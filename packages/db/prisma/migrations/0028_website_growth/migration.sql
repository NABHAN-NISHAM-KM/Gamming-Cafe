-- ─────────────────────────────────────────────────────────────────────────────
-- 0028_website_growth
-- Venue referrals, partner applications, privacy-friendly website stats, and
-- the public venue finder.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterEnum
ALTER TYPE "LeadKind" ADD VALUE 'PARTNER';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "referralRewardedAt" TIMESTAMPTZ(3),
ADD COLUMN     "referrerOrgId" UUID;

-- CreateTable
CREATE TABLE "SiteStat" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT NOT NULL DEFAULT '',
    "event" TEXT NOT NULL DEFAULT 'view',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SiteStat_pkey" PRIMARY KEY ("day","path","referrer","event")
);

CREATE INDEX "Lead_referrerOrgId_idx" ON "Lead"("referrerOrgId");

-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "SiteStat"
  ADD CONSTRAINT site_stat_text CHECK (length("path") BETWEEN 1 AND 200 AND length("referrer") <= 100 AND length("event") BETWEEN 1 AND 40),
  ADD CONSTRAINT site_stat_count CHECK ("count" >= 0);

-- Website stats belong to the platform service only.
REVOKE ALL ON "SiteStat" FROM arena_app;

-- ── Venue finder: every venue that published its page, with its open branches ─
-- Only what the venue already shows on its public page (name, branding, address,
-- the kinds of stations it has). Nothing about customers.
CREATE OR REPLACE FUNCTION app.public_venues()
  RETURNS TABLE (slug text, name text, logo_url text, color text, branch_id uuid, branch_name text, address text, city text, country_code text, latitude numeric, longitude numeric, zone_types text[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT o."slug", o."displayName",
           (SELECT br."logoUrl" FROM "Brand" br WHERE br."organizationId" = o."id" ORDER BY br."createdAt" LIMIT 1),
           (SELECT br."primaryColor" FROM "Brand" br WHERE br."organizationId" = o."id" ORDER BY br."createdAt" LIMIT 1),
           b."id", b."name", b."addressLine1", b."city", b."countryCode", b."latitude", b."longitude",
           ARRAY(SELECT DISTINCT z."type"::text FROM "Zone" z WHERE z."branchId" = b."id" AND z."isActive")
      FROM "Organization" o
      JOIN "Branch" b ON b."organizationId" = o."id" AND b."status" = 'OPEN'
     WHERE o."status" = 'ACTIVE' AND (o."settings"->>'publicPage') = 'true'
     ORDER BY o."displayName", b."name"
     LIMIT 2000
  $fn$;

-- ── Referrals: how the venue's referral link is doing (its own leads only) ──
CREATE OR REPLACE FUNCTION app.my_referrals()
  RETURNS TABLE (signed_up bigint, paying bigint, rewarded bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT COUNT(*) FILTER (WHERE l."kind" = 'TRIAL'),
           COUNT(*) FILTER (WHERE l."kind" = 'TRIAL' AND EXISTS (SELECT 1 FROM "SubscriptionInvoice" i WHERE i."organizationId" = l."trialOrgId" AND i."status" = 'PAID')),
           COUNT(*) FILTER (WHERE l."referralRewardedAt" IS NOT NULL)
      FROM "Lead" l
     WHERE l."referrerOrgId" = app.current_org_id()
  $fn$;

REVOKE ALL ON FUNCTION app.public_venues() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.my_referrals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_venues() TO arena_app;
GRANT EXECUTE ON FUNCTION app.my_referrals() TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "Organization", "Branch", "Zone", "Brand", "Lead", "SubscriptionInvoice" TO arena_definer;
    ALTER FUNCTION app.public_venues() OWNER TO arena_definer;
    ALTER FUNCTION app.my_referrals() OWNER TO arena_definer;
  END IF;
END $$;
