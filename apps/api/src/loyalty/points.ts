import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma, type TenantTx } from "@arena/db";

/**
 * Loyalty points: an append-only ledger (LoyaltyTransaction; the database
 * rejects updates and deletes) with the customer's balance as a projection
 * updated under a compare-and-set, so concurrent earns and redemptions never
 * lose an update — and the database refuses a negative balance.
 *
 * Earning follows the organization's rules: per currency unit spent (gaming
 * and food, when a bill is settled), per minute played, or per event
 * (booking, tournament, referral, birthday) — times the customer's tier
 * multiplier. Points expire after `loyalty.expiryDays` (default 365), oldest
 * first.
 */

export type Source = "GAMING" | "RESTAURANT" | "BOOKING" | "TOURNAMENT" | "TOPUP" | "REFERRAL" | "ACHIEVEMENT" | "BIRTHDAY" | "MANUAL";
export type TxType = "EARN" | "REDEEM" | "EXPIRE" | "ADJUST" | "REVERSAL";

const DEFAULT_EXPIRY_DAYS = 365;
const FOOD = ["STOCK_ITEM", "RECIPE_ITEM", "COMBO"];

export interface PointsMove {
  customerId: string;
  delta: number;
  type: TxType;
  source: Source;
  reason?: string | null;
  rewardId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  employeeId?: string | null;
  idempotencyKey: string;
  expiresAt?: Date | null;
}

/** One ledger movement. Idempotent on the key; a debit can't overdraw. */
export async function movePoints(t: TenantTx, m: PointsMove): Promise<{ applied: boolean; balance: number }> {
  if (!Number.isInteger(m.delta) || m.delta === 0) throw new Error("delta must be a non-zero integer");
  const prior = await t.loyaltyTransaction.findFirst({ where: { idempotencyKey: m.idempotencyKey }, select: { balanceAfter: true } });
  if (prior) return { applied: false, balance: prior.balanceAfter };
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = await t.customer.findUnique({ where: { id: m.customerId }, select: { id: true, organizationId: true, loyaltyPoints: true } });
    if (!c) throw new NotFoundException({ error: "customer_not_found" });
    const after = c.loyaltyPoints + m.delta;
    if (after < 0) throw new ConflictException({ error: "not_enough_points", balance: c.loyaltyPoints, needed: -m.delta });
    const moved = await t.customer.updateMany({ where: { id: c.id, loyaltyPoints: c.loyaltyPoints }, data: { loyaltyPoints: after } });
    if (moved.count !== 1) continue;
    await t.loyaltyTransaction.create({
      data: {
        organizationId: c.organizationId, customerId: c.id, type: m.type, source: m.source, points: m.delta, balanceAfter: after, rewardId: m.rewardId ?? null,
        referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null, employeeId: m.employeeId ?? null, reason: m.reason ?? null,
        idempotencyKey: m.idempotencyKey, expiresAt: m.expiresAt ?? null,
      },
    });
    return { applied: true, balance: after };
  }
  throw new ConflictException({ error: "points_busy" });
}

async function expiryDate(t: TenantTx) {
  const org = await t.organization.findFirstOrThrow({ select: { settings: true } });
  const days = Number((org.settings as { loyalty?: { expiryDays?: number } } | null)?.loyalty?.expiryDays ?? DEFAULT_EXPIRY_DAYS);
  return days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
}

async function rulesFor(t: TenantTx, source: Source, unit: "CURRENCY" | "MINUTE" | "EVENT", branchId: string | null) {
  const rules = await t.loyaltyRule.findMany({ where: { source, unit, isActive: true } });
  return rules.filter((r) => r.branchIds.length === 0 || (branchId && r.branchIds.includes(branchId)));
}

async function multiplierOf(t: TenantTx, customerId: string) {
  const c = await t.customer.findUnique({ where: { id: customerId }, select: { status: true, membershipTier: { select: { loyaltyMultiplier: true } } } });
  if (!c || c.status === "BANNED" || c.status === "DELETED") return null;
  return Number(c.membershipTier?.loyaltyMultiplier ?? 1);
}

/**
 * A settled bill earns points on what the customer paid for: gaming time
 * (GAMING rules) and food & drink (RESTAURANT rules), per currency unit.
 * Once per bill and source.
 */
export async function earnForBill(t: TenantTx, billId: string) {
  const bill = await t.bill.findUnique({ where: { id: billId }, select: { id: true, customerId: true, branchId: true, status: true } });
  if (!bill?.customerId || bill.status !== "SETTLED") return;
  const mult = await multiplierOf(t, bill.customerId);
  if (mult === null) return;
  const items = await t.orderItem.findMany({ where: { order: { billId, status: { not: "CANCELLED" } }, status: { notIn: ["VOIDED", "REFUNDED"] } }, select: { productType: true, lineTotal: true } });
  const spend: Partial<Record<Source, Prisma.Decimal>> = {};
  for (const it of items) {
    const src: Source | null = it.productType === "GAMING_TIME" ? "GAMING" : FOOD.includes(it.productType) ? "RESTAURANT" : null;
    if (src) spend[src] = (spend[src] ?? new Prisma.Decimal(0)).add(it.lineTotal);
  }
  const expiresAt = await expiryDate(t);
  for (const [source, amount] of Object.entries(spend) as Array<[Source, Prisma.Decimal]>) {
    for (const rule of await rulesFor(t, source, "CURRENCY", bill.branchId)) {
      const points = Math.floor(Number(amount) * Number(rule.pointsPerUnit) * mult);
      if (points <= 0) continue;
      await movePoints(t, { customerId: bill.customerId, delta: points, type: "EARN", source, reason: `${source === "GAMING" ? "Gaming" : "Food & drinks"} spend`, referenceType: "BILL", referenceId: bill.id, idempotencyKey: `pts:bill:${bill.id}:${source}:${rule.id}`, expiresAt });
    }
  }
  await rewardReferral(t, bill.customerId, bill.id);
}

