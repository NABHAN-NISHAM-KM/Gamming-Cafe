import { ConflictException } from "@nestjs/common";
import { Prisma, type TenantTx } from "@arena/db";

/**
 * Customer money wallet: CASH (paid in) and BONUS (granted, may expire) in the
 * org's currency, alongside the prepaid-minutes bucket (see time-balance.ts).
 *
 * Every movement is an append-only WalletTransaction; the Wallet row is a
 * projection updated in the same transaction with optimistic locking. The
 * database refuses negative balances, so an overdraft is impossible even under
 * concurrency. Amounts in and out of this module are integer MINOR units.
 */

export type MoneyBucket = "CASH" | "BONUS";

const COLUMN: Record<MoneyBucket, "cashBalance" | "bonusBalance"> = { CASH: "cashBalance", BONUS: "bonusBalance" };

export const toMinor = (d: Prisma.Decimal | number | string, unit: number) => Math.round(Number(d) * 10 ** unit);
export const fromMinor = (m: number, unit: number) => new Prisma.Decimal(m).div(10 ** unit);

export async function orgCurrency(t: TenantTx) {
  const org = await t.organization.findFirstOrThrow({ select: { id: true, defaultCurrency: true } });
  const unit = (await t.currency.findUnique({ where: { code: org.defaultCurrency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
  return { organizationId: org.id, currency: org.defaultCurrency, unit };
}

/**
 * The customer's wallet in `currency`, created on first use. A failed INSERT
 * would abort the surrounding Postgres transaction, so a concurrent first use
 * is absorbed with ON CONFLICT DO NOTHING (which waits for the other insert to
 * commit) and the row is then re-read. `organizationId` must be the current
 * org — the RLS policy's WITH CHECK refuses anything else.
 */
export async function walletFor(t: TenantTx, organizationId: string, customerId: string, currency: string) {
  const found = await t.wallet.findFirst({ where: { customerId, currency } });
  if (found) return found;
  await t.$executeRaw`
    INSERT INTO "Wallet" ("id", "organizationId", "customerId", "currency", "updatedAt")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, ${customerId}::uuid, ${currency}, now())
    ON CONFLICT ("customerId", "currency") DO NOTHING`;
  return t.wallet.findFirstOrThrow({ where: { customerId, currency } });
}

export interface Movement {
  customerId: string;
  bucket: MoneyBucket;
  /** signed minor units: + credit, − debit */
  deltaMinor: number;
  type: "TOPUP" | "SPEND" | "REFUND" | "ADJUSTMENT" | "BONUS_GRANT" | "BONUS_EXPIRE" | "TRANSFER_IN" | "TRANSFER_OUT";
  reason: string;
  branchId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  paymentId?: string | null;
  employeeId?: string | null;
  expiresAt?: Date | null;
  idempotencyKey: string;
}

/** One ledger movement in one bucket. Idempotent on idempotencyKey. */
export async function moveMoney(t: TenantTx, m: Movement): Promise<{ balanceAfterMinor: number; applied: boolean }> {
  if (!Number.isInteger(m.deltaMinor) || m.deltaMinor === 0) throw new Error("deltaMinor must be a non-zero integer");
  const { organizationId, currency, unit } = await orgCurrency(t);
  const existing = await t.walletTransaction.findFirst({ where: { idempotencyKey: m.idempotencyKey }, select: { balanceAfter: true } });
  if (existing) return { balanceAfterMinor: toMinor(existing.balanceAfter, unit), applied: false };

  for (let attempt = 0; attempt < 3; attempt++) {
    const w = await walletFor(t, organizationId, m.customerId, currency);
    if (w.isFrozen && m.deltaMinor < 0) throw new ConflictException({ error: "wallet_frozen" });
    const col = COLUMN[m.bucket];
    const before = toMinor(w[col], unit);
    const after = before + m.deltaMinor;
    if (after < 0) throw new ConflictException({ error: "insufficient_funds", balance: fromMinor(before, unit).toFixed(unit) });
    const moved = await t.wallet.updateMany({ where: { id: w.id, version: w.version }, data: { [col]: fromMinor(after, unit), version: { increment: 1 } } });
    if (moved.count !== 1) continue; // someone else moved money meanwhile — re-read
    await t.walletTransaction.create({
      data: {
        organizationId, walletId: w.id, branchId: m.branchId ?? null, type: m.type, bucket: m.bucket,
        amount: fromMinor(m.deltaMinor, unit), balanceAfter: fromMinor(after, unit), currency,
        referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null, paymentId: m.paymentId ?? null,
        employeeId: m.employeeId ?? null, reason: m.reason, expiresAt: m.expiresAt ?? null, idempotencyKey: m.idempotencyKey,
      },
    });
    return { balanceAfterMinor: after, applied: true };
  }
  throw new ConflictException({ error: "wallet_busy" });
}

/**
 * Pays from the wallet: BONUS first (it can expire), then CASH. Throws
 * insufficient_funds if the two together don't cover it — nothing is taken.
 */
export async function spendMoney(
  t: TenantTx,
  s: { customerId: string; amountMinor: number; reason: string; branchId?: string | null; referenceType?: string; referenceId?: string | null; paymentId?: string | null; employeeId?: string | null; idempotencyKey: string },
): Promise<{ fromBonusMinor: number; fromCashMinor: number }> {
  if (!Number.isInteger(s.amountMinor) || s.amountMinor <= 0) throw new Error("amountMinor must be positive");
  const done = await t.walletTransaction.findMany({ where: { idempotencyKey: { in: [`${s.idempotencyKey}:bonus`, `${s.idempotencyKey}:cash`] } }, select: { idempotencyKey: true, amount: true } });
  const { unit } = await orgCurrency(t);
  if (done.length) {
    const part = (k: string) => -toMinor(done.find((d) => d.idempotencyKey === `${s.idempotencyKey}:${k}`)?.amount ?? 0, unit);
    return { fromBonusMinor: part("bonus"), fromCashMinor: part("cash") };
  }
  const b = await balances(t, s.customerId);
  if (b.frozen) throw new ConflictException({ error: "wallet_frozen" });
  await assertWithinSpendCap(t, s.customerId, s.amountMinor, b.unit);
  if (b.cashMinor + b.bonusMinor < s.amountMinor) {
    throw new ConflictException({ error: "insufficient_funds", balance: fromMinor(b.cashMinor + b.bonusMinor, unit).toFixed(unit), needed: fromMinor(s.amountMinor, unit).toFixed(unit) });
  }
  const fromBonusMinor = Math.min(b.bonusMinor, s.amountMinor);
  const fromCashMinor = s.amountMinor - fromBonusMinor;
  const common = { customerId: s.customerId, type: "SPEND" as const, reason: s.reason, branchId: s.branchId, referenceType: s.referenceType, referenceId: s.referenceId, paymentId: s.paymentId, employeeId: s.employeeId };
  if (fromBonusMinor) await moveMoney(t, { ...common, bucket: "BONUS", deltaMinor: -fromBonusMinor, idempotencyKey: `${s.idempotencyKey}:bonus` });
  if (fromCashMinor) await moveMoney(t, { ...common, bucket: "CASH", deltaMinor: -fromCashMinor, idempotencyKey: `${s.idempotencyKey}:cash` });
  return { fromBonusMinor, fromCashMinor };
}

/** Wallet money spent in the last 7 days, in minor units. */
export async function spentThisWeek(t: TenantTx, customerId: string, unit: number) {
  const r = await t.walletTransaction.aggregate({ where: { wallet: { customerId }, type: "SPEND", bucket: { in: ["CASH", "BONUS"] }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _sum: { amount: true } });
  return -toMinor(r._sum.amount ?? 0, unit);
}

/** A weekly spending limit (set by the customer or their guardian) caps wallet spending over any 7 days. */
async function assertWithinSpendCap(t: TenantTx, customerId: string, amountMinor: number, unit: number) {
  const c = await t.customer.findUnique({ where: { id: customerId }, select: { weeklySpendCap: true } });
  if (!c?.weeklySpendCap) return;
  const capMinor = toMinor(c.weeklySpendCap, unit);
  const spent = await spentThisWeek(t, customerId, unit);
  if (spent + amountMinor > capMinor) {
    throw new ConflictException({ error: "spend_limit_reached", limit: fromMinor(capMinor, unit).toFixed(unit), left: fromMinor(Math.max(0, capMinor - spent), unit).toFixed(unit) });
  }
}

/**
 * A WALLET payment on a bill: a Payment row (method WALLET) plus the matching
 * wallet debit, in the same transaction. Idempotent on `key`.
 */
export async function payFromWallet(
  t: TenantTx,
  p: { bill: { id: string; branchId: string; currency: string }; amountMinor: number; unit: number; key: string; customerId: string | null; employeeId: string | null },
): Promise<string> {
  if (!p.customerId) throw new ConflictException({ error: "wallet_needs_customer" });
  const { currency } = await orgCurrency(t);
  if (currency !== p.bill.currency) throw new ConflictException({ error: "wallet_currency_mismatch", wallet: currency, bill: p.bill.currency });
  const existing = await t.payment.findFirst({ where: { idempotencyKey: p.key }, select: { id: true } });
  if (existing) return existing.id;
  const { organizationId } = await orgCurrency(t);
  const pay = await t.payment.create({
    data: {
      organizationId, branchId: p.bill.branchId, billId: p.bill.id, customerId: p.customerId, employeeId: p.employeeId, method: "WALLET",
      status: "CAPTURED", amount: fromMinor(p.amountMinor, p.unit), currency: p.bill.currency, idempotencyKey: p.key, capturedAt: new Date(),
    },
  });
  await spendMoney(t, {
    customerId: p.customerId, amountMinor: p.amountMinor, reason: "Payment", branchId: p.bill.branchId, referenceType: "BILL", referenceId: p.bill.id,
    paymentId: pay.id, employeeId: p.employeeId, idempotencyKey: `${p.key}:wallet`,
  });
  return pay.id;
}

export async function balances(t: TenantTx, customerId: string) {
  const { currency, unit } = await orgCurrency(t);
  const w = await t.wallet.findFirst({ where: { customerId, currency } });
  const time = await t.wallet.findMany({ where: { customerId }, select: { timeBalanceMin: true } });
  return {
    currency,
    unit,
    cashMinor: w ? toMinor(w.cashBalance, unit) : 0,
    bonusMinor: w ? toMinor(w.bonusBalance, unit) : 0,
    timeMinutes: time.reduce((a, x) => a + x.timeBalanceMin, 0),
    frozen: w?.isFrozen ?? false,
  };
}

export async function walletView(t: TenantTx, customerId: string, take = 50) {
  const b = await balances(t, customerId);
  const f = (m: number) => fromMinor(m, b.unit).toFixed(b.unit);
  const ledger = await t.walletTransaction.findMany({ where: { wallet: { customerId } }, orderBy: { createdAt: "desc" }, take });
  return {
    currency: b.currency,
    cash: f(b.cashMinor),
    bonus: f(b.bonusMinor),
    total: f(b.cashMinor + b.bonusMinor),
    timeMinutes: b.timeMinutes,
    frozen: b.frozen,
    ledger: ledger.map((x) => ({
      id: x.id, at: x.createdAt, type: x.type, bucket: x.bucket, reason: x.reason, referenceType: x.referenceType,
      amount: x.bucket === "TIME" ? Number(x.amount) : Number(x.amount).toFixed(b.unit),
      balanceAfter: x.bucket === "TIME" ? Number(x.balanceAfter) : Number(x.balanceAfter).toFixed(b.unit),
      expiresAt: x.expiresAt,
    })),
  };
}
