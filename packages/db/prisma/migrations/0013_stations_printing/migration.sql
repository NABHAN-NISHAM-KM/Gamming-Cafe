-- ─────────────────────────────────────────────────────────────────────────────
-- 0013_stations_printing (Phase 9)
-- Agentless stations (consoles, VR, simulators, TV station displays), the
-- smart-plug bridge, per-player console pricing, and internet-café printing.
-- ─────────────────────────────────────────────────────────────────────────────


ALTER TYPE "DeviceCommandType" ADD VALUE 'POWER';
ALTER TYPE "DeviceCommandType" ADD VALUE 'PRINT_RELEASE';
ALTER TYPE "DeviceCommandType" ADD VALUE 'PRINT_CANCEL';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "agentless" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "displayPairCodeHash" TEXT,
ADD COLUMN     "displayPairExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "displayTokenHash" TEXT,
ADD COLUMN     "isBridge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minAge" INTEGER,
ADD COLUMN     "powerPlug" JSONB;

-- AlterTable
ALTER TABLE "GamingSession" ADD COLUMN     "players" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PricingPlan" ADD COLUMN     "extraPlayerRate" DECIMAL(19,4),
ADD COLUMN     "includedPlayers" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN     "expiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "jobKey" TEXT NOT NULL,
ADD COLUMN     "payWith" TEXT,
ADD COLUMN     "printerName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Device_displayTokenHash_key" ON "Device"("displayTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Device_displayPairCodeHash_key" ON "Device"("displayPairCodeHash");

-- CreateIndex
CREATE INDEX "PrintJob_status_expiresAt_idx" ON "PrintJob"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_deviceId_jobKey_key" ON "PrintJob"("deviceId", "jobKey");


-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "Device"
  ADD CONSTRAINT device_min_age_range CHECK ("minAge" IS NULL OR "minAge" BETWEEN 3 AND 21),
  ADD CONSTRAINT device_controllers_range CHECK ("controllerCount" IS NULL OR "controllerCount" BETWEEN 0 AND 16);
ALTER TABLE "PricingPlan"
  ADD CONSTRAINT pricing_players_range CHECK ("includedPlayers" BETWEEN 1 AND 16),
  ADD CONSTRAINT pricing_extra_player_nonneg CHECK ("extraPlayerRate" IS NULL OR "extraPlayerRate" >= 0);
ALTER TABLE "GamingSession"
  ADD CONSTRAINT session_players_range CHECK ("players" BETWEEN 1 AND 16);
ALTER TABLE "PrintJob"
  ADD CONSTRAINT print_job_pages_range CHECK ("pages" BETWEEN 1 AND 2000 AND "copies" BETWEEN 1 AND 100),
  ADD CONSTRAINT print_job_money_nonneg CHECK ("unitPrice" >= 0 AND "total" >= 0),
  ADD CONSTRAINT print_job_pay_with CHECK ("payWith" IS NULL OR "payWith" IN ('BILL', 'WALLET'));

-- ── Station displays (TVs) authenticate with a token, not a user ────────────
-- These definer functions only map a secret's hash to its organization and
-- device; everything else then runs in that tenant's transaction (RLS applies).
CREATE OR REPLACE FUNCTION app.display_by_token(p_hash text)
  RETURNS TABLE (organization_id uuid, device_id uuid, branch_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT d."organizationId", d."id", d."branchId"
      FROM "Device" d
     WHERE d."displayTokenHash" = p_hash AND d."kind" = 'SMART_TV' AND d."isEnabled"
  $fn$;

CREATE OR REPLACE FUNCTION app.display_by_pair_code(p_hash text)
  RETURNS TABLE (organization_id uuid, device_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT d."organizationId", d."id"
      FROM "Device" d
     WHERE d."displayPairCodeHash" = p_hash AND d."displayPairExpiresAt" > now() AND d."kind" = 'SMART_TV' AND d."isEnabled"
  $fn$;

-- Print jobs nobody confirmed or released in time (swept across tenants).
CREATE OR REPLACE FUNCTION app.print_jobs_expired()
  RETURNS TABLE (organization_id uuid, job_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT j."organizationId", j."id"
      FROM "PrintJob" j
     WHERE j."status" IN ('QUEUED', 'HELD') AND j."expiresAt" IS NOT NULL AND j."expiresAt" < now()
     ORDER BY j."expiresAt"
     LIMIT 500
  $fn$;

REVOKE ALL ON FUNCTION app.display_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.display_by_pair_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.print_jobs_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.display_by_token(text) TO arena_app;
GRANT EXECUTE ON FUNCTION app.display_by_pair_code(text) TO arena_app;
GRANT EXECUTE ON FUNCTION app.print_jobs_expired() TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "Device", "PrintJob" TO arena_definer;
    ALTER FUNCTION app.display_by_token(text) OWNER TO arena_definer;
    ALTER FUNCTION app.display_by_pair_code(text) OWNER TO arena_definer;
    ALTER FUNCTION app.print_jobs_expired() OWNER TO arena_definer;
  END IF;
END $$;
