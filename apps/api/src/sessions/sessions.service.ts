import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { CommandsService } from "../devices/commands.service.js";
import { DEVICE_FIELDS, DeviceRuntimeService } from "../devices/device-runtime.service.js";
import { DeviceHub, LiveBus } from "../devices/live.js";
import { PricingError, postpaidCharge, quote, selectPlans, type Discount, type PlanDef, type Quote, type QuoteRequest, type StationClass } from "./pricing.js";
import { adjustTime, timeBalance } from "./time-balance.js";

export type PaymentMethodInput = "CASH" | "CARD" | "TIME_BALANCE" | "PAY_LATER";
export const LIVE_STATUSES = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;
const WARNING_MINUTES = [30, 15, 10, 5, 1];
const ENDING_SOON_MINUTES = 5;

export interface Actor {
  type: "EMPLOYEE" | "SYSTEM" | "CUSTOMER";
  id: string | null;
}

export interface StartInput {
  deviceId: string;
  customerId?: string | null;
  guestLabel?: string | null;
  planId?: string | null;
  request: QuoteRequest;
  discount?: Discount | null;
  payment: { method: PaymentMethodInput; reference?: string | null };
  idempotencyKey: string;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const ZONE_CLASS: Record<string, StationClass> = {
  PC_STANDARD: "PC", PC_VIP: "PC", BOOTCAMP: "PC", STREAMING: "PC", CONSOLE: "CONSOLE", VR: "VR",
  SIMULATOR: "SIMULATOR", INTERNET: "INTERNET", PRIVATE_ROOM: "PRIVATE_ROOM", OTHER: "PC", RESTAURANT: "PC",
};

/** Whole years on the given day (for game age ratings); null when unknown. */
export function ageOn(dob: Date | null | undefined, now = new Date()): number | null {
  if (!dob) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export function stationClassFor(zoneType: string, deviceKind: string): StationClass {
  if (deviceKind === "INTERNET_PC") return "INTERNET";
  if (deviceKind === "CONSOLE") return "CONSOLE";
  if (deviceKind === "VR_HEADSET") return "VR";
  if (deviceKind === "SIMULATOR") return "SIMULATOR";
  return ZONE_CLASS[zoneType] ?? "PC";
}

const pow10 = (n: number) => 10 ** n;
export const toMinor = (v: Prisma.Decimal | number | string, unit: number) => Math.round(Number(v) * pow10(unit));
export const fromMinor = (m: number, unit: number) => (m / pow10(unit)).toFixed(unit);
const code = (prefix: string) => `${prefix}-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

type PlanRow = Prisma.PricingPlanGetPayload<{ include: { pricingPackages: true } }>;

export function toPlanDef(p: PlanRow, unit: number): PlanDef {
  return {
    id: p.id,
    name: p.name,
    branchId: p.branchId,
    zoneId: p.zoneId,
    membershipTierId: p.membershipTierId,
    stationClass: p.stationClass,
    billingMode: p.billingMode,
    paymentTiming: p.paymentTiming,
    rateMinor: toMinor(p.rate, unit),
    currency: p.currency,
    minMinutes: p.minMinutes,
    roundingMinutes: p.roundingMinutes,
    graceMinutes: p.graceMinutes,
    schedule: (p.schedule as unknown as PlanDef["schedule"]) ?? [],
    passStartTime: p.passStartTime,
    passEndTime: p.passEndTime,
    priority: p.priority,
    validFrom: p.validFrom,
    validTo: p.validTo,
    isActive: p.isActive,
    packages: p.pricingPackages.map((k) => ({ id: k.id, name: k.name, durationMinutes: k.durationMinutes, priceMinor: toMinor(k.price, unit), bonusMinutes: k.bonusMinutes, isActive: k.isActive })),
  };
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  private async minorUnit(t: TenantTx, currency: string) {
    return (await t.currency.findUnique({ where: { code: currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
  }

  /** Everything needed to price a session on a station. */
  private async context(t: TenantTx, deviceId: string, customerId?: string | null) {
    const device = await t.device.findUnique({
      where: { id: deviceId },
      select: { ...DEVICE_FIELDS, organizationId: true, cleaningRequired: true, zone: { select: { type: true, name: true } }, branch: { select: { code: true, timezone: true, currency: true, name: true } } },
    });
    if (!device || !device.isEnabled) throw new NotFoundException({ error: "not_found" });
    const unit = await this.minorUnit(t, device.branch.currency);
    let customer: { id: string; displayName: string; status: string; membershipTierId: string | null; tierName: string | null; discountPct: number; age: number | null } | null = null;
    if (customerId) {
      const c = await t.customer.findUnique({ where: { id: customerId }, select: { id: true, displayName: true, status: true, dateOfBirth: true, membershipTierId: true, membershipTier: { select: { name: true, gamingDiscountPct: true } } } });
      if (!c) throw new NotFoundException({ error: "customer_not_found" });
      if (c.status === "BANNED" || c.status === "DELETED") throw new ForbiddenException({ error: "customer_banned" });
      const ban = await t.customerRestriction.findFirst({ where: { customerId, type: "BAN", liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, select: { reason: true } });
      if (ban) throw new ForbiddenException({ error: "customer_banned", reason: ban.reason });
      customer = { id: c.id, displayName: c.displayName, status: c.status, membershipTierId: c.membershipTierId, tierName: c.membershipTier?.name ?? null, discountPct: Number(c.membershipTier?.gamingDiscountPct ?? 0), age: ageOn(c.dateOfBirth) };
    }
    const plans = await t.pricingPlan.findMany({ where: { isActive: true, currency: device.branch.currency }, include: { pricingPackages: { orderBy: { sortOrder: "asc" } } } });
    const ctx = {
      branchId: device.branchId,
      zoneId: device.zoneId,
      stationClass: stationClassFor(device.zone.type, device.kind),
      membershipTierId: customer?.membershipTierId ?? null,
      timezone: device.branch.timezone,
      now: new Date(),
    };
    return { device, customer, unit, ctx, plans: selectPlans(plans.map((p) => toPlanDef(p, unit)), ctx) };
  }

  /** Price preview for the staff "start session" form. */
  async quote(t: TenantTx, deviceId: string, input: { customerId?: string | null; planId?: string | null; request?: QuoteRequest; discount?: Discount | null }) {
    const c = await this.context(t, deviceId, input.customerId);
    const balance = c.customer ? await timeBalance(t, c.customer.id) : 0;
    const plan = input.planId ? c.plans.find((p) => p.id === input.planId) : c.plans[0];
    let q: Quote | null = null;
    let error: string | null = null;
    if (plan && input.request) {
      try {
        q = quote(plan, input.request, c.ctx, { membershipDiscountPct: c.customer?.discountPct, discount: input.discount ?? undefined });
      } catch (e) {
        if (!(e instanceof PricingError)) throw e;
        error = e.message;
      }
    }
    return {
      currency: c.device.branch.currency,
      minorUnit: c.unit,
      stationClass: c.ctx.stationClass,
      customer: c.customer ? { ...c.customer, timeBalanceMinutes: balance } : null,
      plans: c.plans.map((p) => ({ id: p.id, name: p.name, billingMode: p.billingMode, paymentTiming: p.paymentTiming, rateMinor: p.rateMinor, minMinutes: p.minMinutes, passEndTime: p.passEndTime, packages: p.packages.filter((k) => k.isActive) })),
      quote: q ? serializeQuote(q) : null,
      error,
    };
  }

  async start(t: TenantTx, input: StartInput, actor: Actor) {
    const already = await t.gamingSession.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
    if (already) return this.view(t, already.id); // retried request — same session, no second charge

    const c = await this.context(t, input.deviceId, input.customerId);
    const { device, customer, unit, ctx } = c;
    if (!this.hub.isOnline(device.id)) throw new ConflictException({ error: "device_offline", hint: "The station must be switched on and connected" });
    if (!["AVAILABLE", "RESERVED"].includes(device.status)) throw new ConflictException({ error: "device_not_available", status: device.status });
    if (input.payment.method === "TIME_BALANCE" && !customer) throw new ConflictException({ error: "time_balance_needs_customer" });

    // ── price ──
    let q: Quote;
    let plan: PlanDef | undefined;
    if (input.payment.method === "TIME_BALANCE") {
      const balance = await timeBalance(t, customer!.id);
      if (balance <= 0) throw new ConflictException({ error: "insufficient_time", balanceMinutes: 0 });
      const wanted = input.request.kind === "minutes" ? Math.min(input.request.minutes, balance) : balance;
      const minutes = Math.min(wanted, 24 * 60);
      plan = c.plans[0];
      q = {
        planId: plan?.id ?? "time-balance", planName: "Prepaid time", packageId: null, billingMode: "FIXED_DURATION", paymentTiming: "PREPAID",
        currency: device.branch.currency, minutes, expiresAt: new Date(ctx.now.getTime() + minutes * 60_000),
        grossMinor: 0, membershipDiscountMinor: 0, manualDiscountMinor: 0, totalMinor: 0, lines: [`${minutes} min from prepaid balance`],
      };
    } else {
      plan = input.planId ? c.plans.find((p) => p.id === input.planId) : c.plans[0];
      if (!plan) throw new ConflictException({ error: "no_rate_available", hint: "No active rate card applies to this station right now" });
      try {
        q = quote(plan, input.request, ctx, { membershipDiscountPct: customer?.discountPct, discount: input.discount ?? undefined });
      } catch (e) {
        if (e instanceof PricingError) throw new HttpException({ error: e.code, message: e.message }, 400);
        throw e;
      }
      if (q.paymentTiming === "POSTPAID" && input.payment.method !== "PAY_LATER") throw new ConflictException({ error: "open_session_is_pay_later" });
    }

    // ── bill + order line (the visit's single bill; food joins it in phase 7) ──
    const bill = await t.bill.create({
      data: { organizationId: device.organizationId, branchId: device.branchId, number: code(device.branch.code), customerId: customer?.id ?? null, currency: q.currency, openedById: actor.type === "EMPLOYEE" ? actor.id : null },
    });
    const now = new Date();
    let session;
    try {
      session = await t.gamingSession.create({
        data: {
          organizationId: device.organizationId,
          branchId: device.branchId,
          zoneId: device.zoneId,
          deviceId: device.id,
          customerId: customer?.id ?? null,
          guestLabel: customer ? null : (input.guestLabel?.slice(0, 40) ?? "Guest"),
          billId: bill.id,
          stationClass: ctx.stationClass,
          status: "ACTIVE",
          pricingPlanId: plan?.id ?? null,
          pricingPackageId: q.packageId,
          billingMode: q.billingMode,
          paymentTiming: q.paymentTiming,
          rateSnapshot: { plan: plan ?? null, quote: { ...q, expiresAt: q.expiresAt?.toISOString() ?? null }, fundedBy: input.payment.method, minorUnit: unit } as object,
          allocatedMinutes: q.minutes,
          startedAt: now,
          expiresAt: q.expiresAt,
          amountDue: fromMinor(q.totalMinor, unit),
          discountAmount: fromMinor(q.membershipDiscountMinor + q.manualDiscountMinor, unit),
          currency: q.currency,
          postSessionAction: device.postSessionAction,
          startedById: actor.type === "EMPLOYEE" ? actor.id : null,
          idempotencyKey: input.idempotencyKey,
        },
      });
    } catch (e) {
      if (isExclusion(e)) throw new ConflictException({ error: "device_busy", hint: "This station already has a session" });
      throw e;
    }

    await this.addCharge(t, {
      session, bill, unit, deviceName: device.name, amountMinor: q.totalMinor, discountMinor: q.membershipDiscountMinor + q.manualDiscountMinor,
      description: `Gaming — ${q.planName} (${q.minutes ?? "open"} min) · ${device.name}`, minutes: q.minutes ?? 0, paymentState: input.payment.method === "PAY_LATER" ? "ON_BILL" : "PAID",
      employeeId: actor.type === "EMPLOYEE" ? actor.id : null,
    });

    // ── payment ──
    if (input.payment.method === "CASH" || input.payment.method === "CARD") {
      if (q.totalMinor > 0) await this.pay(t, { bill, method: input.payment.method, amountMinor: q.totalMinor, unit, key: `${input.idempotencyKey}:pay`, customerId: customer?.id ?? null, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, reference: input.payment.reference });
    } else if (input.payment.method === "TIME_BALANCE") {
      const org = await t.organization.findFirstOrThrow({ select: { defaultCurrency: true } });
      await adjustTime(t, {
        organizationId: device.organizationId, customerId: customer!.id, branchId: device.branchId, currency: org.defaultCurrency, deltaMinutes: -q.minutes!, type: "SPEND",
        reason: `Session on ${device.name}`, referenceType: "GAMING_SESSION", referenceId: session.id, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, idempotencyKey: `${input.idempotencyKey}:time`,
      });
    }
    await this.recomputeBill(t, bill.id);

    await t.device.update({ where: { id: device.id }, data: { status: "OCCUPIED" } });
    await this.commands.issue(t, {
      deviceId: device.id,
      type: "START_SESSION",
      payload: this.startPayload(session, customer?.displayName ?? session.guestLabel ?? "Guest", customer?.tierName ?? null, customer?.age ?? null),
      requestedBy: actor.type === "EMPLOYEE" ? { type: "EMPLOYEE", id: actor.id } : { type: "SYSTEM", id: null },
    });
    await auditAs(t, actor, { action: "session.start", entityType: "GamingSession", entityId: session.id, branchId: device.branchId, after: { device: device.name, quote: q, payment: input.payment.method, customerId: customer?.id } });
    await this.publishDevice(t, device.id);
    return this.view(t, session.id);
  }

  async extend(t: TenantTx, sessionId: string, input: { minutes?: number; packageId?: string; payment: { method: PaymentMethodInput; reference?: string | null }; idempotencyKey: string }, actor: Actor) {
    const dup = await t.sessionExtension.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) return this.view(t, sessionId);

    const s = await t.gamingSession.findUnique({ where: { id: sessionId }, include: { device: { select: { name: true, branch: { select: { currency: true } } } }, bill: true } });
    if (!s) throw new NotFoundException({ error: "not_found" });
    if (!["ACTIVE", "ENDING"].includes(s.status) || !s.expiresAt) throw new ConflictException({ error: "session_not_extendable", status: s.status });
    const snap = s.rateSnapshot as { plan: PlanDef | null; minorUnit: number };
    const unit = snap.minorUnit ?? 2;

    let minutes: number;
    let amountMinor = 0;
    if (input.payment.method === "TIME_BALANCE") {
      if (!s.customerId) throw new ConflictException({ error: "time_balance_needs_customer" });
      minutes = input.minutes ?? 60;
    } else if (input.packageId) {
      const pkg = snap.plan?.packages.find((p) => p.id === input.packageId && p.isActive);
      if (!pkg) throw new ConflictException({ error: "package_not_found" });
      minutes = pkg.durationMinutes + pkg.bonusMinutes;
      amountMinor = pkg.priceMinor;
    } else {
      minutes = input.minutes ?? 0;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) throw new HttpException({ error: "bad_minutes" }, 400);
      if (!snap.plan || !["PER_MINUTE", "PER_HOUR"].includes(snap.plan.billingMode)) throw new ConflictException({ error: "extend_with_package", hint: "This rate is sold in packages — extend with a package" });
      amountMinor = snap.plan.billingMode === "PER_MINUTE" ? snap.plan.rateMinor * minutes : Math.round((snap.plan.rateMinor * minutes) / 60);
    }

    // Extend from the later of now and the current expiry (never "give back" lost time).
    const base = Math.max(s.expiresAt.getTime(), Date.now());
    const expiresAt = new Date(base + minutes * 60_000);
    const moved = await t.gamingSession.updateMany({
      where: { id: s.id, version: s.version, status: { in: ["ACTIVE", "ENDING"] } },
      data: {
        expiresAt,
        status: "ACTIVE",
        allocatedMinutes: (s.allocatedMinutes ?? 0) + minutes,
        amountDue: { increment: fromMinor(amountMinor, unit) },
        warningsSent: s.warningsSent.filter((w) => w * 60_000 >= expiresAt.getTime() - Date.now()),
        version: { increment: 1 },
      },
    });
    if (moved.count !== 1) throw new ConflictException({ error: "session_changed", hint: "Refresh and try again" });

    const ext = await t.sessionExtension.create({
      data: { organizationId: s.organizationId, sessionId: s.id, minutes, amount: fromMinor(amountMinor, unit), source: actor.type === "CUSTOMER" ? "CUSTOMER_SHELL" : "STAFF", employeeId: actor.type === "EMPLOYEE" ? actor.id : null, idempotencyKey: input.idempotencyKey },
    });
    if (s.bill) {
      await this.addCharge(t, { session: s, bill: s.bill, unit, deviceName: s.device.name, amountMinor, discountMinor: 0, description: `Extra time — ${minutes} min · ${s.device.name}`, minutes, paymentState: input.payment.method === "PAY_LATER" ? "ON_BILL" : "PAID", employeeId: actor.type === "EMPLOYEE" ? actor.id : null });
      if ((input.payment.method === "CASH" || input.payment.method === "CARD") && amountMinor > 0) {
        await this.pay(t, { bill: s.bill, method: input.payment.method, amountMinor, unit, key: `${input.idempotencyKey}:pay`, customerId: s.customerId, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, reference: input.payment.reference });
      }
      await this.recomputeBill(t, s.bill.id);
    }
    if (input.payment.method === "TIME_BALANCE") {
      const org = await t.organization.findFirstOrThrow({ select: { defaultCurrency: true } });
      await adjustTime(t, { organizationId: s.organizationId, customerId: s.customerId!, branchId: s.branchId, currency: org.defaultCurrency, deltaMinutes: -minutes, type: "SPEND", reason: "Session extension", referenceType: "GAMING_SESSION", referenceId: s.id, idempotencyKey: `${input.idempotencyKey}:time` });
    }

    await t.device.update({ where: { id: s.deviceId }, data: { status: "OCCUPIED" } });
    await this.commands.issue(t, {
      deviceId: s.deviceId,
      type: "EXTEND_SESSION",
      payload: { sessionId: s.id, expiresAt: expiresAt.toISOString(), serverTime: new Date().toISOString(), addedMinutes: minutes },
      requestedBy: actor.type === "EMPLOYEE" ? { type: "EMPLOYEE", id: actor.id } : { type: "SYSTEM", id: null },
    });
    await auditAs(t, actor, { action: "session.extend", entityType: "GamingSession", entityId: s.id, branchId: s.branchId, after: { minutes, amountMinor, extensionId: ext.id, expiresAt } });
    await this.publishDevice(t, s.deviceId);
    return this.view(t, s.id);
  }

  /**
   * Ends a session exactly once (timer, staff, customer logout or failure):
   * finalize billing, refund unused prepaid time, release pooled game
   * accounts, free the station and tell the PC to lock.
   */
  async end(t: TenantTx, sessionId: string, reason: "EXPIRED" | "STAFF_ENDED" | "CUSTOMER_LOGOUT" | "DEVICE_FAILURE" | "ADMIN_FORCE", actor: Actor) {
    const s = await t.gamingSession.findUnique({ where: { id: sessionId }, include: { device: { select: { name: true, cleaningRequired: true, postSessionAction: true } }, bill: true } });
    if (!s) throw new NotFoundException({ error: "not_found" });
    if (!(LIVE_STATUSES as readonly string[]).includes(s.status)) return this.view(t, s.id); // already ended — idempotent

    const endedAt = new Date();
    const effectiveEnd = s.expiresAt && s.expiresAt < endedAt ? s.expiresAt : endedAt;
    const usedSeconds = Math.max(0, Math.round((effectiveEnd.getTime() - (s.startedAt ?? endedAt).getTime()) / 1000) - s.totalPausedSeconds);
    const snap = s.rateSnapshot as { plan: PlanDef | null; fundedBy: PaymentMethodInput; minorUnit: number; quote?: { minutes: number | null } };
    const unit = snap.minorUnit ?? 2;

    const claimed = await t.gamingSession.updateMany({
      where: { id: s.id, status: { in: [...LIVE_STATUSES] } },
      data: { status: "ENDED", endedAt, endReason: reason, billedSeconds: usedSeconds, endedById: actor.type === "EMPLOYEE" ? actor.id : null, version: { increment: 1 } },
    });
    if (claimed.count !== 1) return this.view(t, s.id); // someone else ended it first

    // Postpaid: charge the time actually used.
    if (s.paymentTiming === "POSTPAID" && snap.plan && s.bill) {
      const c = postpaidCharge(snap.plan, usedSeconds);
      await t.gamingSession.update({ where: { id: s.id }, data: { amountDue: fromMinor(c.totalMinor, unit) } });
      if (c.totalMinor > 0) {
        await this.addCharge(t, { session: s, bill: s.bill, unit, deviceName: s.device.name, amountMinor: c.totalMinor, discountMinor: 0, description: `Gaming — ${c.minutes} min used · ${s.device.name}`, minutes: c.minutes, paymentState: "ON_BILL", employeeId: null });
      }
    }
    // Prepaid from the customer's time balance: give back what wasn't used.
    if (snap.fundedBy === "TIME_BALANCE" && s.customerId && s.allocatedMinutes) {
      const unused = s.allocatedMinutes - Math.ceil(usedSeconds / 60);
      if (unused > 0) {
        const org = await t.organization.findFirstOrThrow({ select: { defaultCurrency: true } });
        await adjustTime(t, { organizationId: s.organizationId, customerId: s.customerId, branchId: s.branchId, currency: org.defaultCurrency, deltaMinutes: unused, type: "REFUND", reason: `Unused time — ${s.device.name}`, referenceType: "GAMING_SESSION", referenceId: s.id, idempotencyKey: `session:${s.id}:refund` });
      }
    }
    if (s.bill) await this.recomputeBill(t, s.bill.id);

    await t.gameLicense.updateMany({ where: { assignedSessionId: s.id }, data: { status: "AVAILABLE", assignedSessionId: null, assignedDeviceId: null, releasedAt: endedAt } });
    await t.customerSession.updateMany({ where: { gamingSessionId: s.id, endedAt: null }, data: { endedAt } });
    await t.device.update({ where: { id: s.deviceId }, data: { status: s.device.cleaningRequired ? "CLEANING" : "AVAILABLE" } });
    await this.commands.issue(t, {
      deviceId: s.deviceId,
      type: "END_SESSION",
      payload: { sessionId: s.id, reason, postSessionAction: s.device.postSessionAction, serverTime: endedAt.toISOString() },
      requestedBy: actor.type === "EMPLOYEE" ? { type: "EMPLOYEE", id: actor.id } : { type: "SYSTEM", id: null },
    });
    await auditAs(t, actor, { action: `session.end.${reason.toLowerCase()}`, entityType: "GamingSession", entityId: s.id, branchId: s.branchId, after: { usedSeconds, device: s.device.name } });
    await this.publishDevice(t, s.deviceId);
    return this.view(t, s.id);
  }

  /** Move a running session to another station (e.g. hardware fault, upgrade). */
  async move(t: TenantTx, sessionId: string, toDeviceId: string, reason: string | null, actor: Actor) {
    const s = await t.gamingSession.findUnique({ where: { id: sessionId }, include: { customer: { select: { displayName: true, dateOfBirth: true, membershipTier: { select: { name: true } } } } } });
    if (!s || !["ACTIVE", "ENDING"].includes(s.status)) throw new ConflictException({ error: "session_not_movable" });
    if (s.deviceId === toDeviceId) throw new ConflictException({ error: "same_station" });
    const target = await t.device.findUnique({ where: { id: toDeviceId }, select: { id: true, branchId: true, zoneId: true, status: true, isEnabled: true, name: true } });
    if (!target || !target.isEnabled || target.branchId !== s.branchId) throw new NotFoundException({ error: "target_not_found" });
    if (target.status !== "AVAILABLE" || !this.hub.isOnline(target.id)) throw new ConflictException({ error: "target_not_available" });

    const from = s.deviceId;
    try {
      await t.gamingSession.update({ where: { id: s.id }, data: { deviceId: target.id, zoneId: target.zoneId, version: { increment: 1 } } });
    } catch (e) {
      if (isExclusion(e)) throw new ConflictException({ error: "target_busy" });
      throw e;
    }
    await t.sessionTransfer.create({ data: { organizationId: s.organizationId, sessionId: s.id, fromDeviceId: from, toDeviceId: target.id, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, reason } });
    await t.device.update({ where: { id: from }, data: { status: "AVAILABLE" } });
    await t.device.update({ where: { id: target.id }, data: { status: "OCCUPIED" } });
    const by = actor.type === "EMPLOYEE" ? { type: "EMPLOYEE" as const, id: actor.id } : { type: "SYSTEM" as const, id: null };
    await this.commands.issue(t, { deviceId: from, type: "END_SESSION", payload: { sessionId: s.id, reason: "MOVED", postSessionAction: "LOCK", serverTime: new Date().toISOString() }, requestedBy: by });
    const moved = await t.gamingSession.findUniqueOrThrow({ where: { id: s.id } });
    await this.commands.issue(t, { deviceId: target.id, type: "START_SESSION", payload: this.startPayload(moved, s.customer?.displayName ?? s.guestLabel ?? "Guest", s.customer?.membershipTier?.name ?? null, ageOn(s.customer?.dateOfBirth)), requestedBy: by });
    await auditAs(t, actor, { action: "session.move", entityType: "GamingSession", entityId: s.id, branchId: s.branchId, after: { from, to: target.id, reason } });
    await this.publishDevice(t, from);
    await this.publishDevice(t, target.id);
    return this.view(t, s.id);
  }

  // ── read models ───────────────────────────────────────────────────────────

  async view(t: TenantTx, sessionId: string) {
    const s = await t.gamingSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { customer: { select: { id: true, displayName: true, username: true } }, device: { select: { name: true } }, bill: { select: { id: true, number: true, total: true, paidTotal: true, status: true } } },
    });
    const snap = s.rateSnapshot as { quote?: { planName?: string }; fundedBy?: string; minorUnit?: number };
    const unit = snap.minorUnit ?? 2;
    return {
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.device.name,
      branchId: s.branchId,
      zoneId: s.zoneId,
      status: s.status,
      customer: s.customer,
      guestLabel: s.guestLabel,
      planName: snap.quote?.planName ?? null,
      fundedBy: snap.fundedBy ?? null,
      billingMode: s.billingMode,
      paymentTiming: s.paymentTiming,
      allocatedMinutes: s.allocatedMinutes,
      startedAt: s.startedAt,
      expiresAt: s.expiresAt,
      endedAt: s.endedAt,
      endReason: s.endReason,
      amountDue: s.amountDue.toFixed(unit),
      discountAmount: s.discountAmount.toFixed(unit),
      currency: s.currency,
      bill: s.bill ? { ...s.bill, total: s.bill.total.toFixed(unit), paidTotal: s.bill.paidTotal.toFixed(unit) } : null,
      serverTime: new Date().toISOString(),
    };
  }

  async liveForDevice(t: TenantTx, deviceId: string) {
    const s = await t.gamingSession.findFirst({ where: { deviceId, status: { in: [...LIVE_STATUSES] } }, select: { id: true } });
    return s ? this.view(t, s.id) : null;
  }

  startPayload(s: { id: string; startedAt: Date | null; expiresAt: Date | null; postSessionAction: string; customerId: string | null }, displayName: string, tier: string | null, age: number | null = null) {
    return {
      sessionId: s.id,
      customer: { id: s.customerId, displayName, membershipTier: tier ?? undefined, age },
      startedAt: (s.startedAt ?? new Date()).toISOString(),
      expiresAt: s.expiresAt?.toISOString() ?? null,
      serverTime: new Date().toISOString(),
      warningMinutes: WARNING_MINUTES,
      postSessionAction: s.postSessionAction,
      allowSelfExtend: false,
    };
  }

  async publishDevice(t: TenantTx, deviceId: string) {
    const d = await t.device.findUniqueOrThrow({ where: { id: deviceId }, select: { ...DEVICE_FIELDS, organizationId: true } });
    const session = await this.liveForDevice(t, deviceId);
    this.bus.publish(d.organizationId, d.branchId, { type: "device", device: { ...this.runtime.view(d), session } });
  }

  // ── billing internals ─────────────────────────────────────────────────────

  private async gamingProduct(t: TenantTx, organizationId: string, currency: string) {
    const existing = await t.product.findFirst({ where: { sku: "SYS-GAMING-TIME" }, select: { id: true } });
    if (existing) return existing.id;
    const cat = (await t.productCategory.findFirst({ where: { name: "Gaming" }, select: { id: true } })) ?? (await t.productCategory.create({ data: { organizationId, name: "Gaming", showInShell: false } }));
    return (await t.product.create({ data: { organizationId, categoryId: cat.id, type: "GAMING_TIME", sku: "SYS-GAMING-TIME", name: "Gaming time", price: 0, currency, availableInShell: false, availableOnline: false } })).id;
  }

  private async addCharge(
    t: TenantTx,
    a: { session: { id: string; organizationId: string; branchId: string; deviceId: string; customerId: string | null }; bill: { id: string; currency: string }; unit: number; deviceName: string; amountMinor: number; discountMinor: number; description: string; minutes: number; paymentState: "PAID" | "ON_BILL"; employeeId: string | null },
  ) {
    const productId = await this.gamingProduct(t, a.session.organizationId, a.bill.currency);
    const amount = fromMinor(a.amountMinor, a.unit);
    const order = await t.order.create({
      data: {
        organizationId: a.session.organizationId, branchId: a.session.branchId, number: code("G"), channel: "SYSTEM", type: "GAMING_SEAT", status: "COMPLETED",
        paymentState: a.paymentState, billId: a.bill.id, customerId: a.session.customerId, deviceId: a.session.deviceId, gamingSessionId: a.session.id,
        employeeId: a.employeeId, deliverTo: a.deviceName, subtotal: fromMinor(a.amountMinor + a.discountMinor, a.unit), discountTotal: fromMinor(a.discountMinor, a.unit),
        total: amount, currency: a.bill.currency, placedAt: new Date(), completedAt: new Date(),
      },
    });
    await t.orderItem.create({
      data: {
        organizationId: a.session.organizationId, orderId: order.id, productId, nameSnapshot: a.description, productType: "GAMING_TIME", quantity: Math.max(1, a.minutes),
        unitPrice: a.minutes > 0 ? fromMinor(Math.round((a.amountMinor + a.discountMinor) / a.minutes), a.unit) : amount,
        discountAmount: fromMinor(a.discountMinor, a.unit), lineTotal: amount, status: "SERVED", gamingSessionId: a.session.id,
      },
    });
  }

  private async pay(t: TenantTx, p: { bill: { id: string; branchId: string; currency: string }; method: "CASH" | "CARD"; amountMinor: number; unit: number; key: string; customerId: string | null; employeeId: string | null; reference?: string | null }) {
    const existing = await t.payment.findFirst({ where: { idempotencyKey: p.key }, select: { id: true } });
    if (existing) return existing.id;
    const pay = await t.payment.create({
      data: {
        organizationId: (await t.bill.findUniqueOrThrow({ where: { id: p.bill.id }, select: { organizationId: true } })).organizationId,
        branchId: p.bill.branchId, billId: p.bill.id, customerId: p.customerId, employeeId: p.employeeId, method: p.method, provider: "MANUAL",
        providerRef: p.reference ?? null, status: "CAPTURED", amount: fromMinor(p.amountMinor, p.unit), currency: p.bill.currency, idempotencyKey: p.key, capturedAt: new Date(),
      },
    });
    return pay.id;
  }

  private async recomputeBill(t: TenantTx, billId: string) {
    const orders = await t.order.findMany({ where: { billId, status: { not: "CANCELLED" } }, select: { subtotal: true, discountTotal: true, taxTotal: true, total: true } });
    const pays = await t.payment.findMany({ where: { billId, status: "CAPTURED" }, select: { amount: true, refundedAmount: true } });
    const sum = (xs: Array<Prisma.Decimal>) => xs.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
    const total = sum(orders.map((o) => o.total));
    const paid = sum(pays.map((p) => p.amount.sub(p.refundedAmount)));
    // A bill with a live session stays open: more time or food may still be added.
    const live = await t.gamingSession.count({ where: { billId, status: { in: [...LIVE_STATUSES] } } });
    const status = live > 0 ? "OPEN" : paid.gte(total) ? "SETTLED" : paid.gt(0) ? "PARTIALLY_PAID" : "OPEN";
    await t.bill.update({
      where: { id: billId },
      data: { subtotal: sum(orders.map((o) => o.subtotal)), discountTotal: sum(orders.map((o) => o.discountTotal)), taxTotal: sum(orders.map((o) => o.taxTotal)), total, paidTotal: paid, status, closedAt: status === "SETTLED" ? new Date() : null },
    });
  }
}

export function serializeQuote(q: Quote) {
  return { ...q, expiresAt: q.expiresAt?.toISOString() ?? null };
}

function isExclusion(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("session_one_live_per_device") || msg.includes("23P01") || msg.includes("exclusion");
}

export { ENDING_SOON_MINUTES, WARNING_MINUTES };
