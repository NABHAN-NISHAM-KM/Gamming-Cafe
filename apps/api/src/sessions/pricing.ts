// Pricing engine — pure functions, no I/O (unit-tested in test/pricing.test.ts).
//
// Money is computed in integer MINOR units (fils, cents…) to avoid floating
// point errors; conversion happens only at the edges. Time windows are in the
// BRANCH's time zone (a "night pass 00:00–06:00" means Dubai time in Dubai).

export type BillingMode = "PER_MINUTE" | "PER_HOUR" | "FIXED_DURATION" | "DAY_PASS" | "NIGHT_PASS" | "PACKAGE";
export type PaymentTiming = "PREPAID" | "POSTPAID";
export type StationClass = "PC" | "CONSOLE" | "VR" | "SIMULATOR" | "INTERNET" | "PRIVATE_ROOM";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface TimeWindow {
  days: Weekday[];
  from: string; // "HH:MM"
  to: string; // "HH:MM"; to <= from means the window crosses midnight
}

export interface PackageDef {
  id: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
  bonusMinutes: number;
  isActive: boolean;
}

export interface PlanDef {
  id: string;
  name: string;
  branchId: string | null;
  zoneId: string | null;
  membershipTierId: string | null;
  stationClass: StationClass;
  billingMode: BillingMode;
  paymentTiming: PaymentTiming;
  rateMinor: number; // per minute / per hour / flat pass price
  currency: string;
  minMinutes: number;
  roundingMinutes: number;
  graceMinutes: number;
  schedule: TimeWindow[]; // empty = always
  passStartTime: string | null;
  passEndTime: string | null;
  priority: number;
  validFrom: Date | null;
  validTo: Date | null;
  isActive: boolean;
  packages: PackageDef[];
}

export interface PricingContext {
  branchId: string;
  zoneId: string;
  stationClass: StationClass;
  membershipTierId: string | null;
  timezone: string;
  now: Date;
}

export type QuoteRequest =
  | { kind: "minutes"; minutes: number }
  | { kind: "package"; packageId: string }
  | { kind: "pass" }
  | { kind: "open" }; // postpaid, billed at the end

export interface Discount {
  percent?: number; // 0–100
  amountMinor?: number;
  reason?: string;
}

export interface Quote {
  planId: string;
  planName: string;
  packageId: string | null;
  billingMode: BillingMode;
  paymentTiming: PaymentTiming;
  currency: string;
  /** Minutes the customer gets (null = open-ended postpaid). */
  minutes: number | null;
  expiresAt: Date | null;
  grossMinor: number;
  membershipDiscountMinor: number;
  manualDiscountMinor: number;
  totalMinor: number;
  lines: string[]; // human-readable breakdown for the receipt / UI
}

export class PricingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

// ── Time-zone helpers (Intl-based, DST-safe) ────────────────────────────────

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function localParts(at: Date, timezone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = (p["weekday"] as string).toLowerCase().slice(0, 3) as Weekday;
  return {
    year: Number(p["year"]),
    month: Number(p["month"]),
    day: Number(p["day"]),
    hour: Number(p["hour"]),
    minute: Number(p["minute"]),
    weekday,
    minuteOfDay: Number(p["hour"]) * 60 + Number(p["minute"]),
  };
}

/** UTC instant for a wall-clock time in a zone (two-pass offset correction handles DST). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timezone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - shown;
  }
  return new Date(guess);
}

const hm = (s: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new PricingError("bad_time", `Invalid time "${s}"`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Is `at` inside the window (in the branch's zone)? Overnight windows belong to the day they start. */
export function inWindow(w: TimeWindow, at: Date, timezone: string): boolean {
  const p = localParts(at, timezone);
  const from = hm(w.from);
  const to = hm(w.to);
  if (from < to) return w.days.includes(p.weekday) && p.minuteOfDay >= from && p.minuteOfDay < to;
  // Overnight (e.g. fri 22:00 → sat 06:00): after `from` on a listed day, or before `to` the next day.
  const yesterday = WEEKDAYS[(WEEKDAYS.indexOf(p.weekday) + 6) % 7]!;
  return (w.days.includes(p.weekday) && p.minuteOfDay >= from) || (w.days.includes(yesterday) && p.minuteOfDay < to);
}

