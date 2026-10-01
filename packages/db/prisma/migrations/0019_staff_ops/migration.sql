-- ─────────────────────────────────────────────────────────────────────────────
-- 0019_staff_ops
-- Staff clock-in/out (attendance), shift handover notes, and the 1–5 star
-- rating players give their session from the Shell.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "TimeClockEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "clockInAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clockOutAt" TIMESTAMPTZ(3),

    CONSTRAINT "TimeClockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverNote" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" UUID,

    CONSTRAINT "HandoverNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionFeedback" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "customerId" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeClockEntry_organizationId_branchId_clockInAt_idx" ON "TimeClockEntry"("organizationId", "branchId", "clockInAt");

-- CreateIndex
CREATE INDEX "TimeClockEntry_organizationId_employeeId_clockInAt_idx" ON "TimeClockEntry"("organizationId", "employeeId", "clockInAt");

-- CreateIndex
CREATE INDEX "HandoverNote_organizationId_branchId_resolvedAt_createdAt_idx" ON "HandoverNote"("organizationId", "branchId", "resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionFeedback_sessionId_key" ON "SessionFeedback"("sessionId");

-- CreateIndex
CREATE INDEX "SessionFeedback_organizationId_branchId_createdAt_idx" ON "SessionFeedback"("organizationId", "branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverNote" ADD CONSTRAINT "HandoverNote_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverNote" ADD CONSTRAINT "HandoverNote_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFeedback" ADD CONSTRAINT "SessionFeedback_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "TimeClockEntry"
  ADD CONSTRAINT time_clock_one_open_per_employee EXCLUDE USING gist ("employeeId" WITH =) WHERE ("clockOutAt" IS NULL),
  ADD CONSTRAINT time_clock_out_after_in CHECK ("clockOutAt" IS NULL OR "clockOutAt" >= "clockInAt");
ALTER TABLE "HandoverNote"
  ADD CONSTRAINT handover_note_body CHECK (char_length("body") BETWEEN 1 AND 500);
ALTER TABLE "SessionFeedback"
  ADD CONSTRAINT session_feedback_rating CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT session_feedback_comment CHECK ("comment" IS NULL OR char_length("comment") <= 300);

-- TimeClockEntry
ALTER TABLE "TimeClockEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeClockEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeClockEntry" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- HandoverNote
ALTER TABLE "HandoverNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HandoverNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HandoverNote" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- SessionFeedback
ALTER TABLE "SessionFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionFeedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SessionFeedback" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

