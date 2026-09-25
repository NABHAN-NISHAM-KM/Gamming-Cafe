import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Db, TenantTx } from "@arena/db";
import type { BootReport, DetectedPeripheral, NetworkProbe } from "@arena/contracts";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import { DeviceRuntimeService } from "../devices/device-runtime.service.js";
import { LiveBus, type Connection } from "../devices/live.js";

/** Peripherals a station can't be used without; losing one raises an alert. */
const ESSENTIAL = new Set(["MOUSE", "KEYBOARD", "HEADSET"]);
const PERSIST_NETWORK_MS = 5 * 60_000;
const HELP_COOLDOWN_MS = 60_000;

/** Pure: what the latest probe says about the internet link. */
export function networkHealth(p: NetworkProbe): { level: "OK" | "WARNING" | "CRITICAL"; title: string } {
  const internet = p.targets.filter((t) => t.host !== "gateway");
  if (internet.length === 0) return { level: "OK", title: "" };
  const reachable = internet.filter((t) => t.pingMs !== null && t.lossPct < 100);
  if (reachable.length === 0) return { level: "CRITICAL", title: "Internet unreachable" };
  const worstLoss = Math.max(...internet.map((t) => t.lossPct));
  const bestPing = Math.min(...reachable.map((t) => t.pingMs!));
  if (worstLoss >= 20) return { level: "WARNING", title: `Packet loss ${Math.round(worstLoss)}%` };
  if (bestPing >= 150) return { level: "WARNING", title: `High latency ${Math.round(bestPing)} ms` };
  return { level: "OK", title: "" };
}

/**
 * Reports from the station agent about the PC itself: peripherals, network
 * quality, boot mode (local disk vs diskless), customer help requests and
 * self-service repairs. Everything is written as the DEVICE actor, in the
 * device's own tenant.
 */
