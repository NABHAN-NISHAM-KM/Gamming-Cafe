-- ─────────────────────────────────────────────────────────────────────────────
-- 0016_reporting_indexes (Phase 11)
-- Date-range indexes for the reports: sales by bill close time, utilization by
-- session start, cash by shift close, refunds by processing time.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE INDEX "Bill_organizationId_branchId_closedAt_idx" ON "Bill"("organizationId", "branchId", "closedAt");
-- CreateIndex
CREATE INDEX "GamingSession_organizationId_branchId_startedAt_idx" ON "GamingSession"("organizationId", "branchId", "startedAt");
-- CreateIndex
CREATE INDEX "Refund_organizationId_processedAt_idx" ON "Refund"("organizationId", "processedAt");
-- CreateIndex
CREATE INDEX "Shift_organizationId_branchId_closedAt_idx" ON "Shift"("organizationId", "branchId", "closedAt");
