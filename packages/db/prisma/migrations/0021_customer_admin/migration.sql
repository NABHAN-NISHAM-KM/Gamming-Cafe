-- ─────────────────────────────────────────────────────────────────────────────
-- 0021_customer_admin
-- Staff notes and tags on customers, and the sweep that returns a customer to
-- ACTIVE once their last timed ban or restriction runs out.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerNote_organizationId_customerId_createdAt_idx" ON "CustomerNote"("organizationId", "customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "CustomerNote"
  ADD CONSTRAINT customer_note_body CHECK (char_length("body") BETWEEN 1 AND 1000);
ALTER TABLE "Customer"
  ADD CONSTRAINT customer_tags_limit CHECK (cardinality("tags") <= 20);

-- CustomerNote
ALTER TABLE "CustomerNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerNote" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- Customers still BANNED/RESTRICTED although nothing holds them any more
-- (a timed ban ran out). Across tenants, like memberships_due().
CREATE OR REPLACE FUNCTION app.customer_status_due()
  RETURNS TABLE (organization_id uuid, customer_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT c."organizationId", c."id"
      FROM "Customer" c
     WHERE c."status" IN ('BANNED', 'RESTRICTED')
       AND EXISTS (SELECT 1 FROM "CustomerRestriction" r WHERE r."customerId" = c."id")
       AND NOT EXISTS (
             SELECT 1 FROM "CustomerRestriction" r
              WHERE r."customerId" = c."id" AND r."liftedAt" IS NULL
                AND (r."endsAt" IS NULL OR r."endsAt" > now())
                AND (c."status" = 'RESTRICTED' OR r."type" = 'BAN'))
     LIMIT 500
  $fn$;

REVOKE ALL ON FUNCTION app.customer_status_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.customer_status_due() TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "Customer", "CustomerRestriction" TO arena_definer;
    ALTER FUNCTION app.customer_status_due() OWNER TO arena_definer;
  END IF;
END $$;
