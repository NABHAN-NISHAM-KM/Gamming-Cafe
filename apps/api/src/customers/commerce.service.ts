import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { chargeWithTax, openShiftOf, taxWithin } from "../pos/bills.js";
import { PricingError, quote } from "../sessions/pricing.js";
import { toPlanDef } from "../sessions/sessions.service.js";
import { adjustTime } from "../sessions/time-balance.js";
import { fromMinor, moveMoney, orgCurrency, payFromWallet, toMinor } from "../wallet/wallet.js";

export type SaleActor = { type: "EMPLOYEE"; id: string } | { type: "CUSTOMER"; id: string };
export type SalePayment = { method: "CASH" | "CARD" | "WALLET"; reference?: string | null };

const SYS_PRODUCTS = {
  GAMING_TIME: { sku: "SYS-PREPAID-TIME", name: "Prepaid gaming time", category: "Gaming" },
  MEMBERSHIP: { sku: "SYS-MEMBERSHIP", name: "Membership", category: "Memberships" },
  WALLET_TOPUP: { sku: "SYS-WALLET-TOPUP", name: "Wallet top-up", category: "Wallet" },
  GIFT_CARD: { sku: "SYS-GIFT-CARD", name: "Gift card", category: "Wallet" },
  /** Season passes (the only SERVICE sold from here). */
  SERVICE: { sku: "SYS-SEASON-PASS", name: "Season pass", category: "Memberships" },
} as const;

