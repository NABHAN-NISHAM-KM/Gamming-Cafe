-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_devices — branch command-signing keys, batch enrolment codes,
-- enrolment lookup for not-yet-authenticated agents.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "SigningKeyStatus" AS ENUM ('ACTIVE', 'RETIRING', 'REVOKED');

-- AlterTable
ALTER TABLE "DeviceEnrollmentToken" ADD COLUMN     "label" TEXT,
ADD COLUMN     "maxUses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "revokedAt" TIMESTAMPTZ(3),
ADD COLUMN     "uses" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BranchSigningKey" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "kid" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ES256',
    "publicKeyPem" TEXT NOT NULL,
    "privateKeySealed" TEXT NOT NULL,
    "status" "SigningKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "BranchSigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchSigningKey_kid_key" ON "BranchSigningKey"("kid");

-- CreateIndex
CREATE INDEX "BranchSigningKey_organizationId_branchId_status_idx" ON "BranchSigningKey"("organizationId", "branchId", "status");

-- AddForeignKey
ALTER TABLE "BranchSigningKey" ADD CONSTRAINT "BranchSigningKey_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS for the new tenant table (generated: node scripts/gen-rls.mjs BranchSigningKey)
-- BranchSigningKey
ALTER TABLE "BranchSigningKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BranchSigningKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BranchSigningKey" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

ALTER TABLE "DeviceEnrollmentToken"
  ADD CONSTRAINT enrollment_uses_bounded CHECK ("uses" >= 0 AND "uses" <= "maxUses" AND "maxUses" BETWEEN 1 AND 500);

-- A new agent only knows its enrolment code. Resolve it to its tenant with a
-- narrowly-scoped definer function; everything after runs under RLS.
CREATE OR REPLACE FUNCTION app.enrollment_token_org(p_token_hash text)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT t."organizationId" FROM "DeviceEnrollmentToken" t
     WHERE t."tokenHash" = p_token_hash
       AND t."revokedAt" IS NULL
       AND t."uses" < t."maxUses"
       AND t."expiresAt" > now()
  $fn$;

-- Device WebSocket auth: which org does this device belong to? (Only the id —
-- the device must still prove possession of its key under that org's RLS.)
CREATE OR REPLACE FUNCTION app.device_org(p_device uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT d."organizationId" FROM "Device" d WHERE d."id" = p_device AND d."isEnabled"
  $fn$;

REVOKE ALL ON FUNCTION app.enrollment_token_org(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.device_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enrollment_token_org(text) TO arena_app;
GRANT EXECUTE ON FUNCTION app.device_org(uuid) TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "DeviceEnrollmentToken", "Device" TO arena_definer;
    ALTER FUNCTION app.enrollment_token_org(text) OWNER TO arena_definer;
    ALTER FUNCTION app.device_org(uuid) OWNER TO arena_definer;
  END IF;
END
$$;
