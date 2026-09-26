import { z } from "zod";

/**
 * The promotions rules engine — pure, no I/O (unit-tested in
 * test/promotions.test.ts). Money is in integer minor units.
 *
 * A promotion has `conditions` (all must hold, and at least one of `any` if
 * given) and `effects`. Given the context of a sale — a gaming session or an
 * order — the engine says which promotions apply and what they're worth.
 * Non-stackable promotions compete (the best one wins); stackable ones add on
 * top. The total discount never exceeds what's being paid.
 */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ids = z.array(z.string().min(1).max(64)).min(1).max(100);

export const Condition = z.union([
  z.object({ branchIn: ids }).strict(),
  z.object({ zoneIn: ids }).strict(),
  z.object({ stationClassIn: z.array(z.enum(["PC", "CONSOLE", "VR", "SIMULATOR", "INTERNET", "PRIVATE_ROOM"])).min(1) }).strict(),
  z.object({ tierIn: z.array(z.string().min(1).max(32)).min(1) }).strict(),
  z.object({ dayOfWeekIn: z.array(z.enum(WEEKDAYS)).min(1) }).strict(),
  z.object({ timeBetween: z.tuple([hhmm, hhmm]) }).strict(),
  z.object({ minSpend: z.number().min(0).max(1_000_000) }).strict(),
  z.object({ segmentIn: ids }).strict(),
  z.object({ firstVisit: z.literal(true) }).strict(),
  z.object({ birthday: z.literal(true) }).strict(),
  z.object({ productIn: ids }).strict(),
  z.object({ categoryIn: ids }).strict(),
  z.object({ gameIn: ids }).strict(),
]);
export type Condition = z.infer<typeof Condition>;
export const Conditions = z.object({ all: z.array(Condition).max(20).optional(), any: z.array(Condition).max(20).optional() }).strict();
export type Conditions = z.infer<typeof Conditions>;

const Target = z.enum(["GAMING_TIME", "ORDER", "PRODUCTS"]);
export const Effect = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERCENT_OFF"), target: Target, value: z.number().gt(0).max(100), productIds: ids.optional(), categoryIds: ids.optional(), maxAmount: z.number().gt(0).optional() }).strict(),
  z.object({ type: z.literal("AMOUNT_OFF"), target: Target, value: z.number().gt(0).max(100_000), productIds: ids.optional(), categoryIds: ids.optional() }).strict(),
  z.object({ type: z.literal("BONUS_MINUTES"), minutes: z.number().int().min(1).max(1440) }).strict(),
  z.object({ type: z.literal("FREE_ITEM"), productIds: ids.optional(), categoryIds: ids.optional(), quantity: z.number().int().min(1).max(10).default(1) }).strict(),
]);
export type Effect = z.infer<typeof Effect>;
export const Effects = z.array(Effect).min(1).max(5);

export interface Line {
  productId: string;
  categoryId: string;
  quantity: number;
  unitMinor: number; // incl. modifiers
}

export interface PromoContext {
  now: Date;
  timezone: string;
  minorUnit: number;
  branchId: string;
  zoneId?: string | null;
  stationClass?: string | null;
  gameId?: string | null;
  customer: { tierCode: string | null; segmentIds: string[]; firstVisit: boolean; birthday: boolean } | null;
  /** What's being bought. */
  gaming?: { amountMinor: number; minutes: number | null } | null;
  order?: { lines: Line[] } | null;
}

export interface PromotionDef {
  id: string;
  name: string;
  priority: number;
  isStackable: boolean;
  conditions: Conditions;
  effects: Effect[];
}

export interface Applied {
  promotionId: string;
  name: string;
  discountMinor: number;
  bonusMinutes: number;
  lines: string[];
}

function local(now: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: (p["weekday"] as string).toLowerCase().slice(0, 3), minutes: Number(p["hour"]) * 60 + Number(p["minute"]) };
}
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

const spendMinor = (c: PromoContext) => (c.gaming?.amountMinor ?? 0) + (c.order?.lines.reduce((a, l) => a + l.unitMinor * l.quantity, 0) ?? 0);

export function holds(cond: Condition, c: PromoContext): boolean {
  if ("branchIn" in cond) return cond.branchIn.includes(c.branchId);
  if ("zoneIn" in cond) return !!c.zoneId && cond.zoneIn.includes(c.zoneId);
  if ("stationClassIn" in cond) return !!c.stationClass && (cond.stationClassIn as string[]).includes(c.stationClass);
  if ("tierIn" in cond) return !!c.customer?.tierCode && cond.tierIn.includes(c.customer.tierCode);
  if ("dayOfWeekIn" in cond) return (cond.dayOfWeekIn as string[]).includes(local(c.now, c.timezone).day);
  if ("timeBetween" in cond) {
    const t = local(c.now, c.timezone).minutes;
    const [from, to] = [toMin(cond.timeBetween[0]), toMin(cond.timeBetween[1])];
    return from <= to ? t >= from && t < to : t >= from || t < to; // crosses midnight
  }
  if ("minSpend" in cond) return spendMinor(c) >= Math.round(cond.minSpend * 10 ** c.minorUnit);
  if ("segmentIn" in cond) return !!c.customer && cond.segmentIn.some((s) => c.customer!.segmentIds.includes(s));
  if ("firstVisit" in cond) return !!c.customer?.firstVisit;
  if ("birthday" in cond) return !!c.customer?.birthday;
  if ("productIn" in cond) return !!c.order?.lines.some((l) => cond.productIn.includes(l.productId));
  if ("categoryIn" in cond) return !!c.order?.lines.some((l) => cond.categoryIn.includes(l.categoryId));
  if ("gameIn" in cond) return !!c.gameId && cond.gameIn.includes(c.gameId);
  return false;
}

