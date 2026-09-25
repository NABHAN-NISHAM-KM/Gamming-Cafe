import { ConflictException } from "@nestjs/common";
import { Prisma, type TenantTx } from "@arena/db";
import { payFromWallet } from "../wallet/wallet.js";

const LIVE_SESSION = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;

export const minorUnit = async (t: TenantTx, currency: string) => (await t.currency.findUnique({ where: { code: currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
export const toMinor = (v: Prisma.Decimal | number | string, unit: number) => Math.round(Number(v) * 10 ** unit);
export const fromMinor = (m: number, unit: number) => new Prisma.Decimal(m).div(10 ** unit);

/**
 * Re-adds a bill from its orders and payments. A bill with a live gaming
 * session stays OPEN (more time or food may still come). Orders on a settled
 * bill are marked PAID.
 */
export async function recomputeBill(t: TenantTx, billId: string) {
  const orders = await t.order.findMany({ where: { billId, status: { notIn: ["CANCELLED"] } }, select: { id: true, subtotal: true, discountTotal: true, taxTotal: true, total: true } });
  const pays = await t.payment.findMany({ where: { billId, status: "CAPTURED" }, select: { amount: true, refundedAmount: true } });
  const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
  const total = sum(orders.map((o) => o.total));
  const paid = sum(pays.map((p) => p.amount.sub(p.refundedAmount)));
  const live = await t.gamingSession.count({ where: { billId, status: { in: [...LIVE_SESSION] } } });
  const status = live > 0 ? (paid.gt(0) && paid.lt(total) ? "PARTIALLY_PAID" : "OPEN") : paid.gte(total) ? "SETTLED" : paid.gt(0) ? "PARTIALLY_PAID" : "OPEN";
  const bill = await t.bill.update({
    where: { id: billId },
    data: {
      subtotal: sum(orders.map((o) => o.subtotal)), discountTotal: sum(orders.map((o) => o.discountTotal)), taxTotal: sum(orders.map((o) => o.taxTotal)),
      total, paidTotal: paid, status: live > 0 && paid.gte(total) ? "OPEN" : status, closedAt: status === "SETTLED" && live === 0 ? new Date() : null, version: { increment: 1 },
    },
  });
  if (paid.gte(total) && total.gt(0)) {
    await t.order.updateMany({ where: { billId, status: { notIn: ["CANCELLED"] }, paymentState: { in: ["UNPAID", "ON_BILL", "PARTIALLY_PAID"] } }, data: { paymentState: "PAID" } });
  }
  return bill;
}

/** The employee's open shift at a branch (any drawer), if any. */
export async function openShiftOf(t: TenantTx, employeeId: string | null, branchId: string) {
  if (!employeeId) return null;
  return t.shift.findFirst({ where: { employeeId, branchId, status: "OPEN" }, select: { id: true, cashDrawerId: true } });
}

export interface RecordPayment {
  bill: { id: string; branchId: string; currency: string };
  method: "CASH" | "CARD" | "WALLET";
  amountMinor: number;
  unit: number;
  key: string;
  customerId: string | null;
  employeeId: string | null;
  orderId?: string | null;
  reference?: string | null;
  tenderedMinor?: number | null;
  /** POS insists on an open shift for cash; older flows (sessions) record it when there is one. */
  requireShiftForCash?: boolean;
}

/**
 * One captured payment on a bill. Cash goes into the cashier's open shift
 * (drawer ledger), wallet payments debit the customer's wallet. Idempotent.
 */
export async function recordPayment(t: TenantTx, p: RecordPayment): Promise<string> {
  const existing = await t.payment.findFirst({ where: { idempotencyKey: p.key }, select: { id: true } });
  if (existing) return existing.id;
  if (p.amountMinor <= 0) throw new ConflictException({ error: "bad_amount" });
  const shift = await openShiftOf(t, p.employeeId, p.bill.branchId);
  if (p.method === "CASH" && p.requireShiftForCash && !shift) throw new ConflictException({ error: "no_open_shift", hint: "Open your shift (cash drawer) before taking cash." });

  let paymentId: string;
  if (p.method === "WALLET") {
    paymentId = await payFromWallet(t, { bill: p.bill, amountMinor: p.amountMinor, unit: p.unit, key: p.key, customerId: p.customerId, employeeId: p.employeeId });
    if (shift || p.orderId) await t.payment.update({ where: { id: paymentId }, data: { shiftId: shift?.id ?? null, orderId: p.orderId ?? null } });
  } else {
    const organizationId = (await t.bill.findUniqueOrThrow({ where: { id: p.bill.id }, select: { organizationId: true } })).organizationId;
    const tendered = p.method === "CASH" && p.tenderedMinor != null ? p.tenderedMinor : null;
    if (tendered !== null && tendered < p.amountMinor) throw new ConflictException({ error: "insufficient_cash" });
    const pay = await t.payment.create({
      data: {
        organizationId, branchId: p.bill.branchId, billId: p.bill.id, orderId: p.orderId ?? null, customerId: p.customerId, employeeId: p.employeeId, shiftId: shift?.id ?? null,
        method: p.method, provider: "MANUAL", providerRef: p.reference ?? null, status: "CAPTURED", amount: fromMinor(p.amountMinor, p.unit), currency: p.bill.currency,
        cashTendered: tendered !== null ? fromMinor(tendered, p.unit) : null, changeGiven: tendered !== null ? fromMinor(tendered - p.amountMinor, p.unit) : null,
        idempotencyKey: p.key, capturedAt: new Date(),
      },
    });
    paymentId = pay.id;
    if (p.method === "CASH" && shift) {
      await t.cashMovement.create({ data: { organizationId, shiftId: shift.id, type: "CASH_SALE", amount: fromMinor(p.amountMinor, p.unit), paymentId, employeeId: p.employeeId! } });
    }
  }
  return paymentId;
}
