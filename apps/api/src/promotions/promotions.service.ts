import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { minorUnit } from "../pos/bills.js";
import { choose, Conditions, Effects, isBirthday, type Applied, type Line, type PromoContext, type PromotionDef } from "./engine.js";

export interface PromoInput {
  branchId: string;
  zoneId?: string | null;
  stationClass?: string | null;
  gameId?: string | null;
  customerId?: string | null;
  gaming?: { amountMinor: number; minutes: number | null } | null;
  order?: { lines: Line[] } | null;
}

export interface Evaluation {
  applied: Applied[];
  discountMinor: number;
  bonusMinutes: number;
  currency: string;
  minorUnit: number;
  codeId: string | null;
}

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const newCode = (prefix = "", len = 8) => prefix.toUpperCase() + Array.from(randomBytes(len), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

/**
 * Promotions at the till: which automatic promotions (happy hour, weekend,
 * birthday, first visit…) and which promo code apply to a gaming session or
 * an order, and recording their use — atomically, so a promotion never goes
 * past its usage limit, budget or per-customer limit.
 */
@Injectable()
export class PromotionsService {
  private async defs(t: TenantTx, where: Prisma.PromotionWhereInput): Promise<Array<PromotionDef & { perCustomerLimit: number | null; totalUsageLimit: number | null; usageCount: number; budgetAmount: Prisma.Decimal | null; budgetUsed: Prisma.Decimal }>> {
    const now = new Date();
    const rows = await t.promotion.findMany({
      where: { status: "ACTIVE", AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }], ...where },
      orderBy: { priority: "desc" },
    });
    return rows.flatMap((r) => {
      const c = Conditions.safeParse(r.conditions);
      const e = Effects.safeParse(r.effects);
      if (!c.success || !e.success) return []; // a malformed promotion never applies
      return [{ id: r.id, name: r.name, priority: r.priority, isStackable: r.isStackable, conditions: c.data, effects: e.data, perCustomerLimit: r.perCustomerLimit, totalUsageLimit: r.totalUsageLimit, usageCount: r.usageCount, budgetAmount: r.budgetAmount, budgetUsed: r.budgetUsed }];
    });
  }

  private async customerCtx(t: TenantTx, customerId: string, tz: string, now: Date): Promise<PromoContext["customer"]> {
    const c = await t.customer.findUnique({ where: { id: customerId }, select: { dateOfBirth: true, membershipTier: { select: { code: true } }, customerSegmentMembers: { select: { segmentId: true } } } });
    if (!c) return null;
    const visited = await t.gamingSession.count({ where: { customerId, status: "ENDED" } });
    const settled = visited ? 1 : await t.bill.count({ where: { customerId, status: "SETTLED" } });
    return { tierCode: c.membershipTier?.code ?? null, segmentIds: c.customerSegmentMembers.map((m) => m.segmentId), firstVisit: visited + settled === 0, birthday: isBirthday(c.dateOfBirth, now, tz) };
  }

  /**
   * What applies to this sale. With a code: the code must be valid and its
   * promotion must apply, or it's refused with the reason.
   */
  async evaluate(t: TenantTx, input: PromoInput, code?: string | null): Promise<Evaluation> {
    const branch = await t.branch.findUniqueOrThrow({ where: { id: input.branchId }, select: { timezone: true, currency: true } });
    const unit = await minorUnit(t, branch.currency);
    const now = new Date();
    const candidates = await this.defs(t, { requiresCode: false });
    let codeRow: { id: string; promotionId: string } | null = null;
    if (code) {
      const c = await t.promoCode.findFirst({ where: { code: code.trim().toUpperCase() } });
      if (!c || !c.isActive) throw new ConflictException({ error: "promo_code_invalid" });
      if (c.expiresAt && c.expiresAt <= now) throw new ConflictException({ error: "promo_code_expired" });
      if (c.maxUses !== null && c.uses >= c.maxUses) throw new ConflictException({ error: "promo_code_used_up" });
      if (c.customerId && c.customerId !== input.customerId) throw new ConflictException({ error: "promo_code_not_yours", hint: "This code belongs to another customer's account." });
      const [p] = await this.defs(t, { id: c.promotionId });
      if (!p) throw new ConflictException({ error: "promo_code_invalid", hint: "That promotion isn't running." });
      if (!candidates.some((x) => x.id === p.id)) candidates.push(p);
      codeRow = { id: c.id, promotionId: c.promotionId };
    }
    const usable = [];
    for (const p of candidates) {
      if (p.totalUsageLimit !== null && p.usageCount >= p.totalUsageLimit) continue;
      if (p.budgetAmount !== null && p.budgetUsed.gte(p.budgetAmount)) continue;
      if (p.perCustomerLimit !== null) {
        if (!input.customerId) continue; // limited per customer → needs a known customer
        const used = await t.promotionRedemption.count({ where: { promotionId: p.id, customerId: input.customerId, reversedAt: null } });
        if (used >= p.perCustomerLimit) continue;
      }
      usable.push(p);
    }
    const ctx: PromoContext = {
      now, timezone: branch.timezone, minorUnit: unit, branchId: input.branchId, zoneId: input.zoneId ?? null, stationClass: input.stationClass ?? null, gameId: input.gameId ?? null,
      customer: input.customerId ? await this.customerCtx(t, input.customerId, branch.timezone, now) : null,
      gaming: input.gaming ?? null, order: input.order ?? null,
    };
    const r = choose(usable, ctx);
    if (codeRow && !r.applied.some((a) => a.promotionId === codeRow!.promotionId)) {
      const exhausted = !usable.some((p) => p.id === codeRow!.promotionId);
      throw new ConflictException({ error: exhausted ? "promo_limit_reached" : "promo_not_applicable", hint: exhausted ? "That promotion has been fully used." : "That code doesn't apply to this purchase." });
    }
    return { ...r, currency: branch.currency, minorUnit: unit, codeId: codeRow?.id ?? null };
  }

  /** Record use. Fails (and so rolls the sale back) if a limit was reached in the meantime. */
  async redeem(t: TenantTx, ev: Evaluation, refs: { customerId?: string | null; orderId?: string | null; gamingSessionId?: string | null; bookingId?: string | null }) {
    for (const a of ev.applied) {
      const amount = new Prisma.Decimal(a.discountMinor).div(10 ** ev.minorUnit);
      if (refs.customerId) await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`promo:${a.promotionId}:${refs.customerId}`}))`;
      const p = await t.promotion.findUniqueOrThrow({ where: { id: a.promotionId }, select: { perCustomerLimit: true, organizationId: true } });
      if (p.perCustomerLimit !== null && refs.customerId) {
        const used = await t.promotionRedemption.count({ where: { promotionId: a.promotionId, customerId: refs.customerId, reversedAt: null } });
        if (used >= p.perCustomerLimit) throw new ConflictException({ error: "promo_limit_reached", hint: "You've already used this promotion." });
      }
      const n = await t.$executeRaw`UPDATE "Promotion" SET "usageCount" = "usageCount" + 1, "budgetUsed" = "budgetUsed" + ${amount}, "updatedAt" = now()
        WHERE "id" = ${a.promotionId}::uuid AND ("totalUsageLimit" IS NULL OR "usageCount" < "totalUsageLimit") AND ("budgetAmount" IS NULL OR "budgetUsed" + ${amount} <= "budgetAmount")`;
      if (n !== 1) throw new ConflictException({ error: "promo_limit_reached", hint: "That promotion was just used up." });
      const codeId = ev.codeId && (await t.promoCode.findFirst({ where: { id: ev.codeId, promotionId: a.promotionId }, select: { id: true } })) ? ev.codeId : null;
      if (codeId) {
        const c = await t.$executeRaw`UPDATE "PromoCode" SET "uses" = "uses" + 1 WHERE "id" = ${codeId}::uuid AND ("maxUses" IS NULL OR "uses" < "maxUses")`;
        if (c !== 1) throw new ConflictException({ error: "promo_code_used_up" });
      }
      await t.promotionRedemption.create({
        data: {
          organizationId: p.organizationId, promotionId: a.promotionId, promoCodeId: codeId, customerId: refs.customerId ?? null, orderId: refs.orderId ?? null,
          gamingSessionId: refs.gamingSessionId ?? null, bookingId: refs.bookingId ?? null, discountAmount: amount, bonusMinutes: a.bonusMinutes, currency: ev.currency,
        },
      });
    }
  }

  // ── admin ────────────────────────────────────────────────────────────────

  async view(t: TenantTx, id: string) {
    const p = await t.promotion.findUnique({ where: { id }, include: { promoCodes: { orderBy: { createdAt: "desc" }, take: 200 }, _count: { select: { promotionRedemptions: true } } } });
    if (!p) throw new NotFoundException({ error: "promotion_not_found" });
    const totals = await t.promotionRedemption.aggregate({ where: { promotionId: id, reversedAt: null }, _sum: { discountAmount: true, bonusMinutes: true } });
    return { ...p, redemptions: p._count.promotionRedemptions, discountGiven: (totals._sum.discountAmount ?? new Prisma.Decimal(0)).toFixed(2), bonusMinutesGiven: totals._sum.bonusMinutes ?? 0 };
  }

  /** Bulk codes: unique, upper-case, optionally for one customer (apology, referral, reward). */
  async generateCodes(t: TenantTx, promotionId: string, o: { count: number; prefix?: string; maxUses?: number | null; expiresAt?: Date | null; customerId?: string | null; code?: string | null }) {
    const p = await t.promotion.findUnique({ where: { id: promotionId }, select: { organizationId: true } });
    if (!p) throw new NotFoundException({ error: "promotion_not_found" });
    const made: string[] = [];
    if (o.code) {
      const code = o.code.trim().toUpperCase();
      if (await t.promoCode.findFirst({ where: { code } })) throw new ConflictException({ error: "promo_code_taken" });
      await t.promoCode.create({ data: { organizationId: p.organizationId, promotionId, code, maxUses: o.maxUses ?? null, expiresAt: o.expiresAt ?? null, customerId: o.customerId ?? null } });
      return [code];
    }
    while (made.length < o.count) {
      const code = newCode(o.prefix ?? "", 8);
      if (made.includes(code) || (await t.promoCode.findFirst({ where: { code }, select: { id: true } }))) continue;
      made.push(code);
    }
    await t.promoCode.createMany({ data: made.map((code) => ({ organizationId: p.organizationId, promotionId, code, maxUses: o.maxUses ?? 1, expiresAt: o.expiresAt ?? null, customerId: o.customerId ?? null })) });
    return made;
  }
}
