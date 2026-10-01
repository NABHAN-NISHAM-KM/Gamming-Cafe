-- ─────────────────────────────────────────────────────────────────────────────
-- 0018_screenshots
-- Screenshots customers take on a gaming PC (Print Screen on the Shell), kept on
-- their account for 30 days and shown in the customer app.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "deviceId" UUID,
    "sessionId" UUID,
    "image" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "takenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Screenshot_organizationId_customerId_takenAt_idx" ON "Screenshot"("organizationId", "customerId", "takenAt");

-- CreateIndex
CREATE INDEX "Screenshot_expiresAt_idx" ON "Screenshot"("expiresAt");

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "Screenshot"
  ADD CONSTRAINT screenshot_size CHECK ("sizeBytes" BETWEEN 1 AND 2000000 AND octet_length("image") = "sizeBytes"),
  ADD CONSTRAINT screenshot_dimensions CHECK ("width" BETWEEN 1 AND 8192 AND "height" BETWEEN 1 AND 8192);

-- Screenshot
ALTER TABLE "Screenshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Screenshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Screenshot" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());
