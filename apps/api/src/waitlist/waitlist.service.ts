import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Db, TenantTx } from "@arena/db";
import { DB } from "../common/db.module.js";
import { LiveBus } from "../devices/live.js";
import { PushService } from "../push/push.service.js";
import { LIVE_STATUSES } from "../sessions/sessions.service.js";

/** Minutes someone has to claim a station they were offered. */
export const CLAIM_MINUTES = 10;
const STATIONS = ["GAMING_PC", "INTERNET_PC", "CONSOLE", "VR_HEADSET", "SIMULATOR"] as const;
const OPEN = ["WAITING", "NOTIFIED"] as const;

export interface NewEntry {
  branchId: string;
  zoneId?: string | null;
  customerId?: string | null;
  name: string;
  phone?: string | null;
  partySize: number;
  source: "STAFF" | "APP";
  createdById?: string | null;
}

/**
 * The waitlist for a full floor. When enough stations are free in the zone
 * someone asked for, the first in line is offered them for CLAIM_MINUTES:
 * staff get a pop-up and app users a push. An offer that isn't claimed
 * lapses and the next person is offered. Someone who starts playing at the
 * branch is marked seated automatically.
 */
@Injectable()
export class WaitlistService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Waitlist");
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly sweepMs = Number(process.env["WAITLIST_SWEEP_MS"] ?? 30_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async add(t: TenantTx, organizationId: string, e: NewEntry) {
    const branch = await t.branch.findUnique({ where: { id: e.branchId }, select: { id: true } });
    if (!branch) throw new NotFoundException({ error: "branch_not_found" });
    if (e.zoneId && !(await t.zone.findFirst({ where: { id: e.zoneId, branchId: e.branchId }, select: { id: true } }))) throw new NotFoundException({ error: "zone_not_found" });
    try {
      const row = await t.waitlistEntry.create({ data: { organizationId, branchId: e.branchId, zoneId: e.zoneId ?? null, customerId: e.customerId ?? null, name: e.name, phone: e.phone ?? null, partySize: e.partySize, source: e.source, createdById: e.createdById ?? null } });
      this.bus.publish(organizationId, e.branchId, { type: "waitlist", change: "added", entry: { id: row.id, name: row.name, partySize: row.partySize } });
      return row;
    } catch (err) {
      if (String(err).includes("waitlist_one_active_per_customer")) throw new ConflictException({ error: "already_waiting" });
      throw err;
    }
  }

  /** The line at a branch, in order, with each zone's free stations and the next expected to free up. */
  async board(t: TenantTx, branchId: string) {
    const entries = await t.waitlistEntry.findMany({
      where: { branchId, status: { in: [...OPEN] } },
      orderBy: { createdAt: "asc" },
      include: { customer: { select: { displayName: true, username: true } } },
    });
    const zones = await t.zone.findMany({ where: { branchId, isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
    const free = await this.freeStations(t, branchId);
    const ending = await t.gamingSession.findMany({
      where: { branchId, status: { in: [...LIVE_STATUSES] }, expiresAt: { not: null } },
      select: { expiresAt: true, device: { select: { zoneId: true } } },
      orderBy: { expiresAt: "asc" },
    });
    const devices = new Map((await t.device.findMany({ where: { id: { in: entries.map((x) => x.offeredDeviceId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const nextFree = (zoneId: string | null) => ending.find((s) => !zoneId || s.device.zoneId === zoneId)?.expiresAt ?? null;
    return {
      zones: zones.map((z) => ({ ...z, free: free.filter((d) => d.zoneId === z.id).length, nextFreeAt: nextFree(z.id) })),
      entries: entries.map((x, i) => ({
        id: x.id, position: i + 1, name: x.customer?.displayName ?? x.name, phone: x.phone, partySize: x.partySize, zoneId: x.zoneId, status: x.status, source: x.source,
        customer: x.customer ? { id: x.customerId, username: x.customer.username } : null,
        offeredDevice: x.offeredDeviceId ? (devices.get(x.offeredDeviceId) ?? null) : null, claimUntil: x.claimUntil, createdAt: x.createdAt, nextFreeAt: nextFree(x.zoneId),
      })),
    };
  }

  /** A customer's own place in line (app). */
  async mine(t: TenantTx, customerId: string) {
    const e = await t.waitlistEntry.findFirst({ where: { customerId, status: { in: [...OPEN] } }, include: { branch: { select: { name: true } } } });
    if (!e) return null;
    const ahead = await t.waitlistEntry.count({ where: { branchId: e.branchId, status: { in: [...OPEN] }, createdAt: { lt: e.createdAt } } });
    const device = e.offeredDeviceId ? await t.device.findUnique({ where: { id: e.offeredDeviceId }, select: { name: true } }) : null;
    const zone = e.zoneId ? await t.zone.findUnique({ where: { id: e.zoneId }, select: { name: true } }) : null;
    return { id: e.id, branch: e.branch.name, zone: zone?.name ?? null, partySize: e.partySize, status: e.status, position: ahead + 1, device: device?.name ?? null, claimUntil: e.claimUntil, createdAt: e.createdAt };
  }

  async setStatus(t: TenantTx, id: string, status: "SEATED" | "CANCELLED", where: { customerId?: string; branchId?: string } = {}) {
    const e = await t.waitlistEntry.findFirst({ where: { id, ...where, status: { in: [...OPEN] } } });
    if (!e) throw new NotFoundException({ error: "not_found" });
    const after = await t.waitlistEntry.update({ where: { id }, data: { status } });
    this.bus.publish(e.organizationId, e.branchId, { type: "waitlist", change: "updated", entry: { id, name: e.name, partySize: e.partySize } });
    return after;
  }

  /** Stations free now at a branch: idle, enabled, and not booked in the next hour. */
  private async freeStations(t: TenantTx, branchId: string) {
    const soon = new Date(Date.now() + 60 * 60_000);
    const devices = await t.device.findMany({
      where: { branchId, isEnabled: true, status: "AVAILABLE", kind: { in: [...STATIONS] }, gamingSessions: { none: { status: { in: [...LIVE_STATUSES] } } } },
      select: { id: true, name: true, zoneId: true },
      orderBy: { name: "asc" },
    });
    const booked = new Set(
      (await t.bookingResource.findMany({ where: { deviceId: { in: devices.map((d) => d.id) }, isLive: true, startsAt: { lt: soon }, endsAt: { gt: new Date() } }, select: { deviceId: true } })).map((r) => r.deviceId!),
    );
    return devices.filter((d) => !booked.has(d.id));
  }

  /** One pass for one organization: seat players who started, lapse old offers, offer free stations. */
  async tick(t: TenantTx, organizationId: string, now = new Date()) {
    const open = await t.waitlistEntry.findMany({ where: { status: { in: [...OPEN] } }, orderBy: { createdAt: "asc" } });
    // Started playing at that branch since joining the line → seated.
    for (const e of open.filter((x) => x.customerId)) {
      const playing = await t.gamingSession.findFirst({ where: { customerId: e.customerId!, branchId: e.branchId, startedAt: { gte: e.createdAt } }, select: { id: true } });
      if (playing) await t.waitlistEntry.update({ where: { id: e.id }, data: { status: "SEATED" } });
    }
    await t.waitlistEntry.updateMany({ where: { status: "NOTIFIED", claimUntil: { lt: now } }, data: { status: "EXPIRED" } });

    const waiting = await t.waitlistEntry.findMany({ where: { status: "WAITING" }, orderBy: { createdAt: "asc" } });
    for (const branchId of [...new Set(waiting.map((w) => w.branchId))]) {
      const held = new Set((await t.waitlistEntry.findMany({ where: { branchId, status: "NOTIFIED" }, select: { offeredDeviceId: true } })).map((x) => x.offeredDeviceId));
      let free = (await this.freeStations(t, branchId)).filter((d) => !held.has(d.id));
      for (const e of waiting.filter((w) => w.branchId === branchId)) {
        const fits = free.filter((d) => !e.zoneId || d.zoneId === e.zoneId);
        // A group needs its stations together in one zone.
        const zone = e.zoneId ?? [...new Set(fits.map((d) => d.zoneId))].find((z) => fits.filter((d) => d.zoneId === z).length >= e.partySize);
        const seats = fits.filter((d) => d.zoneId === zone).slice(0, e.partySize);
        if (seats.length < e.partySize) continue;
        free = free.filter((d) => !seats.includes(d));
        const claimUntil = new Date(now.getTime() + CLAIM_MINUTES * 60_000);
        await t.waitlistEntry.update({ where: { id: e.id }, data: { status: "NOTIFIED", offeredDeviceId: seats[0]!.id, notifiedAt: now, claimUntil } });
        const names = seats.map((d) => d.name).join(", ");
        this.bus.publish(organizationId, branchId, { type: "waitlist", change: "offered", entry: { id: e.id, name: e.name, partySize: e.partySize, device: names } });
        if (e.customerId) {
          await this.push.notify(t, { customerId: e.customerId, event: "waitlist.ready", title: "Your station is ready", body: `${names} is free — you have ${CLAIM_MINUTES} minutes to claim it at the counter.`, screen: "home", dedupeKey: `waitlist:${e.id}`, branchId });
        }
      }
    }
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.db.global.$queryRaw<Array<{ organization_id: string }>>`SELECT * FROM app.waitlist_orgs()`;
      for (const { organization_id } of orgs) {
        await this.db.withTenant({ organizationId: organization_id, actorType: "SYSTEM", actorId: null }, (t) => this.tick(t, organization_id)).catch((e) => this.log.error(`waitlist ${organization_id}: ${e instanceof Error ? e.message : e}`));
      }
    } finally {
      this.running = false;
    }
  }
}
