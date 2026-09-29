-- ─────────────────────────────────────────────────────────────────────────────
-- 0017_detected_titles
-- Everything a PC's scan found (Steam/Epic games and registry-installed apps),
-- catalog or not, so staff can see it and add it to the catalog or the Shell.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "DetectedTitle" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "publisher" TEXT,
    "installPath" TEXT,
    "executablePath" TEXT,
    "sizeBytes" BIGINT,
    "updateRequired" BOOLEAN NOT NULL DEFAULT false,
    "updating" BOOLEAN NOT NULL DEFAULT false,
    "progressPct" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DetectedTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DetectedTitle_deviceId_source_key_key" ON "DetectedTitle"("deviceId", "source", "key");

-- CreateIndex
CREATE INDEX "DetectedTitle_organizationId_kind_source_key_idx" ON "DetectedTitle"("organizationId", "kind", "source", "key");

-- AddForeignKey
ALTER TABLE "DetectedTitle" ADD CONSTRAINT "DetectedTitle_deviceId_organizationId_fkey" FOREIGN KEY ("deviceId", "organizationId") REFERENCES "Device"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "DetectedTitle"
  ADD CONSTRAINT detected_title_kind CHECK ("kind" IN ('GAME', 'APP')),
  ADD CONSTRAINT detected_title_source CHECK ("source" IN ('STEAM', 'EPIC', 'REGISTRY')),
  ADD CONSTRAINT detected_title_progress_range CHECK ("progressPct" IS NULL OR "progressPct" BETWEEN 0 AND 100);

-- DetectedTitle
ALTER TABLE "DetectedTitle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DetectedTitle" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DetectedTitle" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

