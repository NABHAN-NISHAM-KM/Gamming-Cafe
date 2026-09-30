import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Db } from "@arena/db";
import type { DetectedGame } from "@arena/contracts";
import { CONFIG, type AppConfig } from "../config.js";
import { DB } from "../common/db.module.js";
import { LiveBus } from "../devices/live.js";
import { StationConfigService } from "./station-config.service.js";

/**
 * Is build `a` newer than `b`? Numeric-aware ("1.0.3900" > "1.0.3889", "Release-31.10" > "Release-9.2"; Steam build ids are plain integers).
 * ponytail: string heuristic; a build string that isn't version-shaped (hash-only) could misorder — ask the store's API if that shows up.
 */
export const isNewer = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && (!b || a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) > 0);

const FRESH_MS = 15 * 60_000;
const MISS_MS = 5 * 60_000;
const SWEEP_MS = 15 * 60_000;

/**
 * Steam only tells a PC about a new build while the Steam client runs. This
 * asks Steam's app info (the public branch's build id, via a steamcmd PICS
 * mirror) so a PC with Steam closed — or switched off — still shows "needs
 * update". Once per game for the whole platform, cached; never blocks a
 * report for long and never fails one: no answer = trust the PC.
 */
@Injectable()
export class SteamBuildsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("SteamBuilds");
  private readonly cache = new Map<string, { build: string | null; at: number }>();
  private timer?: NodeJS.Timeout;
  private readonly base: string | null;

  constructor(
    @Inject(CONFIG) cfg: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(StationConfigService) private readonly config: StationConfigService,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {
    this.base = cfg.STEAM_BUILDS_URL === "off" ? null : cfg.STEAM_BUILDS_URL ?? (cfg.NODE_ENV === "test" ? null : "https://api.steamcmd.net/v1/info/");
  }

  onModuleInit() {
    if (!this.base) return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(`sweep: ${e instanceof Error ? e.message : e}`)), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Latest public build per Steam appid (only the ones Steam answered for). */
  async latest(appIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.base) return out;
    const now = Date.now();
    await Promise.all(
      [...new Set(appIds)].filter((id) => /^\d{1,10}$/.test(id)).map(async (id) => {
        const hit = this.cache.get(id);
        if (hit && now - hit.at < (hit.build ? FRESH_MS : MISS_MS)) {
          if (hit.build) out.set(id, hit.build);
          return;
        }
        const build = await this.fetchBuild(id);
        this.cache.set(id, { build, at: Date.now() });
        if (build) out.set(id, build);
      }),
    );
    return out;
  }

  private async fetchBuild(appId: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.base}${appId}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: Record<string, { depots?: { branches?: { public?: { buildid?: unknown } } } }> };
      const build = body.data?.[appId]?.depots?.branches?.public?.buildid;
      return typeof build === "string" && /^\d{1,12}$/.test(build) ? build : null;
    } catch {
      return null; // offline, slow or changed format: fall back to what the PC says
    }
  }

  /** A PC's report, with Steam games older than the public build marked as needing an update. */
  async markBehind(found: DetectedGame[]): Promise<DetectedGame[]> {
    const steam = found.filter((g) => g.source === "STEAM" && g.buildId && !g.updateRequired);
    if (!steam.length) return found;
    const latest = await this.latest(steam.map((g) => g.key));
    return found.map((g) => (g.source === "STEAM" && g.buildId && !g.updateRequired && isNewer(latest.get(g.key), g.buildId) ? { ...g, updateRequired: true } : g));
  }

  /**
   * PCs that aren't reporting (Steam closed, PC off) still get flagged when
   * Steam publishes a new build: check every Steam game any PC has.
   */
  async sweep() {
    const orgs = await this.db.global.$queryRaw<Array<{ organization_id: string }>>`SELECT * FROM app.live_organizations()`;
    for (const { organization_id: organizationId } of orgs) {
      const ctx = { organizationId, actorType: "SYSTEM", actorId: null } as const;
      const rows = await this.db.withTenant(ctx, (t) =>
        t.detectedTitle.findMany({ where: { source: "STEAM", kind: "GAME", updateRequired: false, version: { not: null }, device: { isEnabled: true } }, select: { id: true, key: true, version: true, deviceId: true, device: { select: { branchId: true } } } }),
      );
      if (!rows.length) continue;
      const latest = await this.latest(rows.map((r) => r.key));
      const behind = rows.filter((r) => isNewer(latest.get(r.key), r.version));
      if (!behind.length) continue;
      await this.db.withTenant(ctx, async (t) => {
        for (const r of behind) {
          await t.detectedTitle.update({ where: { id: r.id }, data: { updateRequired: true } });
          await t.gameInstallation.updateMany({
            where: { deviceId: r.deviceId, status: "INSTALLED", game: { launcherGameId: r.key, launcher: { key: "STEAM" } } },
            data: { status: "UPDATE_REQUIRED" },
          });
        }
      });
      for (const deviceId of new Set(behind.map((r) => r.deviceId))) await this.config.push(organizationId, deviceId);
      for (const r of behind) this.bus.publish(organizationId, r.device.branchId, { type: "inventory", deviceId: r.deviceId });
      this.log.log(`${behind.length} Steam install(s) behind the public build in ${organizationId}`);
    }
  }
}
