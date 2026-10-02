-- ─────────────────────────────────────────────────────────────────────────────
-- 0026_website
-- Leads from the marketing website: "Request a walkthrough", booked demo
-- calls and trial sign-ups. Platform-level, read by the Super Admin only.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('CONTACT', 'DEMO', 'TRIAL');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "kind" "LeadKind" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "venue" TEXT,
    "country" TEXT,
    "venueType" TEXT,
    "plan" TEXT,
    "branches" INTEGER,
    "stations" INTEGER,
    "notes" TEXT,
    "demoAt" TIMESTAMPTZ(3),
    "trialOrgId" UUID,
    "source" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_kind_demoAt_idx" ON "Lead"("kind", "demoAt");

-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "Lead"
  ADD CONSTRAINT lead_text_sizes CHECK (char_length("name") <= 120 AND char_length("email") <= 254 AND coalesce(char_length("notes"), 0) <= 2000),
  ADD CONSTRAINT lead_demo_has_time CHECK (("kind" = 'DEMO') = ("demoAt" IS NOT NULL)),
  -- one call per slot, unless that booking was dropped
  ADD CONSTRAINT lead_one_demo_per_slot EXCLUDE USING btree ("demoAt" WITH =) WHERE ("kind" = 'DEMO' AND "status" <> 'LOST');

-- The tenant API never reads the sales pipeline.
REVOKE ALL ON "Lead" FROM arena_app;
