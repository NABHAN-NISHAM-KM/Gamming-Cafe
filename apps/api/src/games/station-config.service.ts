import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db, TenantTx } from "@arena/db";
import { DEFAULT_CONNECTIVITY_TARGETS, type CommandEnvelope, type ConnectivityTarget, type LaunchSpec, type LibraryGame, type StationConfig } from "@arena/contracts";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";
import { DeviceRuntimeService } from "../devices/device-runtime.service.js";
import { DeviceHub } from "../devices/live.js";
import { SigningKeysService } from "../devices/signing-keys.service.js";

/** How a catalog game is started on a PC. Launcher URIs are built by the agent from these ids. */
export function launchSpec(g: { launcherGameId: string | null; executablePath: string | null; arguments: string | null; workingDirectory: string | null; launcher: { key: string } | null }): LaunchSpec | null {
  if (g.launcher?.key === "STEAM" && g.launcherGameId && /^\d{1,10}$/.test(g.launcherGameId)) return { kind: "STEAM", appId: g.launcherGameId };
  if (g.launcher?.key === "EPIC" && g.launcherGameId && /^[\w.-]{1,128}$/.test(g.launcherGameId)) return { kind: "EPIC", appName: g.launcherGameId };
  if (g.executablePath) return { kind: "PATH", executablePath: g.executablePath, arguments: g.arguments, workingDirectory: g.workingDirectory };
  return null;
}

const zoneAllowed = (allowed: string[], zoneId: string) => allowed.length === 0 || allowed.includes(zoneId);

/**
 * Builds and pushes each station's configuration: its game library (what's
 * enabled for the org and allowed in the PC's zone, with this PC's install
 * state), apps, connectivity targets and pointer presets.
 *
 * The config is SIGNED with the branch key like a command. The agent will
 * launch executables from it on a customer's tap, so it must only ever run
 * what the branch signed off — not whatever arrives on the socket.
 */
@Injectable()
export class StationConfigService implements OnModuleInit {
  private readonly log = new Logger("StationConfig");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(SigningKeysService) private readonly keys: SigningKeysService,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
  ) {}

  onModuleInit() {
    this.runtime.onConnected(async (c) => {
      c.configRevision = undefined;
      await this.push(c.organizationId, c.deviceId);
    });
  }

  async build(t: TenantTx, deviceId: string): Promise<StationConfig> {
    const device = await t.device.findUniqueOrThrow({ where: { id: deviceId }, select: { id: true, zoneId: true, branch: { select: { settings: true } } } });
    const settings = await t.orgGameSetting.findMany({
      where: { isEnabled: true, game: { isActive: true } },
      include: { game: { include: { launcher: { select: { key: true } } } } },
    });
    const installs = new Map((await t.gameInstallation.findMany({ where: { deviceId }, select: { gameId: true, status: true } })).map((i) => [i.gameId, i.status]));

    const games: LibraryGame[] = settings
      .filter((s) => zoneAllowed(s.allowedZoneIds, device.zoneId))
      .map((s) => {
        const g = s.game;
        const status = installs.get(g.id);
        return {
          id: g.id,
          title: g.title,
          categories: g.categories,
          coverUrl: g.coverUrl,
          minAge: s.minAgeOverride ?? g.minAge,
          savePaths: s.savePaths,
          featured: s.isFeatured,
          sortOrder: s.sortOrder,
          launcherKey: g.launcher?.key ?? null,
          launch: launchSpec(g),
          processNames: g.processNames,
          installed: status === "INSTALLED" || status === "UPDATE_REQUIRED" || status === "QUEUED" || status === "UPDATING",
          updateRequired: status === "UPDATE_REQUIRED" || status === "QUEUED" || status === "UPDATING",
        };
      })
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));

    const apps = (await t.shellApp.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }))
      .filter((a) => zoneAllowed(a.allowedZoneIds, device.zoneId))
      .map((a) => ({ id: a.id, name: a.name, kind: a.kind, executablePath: a.executablePath, arguments: a.arguments }));

    const branchTargets = (device.branch.settings as { connectivityTargets?: ConnectivityTarget[] } | null)?.connectivityTargets;
    const presets = (await t.peripheralProfile.findMany({ where: { category: "MOUSE" }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] })).map((p) => ({
      id: p.id,
      name: p.name,
      settings: p.settings as { mouseSpeed?: number; enhancePointerPrecision?: boolean },
    }));

    const body = { games, apps, connectivityTargets: Array.isArray(branchTargets) && branchTargets.length ? branchTargets.slice(0, 8) : DEFAULT_CONNECTIVITY_TARGETS, peripheralPresets: presets };
    const revision = createHash("sha256").update(JSON.stringify(body)).digest("base64url").slice(0, 16);
    return { revision, ...body };
  }

  /** Signs and sends the config to a connected PC (no-op if offline or unchanged). */
  async push(organizationId: string, deviceId: string, force = false) {
    const conn = this.hub.get(deviceId);
    if (!conn) return false;
    return this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (t) => {
      const config = await this.build(t, deviceId);
      if (!force && conn.configRevision === config.revision) return false;
      const issuedAt = new Date();
      const envelope: CommandEnvelope = {
        v: 1,
        commandId: randomUUID(),
        organizationId,
        branchId: conn.branchId,
        deviceId,
        type: "REFRESH_CONFIG",
        payload: config as unknown as Record<string, unknown>,
        requestedBy: { type: "SYSTEM", id: null },
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 10 * 60_000).toISOString(),
        nonce: randomBytes(12).toString("base64url"),
      };
      const command = await this.keys.sign(t, envelope);
      if (this.hub.send(deviceId, { type: "config", command })) conn.configRevision = config.revision;
      return true;
    });
  }

  /** Re-push to every connected PC of the org (optionally one branch) — after settings change, once committed. */
  pushAll(organizationId: string, branchId?: string) {
    const run = async () => {
      for (const c of this.hub.all()) {
        if (c.organizationId !== organizationId || (branchId && c.branchId !== branchId)) continue;
        await this.push(organizationId, c.deviceId).catch((e) => this.log.warn(`config push to ${c.deviceId} failed: ${e instanceof Error ? e.message : e}`));
      }
    };
    const req = requestStore.getStore();
    if (req) req.afterCommit.push(run);
    else void run();
  }
}