@Injectable()
export class StationReportsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  onModuleInit() {
    this.gateway.handleStation("peripherals", (c, m) => this.peripherals(c, m.items));
    this.gateway.handleStation("network", (c, m) => this.network(c, m.probe));
    this.gateway.handleStation("boot", (c, m) => this.boot(c, m.report));
    this.gateway.handleStation("help_request", (c, m) => this.help(c, m.topic, m.note ?? null));
    this.gateway.handleStation("self_repair", (c, m) => this.selfRepair(c, m.action, m.ok, m.detail ?? null));
  }

  private asDevice<T>(c: Connection, fn: (t: TenantTx) => Promise<T>) {
    return this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, fn);
  }

  async peripherals(c: Connection, items: DetectedPeripheral[]) {
    await this.asDevice(c, async (t) => {
      const now = new Date();
      const seen = new Set<string>();
      for (const p of items) {
        if (seen.has(p.hardwareId)) continue;
        seen.add(p.hardwareId);
        await t.deviceAccessory.upsert({
          where: { deviceId_hardwareId: { deviceId: c.deviceId, hardwareId: p.hardwareId } },
          create: { organizationId: c.organizationId, deviceId: c.deviceId, hardwareId: p.hardwareId, type: p.type, label: p.name, vendor: p.vendor ?? null, connected: true, lastSeenAt: now },
          update: { type: p.type, label: p.name, vendor: p.vendor ?? null, connected: true, lastSeenAt: now },
        });
      }
      const gone = await t.deviceAccessory.findMany({ where: { deviceId: c.deviceId, hardwareId: { not: null, notIn: [...seen] }, connected: true } });
      if (gone.length) await t.deviceAccessory.updateMany({ where: { id: { in: gone.map((g) => g.id) } }, data: { connected: false } });

      // Alert if an essential kind is now missing entirely (a second mouse still counts as "has a mouse").
      const present = new Set<string>(items.map((i) => i.type));
      const known = await t.deviceAccessory.findMany({ where: { deviceId: c.deviceId, hardwareId: { not: null }, type: { in: [...ESSENTIAL] as any } }, select: { type: true, label: true, connected: true } });
      const missing = [...new Set(known.filter((k) => !k.connected && !present.has(k.type)).map((k) => k.type))];
      if (missing.length) {
        const title = `${missing.map((m) => m.charAt(0) + m.slice(1).toLowerCase()).join(" & ")} disconnected`;
        await this.runtime.openAlert(t, c, "PERIPHERAL_MISSING", "WARNING", title, { missing, labels: known.filter((k) => missing.includes(k.type) && !k.connected).map((k) => k.label) });
      } else {
        await this.runtime.resolveAlert(t, "PERIPHERAL_MISSING", c.deviceId);
      }
    });
  }

  async network(c: Connection, probe: NetworkProbe) {
    const at = new Date().toISOString();
    c.network = { ...probe, at };
    this.bus.publish(c.organizationId, c.branchId, { type: "network", deviceId: c.deviceId, network: c.network });
    const health = networkHealth(probe);
    const now = Date.now();
    const persist = !c.networkPersistAt || now - c.networkPersistAt > PERSIST_NETWORK_MS;
    const alertState = c.networkAlert;
    const wanted = health.level === "OK" ? undefined : health.level;
    if (!persist && alertState === wanted) return;
    await this.asDevice(c, async (t) => {
      if (persist) {
        const d = await t.device.findUniqueOrThrow({ where: { id: c.deviceId }, select: { metadata: true } });
        await t.device.update({ where: { id: c.deviceId }, data: { metadata: { ...((d.metadata as object) ?? {}), network: c.network } as object } });
        c.networkPersistAt = now;
      }
      if (alertState !== wanted) {
        if (wanted) await this.runtime.openAlert(t, c, "NETWORK_DEGRADED", wanted, health.title, { targets: probe.targets });
        else await this.runtime.resolveAlert(t, "NETWORK_DEGRADED", c.deviceId);
        c.networkAlert = wanted;
      }
    });
  }

  async boot(c: Connection, r: BootReport) {
    await this.asDevice(c, async (t) => {
      const integration = r.mode === "ISCSI" ? await t.disklessIntegration.findFirst({ where: { branchId: c.branchId, isActive: true }, select: { id: true } }) : null;
      const data = {
        bootStatus: r.mode === "LOCAL_DISK" ? ("LOCAL_DISK" as const) : r.mode === "ISCSI" ? ("BOOTED" as const) : ("UNKNOWN" as const),
        bootServer: r.bootServer ?? null,
        imageName: r.imageName ?? (r.provider ? `${r.provider} image` : null),
        integrationId: integration?.id ?? null,
        lastBootAt: new Date(),
      };
      await t.deviceBootInfo.upsert({ where: { deviceId: c.deviceId }, create: { organizationId: c.organizationId, deviceId: c.deviceId, ...data }, update: data });
    });
  }

  async help(c: Connection, topic: string, note: string | null) {
    const now = Date.now();
    if (c.lastHelpAt && now - c.lastHelpAt < HELP_COOLDOWN_MS) return { ok: true, duplicate: true };
    c.lastHelpAt = now;
    await this.asDevice(c, async (t) => {
      const d = await t.device.findUniqueOrThrow({ where: { id: c.deviceId }, select: { name: true } });
      const session = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: ["ACTIVE", "ENDING", "PAUSED"] } }, select: { id: true, customer: { select: { displayName: true } } } });
      const who = session?.customer?.displayName;
      await this.runtime.openAlert(t, c, "HELP_REQUESTED", "WARNING", `${d.name}: ${who ? `${who} needs` : "customer needs"} help (${topic})`, { topic, note, sessionId: session?.id ?? null });
    });
    return { ok: true };
  }

  async selfRepair(c: Connection, action: string, ok: boolean, detail: string | null) {
    await this.asDevice(c, (t) => auditAs(t, { type: "DEVICE", id: c.deviceId }, { action: `station.self_repair.${action}`, entityType: "Device", entityId: c.deviceId, branchId: c.branchId, after: { ok, detail } }));
  }
}