/** Next occurrence (strictly after `at`) of a local HH:MM in the branch's zone. */
export function nextLocalTime(at: Date, hhmm: string, timezone: string): Date {
  const p = localParts(at, timezone);
  const mins = hm(hhmm);
  let d = zonedToUtc(p.year, p.month, p.day, Math.floor(mins / 60), mins % 60, timezone);
  if (d <= at) {
    const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day) + 86_400_000);
    d = zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), Math.floor(mins / 60), mins % 60, timezone);
  }
  return d;
}

// ── Plan selection ──────────────────────────────────────────────────────────

export function planApplies(plan: PlanDef, ctx: PricingContext): boolean {
  if (!plan.isActive || plan.stationClass !== ctx.stationClass) return false;
  if (plan.branchId && plan.branchId !== ctx.branchId) return false;
  if (plan.zoneId && plan.zoneId !== ctx.zoneId) return false;
  if (plan.membershipTierId && plan.membershipTierId !== ctx.membershipTierId) return false;
  if (plan.validFrom && ctx.now < plan.validFrom) return false;
  if (plan.validTo && ctx.now >= plan.validTo) return false;
  if (plan.schedule.length && !plan.schedule.some((w) => inWindow(w, ctx.now, ctx.timezone))) return false;
  if (plan.billingMode === "NIGHT_PASS" && plan.passStartTime && plan.passEndTime) {
    const w: TimeWindow = { days: [...WEEKDAYS], from: plan.passStartTime, to: plan.passEndTime };
    if (!inWindow(w, ctx.now, ctx.timezone)) return false;
  }
  return true;
}

/**
 * Applicable plans, best first: more specific scope wins (zone > branch > org,
 * member-tier rate > general), then higher priority, then cheaper.
 */
export function selectPlans(plans: PlanDef[], ctx: PricingContext): PlanDef[] {
  const specificity = (p: PlanDef) => (p.zoneId ? 4 : p.branchId ? 2 : 0) + (p.membershipTierId ? 1 : 0);
  return plans
    .filter((p) => planApplies(p, ctx))
    .sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority || a.rateMinor - b.rateMinor);
}

// ── Quoting ─────────────────────────────────────────────────────────────────

/** Billable minutes after minimum and rounding rules. */
export function billableMinutes(plan: Pick<PlanDef, "minMinutes" | "roundingMinutes">, minutes: number): number {
  const r = Math.max(1, plan.roundingMinutes);
  return Math.max(plan.minMinutes, Math.ceil(minutes / r) * r);
}

function timeCharge(plan: PlanDef, minutes: number): number {
  const billable = billableMinutes(plan, minutes);
  if (plan.billingMode === "PER_MINUTE") return plan.rateMinor * billable;
  if (plan.billingMode === "PER_HOUR") return Math.round((plan.rateMinor * billable) / 60);
  throw new PricingError("not_time_based", `${plan.name} is not billed by time`);
}

