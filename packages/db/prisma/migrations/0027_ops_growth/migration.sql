-- ─────────────────────────────────────────────────────────────────────────────
-- 0027_ops_growth
-- Waitlist, staff rota, season passes, "find a team", card top-ups, spending
-- limits and guardians, "running late" on bookings, game news on the PC,
-- release rollout, read-only support sign-in, lead follow-up and platform
-- announcements.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'SEATED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LfgStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AnnouncementSeverity" AS ENUM ('INFO', 'WARNING');

-- AlterEnum
ALTER TYPE "LeadKind" ADD VALUE 'UPGRADE';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "runningLateUntil" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ClientRelease" ADD COLUMN     "pausedAt" TIMESTAMPTZ(3),
ADD COLUMN     "rolloutPercent" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "guardianCodeExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "guardianCodeHash" TEXT,
ADD COLUMN     "guardianId" UUID,
ADD COLUMN     "spendCapByGuardian" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weeklySpendCap" DECIMAL(19,4);

-- AlterTable
ALTER TABLE "ImpersonationSession" ADD COLUMN     "canWrite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "nextActionAt" TIMESTAMPTZ(3),
ADD COLUMN     "staffNotes" TEXT;

-- AlterTable
ALTER TABLE "OrgGameSetting" ADD COLUMN     "news" TEXT,
ADD COLUMN     "newsAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "SubscriptionInvoice" ADD COLUMN     "providerRef" TEXT;

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "zoneId" UUID,
    "customerId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "offeredDeviceId" UUID,
    "notifiedAt" TIMESTAMPTZ(3),
    "claimUntil" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPlan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "price" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPass" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "claimedTiers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LfgPost" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "game" TEXT NOT NULL,
    "playersNeeded" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "status" "LfgStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LfgPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LfgMember" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LfgMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTopUp" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "TopUpStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WalletTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "announcementId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAnnouncement" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "AnnouncementSeverity" NOT NULL DEFAULT 'INFO',
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitlistEntry_organizationId_branchId_status_createdAt_idx" ON "WaitlistEntry"("organizationId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_organizationId_customerId_idx" ON "WaitlistEntry"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "ShiftPlan_organizationId_branchId_startsAt_idx" ON "ShiftPlan"("organizationId", "branchId", "startsAt");

-- CreateIndex
CREATE INDEX "ShiftPlan_organizationId_employeeId_startsAt_idx" ON "ShiftPlan"("organizationId", "employeeId", "startsAt");

