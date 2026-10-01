import { ConflictException } from "@nestjs/common";
import type { TenantTx } from "@arena/db";
import { walletFor } from "../wallet/wallet.js";

/**
 * Prepaid gaming minutes on a customer account (Wallet.timeBalanceMin), kept
 * as an append-only ledger (WalletTransaction, bucket TIME). The balance is a
 * projection updated with optimistic locking; the database forbids a negative
 * balance, so an overdraft is impossible even under concurrency. Money buckets
 * (cash/bonus/promo) arrive with the full wallet in phase 6.
 */
export async function adjustTime(
  t: TenantTx,
  input: {
    organizationId: string;
    customerId: string;
    branchId: string | null;
    currency: string;
    deltaMinutes: number;
    type: "TOPUP" | "SPEND" | "REFUND" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";
    reason: string;
    referenceType?: string;
    referenceId?: string | null;
    paymentId?: string | null;
    employeeId?: string | null;
    idempotencyKey: string;
  },
): Promise<{ balanceAfter: number; applied: boolean }> {
  if (!Number.isInteger(input.deltaMinutes) || input.deltaMinutes === 0) throw new Error("deltaMinutes must be a non-zero integer");

  const existing = await t.walletTransaction.findFirst({ where: { idempotencyKey: input.idempotencyKey }, select: { balanceAfter: true } });
  if (existing) return { balanceAfter: Number(existing.balanceAfter), applied: false }; // retry → no double effect

  for (let attempt = 0; attempt < 3; attempt++) {
    const wallet = await walletFor(t, input.organizationId, input.customerId, input.currency);
    const after = wallet.timeBalanceMin + input.deltaMinutes;
    if (after < 0) throw new ConflictException({ error: "insufficient_time", balanceMinutes: wallet.timeBalanceMin });

    const moved = await t.wallet.updateMany({ where: { id: wallet.id, version: wallet.version }, data: { timeBalanceMin: after, version: { increment: 1 } } });
    if (moved.count !== 1) continue; // concurrent change — re-read and retry
    await t.walletTransaction.create({
      data: {
        organizationId: input.organizationId,
        walletId: wallet.id,
        branchId: input.branchId,
        type: input.type,
        bucket: "TIME",
        amount: input.deltaMinutes,
        balanceAfter: after,
        currency: input.currency,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        paymentId: input.paymentId ?? null,
        employeeId: input.employeeId ?? null,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { balanceAfter: after, applied: true };
  }
  throw new ConflictException({ error: "wallet_busy" });
}

export async function timeBalance(t: TenantTx, customerId: string): Promise<number> {
  const w = await t.wallet.findMany({ where: { customerId }, select: { timeBalanceMin: true } });
  return w.reduce((s, x) => s + x.timeBalanceMin, 0);
}
