import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Db, TenantTx } from "@arena/db";
import type { DetectedGame } from "@arena/contracts";
import { DB } from "../common/db.module.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import { LiveBus, type Connection } from "../devices/live.js";
import { StationConfigService } from "./station-config.service.js";

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
  ) {}

  onModuleInit() {
    this.gateway.handleStation("inventory", (c, m) => this.ingest(c, m.games));
    this.gateway.handleStation("game_event", (c, m) => this.gameEvent(c, m.event, m.gameId));
  }

  private asDevice<T>(c: Connection, fn: (t: TenantTx) => Promise<T>) {
    return this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, fn);
  }

  async ingest(c: Connection, found: DetectedGame[]) {
    const changed = await this.asDevice(c, async (t) => {
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
        // A PC mid-update still reports "update required": keep the orchestrator's QUEUED/UPDATING.
        const status = d.updateRequired ? (prev && (prev.status === "QUEUED" || prev.status === "UPDATING") ? prev.status : "UPDATE_REQUIRED") : "INSTALLED";
        const data = {
          status,
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
    return { matched: changed };
  }

  async gameEvent(c: Connection, event: "started" | "exited", gameId: string) {
    if (event === "exited") {
      if (c.currentGame?.id === gameId) c.currentGame = null;
    } else {
      const game = await this.asDevice(c, async (t) => {
        const g = await t.game.findUnique({ where: { id: gameId }, select: { id: true, title: true } });
        if (g) await t.gameInstallation.updateMany({ where: { deviceId: c.deviceId, gameId }, data: { lastPlayedAt: new Date() } });
        return g;
      });
      if (!game) return;
      c.currentGame = { id: game.id, title: game.title, startedAt: new Date().toISOString() };
    }
    this.bus.publish(c.organizationId, c.branchId, { type: "activity", deviceId: c.deviceId, game: c.currentGame ?? null });
  }
}
