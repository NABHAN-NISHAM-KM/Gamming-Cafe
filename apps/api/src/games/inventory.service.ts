import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Db, TenantTx } from "@arena/db";
import type { DetectedApp, DetectedGame } from "@arena/contracts";
import { DB } from "../common/db.module.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import { LiveBus, type Connection } from "../devices/live.js";
import { StationConfigService } from "./station-config.service.js";
import { SteamBuildsService, isNewer } from "./steam-builds.service.js";

/** Statuses that mean "an update is outstanding or in progress" on a PC. */
export const UPDATING = ["UPDATE_REQUIRED", "QUEUED", "UPDATING"] as const;

/**
 * What is installed where. Each PC reports what it found (Steam/Epic
 * manifests, catalog executables); we match that to the catalog and keep
 * GameInstallation current. Nothing here trusts the PC beyond "what I see on
 * my own disk" — it can't create catalog entries or touch another PC's rows.
 */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(StationConfigService) private readonly config: StationConfigService,
    @Inject(SteamBuildsService) private readonly steam: SteamBuildsService,
  ) {}

  onModuleInit() {
    this.gateway.handleStation("inventory", (c, m) => this.ingest(c, m.games, m.apps));
    this.gateway.handleStation("game_event", (c, m) => this.gameEvent(c, m.event, m.gameId));
  }

  private asDevice<T>(c: Connection, fn: (t: TenantTx) => Promise<T>) {
    return this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, fn);
  }

  async ingest(c: Connection, reported: DetectedGame[], apps?: DetectedApp[]) {
    const vsSteam = await this.steam.markBehind(reported); // network, so outside the transaction
    const changed = await this.asDevice(c, async (t) => {
      const found = await this.epicBehind(t, c, vsSteam);
      await this.recordDetected(t, c, found, apps);
      const games = await t.game.findMany({ where: { isActive: true }, select: { id: true, launcherGameId: true, launcher: { select: { key: true } } } });
      const byStore = new Map<string, string>();
      const ids = new Set<string>();
      for (const g of games) {
        ids.add(g.id);
        if (g.launcher && g.launcherGameId) byStore.set(`${g.launcher.key}:${g.launcherGameId.toLowerCase()}`, g.id);
      }
      const matched = new Map<string, DetectedGame>();
      for (const d of found) {
        const gameId = d.source === "PATH" ? (ids.has(d.key) ? d.key : undefined) : byStore.get(`${d.source}:${d.key.toLowerCase()}`);
        if (gameId && !matched.has(gameId)) matched.set(gameId, d);
      }

      const existing = new Map((await t.gameInstallation.findMany({ where: { deviceId: c.deviceId } })).map((i) => [i.gameId, i]));
      const now = new Date();
      let changes = 0;
      for (const [gameId, d] of matched) {
        const prev = existing.get(gameId);
        // The launcher says it's downloading → UPDATING (whoever started it: us, Steam's auto-update, staff).
        // Otherwise a pending update keeps the orchestrator's QUEUED/UPDATING until the PC reports it done.
        const status = !d.updateRequired ? "INSTALLED" : d.updating ? "UPDATING" : prev && (prev.status === "QUEUED" || prev.status === "UPDATING") ? prev.status : "UPDATE_REQUIRED";
        const data = {
          status,
          progressPct: d.updateRequired ? d.progressPct ?? null : null,
          detectedBy: d.source,
          buildId: d.buildId ?? null,
          installPath: d.installPath ?? null,
          sizeBytes: d.sizeBytes != null ? BigInt(d.sizeBytes) : null,
          lastCheckedAt: now,
        } as const;
        if (!prev) {
          await t.gameInstallation.create({ data: { organizationId: c.organizationId, deviceId: c.deviceId, gameId, ...data } });
          changes++;
        } else {
          if (prev.status !== status || prev.buildId !== data.buildId) changes++;
          await t.gameInstallation.update({ where: { id: prev.id }, data });
        }
      }
      for (const [gameId, prev] of existing) {
        if (matched.has(gameId) || prev.status === "NOT_INSTALLED") continue;
        await t.gameInstallation.update({ where: { id: prev.id }, data: { status: "NOT_INSTALLED", lastCheckedAt: now } });
        changes++;
      }
      return changes;
    });
    if (changed) await this.config.push(c.organizationId, c.deviceId);
    // Agents only send when something changed, so every report is news for open Games pages.
    this.bus.publish(c.organizationId, c.branchId, { type: "inventory", deviceId: c.deviceId });
    return { matched: changed };
  }

  /**
   * Epic manifests never say "update available", so an Epic game counts as
   * needing one when another PC in the organization runs a newer build.
   * From there it flows like Steam: badge, Update button, rollout, done when
   * the PC's next scan reports the newest build.
   */
  private async epicBehind(t: TenantTx, c: Connection, found: DetectedGame[]) {
    const epic = found.filter((g) => g.source === "EPIC" && g.buildId);
    if (!epic.length) return found;
    const others = await t.detectedTitle.findMany({
      where: { source: "EPIC", key: { in: epic.map((g) => g.key) }, deviceId: { not: c.deviceId }, version: { not: null } },
      select: { key: true, version: true },
    });
    const newest = new Map<string, string>();
    for (const o of others) if (isNewer(o.version!, newest.get(o.key))) newest.set(o.key, o.version!);
    return found.map((g) => (g.source === "EPIC" && g.buildId && isNewer(newest.get(g.key), g.buildId) ? { ...g, updateRequired: true } : g));
  }

  /**
   * Everything the scan saw, catalog or not, replacing this PC's previous
   * report. Apps are only replaced when the agent sent them (older agents don't).
   */
  private async recordDetected(t: TenantTx, c: Connection, found: DetectedGame[], apps?: DetectedApp[]) {
    const base = { organizationId: c.organizationId, deviceId: c.deviceId, lastSeenAt: new Date() };
    const size = (n?: number | null) => (n != null ? BigInt(n) : null);
    const games = found
      .filter((g) => g.source !== "PATH") // PATH hits are catalog games already
      .map((g) => ({
        ...base, kind: "GAME", source: g.source, key: g.key, name: g.name, version: g.buildId ?? null, installPath: g.installPath ?? null, sizeBytes: size(g.sizeBytes),
        updateRequired: !!g.updateRequired, updating: !!g.updating, progressPct: g.updateRequired ? g.progressPct ?? null : null,
      }));
    const programs = (apps ?? []).map((a) => ({ ...base, kind: "APP", source: "REGISTRY", key: a.key, name: a.name, version: a.version ?? null, publisher: a.publisher ?? null, installPath: a.installPath ?? null, executablePath: a.executablePath ?? null, sizeBytes: size(a.sizeBytes) }));
    await t.detectedTitle.deleteMany({ where: { deviceId: c.deviceId, ...(apps ? {} : { kind: "GAME" }) } });
    const data = [...games, ...programs];
    if (data.length) await t.detectedTitle.createMany({ data, skipDuplicates: true });
  }

  async gameEvent(c: Connection, event: "started" | "exited", gameId: string) {
    if (event === "exited") {
      if (c.currentGame?.id === gameId) c.currentGame = null;
    } else {
      const game = await this.asDevice(c, async (t) => {
        const g = await t.game.findUnique({ where: { id: gameId }, select: { id: true, title: true } });
        if (g) await t.gameInstallation.updateMany({ where: { deviceId: c.deviceId, gameId }, data: { lastPlayedAt: new Date() } });
        // "Recently played" for the player at this PC (their own list, on any PC).
        const s = g ? await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: ["PENDING", "ACTIVE", "PAUSED", "ENDING"] } }, select: { customerId: true } }) : null;
        if (s?.customerId) {
          await t.customerRecentGame.upsert({
            where: { customerId_gameId: { customerId: s.customerId, gameId } },
            create: { organizationId: c.organizationId, customerId: s.customerId, gameId },
            update: { plays: { increment: 1 }, lastPlayedAt: new Date() },
          });
        }
        return g;
      });
      if (!game) return;
      c.currentGame = { id: game.id, title: game.title, startedAt: new Date().toISOString() };
    }
    this.bus.publish(c.organizationId, c.branchId, { type: "activity", deviceId: c.deviceId, game: c.currentGame ?? null });
  }
}
