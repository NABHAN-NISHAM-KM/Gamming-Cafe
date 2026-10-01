import type { TenantTx } from "@arena/db";

/**
 * Rebuilds a customer's denormalised counters from the source rows, so it is
 * safe to call any number of times: money actually paid in (wallet payments
 * are excluded — that money was already counted when it was topped up, net of
 * refunds), minutes played in ended sessions, and the latest visit.
 */
export async function refreshStats(t: TenantTx, customerId: string) {
  await t.$executeRaw`
    UPDATE "Customer" c SET
      "totalSpend" = COALESCE((SELECT SUM(p."amount" - p."refundedAmount") FROM "Payment" p
                                WHERE p."customerId" = c."id" AND p."method" <> 'WALLET' AND p."status" IN ('CAPTURED', 'PARTIALLY_REFUNDED')), 0),
      "totalGamingMinutes" = COALESCE((SELECT SUM(s."billedSeconds") / 60 FROM "GamingSession" s WHERE s."customerId" = c."id" AND s."status" = 'ENDED'), 0),
      "lastVisitAt" = GREATEST(c."lastVisitAt", (SELECT MAX(s."startedAt") FROM "GamingSession" s WHERE s."customerId" = c."id"))
    WHERE c."id" = ${customerId}::uuid`;
}
