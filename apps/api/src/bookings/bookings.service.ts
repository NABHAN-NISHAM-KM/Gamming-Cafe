import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Db, TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { LiveBus } from "../devices/live.js";
import { PushService } from "../push/push.service.js";
import { earnEvent } from "../loyalty/points.js";
import { quote, selectPlans } from "../sessions/pricing.js";
import { LIVE_STATUSES, SessionsService, stationClassFor, toPlanDef, type PaymentMethodInput } from "../sessions/sessions.service.js";
import { fromMinor, moveMoney } from "../wallet/wallet.js";

export type BookingActor = { type: "EMPLOYEE"; id: string } | { type: "CUSTOMER"; id: string } | { type: "SYSTEM"; id: null };

/** Rules (per branch settings in a later phase). */
export const BOOKING_RULES = {
  minMinutes: 30,
  maxMinutes: 12 * 60,
  maxPlayers: 20,
  staffWindowDays: 60,
  defaultWindowDays: 7,
  checkInEarlyMinutes: 15,
  noShowGraceMinutes: 15,
  customerCancelCutoffMinutes: 60,
};

const BOOKABLE_ZONES = ["PC_STANDARD", "PC_VIP", "BOOTCAMP", "STREAMING", "CONSOLE", "VR", "SIMULATOR", "PRIVATE_ROOM"];
const RESOURCE_TYPE: Record<string, "PC" | "VIP_PC" | "CONSOLE" | "VR" | "SIMULATOR" | "PRIVATE_ROOM" | "BOOTCAMP"> = {
  PC_STANDARD: "PC", PC_VIP: "VIP_PC", BOOTCAMP: "BOOTCAMP", STREAMING: "PC", CONSOLE: "CONSOLE", VR: "VR", SIMULATOR: "SIMULATOR", PRIVATE_ROOM: "PRIVATE_ROOM",
};

const reference = () => `BK-${randomBytes(5).toString("base64url").replace(/[-_]/g, "X").toUpperCase().slice(0, 6)}`;

export interface CreateBooking {
  branchId: string;
  zoneId?: string | null;
  deviceIds?: string[];
  players: number;
  startsAt: Date;
  minutes: number;
  customerId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  source: "STAFF" | "PHONE" | "CUSTOMER_WEB";
  idempotencyKey: string;
}

/**
 * Reservations of stations for a time window. The database guarantees no
 * double booking (GiST exclusion on BookingResource); this service picks free
 * stations, prices the booking, checks customers in (which starts their
 * sessions) and closes out no-shows automatically.
 */
