-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_games_and_station_tools (Phase 5)
-- Game scanning/updating commands, detected peripherals, and the definer
-- function the update orchestrator uses to find due jobs across tenants.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE "DeviceCommandType" ADD VALUE 'SCAN_GAMES';
ALTER TYPE "DeviceCommandType" ADD VALUE 'UPDATE_GAME';

-- Peripherals the agent detects are keyed by their Windows PnP instance id.
ALTER TABLE "DeviceAccessory" ADD COLUMN "connected" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "hardwareId" TEXT,
ADD COLUMN "lastSeenAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "DeviceAccessory_deviceId_hardwareId_key" ON "DeviceAccessory"("deviceId", "hardwareId");

ALTER TABLE "GameInstallation" ADD COLUMN "detectedBy" TEXT;

ALTER TABLE "GameUpdateJob" ADD COLUMN "maxConcurrent" INTEGER NOT NULL DEFAULT 4;

-- The update orchestrator runs in the background for all tenants. This
-- returns only ids of jobs that are due; each job is then processed inside
-- its own tenant transaction (RLS applies there).
CREATE OR REPLACE FUNCTION app.update_jobs_due()
  RETURNS TABLE (organization_id uuid, job_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT j."organizationId", j."id"
      FROM "GameUpdateJob" j
     WHERE j."status" IN ('SCHEDULED', 'RUNNING')
       AND j."scheduledFor" <= now()
     ORDER BY j."scheduledFor"
     LIMIT 200
  $fn$;

REVOKE ALL ON FUNCTION app.update_jobs_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_jobs_due() TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "GameUpdateJob" TO arena_definer;
    ALTER FUNCTION app.update_jobs_due() OWNER TO arena_definer;
  END IF;
END $$;
