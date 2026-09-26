import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Db, TenantTx } from "@arena/db";
import { canonicalize, type DeviceMetrics, type HardwareSnapshot } from "@arena/contracts";
import { CONFIG, type AppConfig } from "../config.js";
import { DB } from "../common/db.module.js";
import { CommandsService } from "./commands.service.js";
import { DeviceHub, LiveBus, type Connection } from "./live.js";

const PERSIST_EVERY_MS = 30_000;
const OFFLINE_ALERT_AFTER_MS = 120_000;
const MONITORED = ["HIGH_CPU_TEMP", "HIGH_GPU_TEMP", "LOW_DISK"] as const;

/** Alert thresholds (per-branch configuration comes later). */
const THRESHOLDS = {
  cpuTempWarn: 90,
  cpuTempCrit: 97,
  gpuTempWarn: 88,
  gpuTempCrit: 95,
  diskWarn: 92,
};

export const DEVICE_FIELDS = {
  id: true, name: true, kind: true, platform: true, status: true, isEnabled: true, zoneId: true, branchId: true,
  mapX: true, mapY: true, mapW: true, mapH: true, mapRotation: true, ipAddress: true, macAddress: true, hostname: true,
  agentVersion: true, shellVersion: true, lastSeenAt: true, postSessionAction: true, controllerCount: true, notes: true,
  agentless: true, minAge: true, cleaningRequired: true, linkedDisplayId: true, isBridge: true,
} as const;