export function matches(p: Pick<PromotionDef, "conditions">, c: PromoContext) {
  const all = p.conditions.all ?? [];
  const any = p.conditions.any ?? [];
  return all.every((x) => holds(x, c)) && (any.length === 0 || any.some((x) => holds(x, c)));
}

const inScope = (l: Line, e: { productIds?: string[]; categoryIds?: string[] }) =>
  (!e.productIds && !e.categoryIds) || !!e.productIds?.includes(l.productId) || !!e.categoryIds?.includes(l.categoryId);

/** What one promotion is worth in this context (0/0 when none of its effects fit). */
export function value(p: PromotionDef, c: PromoContext): Applied {
  const unit = c.minorUnit;
  const money = (m: number) => (m / 10 ** unit).toFixed(unit);
  let discount = 0;
  let bonus = 0;
  const lines: string[] = [];
  const base = (target: z.infer<typeof Target>, e: { productIds?: string[]; categoryIds?: string[] }) => {
    if (target === "GAMING_TIME") return c.gaming?.amountMinor ?? 0;
    const ls = c.order?.lines ?? [];
    return (target === "ORDER" ? ls : ls.filter((l) => inScope(l, e))).reduce((a, l) => a + l.unitMinor * l.quantity, 0);
  };
  for (const e of p.effects) {
    if (e.type === "PERCENT_OFF") {
      let d = Math.round((base(e.target, e) * e.value) / 100);
      if (e.maxAmount) d = Math.min(d, Math.round(e.maxAmount * 10 ** unit));
      if (d > 0) lines.push(`${p.name}: ${e.value}% off −${money(d)}`);
      discount += d;
    } else if (e.type === "AMOUNT_OFF") {
      const d = Math.min(base(e.target, e), Math.round(e.value * 10 ** unit));
      if (d > 0) lines.push(`${p.name}: −${money(d)}`);
      discount += d;
    } else if (e.type === "BONUS_MINUTES") {
      if (c.gaming && c.gaming.minutes !== null) {
        bonus += e.minutes;
        lines.push(`${p.name}: +${e.minutes} min free`);
      }
    } else if (e.type === "FREE_ITEM") {
      // The cheapest matching units are free.
      const units = (c.order?.lines ?? []).filter((l) => inScope(l, e)).flatMap((l) => Array.from({ length: l.quantity }, () => l.unitMinor)).sort((a, b) => a - b);
      const d = units.slice(0, e.quantity).reduce((a, x) => a + x, 0);
      if (d > 0) lines.push(`${p.name}: free item −${money(d)}`);
      discount += d;
    }
  }
  return { promotionId: p.id, name: p.name, discountMinor: discount, bonusMinutes: bonus, lines };
}

/**
 * Which promotions to apply: every matching stackable one, plus the single
 * best non-stackable one (by discount, then bonus minutes, then priority).
 * The combined discount is capped at the amount being paid.
 */
export function choose(promos: PromotionDef[], c: PromoContext): { applied: Applied[]; discountMinor: number; bonusMinutes: number } {
  const valued = promos.filter((p) => matches(p, c)).map((p) => ({ p, v: value(p, c) })).filter((x) => x.v.discountMinor > 0 || x.v.bonusMinutes > 0);
  const best = valued
    .filter((x) => !x.p.isStackable)
    .sort((a, b) => b.v.discountMinor - a.v.discountMinor || b.v.bonusMinutes - a.v.bonusMinutes || b.p.priority - a.p.priority)[0];
  const picked = [...(best ? [best] : []), ...valued.filter((x) => x.p.isStackable).sort((a, b) => b.p.priority - a.p.priority)];
  const cap = spendMinor(c);
  let left = cap;
  const applied: Applied[] = [];
  for (const { v } of picked) {
    const d = Math.min(v.discountMinor, left);
    left -= d;
    if (d > 0 || v.bonusMinutes > 0) applied.push({ ...v, discountMinor: d });
  }
  return { applied, discountMinor: cap - left, bonusMinutes: applied.reduce((a, x) => a + x.bonusMinutes, 0) };
}

/** Birthday "today" means within ±`windowDays` of the date (in the branch's time zone), ignoring the year. */
export function isBirthday(dob: Date | null | undefined, now: Date, tz: string, windowDays = 3): boolean {
  if (!dob) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  const today = Date.UTC(Number(p["year"]), Number(p["month"]) - 1, Number(p["day"]));
  for (const y of [Number(p["year"]) - 1, Number(p["year"]), Number(p["year"]) + 1]) {
    const bd = Date.UTC(y, dob.getUTCMonth(), dob.getUTCDate());
    if (Math.abs(bd - today) <= windowDays * 86_400_000) return true;
  }
  return false;
}
