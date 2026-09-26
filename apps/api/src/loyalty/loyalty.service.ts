import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { Prisma, type Db, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { isBirthday } from "../promotions/engine.js";
import { PromotionsService } from "../promotions/promotions.service.js";
import { adjustTime } from "../sessions/time-balance.js";
import { moveMoney, orgCurrency, toMinor } from "../wallet/wallet.js";
import { earnEvent, expireFor, movePoints } from "./points.js";

type Actor = { type: "EMPLOYEE" | "CUSTOMER" | "SYSTEM"; id: string | null };

/** What a reward gives, by type (validated when the reward is created). */
export const RewardValue = {
  FREE_MINUTES: z.object({ minutes: z.number().int().min(5).max(1440) }).strict(),
  WALLET_CREDIT: z.object({ amount: z.number().gt(0).max(10_000) }).strict(),
  DISCOUNT_PERCENT: z.object({ percent: z.number().gt(0).max(100), target: z.enum(["GAMING_TIME", "ORDER"]) }).strict(),
  DISCOUNT_AMOUNT: z.object({ amount: z.number().gt(0).max(10_000), target: z.enum(["GAMING_TIME", "ORDER"]) }).strict(),
  PRODUCT: z.object({ productId: z.uuid() }).strict(),
} as const;
export type RewardKind = keyof typeof RewardValue;
const CODE_DAYS = 90;

/**
 * Loyalty: the rewards catalogue and redeeming points for rewards — free
 * minutes and wallet credit are given at once; discounts and free items
 * become a personal one-time promo code. Plus the hourly sweeps: birthday
 * points, and expiring old points.
 */
@Injectable()
export class LoyaltyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Loyalty");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PromotionsService) private readonly promotions: PromotionsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async summary(t: TenantTx, customerId: string) {
    const c = await t.customer.findUnique({ where: { id: customerId }, select: { loyaltyPoints: true, referralCode: true, membershipTier: { select: { name: true, loyaltyMultiplier: true } } } });
    if (!c) throw new NotFoundException({ error: "customer_not_found" });
    const [history, rewards, expiring] = await Promise.all([
      t.loyaltyTransaction.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 50, include: { reward: { select: { name: true } } } }),
      t.loyaltyReward.findMany({ where: { isActive: true }, orderBy: { costPoints: "asc" } }),
      t.loyaltyTransaction.aggregate({ where: { customerId, points: { gt: 0 }, expiresAt: { gt: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) } }, _sum: { points: true } }),
    ]);
    return {
      points: c.loyaltyPoints, referralCode: c.referralCode, tier: c.membershipTier?.name ?? null, multiplier: Number(c.membershipTier?.loyaltyMultiplier ?? 1),
      expiringSoon: Math.min(c.loyaltyPoints, expiring._sum.points ?? 0),
      history: history.map((h) => ({ id: h.id, at: h.createdAt, type: h.type, source: h.source, points: h.points, balanceAfter: h.balanceAfter, reason: h.reward ? `Redeemed: ${h.reward.name}` : h.reason, expiresAt: h.expiresAt })),
      rewards: rewards.map((r) => ({ id: r.id, name: r.name, description: r.description, imageUrl: r.imageUrl, costPoints: r.costPoints, rewardType: r.rewardType, value: r.value, stock: r.stock, affordable: r.costPoints <= c.loyaltyPoints && (r.stock === null || r.stock > 0) })),
    };
  }

  /** Redeem points for a reward. Idempotent on the key; stock can't go below zero. */
  async redeem(t: TenantTx, customerId: string, rewardId: string, actor: Actor, key: string) {
    const prior = await t.loyaltyTransaction.findFirst({ where: { idempotencyKey: `${key}:pts` }, select: { id: true } });
    if (prior) throw new ConflictException({ error: "already_redeemed", hint: "This redemption was already made." });
    const r = await t.loyaltyReward.findUnique({ where: { id: rewardId } });
    if (!r || !r.isActive) throw new NotFoundException({ error: "reward_not_found" });
    const kind = r.rewardType as RewardKind;
    const schema = RewardValue[kind];
    if (!schema) throw new ConflictException({ error: "reward_not_supported" });
    const value = schema.parse(r.value) as Record<string, unknown>;
    if (r.stock !== null) {
      const n = await t.$executeRaw`UPDATE "LoyaltyReward" SET "stock" = "stock" - 1, "updatedAt" = now() WHERE "id" = ${r.id}::uuid AND "stock" > 0`;
      if (n !== 1) throw new ConflictException({ error: "reward_out_of_stock" });
    }
    const moved = await movePoints(t, { customerId, delta: -r.costPoints, type: "REDEEM", source: "MANUAL", rewardId: r.id, reason: `Redeemed: ${r.name}`, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, idempotencyKey: `${key}:pts` });
    const { organizationId, currency, unit } = await orgCurrency(t);
    const out: { reward: string; points: number; balance: number; code?: string; minutes?: number; walletCredit?: string } = { reward: r.name, points: r.costPoints, balance: moved.balance };
    if (kind === "FREE_MINUTES") {
      const minutes = value["minutes"] as number;
      await adjustTime(t, { organizationId, customerId, branchId: null, currency, deltaMinutes: minutes, type: "TOPUP", reason: `Reward: ${r.name}`, referenceType: "LOYALTY_REWARD", referenceId: r.id, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, idempotencyKey: `${key}:time` });
      out.minutes = minutes;
    } else if (kind === "WALLET_CREDIT") {
      const amount = toMinor(value["amount"] as number, unit);
      await moveMoney(t, { customerId, bucket: "BONUS", deltaMinor: amount, type: "BONUS_GRANT", reason: `Reward: ${r.name}`, referenceType: "LOYALTY_REWARD", referenceId: r.id, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, expiresAt: new Date(Date.now() + CODE_DAYS * 86_400_000), idempotencyKey: `${key}:wallet` });
      out.walletCredit = (amount / 10 ** unit).toFixed(unit);
    } else {
      const promotionId = await this.rewardPromotion(t, organizationId, r.id, r.name, kind, value);
      [out.code] = await this.promotions.generateCodes(t, promotionId, { count: 1, prefix: "RW", maxUses: 1, customerId, expiresAt: new Date(Date.now() + CODE_DAYS * 86_400_000) });
    }
    await auditAs(t, { type: actor.type, id: actor.id }, { action: "loyalty.redeem", entityType: "Customer", entityId: customerId, after: { reward: r.name, points: r.costPoints, code: out.code ?? null } });
    return out;
  }

  /** The hidden, code-only promotion behind a discount/free-item reward (one per reward). */
  private async rewardPromotion(t: TenantTx, organizationId: string, rewardId: string, name: string, kind: RewardKind, value: Record<string, unknown>) {
    const marker = `reward:${rewardId}`;
    const found = await t.promotion.findFirst({ where: { description: marker }, select: { id: true } });
    if (found) return found.id;
    const effects =
      kind === "DISCOUNT_PERCENT" ? [{ type: "PERCENT_OFF", target: value["target"], value: value["percent"] }]
      : kind === "DISCOUNT_AMOUNT" ? [{ type: "AMOUNT_OFF", target: value["target"], value: value["amount"] }]
      : [{ type: "FREE_ITEM", productIds: [value["productId"]], quantity: 1 }];
    const p = await t.promotion.create({
      data: { organizationId, name: `Reward: ${name}`, description: marker, type: "PROMO_CODE", status: "ACTIVE", requiresCode: true, isStackable: true, conditions: {}, effects: effects as Prisma.InputJsonValue },
    });
    return p.id;
  }

  /** Points in or out by hand (sensitive: reason required and audited). */
  async adjust(t: TenantTx, customerId: string, points: number, reason: string, employeeId: string, key: string) {
    const r = await movePoints(t, { customerId, delta: points, type: "ADJUST", source: "MANUAL", reason, employeeId, idempotencyKey: key, expiresAt: points > 0 ? new Date(Date.now() + 365 * 86_400_000) : null });
    await auditAs(t, { type: "EMPLOYEE", id: employeeId }, { action: "loyalty.adjust", entityType: "Customer", entityId: customerId, after: { points, reason, balance: r.balance }, reason });
    return r;
  }

  // ── sweeps ───────────────────────────────────────────────────────────────

  /** Birthday points (once a year) and expiring old points, for every live organization. */
  async sweep(now = new Date()) {
    const orgs = await this.db.global.$queryRaw<Array<{ organization_id: string }>>`SELECT * FROM app.live_organizations()`;
    for (const { organization_id } of orgs) {
      try {
        await this.db.withTenant({ organizationId: organization_id, actorType: "SYSTEM", actorId: null }, (t) => this.sweepOrg(t, now));
      } catch (e) {
        this.log.warn(`loyalty sweep ${organization_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  async sweepOrg(t: TenantTx, now = new Date()) {
    let birthdays = 0;
    let expired = 0;
    if (await t.loyaltyRule.count({ where: { source: "BIRTHDAY", isActive: true } })) {
      const tz = (await t.branch.findFirst({ select: { timezone: true } }))?.timezone ?? "UTC";
      const people = await t.customer.findMany({ where: { status: "ACTIVE", dateOfBirth: { not: null } }, select: { id: true, dateOfBirth: true } });
      for (const c of people) {
        if (!isBirthday(c.dateOfBirth, now, tz, 0)) continue;
        birthdays += await earnEvent(t, c.id, "BIRTHDAY", null, { type: "BIRTHDAY", id: null }, `pts:birthday:${c.id}:${now.getUTCFullYear()}`, "Happy birthday!");
      }
    }
    const due = await t.loyaltyTransaction.findMany({ where: { points: { gt: 0 }, expiresAt: { lte: now } }, distinct: ["customerId"], select: { customerId: true } });
    for (const { customerId } of due) expired += await expireFor(t, customerId, now);
    return { birthdays, expired };
  }
}