/** Minutes played earn points under MINUTE rules (e.g. 1 point per 10 minutes = 0.1/min). */
export async function earnForSession(t: TenantTx, sessionId: string) {
  const s = await t.gamingSession.findUnique({ where: { id: sessionId }, select: { id: true, customerId: true, branchId: true, billedSeconds: true, status: true } });
  if (!s?.customerId || s.status !== "ENDED" || !s.billedSeconds) return;
  const mult = await multiplierOf(t, s.customerId);
  if (mult === null) return;
  const minutes = Math.floor(s.billedSeconds / 60);
  const expiresAt = await expiryDate(t);
  for (const rule of await rulesFor(t, "GAMING", "MINUTE", s.branchId)) {
    const points = Math.floor(minutes * Number(rule.pointsPerUnit) * mult);
    if (points > 0) await movePoints(t, { customerId: s.customerId, delta: points, type: "EARN", source: "GAMING", reason: `${minutes} min played`, referenceType: "GAMING_SESSION", referenceId: s.id, idempotencyKey: `pts:session:${s.id}:${rule.id}`, expiresAt });
  }
}

/** Fixed points for an event (a booking kept, a tournament played, a birthday). */
export async function earnEvent(t: TenantTx, customerId: string, source: Source, branchId: string | null, ref: { type: string; id: string | null }, key: string, reason: string) {
  const mult = await multiplierOf(t, customerId);
  if (mult === null) return 0;
  let total = 0;
  const expiresAt = await expiryDate(t);
  for (const rule of await rulesFor(t, source, "EVENT", branchId)) {
    const points = Math.floor(Number(rule.pointsPerUnit) * (source === "REFERRAL" ? 1 : mult));
    if (points <= 0) continue;
    const r = await movePoints(t, { customerId, delta: points, type: "EARN", source, reason, referenceType: ref.type, referenceId: ref.id, idempotencyKey: `${key}:${rule.id}`, expiresAt });
    if (r.applied) total += points;
  }
  return total;
}

/** The friend who referred this customer earns REFERRAL points on the new customer's first settled bill. */
async function rewardReferral(t: TenantTx, customerId: string, billId: string) {
  const c = await t.customer.findUnique({ where: { id: customerId }, select: { referredById: true, displayName: true } });
  if (!c?.referredById) return;
  const firstBill = await t.bill.findFirst({ where: { customerId, status: "SETTLED" }, orderBy: { closedAt: "asc" }, select: { id: true } });
  if (firstBill?.id !== billId) return;
  await earnEvent(t, c.referredById, "REFERRAL", null, { type: "CUSTOMER", id: customerId }, `pts:referral:${customerId}`, `Referred ${c.displayName}`);
}

/** A refund takes back the points its share of the bill earned (never below zero). */
export async function reverseForRefund(t: TenantTx, billId: string, refundMinorShare: number, billTotalMinor: number, refundId: string) {
  if (billTotalMinor <= 0) return;
  const earned = await t.loyaltyTransaction.findMany({ where: { referenceType: "BILL", referenceId: billId, type: "EARN" }, select: { customerId: true, points: true } });
  if (!earned.length) return;
  const customerId = earned[0]!.customerId;
  const total = earned.reduce((a, e) => a + e.points, 0);
  const back = Math.min(Math.round((total * refundMinorShare) / billTotalMinor), total);
  const c = await t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { loyaltyPoints: true } });
  const take = Math.min(back, c.loyaltyPoints);
  if (take > 0) await movePoints(t, { customerId, delta: -take, type: "REVERSAL", source: "MANUAL", reason: "Refund", referenceType: "REFUND", referenceId: refundId, idempotencyKey: `pts:refund:${refundId}` });
}

/**
 * Expire points oldest-first: every debit so far (redemptions, reversals,
 * earlier expiries) consumed the oldest earnings first, so whatever of the
 * earnings past their date isn't covered by debits is what expires now.
 */
export async function expireFor(t: TenantTx, customerId: string, now = new Date()) {
  const rows = await t.loyaltyTransaction.findMany({ where: { customerId }, select: { type: true, points: true, expiresAt: true } });
  const earnedExpired = rows.filter((r) => r.points > 0 && r.expiresAt && r.expiresAt <= now).reduce((a, r) => a + r.points, 0);
  const debits = rows.filter((r) => r.points < 0).reduce((a, r) => a - r.points, 0);
  const due = earnedExpired - debits;
  if (due <= 0) return 0;
  const c = await t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { loyaltyPoints: true } });
  const take = Math.min(due, c.loyaltyPoints);
  if (take <= 0) return 0;
  await movePoints(t, { customerId, delta: -take, type: "EXPIRE", source: "MANUAL", reason: "Points expired", idempotencyKey: `pts:expire:${customerId}:${now.toISOString().slice(0, 10)}:${earnedExpired}` });
  return take;
}