-- CreateIndex
CREATE INDEX "Season_organizationId_startsAt_idx" ON "Season"("organizationId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Season_id_organizationId_key" ON "Season"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SeasonPass_organizationId_customerId_idx" ON "SeasonPass"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonPass_seasonId_customerId_key" ON "SeasonPass"("seasonId", "customerId");

-- CreateIndex
CREATE INDEX "LfgPost_organizationId_branchId_status_startsAt_idx" ON "LfgPost"("organizationId", "branchId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LfgPost_id_organizationId_key" ON "LfgPost"("id", "organizationId");

-- CreateIndex
CREATE INDEX "LfgMember_organizationId_customerId_idx" ON "LfgMember"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "LfgMember_postId_customerId_key" ON "LfgMember"("postId", "customerId");

-- CreateIndex
CREATE INDEX "WalletTopUp_organizationId_customerId_createdAt_idx" ON "WalletTopUp"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTopUp_providerRef_key" ON "WalletTopUp"("providerRef");

-- CreateIndex
CREATE INDEX "AnnouncementRead_organizationId_announcementId_idx" ON "AnnouncementRead"("organizationId", "announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_employeeId_key" ON "AnnouncementRead"("announcementId", "employeeId");

-- CreateIndex
CREATE INDEX "PlatformAnnouncement_startsAt_idx" ON "PlatformAnnouncement"("startsAt");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_guardianId_organizationId_fkey" FOREIGN KEY ("guardianId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPlan" ADD CONSTRAINT "ShiftPlan_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPlan" ADD CONSTRAINT "ShiftPlan_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPass" ADD CONSTRAINT "SeasonPass_seasonId_organizationId_fkey" FOREIGN KEY ("seasonId", "organizationId") REFERENCES "Season"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPass" ADD CONSTRAINT "SeasonPass_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LfgPost" ADD CONSTRAINT "LfgPost_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LfgPost" ADD CONSTRAINT "LfgPost_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LfgMember" ADD CONSTRAINT "LfgMember_postId_organizationId_fkey" FOREIGN KEY ("postId", "organizationId") REFERENCES "LfgPost"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LfgMember" ADD CONSTRAINT "LfgMember_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTopUp" ADD CONSTRAINT "WalletTopUp_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "WaitlistEntry"
  ADD CONSTRAINT waitlist_party CHECK ("partySize" BETWEEN 1 AND 20),
  ADD CONSTRAINT waitlist_text CHECK (length("name") BETWEEN 1 AND 80 AND coalesce(length("phone"), 0) <= 30),
  ADD CONSTRAINT waitlist_source CHECK ("source" IN ('STAFF', 'APP'));
-- One place in the queue per app customer per branch.
CREATE UNIQUE INDEX waitlist_one_active_per_customer ON "WaitlistEntry"("branchId", "customerId")
  WHERE "customerId" IS NOT NULL AND "status" IN ('WAITING', 'NOTIFIED');

ALTER TABLE "ShiftPlan"
  ADD CONSTRAINT shift_plan_order CHECK ("endsAt" > "startsAt" AND "endsAt" - "startsAt" <= interval '16 hours'),
  ADD CONSTRAINT shift_plan_no_overlap EXCLUDE USING gist ("employeeId" WITH =, tstzrange("startsAt", "endsAt") WITH &&);

ALTER TABLE "Season"
  ADD CONSTRAINT season_order CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT season_price CHECK ("price" >= 0),
  ADD CONSTRAINT season_tiers CHECK (jsonb_typeof("tiers") = 'array' AND jsonb_array_length("tiers") <= 50);

ALTER TABLE "LfgPost"
  ADD CONSTRAINT lfg_players CHECK ("playersNeeded" BETWEEN 1 AND 20),
  ADD CONSTRAINT lfg_text CHECK (length("game") BETWEEN 1 AND 60 AND coalesce(length("note"), 0) <= 300);

ALTER TABLE "WalletTopUp" ADD CONSTRAINT topup_amount CHECK ("amount" > 0);

ALTER TABLE "Customer"
  ADD CONSTRAINT customer_spend_cap CHECK ("weeklySpendCap" IS NULL OR "weeklySpendCap" >= 0),
  ADD CONSTRAINT customer_not_own_guardian CHECK ("guardianId" IS NULL OR "guardianId" <> "id");

ALTER TABLE "ClientRelease" ADD CONSTRAINT release_rollout CHECK ("rolloutPercent" BETWEEN 0 AND 100);
ALTER TABLE "OrgGameSetting" ADD CONSTRAINT org_game_news CHECK (coalesce(length("news"), 0) <= 140);
ALTER TABLE "Lead" ADD CONSTRAINT lead_staff_notes CHECK (coalesce(length("staffNotes"), 0) <= 4000);
ALTER TABLE "PlatformAnnouncement"
  ADD CONSTRAINT announcement_text CHECK (length("title") BETWEEN 1 AND 120 AND length("body") BETWEEN 1 AND 2000),
  ADD CONSTRAINT announcement_order CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

-- Announcements are platform-wide: staff read them through the tenant API, only the platform writes them.
REVOKE ALL ON "PlatformAnnouncement" FROM arena_app;
GRANT SELECT ON "PlatformAnnouncement" TO arena_app;

-- "Running late" holds a booking past the usual no-show grace.
CREATE OR REPLACE FUNCTION app.bookings_due(p_no_show_grace_min int)
  RETURNS TABLE (organization_id uuid, booking_id uuid, next_status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT b."organizationId", b."id",
           CASE
             WHEN b."status" = 'CONFIRMED' THEN 'NO_SHOW'
             WHEN b."status" = 'CHECKED_IN' THEN 'COMPLETED'
             ELSE 'CANCELLED'
           END
      FROM "Booking" b
     WHERE (b."status" = 'CONFIRMED' AND GREATEST(b."startsAt" + make_interval(mins => p_no_show_grace_min), coalesce(b."runningLateUntil", '-infinity')) < now())
        OR (b."status" = 'CHECKED_IN' AND b."endsAt" < now())
        OR (b."status" = 'PENDING' AND b."holdExpiresAt" IS NOT NULL AND b."holdExpiresAt" < now())
     ORDER BY b."startsAt"
     LIMIT 500
  $fn$;

-- ── Row-level security ──────────────────────────────────────────────────────
-- WaitlistEntry
ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WaitlistEntry" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- ShiftPlan
ALTER TABLE "ShiftPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShiftPlan" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- Season
ALTER TABLE "Season" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Season" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Season" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- SeasonPass
ALTER TABLE "SeasonPass" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeasonPass" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SeasonPass" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- LfgPost
ALTER TABLE "LfgPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LfgPost" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LfgPost" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- LfgMember
ALTER TABLE "LfgMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LfgMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LfgMember" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- WalletTopUp
ALTER TABLE "WalletTopUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalletTopUp" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WalletTopUp" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- AnnouncementRead
ALTER TABLE "AnnouncementRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnouncementRead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnnouncementRead" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- ── Cross-tenant helpers (SECURITY DEFINER, narrow) ─────────────────────────
-- Organizations with someone waiting or an offer to expire: the waitlist worker visits only these.
CREATE OR REPLACE FUNCTION app.waitlist_orgs()
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT DISTINCT w."organizationId" FROM "WaitlistEntry" w WHERE w."status" IN ('WAITING', 'NOTIFIED') LIMIT 1000
  $fn$;

-- A venue near its plan limits asks for a bigger plan: a lead for the platform's sales team.
-- Only ever for the venue the caller is signed in to (app.current_org_id()).
CREATE OR REPLACE FUNCTION app.request_upgrade(p_name text, p_email text, p_plan text, p_note text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
  DECLARE
    v_org uuid := app.current_org_id();
    v_id uuid;
  BEGIN
    IF v_org IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
    INSERT INTO "Lead" ("id", "kind", "name", "email", "venue", "country", "plan", "notes", "trialOrgId", "source", "updatedAt")
    SELECT gen_random_uuid(), 'UPGRADE', left(p_name, 120), left(p_email, 254), o."displayName", o."countryCode", left(p_plan, 20), left(p_note, 2000), o."id", 'admin', now()
      FROM "Organization" o WHERE o."id" = v_org
    RETURNING "id" INTO v_id;
    RETURN v_id;
  END
  $fn$;

REVOKE ALL ON FUNCTION app.waitlist_orgs() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.request_upgrade(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.waitlist_orgs() TO arena_app;
GRANT EXECUTE ON FUNCTION app.request_upgrade(text, text, text, text) TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "WaitlistEntry" TO arena_definer;
    GRANT SELECT ON "Organization" TO arena_definer;
    GRANT SELECT, INSERT ON "Lead" TO arena_definer; -- RETURNING reads the new row
    ALTER FUNCTION app.waitlist_orgs() OWNER TO arena_definer;
    ALTER FUNCTION app.request_upgrade(text, text, text, text) OWNER TO arena_definer;
  END IF;
END $$;

-- ── Paying for ArenaOS from the venue's own admin ───────────────────────────
-- The tenant API only reads subscriptions and invoices. These two functions are
-- the narrow way an owner opens a plan invoice or ties an invoice to a card
-- checkout — always for their own organization. The platform marks invoices paid.
CREATE OR REPLACE FUNCTION app.billing_open_invoice(p_plan uuid)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
  DECLARE
    v_org uuid := app.current_org_id();
    v_sub record;
    v_plan record;
    v_id uuid;
    v_start timestamptz;
  BEGIN
    IF v_org IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;
    SELECT * INTO v_plan FROM "SubscriptionPlan" WHERE "id" = p_plan AND "isActive";
    IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;
    SELECT * INTO v_sub FROM "Subscription" WHERE "organizationId" = v_org ORDER BY "createdAt" DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no_subscription'; END IF;
    -- One open invoice at a time: a fresh choice replaces an unpaid one.
    UPDATE "SubscriptionInvoice" SET "status" = 'VOID', "updatedAt" = now()
     WHERE "organizationId" = v_org AND "status" = 'OPEN';
    v_start := GREATEST(now(), v_sub."currentPeriodEnd");
    IF v_sub."status" IN ('TRIALING', 'PAST_DUE', 'EXPIRED', 'CANCELLED') OR v_sub."planId" <> p_plan THEN v_start := now(); END IF;
    INSERT INTO "SubscriptionInvoice" ("id", "organizationId", "subscriptionId", "number", "amount", "currency", "status", "periodStart", "periodEnd", "dueAt", "updatedAt")
    VALUES (gen_random_uuid(), v_org, v_sub."id", 'INV-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(md5(random()::text), 1, 6)),
            v_plan."price", v_plan."currency", 'OPEN', v_start,
            v_start + CASE WHEN v_plan."interval" = 'YEARLY' THEN interval '1 year' ELSE interval '1 month' END, now() + interval '7 days', now())
    RETURNING "id" INTO v_id;
    RETURN v_id;
  END
  $fn$;

CREATE OR REPLACE FUNCTION app.billing_checkout_ref(p_invoice uuid, p_ref text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    UPDATE "SubscriptionInvoice" SET "providerRef" = left(p_ref, 255), "attempts" = "attempts" + 1, "updatedAt" = now()
     WHERE "id" = p_invoice AND "organizationId" = app.current_org_id() AND "status" = 'OPEN'
  $fn$;

REVOKE ALL ON FUNCTION app.billing_open_invoice(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.billing_checkout_ref(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.billing_open_invoice(uuid) TO arena_app;
GRANT EXECUTE ON FUNCTION app.billing_checkout_ref(uuid, text) TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "SubscriptionPlan", "Subscription" TO arena_definer;
    GRANT SELECT, INSERT, UPDATE ON "SubscriptionInvoice" TO arena_definer;
    ALTER FUNCTION app.billing_open_invoice(uuid) OWNER TO arena_definer;
    ALTER FUNCTION app.billing_checkout_ref(uuid, text) OWNER TO arena_definer;
  END IF;
END $$;