@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Bookings");
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly sweepMs = Number(process.env["BOOKING_SWEEP_MS"] ?? 30_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SessionsService) private readonly sessions: SessionsService,
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

  // ── availability ─────────────────────────────────────────────────────────

  async availability(t: TenantTx, q: { branchId: string; zoneId?: string | null; startsAt: Date; minutes: number }) {
    const end = new Date(q.startsAt.getTime() + q.minutes * 60_000);
    const zones = await t.zone.findMany({
      where: { branchId: q.branchId, isActive: true, type: { in: BOOKABLE_ZONES as any }, ...(q.zoneId ? { id: q.zoneId } : {}) },
      select: { id: true, name: true, type: true, devices: { where: { isEnabled: true }, select: { id: true, name: true, status: true, kind: true }, orderBy: { name: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    const ids = zones.flatMap((z) => z.devices.map((d) => d.id));
    const booked = new Set(
      (await t.bookingResource.findMany({ where: { deviceId: { in: ids }, isLive: true, startsAt: { lt: end }, endsAt: { gt: q.startsAt } }, select: { deviceId: true } })).map((r) => r.deviceId!),
    );
    // A running session blocks the slot if it will still be going at the start.
    const live = await t.gamingSession.findMany({ where: { deviceId: { in: ids }, status: { in: [...LIVE_STATUSES] } }, select: { deviceId: true, expiresAt: true } });
    const busyNow = new Set(live.filter((s) => (s.expiresAt ? s.expiresAt > q.startsAt : q.startsAt.getTime() - Date.now() < 3 * 3_600_000)).map((s) => s.deviceId));
    return zones.map((z) => {
      const devices = z.devices.map((d) => ({ id: d.id, name: d.name, free: !booked.has(d.id) && !busyNow.has(d.id) && d.status !== "MAINTENANCE" }));
      return { zoneId: z.id, name: z.name, type: z.type, free: devices.filter((d) => d.free).length, total: devices.length, devices };
    });
  }

  /**
   * Each station in a zone with the periods it is taken between `from` and
   * `to` (live bookings, a running session). Who took it is never included.
   */
  async schedule(t: TenantTx, q: { branchId: string; zoneId: string; from: Date; to: Date }) {
    const zone = await t.zone.findFirst({ where: { id: q.zoneId, branchId: q.branchId, isActive: true, type: { in: BOOKABLE_ZONES as any } }, select: { id: true, devices: { where: { isEnabled: true }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } } } });
    if (!zone) throw new NotFoundException({ error: "zone_not_found" });
    const ids = zone.devices.map((d) => d.id);
    const busy = new Map<string, Array<{ from: string; to: string }>>(ids.map((id) => [id, []]));
    for (const r of await t.bookingResource.findMany({ where: { deviceId: { in: ids }, isLive: true, startsAt: { lt: q.to }, endsAt: { gt: q.from } }, select: { deviceId: true, startsAt: true, endsAt: true } })) {
      busy.get(r.deviceId!)?.push({ from: r.startsAt.toISOString(), to: r.endsAt.toISOString() });
    }
    const now = new Date();
    for (const s of await t.gamingSession.findMany({ where: { deviceId: { in: ids }, status: { in: [...LIVE_STATUSES] } }, select: { deviceId: true, expiresAt: true } })) {
      busy.get(s.deviceId)?.push({ from: now.toISOString(), to: (s.expiresAt ?? new Date(now.getTime() + 3 * 3_600_000)).toISOString() });
    }
    return zone.devices.map((d) => ({ id: d.id, name: d.name, maintenance: d.status === "MAINTENANCE", busy: busy.get(d.id)!.sort((a, b) => a.from.localeCompare(b.from)) }));
  }

  /** Price per station for a zone at a start time (what the booking will show as its estimate). */
  async estimateFor(t: TenantTx, q: { branchId: string; zoneId: string; startsAt: Date; minutes: number; customerId: string | null }) {
    const branch = await t.branch.findUnique({ where: { id: q.branchId }, select: { id: true, currency: true, timezone: true } });
    const zone = await t.zone.findFirst({ where: { id: q.zoneId, branchId: q.branchId }, select: { type: true } });
    if (!branch || !zone) throw new NotFoundException({ error: "zone_not_found" });
    const unit = (await t.currency.findUnique({ where: { code: branch.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    const minor = await this.estimate(t, { branchId: branch.id, zoneId: q.zoneId, zoneType: zone.type, timezone: branch.timezone, currency: branch.currency, startsAt: q.startsAt, minutes: q.minutes, customerId: q.customerId });
    return { currency: branch.currency, perStation: fromMinor(minor, unit).toFixed(unit), perStationMinor: minor, unit };
  }

  /**
   * "Pay now" for a booking. The money goes to the customer's wallet (a
   * top-up tied to the booking) and check-in pays from the wallet — so it is
   * recorded once, and if plans change the credit simply stays theirs.
   * DEMO_CARD is a simulated card for demos; a real gateway plugs in here.
   */
  async prepay(t: TenantTx, bookingId: string, method: "DEMO_CARD", actor: BookingActor, key: string) {
    const b = await t.booking.findUnique({ where: { id: bookingId } });
    if (!b || !b.customerId) throw new NotFoundException({ error: "not_found" });
    if (b.status !== "CONFIRMED") throw new ConflictException({ error: "not_confirmed" });
    if (b.depositAmount.gt(0)) return this.view(t, bookingId);
    const unit = (await t.currency.findUnique({ where: { code: b.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    const amountMinor = Math.round(Number(b.estimatedTotal) * 10 ** unit);
    if (amountMinor <= 0) throw new ConflictException({ error: "nothing_to_pay" });
    const existing = await t.payment.findFirst({ where: { idempotencyKey: `${key}:prepay` } });
    const payment =
      existing ??
      (await t.payment.create({
        data: {
          organizationId: b.organizationId, branchId: b.branchId, bookingId: b.id, customerId: b.customerId, method: "ONLINE", provider: "MANUAL",
          providerRef: `demo_${randomBytes(6).toString("hex")}`, status: "CAPTURED", amount: b.estimatedTotal, currency: b.currency, idempotencyKey: `${key}:prepay`, capturedAt: new Date(),
        },
      }));
    await moveMoney(t, { customerId: b.customerId, bucket: "CASH", deltaMinor: amountMinor, type: "TOPUP", reason: `Prepaid booking ${b.reference}`, branchId: b.branchId, referenceType: "BOOKING", referenceId: b.id, paymentId: payment.id, idempotencyKey: `${key}:prepay-credit` });
    await t.booking.update({ where: { id: b.id }, data: { depositAmount: b.estimatedTotal } });
    await auditAs(t, actor, { action: "booking.prepay", entityType: "Booking", entityId: b.id, branchId: b.branchId, after: { amount: b.estimatedTotal.toFixed(unit), method, paymentId: payment.id } });
    return this.view(t, bookingId);
  }

  // ── create ───────────────────────────────────────────────────────────────

  async create(t: TenantTx, i: CreateBooking, actor: BookingActor) {
    const dup = await t.booking.findFirst({ where: { idempotencyKey: i.idempotencyKey } });
    if (dup) return this.view(t, dup.id);

    const r = BOOKING_RULES;
    if (!Number.isInteger(i.minutes) || i.minutes < r.minMinutes || i.minutes > r.maxMinutes) throw new HttpException({ error: "bad_duration", min: r.minMinutes, max: r.maxMinutes }, 400);
    if (!Number.isInteger(i.players) || i.players < 1 || i.players > r.maxPlayers) throw new HttpException({ error: "bad_players", max: r.maxPlayers }, 400);
    const now = Date.now();
    if (i.startsAt.getTime() < now - 5 * 60_000) throw new ConflictException({ error: "starts_in_past" });

    // How far ahead: staff up to 60 days; customers per their membership tier.
    let windowDays = r.staffWindowDays;
    let customer: { id: string; displayName: string; phone: string | null; status: string } | null = null;
    if (i.customerId) {
      const c = await t.customer.findUnique({ where: { id: i.customerId }, select: { id: true, displayName: true, phone: true, status: true, membershipTier: { select: { bookingWindowDays: true } } } });
      if (!c) throw new NotFoundException({ error: "customer_not_found" });
      if (c.status === "BANNED" || c.status === "DELETED") throw new ConflictException({ error: "customer_blocked" });
      customer = c;
      if (actor.type === "CUSTOMER") windowDays = c.membershipTier?.bookingWindowDays ?? r.defaultWindowDays;
    }
    if (i.startsAt.getTime() > now + windowDays * 86_400_000) throw new ConflictException({ error: "too_far_ahead", maxDays: windowDays });
    if (!customer && !i.contactName) throw new HttpException({ error: "contact_required", hint: "A customer account or a contact name is needed" }, 400);

    const branch = await t.branch.findUnique({ where: { id: i.branchId }, select: { id: true, currency: true, timezone: true, organizationId: true } });
    if (!branch) throw new NotFoundException({ error: "branch_not_found" });

    // Which stations: the ones asked for, or the first free ones in the zone.
    const avail = await this.availability(t, { branchId: branch.id, zoneId: i.zoneId, startsAt: i.startsAt, minutes: i.minutes });
    const all = avail.flatMap((z) => z.devices.map((d) => ({ ...d, zoneId: z.zoneId, zoneType: z.type })));
    let picked: typeof all;
    if (i.deviceIds?.length) {
      picked = i.deviceIds.map((id) => all.find((d) => d.id === id)).filter((d): d is (typeof all)[number] => !!d);
      if (picked.length !== i.deviceIds.length) throw new NotFoundException({ error: "device_not_found" });
      if (picked.some((d) => !d.free)) throw new ConflictException({ error: "slot_taken", devices: picked.filter((d) => !d.free).map((d) => d.name) });
      if (new Set(picked.map((d) => d.zoneId)).size > 1) throw new ConflictException({ error: "one_zone_per_booking" });
    } else {
      if (!i.zoneId) throw new HttpException({ error: "zone_required" }, 400);
      picked = all.filter((d) => d.free).slice(0, i.players);
      if (picked.length < i.players) throw new ConflictException({ error: "not_enough_free", free: picked.length, wanted: i.players });
    }
    const zoneId = picked[0]!.zoneId;
    const zoneType = picked[0]!.zoneType;

    const estimateMinor = await this.estimate(t, { branchId: branch.id, zoneId, zoneType, timezone: branch.timezone, currency: branch.currency, startsAt: i.startsAt, minutes: i.minutes, customerId: customer?.id ?? null });
    const unit = (await t.currency.findUnique({ where: { code: branch.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;

    let booking;
    try {
      booking = await t.booking.create({
        data: {
          organizationId: branch.organizationId, branchId: branch.id, zoneId, customerId: customer?.id ?? null, reference: reference(), resourceType: RESOURCE_TYPE[zoneType] ?? "PC",
          startsAt: i.startsAt, endsAt: new Date(i.startsAt.getTime() + i.minutes * 60_000), players: picked.length, status: "CONFIRMED", source: i.source,
          contactName: i.contactName ?? customer?.displayName ?? null, contactPhone: i.contactPhone ?? customer?.phone ?? null, notes: i.notes ?? null,
          estimatedTotal: fromMinor(estimateMinor * picked.length, unit), currency: branch.currency, createdById: actor.type === "EMPLOYEE" ? actor.id : null, idempotencyKey: i.idempotencyKey,
          bookingResources: { create: picked.map((d) => ({ deviceId: d.id, startsAt: i.startsAt, endsAt: new Date(i.startsAt.getTime() + i.minutes * 60_000) })) },
        },
      });
    } catch (e) {
      // Two people grabbed the same station at the same moment: the database said no.
      if (String(e).includes("booking_device_no_overlap") || String(e).includes("23P01")) throw new ConflictException({ error: "slot_taken" });
      throw e;
    }
    await auditAs(t, actor, { action: "booking.create", entityType: "Booking", entityId: booking.id, branchId: branch.id, after: { reference: booking.reference, startsAt: booking.startsAt, minutes: i.minutes, devices: picked.map((d) => d.name), source: i.source } });
    this.bus.publish(branch.organizationId, branch.id, { type: "booking", booking: { id: booking.id, deviceIds: picked.map((d) => d.id), status: booking.status } });
    return this.view(t, booking.id);
  }

  /** Estimated price per station from the rate card that would apply at the start time. */
  private async estimate(t: TenantTx, a: { branchId: string; zoneId: string; zoneType: string; timezone: string; currency: string; startsAt: Date; minutes: number; customerId: string | null }) {
    try {
      const unit = (await t.currency.findUnique({ where: { code: a.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
      const c = a.customerId ? await t.customer.findUnique({ where: { id: a.customerId }, select: { membershipTierId: true, membershipTier: { select: { gamingDiscountPct: true } } } }) : null;
      const ctx = { branchId: a.branchId, zoneId: a.zoneId, stationClass: stationClassFor(a.zoneType, "PC"), membershipTierId: c?.membershipTierId ?? null, timezone: a.timezone, now: a.startsAt };
      const plans = selectPlans((await t.pricingPlan.findMany({ where: { isActive: true, currency: a.currency }, include: { pricingPackages: true } })).map((p) => toPlanDef(p, unit)), ctx);
      const plan = plans.find((p) => p.billingMode === "PER_HOUR" || p.billingMode === "PER_MINUTE") ?? plans[0];
      if (!plan) return 0;
      return quote(plan, { kind: "minutes", minutes: a.minutes }, ctx, { membershipDiscountPct: Number(c?.membershipTier?.gamingDiscountPct ?? 0) }).totalMinor;
    } catch {
      return 0;
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async cancel(t: TenantTx, id: string, reason: string, actor: BookingActor) {
    const b = await t.booking.findUnique({ where: { id } });
    if (!b) throw new NotFoundException({ error: "not_found" });
    if (actor.type === "CUSTOMER" && b.customerId !== actor.id) throw new NotFoundException({ error: "not_found" });
    if (!["PENDING", "CONFIRMED"].includes(b.status)) throw new ConflictException({ error: "not_cancellable", status: b.status });
    if (actor.type === "CUSTOMER" && b.startsAt.getTime() - Date.now() < BOOKING_RULES.customerCancelCutoffMinutes * 60_000) {
      throw new ConflictException({ error: "too_late_to_cancel", hint: `Bookings can be cancelled in the app up to ${BOOKING_RULES.customerCancelCutoffMinutes} minutes before they start — please call the venue.` });
    }
    const after = await t.booking.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.slice(0, 200) } });
    await auditAs(t, actor, { action: "booking.cancel", entityType: "Booking", entityId: id, branchId: b.branchId, before: { status: b.status }, after: { status: after.status, reason } });
    this.publishBooking(t, after);
    return this.view(t, id);
  }

  async noShow(t: TenantTx, id: string, actor: BookingActor) {
    const b = await t.booking.findUnique({ where: { id } });
    if (!b) throw new NotFoundException({ error: "not_found" });
    if (b.status !== "CONFIRMED") throw new ConflictException({ error: "not_confirmed", status: b.status });
    const after = await t.booking.update({ where: { id }, data: { status: "NO_SHOW" } });
    await auditAs(t, actor, { action: "booking.no_show", entityType: "Booking", entityId: id, branchId: b.branchId, before: { status: b.status }, after: { status: after.status } });
    this.publishBooking(t, after);
    return this.view(t, id);
  }

  /**
   * The customer has arrived: start a session on every booked station until
   * the booking ends, paid the way the desk chooses.
   */
  async checkIn(t: TenantTx, id: string, payment: { method: PaymentMethodInput; reference?: string | null }, actor: Extract<BookingActor, { type: "EMPLOYEE" }>) {
    const b = await t.booking.findUnique({ where: { id }, include: { bookingResources: { select: { deviceId: true } } } });
    if (!b) throw new NotFoundException({ error: "not_found" });
    if (b.status !== "CONFIRMED") throw new ConflictException({ error: "not_confirmed", status: b.status });
    const now = Date.now();
    if (now < b.startsAt.getTime() - BOOKING_RULES.checkInEarlyMinutes * 60_000) throw new ConflictException({ error: "too_early", startsAt: b.startsAt.toISOString() });
    if (now >= b.endsAt.getTime()) throw new ConflictException({ error: "booking_over" });
    const minutes = Math.max(1, Math.min(Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000), Math.floor((b.endsAt.getTime() - now) / 60_000)));

    const started: string[] = [];
    for (const r of b.bookingResources) {
      if (!r.deviceId) continue;
      const s = await this.sessions.start(
        t,
        {
          deviceId: r.deviceId, customerId: b.customerId, guestLabel: b.customerId ? null : (b.contactName ?? "Booking"), request: { kind: "minutes", minutes },
          payment, idempotencyKey: `${b.id}:${r.deviceId}`, bookingId: b.id,
        },
        actor,
      );
      started.push(s.id);
    }
    await t.booking.update({ where: { id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
    if (b.customerId) await earnEvent(t, b.customerId, "BOOKING", b.branchId, { type: "BOOKING", id: b.id }, `pts:booking:${b.id}`, "Booking kept");
    await auditAs(t, actor, { action: "booking.check_in", entityType: "Booking", entityId: id, branchId: b.branchId, after: { sessions: started, minutes, payment: payment.method } });
    return { ...(await this.view(t, id)), sessionIds: started };
  }

  async view(t: TenantTx, id: string) {
    const b = await t.booking.findUniqueOrThrow({
      where: { id },
      include: { customer: { select: { id: true, displayName: true, username: true } }, zone: { select: { id: true, name: true } }, bookingResources: { select: { device: { select: { id: true, name: true } } } } },
    });
    const unit = (await t.currency.findUnique({ where: { code: b.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    const { bookingResources, idempotencyKey: _k, ...rest } = b;
    return {
      ...rest,
      estimatedTotal: b.estimatedTotal.toFixed(unit),
      depositAmount: b.depositAmount.toFixed(unit),
      minutes: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000),
      devices: bookingResources.map((r) => r.device).filter(Boolean),
    };
  }

  private publishBooking(t: TenantTx, b: { id: string; organizationId: string; branchId: string; status: string }) {
    void t; // published after the fact; floor clients refetch
    this.bus.publish(b.organizationId, b.branchId, { type: "booking", booking: { id: b.id, status: b.status } });
  }

  // ── background: no-shows, completions, expired holds ────────────────────

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.db.global.$queryRaw<Array<{ organization_id: string; booking_id: string; next_status: string }>>`
        SELECT * FROM app.bookings_due(${BOOKING_RULES.noShowGraceMinutes}::int)`;
      for (const row of due) {
        await this.db
          .withTenant({ organizationId: row.organization_id, actorType: "SYSTEM", actorId: null }, async (t) => {
            const b = await t.booking.findUnique({ where: { id: row.booking_id } });
            if (!b) return;
            const allowed: Record<string, string> = { NO_SHOW: "CONFIRMED", COMPLETED: "CHECKED_IN", CANCELLED: "PENDING" };
            if (b.status !== allowed[row.next_status]) return; // changed meanwhile
            const after = await t.booking.update({ where: { id: b.id }, data: { status: row.next_status as "NO_SHOW" | "COMPLETED" | "CANCELLED", ...(row.next_status === "CANCELLED" ? { cancelledAt: new Date(), cancelReason: "Hold expired" } : {}) } });
            await auditAs(t, { type: "SYSTEM", id: null }, { action: `booking.auto.${row.next_status.toLowerCase()}`, entityType: "Booking", entityId: b.id, branchId: b.branchId, before: { status: b.status }, after: { status: after.status } });
            this.publishBooking(t, after);
          })
          .catch((e) => this.log.error(`booking ${row.booking_id}: ${e instanceof Error ? e.message : e}`));
      }
      const soon = await this.db.global.$queryRaw<Array<{ organization_id: string; booking_id: string }>>`SELECT * FROM app.booking_reminders_due()`;
      for (const row of soon) {
        await this.db
          .withTenant({ organizationId: row.organization_id, actorType: "SYSTEM", actorId: null }, async (t) => {
            const b = await t.booking.findUnique({ where: { id: row.booking_id }, select: { id: true, customerId: true, branchId: true, reference: true, startsAt: true, branch: { select: { name: true, timezone: true } } } });
            if (!b?.customerId) return;
            const at = b.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: b.branch.timezone });
            await this.push.notify(t, { customerId: b.customerId, event: "booking.reminder", title: `Your booking starts at ${at}`, body: `${b.branch.name} · ${b.reference}. See you soon!`, screen: "bookings", dedupeKey: `booking-reminder:${b.id}`, branchId: b.branchId });
          })
          .catch((e) => this.log.error(`reminder ${row.booking_id}: ${e instanceof Error ? e.message : e}`));
      }
    } finally {
      this.running = false;
    }
  }
}
