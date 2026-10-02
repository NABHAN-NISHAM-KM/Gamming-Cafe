-- ─────────────────────────────────────────────────────────────────────────────
-- 0023_customer_app
-- Leaderboard opt-in, and a one-time password reset code staff can give a
-- customer (there's no SMS/e-mail provider yet to send one).
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "showOnLeaderboard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "resetCodeHash" TEXT,
ADD COLUMN "resetCodeExpiresAt" TIMESTAMPTZ(3);

-- One web-push endpoint belongs to one browser: re-subscribing replaces the owner.
CREATE INDEX "PushSubscription_customerId_idx" ON "PushSubscription"("customerId");