@Injectable()
export class DeviceRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("DeviceRuntime");
  private sweeper?: NodeJS.Timeout;
  private readonly connectedHooks: Array<(c: Connection, hello: { activeSessionId?: string | null }) => Promise<void>> = [];

  /** Other modules (sessions) react to a device (re)connecting without a circular dependency. */
  onConnected(fn: (c: Connection, hello: { activeSessionId?: string | null }) => Promise<void>) {
    this.connectedHooks.push(fn);
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.sweeper = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 5_000);
    this.sweeper.unref();
  }
  onModuleDestroy() {
    clearInterval(this.sweeper);
  }

  private asDevice<T>(c: Pick<Connection, "organizationId" | "deviceId">, fn: (tx: TenantTx) => Promise<T>) {
    return this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, fn);
  }

  /** Public view of a device for the Live Floor, with live connection state merged in. */
  view(d: Record<string, any>) {
    const live = this.hub.live(d["id"]);
    // A console, VR headset or TV has no agent to be "online": its stored status is the truth.
    if (d["agentless"]) return { ...d, isOnline: true, displayStatus: d["status"], metrics: null, metricsAt: null, currentGame: null };
    return { ...d, isOnline: !!live, displayStatus: live ? d["status"] : "OFFLINE", metrics: live?.metrics ?? null, metricsAt: live?.metricsAt ?? null, currentGame: live?.currentGame ?? null };
  }

  async onHello(c: Connection, hello: { agentVersion: string; shellVersion?: string | null; ipAddress?: string | null; hostname?: string | null; macAddress?: string | null; activeSessionId?: string | null }) {
    const device = await this.asDevice(c, async (tx) => {
      const current = await tx.device.findUniqueOrThrow({ where: { id: c.deviceId }, select: { status: true, macAddress: true } });
      const d = await tx.device.update({
        where: { id: c.deviceId },
        data: {
          isOnline: true,
          lastSeenAt: new Date(),
          agentVersion: hello.agentVersion.slice(0, 32),
          shellVersion: hello.shellVersion?.slice(0, 32) ?? undefined,
          ipAddress: hello.ipAddress?.slice(0, 64) ?? undefined,
          hostname: hello.hostname?.slice(0, 64) ?? undefined,
          macAddress: current.macAddress ?? hello.macAddress?.slice(0, 32) ?? undefined,
          status: current.status === "OFFLINE" ? "AVAILABLE" : undefined,
        },
        select: DEVICE_FIELDS,
      });
      await this.resolveAlert(tx, "CLIENT_OFFLINE", c.deviceId);
      return d;
    });
    this.bus.publish(c.organizationId, c.branchId, { type: "device", device: this.view(device) });
    await this.commands.deliverPending(c.organizationId, c.deviceId);
    for (const hook of this.connectedHooks) await hook(c, hello).catch((e) => this.log.error(`connect hook: ${e instanceof Error ? e.message : e}`));
  }

  async onHeartbeat(c: Connection, m: DeviceMetrics) {
    const now = Date.now();
    c.metrics = m;
    c.metricsAt = now;
    this.bus.publish(c.organizationId, c.branchId, { type: "metrics", deviceId: c.deviceId, metrics: m, at: new Date(now).toISOString() });

    // Alert conditions are evaluated on every heartbeat, in memory; the DB is
    // touched only when an alert must open, change severity or resolve.
    const wanted = this.evaluate(m);
    const synced = c.alerts;
    const changed = !synced || wanted.size !== synced.size || [...wanted].some(([k, v]) => synced.get(k) !== v);
    const persist = now - c.lastPersistAt >= PERSIST_EVERY_MS;
    if (!changed && !persist) return;

    await this.asDevice(c, async (tx) => {
      if (persist) {
        c.lastPersistAt = now;
        await tx.deviceHeartbeat.create({ data: { organizationId: c.organizationId, deviceId: c.deviceId, ...m } });
        await tx.device.update({ where: { id: c.deviceId }, data: { lastSeenAt: new Date(now), isOnline: true } });
      }
      if (changed) {
        for (const type of MONITORED) {
          const sev = wanted.get(type);
          if (sev) await this.openAlert(tx, c, type, sev, this.title(type, m), { metrics: m });
          else if (!synced || synced.has(type)) await this.resolveAlert(tx, type, c.deviceId);
        }
        c.alerts = wanted;
      }
    });
  }

  /** Desired alert state for one sample (with hysteresis against the current state). */
  private evaluate(m: DeviceMetrics) {
    const out = new Map<string, "WARNING" | "CRITICAL">();
    const t = (v: number | null | undefined, warn: number, crit: number, type: string) => {
      if (v != null && v >= warn) out.set(type, v >= crit ? "CRITICAL" : "WARNING");
    };
    t(m.cpuTempC, THRESHOLDS.cpuTempWarn, THRESHOLDS.cpuTempCrit, "HIGH_CPU_TEMP");
    t(m.gpuTempC, THRESHOLDS.gpuTempWarn, THRESHOLDS.gpuTempCrit, "HIGH_GPU_TEMP");
    if (m.diskPct != null && m.diskPct >= THRESHOLDS.diskWarn) out.set("LOW_DISK", "WARNING");
    return out;
  }

  private title(type: string, m: DeviceMetrics) {
    if (type === "HIGH_CPU_TEMP") return `CPU temperature ${Math.round(m.cpuTempC ?? 0)}°C`;
    if (type === "HIGH_GPU_TEMP") return `GPU temperature ${Math.round(m.gpuTempC ?? 0)}°C`;
    return `Disk ${Math.round(m.diskPct ?? 0)}% full`;
  }

  async onHardware(c: Connection, snap: HardwareSnapshot) {
    // Hash only stable identity fields (free space etc. would change constantly).
    const stable = {
      cpu: snap.cpu, cpuCores: snap.cpuCores, gpu: snap.gpu, gpuVramMb: snap.gpuVramMb, ramMb: snap.ramMb, motherboard: snap.motherboard,
      disks: (snap.disks ?? []).map((d) => ({ model: d.model, serial: d.serial, sizeGb: d.sizeGb })),
      nics: (snap.nics ?? []).map((n) => ({ mac: n.mac })),
    };
    const hardwareHash = createHash("sha256").update(canonicalize(stable)).digest("hex");
    await this.asDevice(c, async (tx) => {
      const current = await tx.deviceHardware.findFirst({ where: { deviceId: c.deviceId, isCurrent: true } });
      if (current?.hardwareHash === hardwareHash) return;
      if (current) await tx.deviceHardware.update({ where: { id: current.id }, data: { isCurrent: false } });
      await tx.deviceHardware.create({
        data: {
          organizationId: c.organizationId,
          deviceId: c.deviceId,
          hardwareHash,
          cpu: snap.cpu ?? null,
          cpuCores: snap.cpuCores ?? null,
          gpu: snap.gpu ?? null,
          gpuVramMb: snap.gpuVramMb ?? null,
          ramMb: snap.ramMb ?? null,
          motherboard: snap.motherboard ?? null,
          biosVersion: snap.biosVersion ?? null,
          osVersion: snap.osVersion ?? null,
          disks: (snap.disks ?? []) as object,
          nics: (snap.nics ?? []) as object,
          monitors: (snap.monitors ?? []) as object,
        },
      });
      if (current) {
        const changes = (["cpu", "gpu", "ramMb", "motherboard"] as const)
          .filter((k) => (current as any)[k] !== ((snap as any)[k] ?? null))
          .map((k) => ({ field: k, before: (current as any)[k], after: (snap as any)[k] ?? null }));
        await this.openAlert(tx, c, "HARDWARE_CHANGED", "WARNING", "Unexpected hardware change", { changes, diskOrNicChanged: changes.length === 0 });
      }
    });
  }

  async onDisconnect(c: Connection) {
    const device = await this.asDevice(c, (tx) =>
      tx.device.update({ where: { id: c.deviceId }, data: { isOnline: false, lastSeenAt: new Date(c.lastMessageAt) }, select: DEVICE_FIELDS }),
    ).catch(() => null);
    if (device) this.bus.publish(c.organizationId, c.branchId, { type: "device", device: this.view(device) });
  }

  /** Drops silent connections and raises "client offline" after a grace period. */
  private async sweep() {
    const now = Date.now();
    const silentAfter = this.cfg.DEVICE_HEARTBEAT_SECONDS * 3_500;
    for (const c of this.hub.all()) {
      if (now - c.lastMessageAt > silentAfter) c.socket.terminate();
    }
    for (const [deviceId, o] of this.hub.offlineSince) {
      if (now - o.at < OFFLINE_ALERT_AFTER_MS) continue;
      this.hub.offlineSince.delete(deviceId);
      await this.asDevice({ deviceId, organizationId: o.organizationId }, async (tx) => {
        const d = await tx.device.findUnique({ where: { id: deviceId }, select: { isEnabled: true } });
        if (d?.isEnabled) await this.openAlert(tx, { deviceId, organizationId: o.organizationId, branchId: o.branchId }, "CLIENT_OFFLINE", "WARNING", "Station went offline", { since: new Date(o.at).toISOString() });
      }).catch((e) => this.log.warn(`offline alert failed: ${e}`));
    }
  }

  async openAlert(tx: TenantTx, c: { deviceId: string; organizationId: string; branchId: string }, type: string, severity: "INFO" | "WARNING" | "CRITICAL", title: string, detail: object) {
    const dedupeKey = `${type}:${c.deviceId}`;
    const existing = await tx.alert.findFirst({ where: { dedupeKey, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
    if (existing) {
      if (existing.severity !== severity) await tx.alert.update({ where: { id: existing.id }, data: { severity, title, detail } });
      return;
    }
    const alert = await tx.alert.create({
      data: { organizationId: c.organizationId, branchId: c.branchId, deviceId: c.deviceId, type, severity, title, detail, dedupeKey },
    });
    this.bus.publish(c.organizationId, c.branchId, { type: "alert", alert });
  }

  async resolveAlert(tx: TenantTx, type: string, deviceId: string) {
    const open = await tx.alert.findMany({ where: { dedupeKey: `${type}:${deviceId}`, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
    for (const a of open) {
      const alert = await tx.alert.update({ where: { id: a.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
      if (alert.branchId) this.bus.publish(alert.organizationId, alert.branchId, { type: "alert", alert });
    }
  }
}
