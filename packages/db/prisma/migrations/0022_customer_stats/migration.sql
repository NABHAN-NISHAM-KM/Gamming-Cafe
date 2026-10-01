-- ─────────────────────────────────────────────────────────────────────────────
-- 0022_customer_stats
-- Customer.totalSpend / totalGamingMinutes / lastVisitAt were declared but
-- never kept up to date. The API now rebuilds them on every bill change and
-- session end; this fills them in for everyone who already has history.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE INDEX "Payment_organizationId_customerId_idx" ON "Payment"("organizationId", "customerId");

UPDATE "Customer" c SET
  "totalSpend" = COALESCE((SELECT SUM(p."amount" - p."refundedAmount") FROM "Payment" p
                            WHERE p."customerId" = c."id" AND p."method" <> 'WALLET' AND p."status" IN ('CAPTURED', 'PARTIALLY_REFUNDED')), 0),
  "totalGamingMinutes" = COALESCE((SELECT SUM(s."billedSeconds") / 60 FROM "GamingSession" s WHERE s."customerId" = c."id" AND s."status" = 'ENDED'), 0),
  "lastVisitAt" = GREATEST(c."lastVisitAt", (SELECT MAX(s."startedAt") FROM "GamingSession" s WHERE s."customerId" = c."id"))
WHERE c."status" <> 'DELETED';