// No 0/O/1/I/L: a code read out loud or off a printed card survives being typed.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** 16 characters, about 79 bits: not guessable, so redeeming needs no more than a per-customer throttle. */
const newGiftCode = () => Array.from(randomBytes(16), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const formatGiftCode = (c: string) => c.match(/.{4}/g)!.join("-");
/** Case, spaces and dashes don't matter when typing a code. */
export const giftCodeHash = (code: string) => createHash("sha256").update(code.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");

/** Default life of bonus credit granted with a top-up. */
const BONUS_DAYS = 90;

/**
 * Things a customer buys for their account — prepaid time, memberships,
 * wallet credit — sold by staff at the counter or by the customer in the app
 * (paying from their wallet). Each sale is one bill, one order line and one
 * payment, written together; retries with the same key change nothing.
 */
@Injectable()
export class CommerceService {
  private async branch(t: TenantTx, branchId: string) {
    const b = await t.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, brandId: true, currency: true, timezone: true } });
    if (!b) throw new NotFoundException({ error: "branch_not_found" });
    return b;
  }

  private async product(t: TenantTx, organizationId: string, type: keyof typeof SYS_PRODUCTS, currency: string) {
    const p = SYS_PRODUCTS[type];
    const found = await t.product.findFirst({ where: { sku: p.sku }, select: { id: true } });
    if (found) return found.id;
    const category = (await t.productCategory.findFirst({ where: { name: p.category }, select: { id: true } })) ?? (await t.productCategory.create({ data: { organizationId, name: p.category, showInShell: false } }));
    return (await t.product.create({ data: { organizationId, sku: p.sku, name: p.name, type, price: 0, currency, availableInShell: false, categoryId: category.id }, select: { id: true } })).id;
  }

  /** Bill + order + line + payment for one account sale. Returns null if this key was already paid (a retry). */
  private async sell(
    t: TenantTx,
    s: {
      branchId: string; customerId: string | null; type: keyof typeof SYS_PRODUCTS; line: string; quantity: number;
      grossMinor: number; discountMinor: number; payment: SalePayment; key: string; actor: SaleActor;
    },
  ) {
    if (await t.payment.findFirst({ where: { idempotencyKey: `${s.key}:pay` }, select: { id: true } })) return null;
    const branch = await this.branch(t, s.branchId);
    const { organizationId, unit } = await orgCurrency(t);
    const employeeId = s.actor.type === "EMPLOYEE" ? s.actor.id : null;
    const now = new Date();
    const stamp = `${now.toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    // A top-up or gift card is money held for the customer (a liability), not a sale: no tax until it's spent.
    const held = s.type === "WALLET_TOPUP" || s.type === "GIFT_CARD";
    const cls = s.type === "GAMING_TIME" ? "GAMING" : "SERVICE";
    const netMinor = held ? s.grossMinor - s.discountMinor : await chargeWithTax(t, branch.id, cls, s.grossMinor - s.discountMinor);
    const amount = fromMinor(netMinor, unit);
    const { taxMinor, taxes } = held ? { taxMinor: 0, taxes: [] } : await taxWithin(t, branch.id, cls, netMinor);
    const taxTotal = fromMinor(taxMinor, unit);
    const bill = await t.bill.create({ data: { organizationId, branchId: branch.id, number: `${branch.code}-${stamp}`, customerId: s.customerId, currency: branch.currency, openedById: employeeId } });
    const order = await t.order.create({
      data: {
        organizationId, branchId: branch.id, number: `A-${stamp}`, channel: s.actor.type === "CUSTOMER" ? "WEB" : "POS", type: "COUNTER", status: "COMPLETED", paymentState: "PAID",
        billId: bill.id, customerId: s.customerId, employeeId, subtotal: fromMinor(s.grossMinor, unit), discountTotal: fromMinor(s.discountMinor, unit), taxTotal, total: amount,
        currency: branch.currency, placedAt: now, completedAt: now,
      },
    });
    await t.orderItem.create({
      data: {
        organizationId, orderId: order.id, productId: await this.product(t, organizationId, s.type, branch.currency), nameSnapshot: s.line, productType: s.type,
        quantity: s.quantity, unitPrice: fromMinor(Math.round(s.grossMinor / Math.max(1, s.quantity)), unit), discountAmount: fromMinor(s.discountMinor, unit), taxAmount: taxTotal, taxBreakdown: taxes as unknown as Prisma.InputJsonValue, lineTotal: amount, status: "SERVED",
      },
    });
    let paymentId: string | null = null;
    if (netMinor > 0) {
      if (s.payment.method === "WALLET") {
        if (!s.customerId) throw new ConflictException({ error: "wallet_needs_customer" });
        paymentId = await payFromWallet(t, { bill: { id: bill.id, branchId: branch.id, currency: branch.currency }, amountMinor: netMinor, unit, key: `${s.key}:pay`, customerId: s.customerId, employeeId });
      } else {
        // Cash at the counter goes into the cashier's open drawer, like any POS sale, so the shift count adds up.
        const shift = await openShiftOf(t, employeeId, branch.id);
        paymentId = (await t.payment.create({
          data: {
            organizationId, branchId: branch.id, billId: bill.id, customerId: s.customerId, employeeId, shiftId: shift?.id ?? null, method: s.payment.method, provider: "MANUAL",
            providerRef: s.payment.reference ?? null, status: "CAPTURED", amount, currency: branch.currency, idempotencyKey: `${s.key}:pay`, capturedAt: now,
          },
        })).id;
        if (s.payment.method === "CASH" && shift) {
          await t.cashMovement.create({ data: { organizationId, shiftId: shift.id, type: "CASH_SALE", amount, paymentId, employeeId: employeeId! } });
        }
      }
    }
    await t.bill.update({ where: { id: bill.id }, data: { subtotal: order.subtotal, discountTotal: order.discountTotal, taxTotal, total: amount, paidTotal: amount, status: "SETTLED", closedAt: now } });
    return { bill, paymentId, amount: amount.toFixed(unit), currency: branch.currency, unit };
  }

  // ── prepaid time ─────────────────────────────────────────────────────────

  async sellTime(
    t: TenantTx,
    i: { customerId: string; branchId: string; planId: string; packageId?: string; minutes?: number; payment: SalePayment; idempotencyKey: string },
    actor: SaleActor,
  ) {
    const customer = await t.customer.findUnique({ where: { id: i.customerId }, select: { id: true, status: true, membershipTier: { select: { gamingDiscountPct: true } } } });
    if (!customer) throw new NotFoundException({ error: "customer_not_found" });
    const branch = await this.branch(t, i.branchId);
    const { unit } = await orgCurrency(t);
    const row = await t.pricingPlan.findUnique({ where: { id: i.planId }, include: { pricingPackages: true } });
    if (!row || !row.isActive || (row.branchId && row.branchId !== branch.id)) throw new NotFoundException({ error: "plan_not_found" });
    const plan = toPlanDef(row, unit);
    let q;
    try {
      q = quote(
        plan,
        i.packageId ? { kind: "package", packageId: i.packageId } : { kind: "minutes", minutes: i.minutes! },
        { branchId: branch.id, zoneId: row.zoneId ?? "", stationClass: plan.stationClass, membershipTierId: null, timezone: branch.timezone, now: new Date() },
        { membershipDiscountPct: Number(customer.membershipTier?.gamingDiscountPct ?? 0) },
      );
    } catch (e) {
      if (e instanceof PricingError) throw new ConflictException({ error: e.code, message: e.message });
      throw e;
    }
    const sale = await this.sell(t, {
      branchId: branch.id, customerId: i.customerId, type: "GAMING_TIME", line: `Prepaid time — ${q.lines[0]}`, quantity: q.minutes!,
      grossMinor: q.grossMinor, discountMinor: q.membershipDiscountMinor, payment: i.payment, key: i.idempotencyKey, actor,
    });
    const { currency } = await orgCurrency(t);
    const r = await adjustTime(t, {
      organizationId: (await orgCurrency(t)).organizationId, customerId: i.customerId, branchId: branch.id, currency, deltaMinutes: q.minutes!, type: "TOPUP", reason: q.lines[0]!,
      referenceType: "BILL", referenceId: sale?.bill.id ?? null, paymentId: sale?.paymentId ?? null, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, idempotencyKey: `${i.idempotencyKey}:time`,
    });
    if (sale) await auditAs(t, actor, { action: "customer.time.sell", entityType: "Customer", entityId: i.customerId, branchId: branch.id, after: { minutes: q.minutes, amount: sale.amount, method: i.payment.method, billId: sale.bill.id } });
    return { customerId: i.customerId, minutesAdded: q.minutes, amount: sale?.amount ?? null, currency: sale?.currency ?? currency, billNumber: sale?.bill.number ?? null, timeBalanceMinutes: r.balanceAfter, duplicate: !sale };
  }

  // ── wallet top-up ───────────────────────────────────────────────────────

  async topUp(
    t: TenantTx,
    i: { customerId: string; branchId: string; amount: string; bonus?: string | null; payment: { method: "CASH" | "CARD"; reference?: string | null }; idempotencyKey: string },
    actor: SaleActor,
  ) {
    if (!(await t.customer.findUnique({ where: { id: i.customerId }, select: { id: true } }))) throw new NotFoundException({ error: "customer_not_found" });
    const { unit, currency } = await orgCurrency(t);
    const branch = await this.branch(t, i.branchId);
    if (branch.currency !== currency) throw new ConflictException({ error: "wallet_currency_mismatch" });
    const amountMinor = toMinor(i.amount, unit);
    const bonusMinor = i.bonus ? toMinor(i.bonus, unit) : 0;
    if (amountMinor <= 0 || bonusMinor < 0) throw new ConflictException({ error: "bad_amount" });
    const sale = await this.sell(t, { branchId: branch.id, customerId: i.customerId, type: "WALLET_TOPUP", line: `Wallet top-up`, quantity: 1, grossMinor: amountMinor, discountMinor: 0, payment: i.payment, key: i.idempotencyKey, actor });
    const employeeId = actor.type === "EMPLOYEE" ? actor.id : null;
    const cash = await moveMoney(t, { customerId: i.customerId, bucket: "CASH", deltaMinor: amountMinor, type: "TOPUP", reason: "Top-up", branchId: branch.id, referenceType: "BILL", referenceId: sale?.bill.id ?? null, paymentId: sale?.paymentId ?? null, employeeId, idempotencyKey: `${i.idempotencyKey}:cash` });
    if (bonusMinor > 0) {
      await moveMoney(t, { customerId: i.customerId, bucket: "BONUS", deltaMinor: bonusMinor, type: "BONUS_GRANT", reason: "Top-up bonus", branchId: branch.id, referenceType: "BILL", referenceId: sale?.bill.id ?? null, employeeId, expiresAt: new Date(Date.now() + BONUS_DAYS * 86_400_000), idempotencyKey: `${i.idempotencyKey}:bonus` });
    }
    if (sale) await auditAs(t, actor, { action: "wallet.topup", entityType: "Customer", entityId: i.customerId, branchId: branch.id, after: { amount: i.amount, bonus: i.bonus ?? null, method: i.payment.method, billId: sale.bill.id } });
    return { customerId: i.customerId, cashBalance: fromMinor(cash.balanceAfterMinor, unit).toFixed(unit), duplicate: !sale };
  }

  // ── gift cards ──────────────────────────────────────────────────────────

  /**
   * Sells a gift card: one bill (held as a liability, not revenue) and a new
   * code, returned once. Only the code's hash is stored. A retry with the same
   * key returns no code, because it can't be recovered.
   */
  async sellGiftCard(t: TenantTx, i: { branchId: string; amount: string; customerId?: string | null; payment: SalePayment; idempotencyKey: string }, actor: SaleActor) {
    const { unit, currency, organizationId } = await orgCurrency(t);
    const branch = await this.branch(t, i.branchId);
    if (branch.currency !== currency) throw new ConflictException({ error: "wallet_currency_mismatch" });
    if (i.customerId && !(await t.customer.findUnique({ where: { id: i.customerId }, select: { id: true } }))) throw new NotFoundException({ error: "customer_not_found" });
    const grossMinor = toMinor(i.amount, unit);
    if (grossMinor <= 0) throw new ConflictException({ error: "bad_amount" });
    const sale = await this.sell(t, { branchId: branch.id, customerId: i.customerId ?? null, type: "GIFT_CARD", line: "Gift card", quantity: 1, grossMinor, discountMinor: 0, payment: i.payment, key: i.idempotencyKey, actor });
    if (!sale) return { duplicate: true as const };
    const code = newGiftCode();
    const card = await t.giftCard.create({
      data: { organizationId, codeHash: giftCodeHash(code), codeHint: code.slice(-4), amount: fromMinor(grossMinor, unit), currency, branchId: branch.id, billId: sale.bill.id, soldById: actor.type === "EMPLOYEE" ? actor.id : null },
    });
    await auditAs(t, actor, { action: "giftcard.sell", entityType: "GiftCard", entityId: card.id, branchId: branch.id, after: { amount: i.amount, method: i.payment.method, billId: sale.bill.id } });
    return { duplicate: false as const, id: card.id, code: formatGiftCode(code), amount: sale.amount, currency, billNumber: sale.bill.number };
  }

  /** Turns a code into wallet money, once. A wrong or used code looks the same: `gift_card_invalid`. */
  async redeemGiftCard(t: TenantTx, i: { customerId: string; code: string }, actor: SaleActor) {
    const card = await t.giftCard.findFirst({ where: { codeHash: giftCodeHash(i.code), status: "ACTIVE" } });
    if (!card) throw new ConflictException({ error: "gift_card_invalid" });
    // The claim is atomic: of two racing redemptions only one flips ACTIVE to REDEEMED.
    const claimed = await t.giftCard.updateMany({ where: { id: card.id, status: "ACTIVE" }, data: { status: "REDEEMED", redeemedAt: new Date(), redeemedById: i.customerId } });
    if (claimed.count !== 1) throw new ConflictException({ error: "gift_card_invalid" });
    const { unit } = await orgCurrency(t);
    const cash = await moveMoney(t, { customerId: i.customerId, bucket: "CASH", deltaMinor: toMinor(card.amount, unit), type: "TOPUP", reason: `Gift card ....${card.codeHint}`, branchId: card.branchId, referenceType: "GIFT_CARD", referenceId: card.id, idempotencyKey: `giftcard:${card.id}` });
    await auditAs(t, actor, { action: "giftcard.redeem", entityType: "GiftCard", entityId: card.id, branchId: card.branchId, after: { amount: card.amount.toFixed(unit), customerId: i.customerId } });
    return { amount: card.amount.toFixed(unit), currency: card.currency, cashBalance: fromMinor(cash.balanceAfterMinor, unit).toFixed(unit) };
  }

  // ── memberships ─────────────────────────────────────────────────────────

  /** A paid season pass, from the customer's wallet: a sale like any other, so the books and the wallet agree. */
  async sellSeasonPass(t: TenantTx, i: { customerId: string; branchId: string; name: string; price: string; idempotencyKey: string }, actor: SaleActor) {
    const { unit } = await orgCurrency(t);
    return this.sell(t, { branchId: i.branchId, customerId: i.customerId, type: "SERVICE", line: `Season pass — ${i.name}`, quantity: 1, grossMinor: toMinor(i.price, unit), discountMinor: 0, payment: { method: "WALLET" }, key: i.idempotencyKey, actor });
  }

  async sellMembership(t: TenantTx, i: { customerId: string; branchId: string; tierId: string; payment: SalePayment; idempotencyKey: string }, actor: SaleActor) {
    const tier = await t.membershipTier.findUnique({ where: { id: i.tierId } });
    if (!tier || !tier.isActive) throw new NotFoundException({ error: "tier_not_found" });
    if (tier.price === null || !tier.durationDays) throw new ConflictException({ error: "tier_not_for_sale", hint: "This tier is earned, not sold." });
    const customer = await t.customer.findUnique({ where: { id: i.customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException({ error: "customer_not_found" });
    const { unit, currency, organizationId } = await orgCurrency(t);

    const sale = await this.sell(t, {
      branchId: i.branchId, customerId: i.customerId, type: "MEMBERSHIP", line: `${tier.name} membership — ${tier.durationDays} days`, quantity: 1,
      grossMinor: toMinor(tier.price, unit), discountMinor: 0, payment: i.payment, key: i.idempotencyKey, actor,
    });
    if (!sale) {
      const m = await t.membership.findFirst({ where: { customerId: i.customerId, status: "ACTIVE" }, orderBy: { expiresAt: "desc" } });
      return { membership: m, duplicate: true };
    }

    const now = new Date();
    const days = tier.durationDays * 86_400_000;
    const current = await t.membership.findFirst({ where: { customerId: i.customerId, status: "ACTIVE" }, orderBy: { expiresAt: "desc" } });
    let membership;
    if (current && current.tierId === tier.id) {
      // Renewal: add the period on top of what's left.
      const from = current.expiresAt && current.expiresAt > now ? current.expiresAt : now;
      membership = await t.membership.update({ where: { id: current.id }, data: { expiresAt: new Date(from.getTime() + days) } });
    } else {
      // New or changed tier: the old one ends now (no proration in this version).
      if (current) await t.membership.update({ where: { id: current.id }, data: { status: "CANCELLED", expiresAt: now } });
      membership = await t.membership.create({ data: { organizationId, customerId: i.customerId, tierId: tier.id, status: "ACTIVE", startsAt: now, expiresAt: new Date(now.getTime() + days) } });
    }
    await t.customer.update({ where: { id: i.customerId }, data: { membershipTierId: tier.id } });
    if (tier.bonusMinutesMonthly > 0) {
      await adjustTime(t, {
        organizationId, customerId: i.customerId, branchId: i.branchId, currency, deltaMinutes: tier.bonusMinutesMonthly, type: "TOPUP", reason: `${tier.name} membership bonus`,
        referenceType: "MEMBERSHIP", referenceId: membership.id, employeeId: actor.type === "EMPLOYEE" ? actor.id : null, idempotencyKey: `${i.idempotencyKey}:bonus-time`,
      });
    }
    await auditAs(t, actor, { action: "membership.sell", entityType: "Membership", entityId: membership.id, branchId: i.branchId, after: { tier: tier.code, expiresAt: membership.expiresAt, amount: sale.amount, method: i.payment.method } });
    return { membership, amount: sale.amount, currency: sale.currency, billNumber: sale.bill.number, duplicate: false };
  }

  /** The customer's tier after a membership ends: the best other active membership, or none. */
  async recomputeTier(t: TenantTx, customerId: string) {
    const best = await t.membership.findFirst({ where: { customerId, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { tier: { select: { id: true, rank: true } } }, orderBy: { tier: { rank: "desc" } } });
    await t.customer.update({ where: { id: customerId }, data: { membershipTierId: best?.tier.id ?? null } });
    return best?.tier.id ?? null;
  }
}
