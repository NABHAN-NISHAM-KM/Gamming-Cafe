-- ─────────────────────────────────────────────────────────────────────────────
-- 0014_loyalty_promotions_tournaments (Phase 10)
-- Tournament bracket wiring (winner/loser slots, byes), Swiss rounds, prizes
-- to wallet; database guards for points, promotions, promo codes, rewards and
-- tournaments; a unique referral code per customer; and a list of live
-- organizations for the daily sweeps (birthdays, points expiry, segments,
-- scheduled campaigns). LoyaltyTransaction is already append-only (0003).
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "byeA" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "byeB" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loserNextSlot" CHAR(1),
ADD COLUMN     "nextSlot" CHAR(1);

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "prizesToWallet" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "swissRounds" INTEGER;


ALTER TABLE "Match"
  ADD CONSTRAINT match_slots CHECK (("nextSlot" IS NULL OR "nextSlot" IN ('A', 'B')) AND ("loserNextSlot" IS NULL OR "loserNextSlot" IN ('A', 'B'))),
  ADD CONSTRAINT match_scores_nonneg CHECK (("scoreA" IS NULL OR "scoreA" >= 0) AND ("scoreB" IS NULL OR "scoreB" >= 0)),
  ADD CONSTRAINT match_best_of CHECK ("bestOf" BETWEEN 1 AND 9);

ALTER TABLE "Tournament"
  ADD CONSTRAINT tournament_team_counts CHECK ("minTeams" >= 2 AND "maxTeams" >= "minTeams" AND "maxTeams" <= 256),
  ADD CONSTRAINT tournament_team_size CHECK ("teamSize" BETWEEN 1 AND 10),
  ADD CONSTRAINT tournament_money_nonneg CHECK ("entryFee" >= 0 AND "prizePool" >= 0),
  ADD CONSTRAINT tournament_swiss_rounds CHECK ("swissRounds" IS NULL OR "swissRounds" BETWEEN 1 AND 20);

-- Points can't go negative, even under concurrency.
ALTER TABLE "Customer" ADD CONSTRAINT customer_points_nonneg CHECK ("loyaltyPoints" >= 0);
CREATE UNIQUE INDEX customer_referral_code ON "Customer" ("organizationId", "referralCode") WHERE "referralCode" IS NOT NULL;

ALTER TABLE "LoyaltyRule"
  ADD CONSTRAINT loyalty_rule_points_nonneg CHECK ("pointsPerUnit" >= 0),
  ADD CONSTRAINT loyalty_rule_unit CHECK ("unit" IN ('CURRENCY', 'MINUTE', 'EVENT'));
ALTER TABLE "LoyaltyReward"
  ADD CONSTRAINT loyalty_reward_cost_positive CHECK ("costPoints" > 0),
  ADD CONSTRAINT loyalty_reward_stock_nonneg CHECK ("stock" IS NULL OR "stock" >= 0);

-- A promotion never goes past its usage limit or budget; a code never past its uses.
ALTER TABLE "Promotion"
  ADD CONSTRAINT promotion_usage CHECK ("usageCount" >= 0 AND ("totalUsageLimit" IS NULL OR "usageCount" <= "totalUsageLimit")),
  ADD CONSTRAINT promotion_budget CHECK ("budgetUsed" >= 0 AND ("budgetAmount" IS NULL OR "budgetUsed" <= "budgetAmount")),
  ADD CONSTRAINT promotion_limits_positive CHECK (("totalUsageLimit" IS NULL OR "totalUsageLimit" > 0) AND ("perCustomerLimit" IS NULL OR "perCustomerLimit" > 0));
ALTER TABLE "PromoCode"
  ADD CONSTRAINT promo_code_uses CHECK ("uses" >= 0 AND ("maxUses" IS NULL OR "uses" <= "maxUses")),
  ADD CONSTRAINT promo_code_upper CHECK ("code" = upper("code"));
ALTER TABLE "PromotionRedemption"
  ADD CONSTRAINT redemption_amounts_nonneg CHECK ("discountAmount" >= 0 AND "bonusMinutes" >= 0);

CREATE INDEX IF NOT EXISTS "Notification_customer_channel_status_idx" ON "Notification" ("organizationId", "customerId", "channel", "status");

-- Organizations the daily sweeps run for (the work itself runs in each tenant's transaction).
CREATE OR REPLACE FUNCTION app.live_organizations()
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT o."id" FROM "Organization" o WHERE o."status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE') ORDER BY o."id"
  $fn$;
REVOKE ALL ON FUNCTION app.live_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.live_organizations() TO arena_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    ALTER FUNCTION app.live_organizations() OWNER TO arena_definer;
  END IF;
END $$;