export function quote(plan: PlanDef, req: QuoteRequest, ctx: PricingContext, opts: { membershipDiscountPct?: number; discount?: Discount } = {}): Quote {
  const lines: string[] = [];
  let minutes: number | null;
  let expiresAt: Date | null;
  let gross: number;
  let packageId: string | null = null;
  const money = (m: number) => `${(m / 100).toFixed(2)} ${plan.currency}`;

  switch (req.kind) {
    case "minutes": {
      if (plan.billingMode !== "PER_MINUTE" && plan.billingMode !== "PER_HOUR") throw new PricingError("wrong_request", `${plan.name} is sold as ${plan.billingMode}`);
      if (!Number.isInteger(req.minutes) || req.minutes < 1 || req.minutes > 24 * 60) throw new PricingError("bad_minutes", "Minutes must be between 1 and 1440");
      minutes = billableMinutes(plan, req.minutes);
      gross = timeCharge(plan, req.minutes);
      expiresAt = new Date(ctx.now.getTime() + minutes * 60_000);
      lines.push(`${minutes} min @ ${money(plan.rateMinor)}/${plan.billingMode === "PER_HOUR" ? "hour" : "min"}`);
      break;
    }
    case "package": {
      const pkg = plan.packages.find((p) => p.id === req.packageId && p.isActive);
      if (!pkg) throw new PricingError("package_not_found", "Package not available for this rate");
      packageId = pkg.id;
      minutes = pkg.durationMinutes + pkg.bonusMinutes;
      gross = pkg.priceMinor;
      expiresAt = new Date(ctx.now.getTime() + minutes * 60_000);
      lines.push(`${pkg.name}: ${pkg.durationMinutes} min${pkg.bonusMinutes ? ` + ${pkg.bonusMinutes} bonus` : ""}`);
      break;
    }
    case "pass": {
      if (plan.billingMode !== "NIGHT_PASS" && plan.billingMode !== "DAY_PASS") throw new PricingError("wrong_request", `${plan.name} is not a pass`);
      const end = plan.passEndTime ?? "00:00";
      expiresAt = nextLocalTime(ctx.now, end, ctx.timezone);
      minutes = Math.round((expiresAt.getTime() - ctx.now.getTime()) / 60_000);
      gross = plan.rateMinor;
      lines.push(`${plan.name} until ${end}`);
      break;
    }
    case "open": {
      if (plan.paymentTiming !== "POSTPAID") throw new PricingError("prepaid_only", `${plan.name} must be paid in advance`);
      if (plan.billingMode !== "PER_MINUTE" && plan.billingMode !== "PER_HOUR") throw new PricingError("wrong_request", "Open sessions need a per-minute or per-hour rate");
      minutes = null;
      expiresAt = null;
      gross = 0;
      lines.push(`Open session — pay at the end (${money(plan.rateMinor)}/${plan.billingMode === "PER_HOUR" ? "hour" : "min"})`);
      break;
    }
  }

  const membershipDiscount = Math.round((gross * Math.min(100, Math.max(0, opts.membershipDiscountPct ?? 0))) / 100);
  if (membershipDiscount) lines.push(`Membership discount −${money(membershipDiscount)}`);
  const afterMember = gross - membershipDiscount;
  let manual = 0;
  if (opts.discount?.percent) manual += Math.round((afterMember * Math.min(100, Math.max(0, opts.discount.percent))) / 100);
  if (opts.discount?.amountMinor) manual += Math.max(0, opts.discount.amountMinor);
  manual = Math.min(manual, afterMember);
  if (manual) lines.push(`Discount${opts.discount?.reason ? ` (${opts.discount.reason})` : ""} −${money(manual)}`);

  return {
    planId: plan.id,
    planName: plan.name,
    packageId,
    billingMode: plan.billingMode,
    paymentTiming: req.kind === "open" ? "POSTPAID" : "PREPAID",
    currency: plan.currency,
    minutes,
    expiresAt,
    grossMinor: gross,
    membershipDiscountMinor: membershipDiscount,
    manualDiscountMinor: manual,
    totalMinor: afterMember - manual,
    lines,
  };
}

/** Final charge for an open (postpaid) session from the time actually used. */
export function postpaidCharge(plan: PlanDef, usedSeconds: number, membershipDiscountPct = 0): { minutes: number; totalMinor: number } {
  const usedMinutes = Math.max(0, usedSeconds) / 60;
  if (usedMinutes <= plan.graceMinutes) return { minutes: 0, totalMinor: 0 };
  const minutes = Math.ceil(usedMinutes);
  const gross = timeCharge(plan, minutes);
  return { minutes: billableMinutes(plan, minutes), totalMinor: gross - Math.round((gross * membershipDiscountPct) / 100) };
}

/** Minutes of extra time a given amount of money buys (for "extend by package" helpers). */
export function extensionQuote(plan: PlanDef, minutes: number): number {
  return timeCharge(plan, minutes);
}
