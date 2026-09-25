-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_integrity_constraints
-- Business invariants the database must guarantee even under concurrency.
-- Prisma does not model CHECK / EXCLUDE constraints or triggers; they live
-- here and are left untouched by `prisma migrate`.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Bookings: no double booking ─────────────────────────────────────────────

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_time_order CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT booking_players_positive CHECK ("players" >= 1),
  ADD CONSTRAINT booking_money_non_negative CHECK ("depositAmount" >= 0 AND "estimatedTotal" >= 0);

ALTER TABLE "BookingResource"
  ADD CONSTRAINT booking_resource_exactly_one CHECK (num_nonnulls("deviceId", "tableId") = 1),
  ADD CONSTRAINT booking_resource_time_order CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT booking_device_no_overlap EXCLUDE USING gist (
    "deviceId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("isLive" AND "deviceId" IS NOT NULL),
  ADD CONSTRAINT booking_table_no_overlap EXCLUDE USING gist (
    "tableId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("isLive" AND "tableId" IS NOT NULL);

-- BookingResource carries a denormalised copy of the booking window/status so
-- the exclusion constraint can see it. Keep it in sync from both sides.
CREATE OR REPLACE FUNCTION app.booking_is_live(s "BookingStatus") RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $fn$ SELECT s IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE') $fn$;

CREATE OR REPLACE FUNCTION app.booking_resource_fill() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  b "Booking";
BEGIN
  SELECT * INTO b FROM "Booking" WHERE "id" = NEW."bookingId";
  NEW."startsAt" := b."startsAt";
  NEW."endsAt"   := b."endsAt";
  NEW."isLive"   := app.booking_is_live(b."status");
  RETURN NEW;
END
$fn$;

CREATE TRIGGER booking_resource_fill BEFORE INSERT OR UPDATE ON "BookingResource"
  FOR EACH ROW EXECUTE FUNCTION app.booking_resource_fill();

CREATE OR REPLACE FUNCTION app.booking_propagate() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
     OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt"
     OR NEW."status" IS DISTINCT FROM OLD."status" THEN
    -- Touching the rows re-runs booking_resource_fill → exclusion re-checked.
    UPDATE "BookingResource" SET "bookingId" = "bookingId" WHERE "bookingId" = NEW."id";
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER booking_propagate AFTER UPDATE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION app.booking_propagate();

-- ── Gaming sessions ─────────────────────────────────────────────────────────

-- At most one live session per station.
ALTER TABLE "GamingSession"
  ADD CONSTRAINT session_one_live_per_device EXCLUDE USING gist ("deviceId" WITH =)
    WHERE ("status" IN ('PENDING', 'ACTIVE', 'PAUSED', 'ENDING')),
  ADD CONSTRAINT session_expiry_after_start CHECK ("expiresAt" IS NULL OR "startedAt" IS NULL OR "expiresAt" > "startedAt"),
  ADD CONSTRAINT session_money_non_negative CHECK ("amountDue" >= 0 AND "discountAmount" >= 0),
  ADD CONSTRAINT session_prepaid_has_allocation CHECK ("paymentTiming" = 'POSTPAID' OR "allocatedMinutes" IS NOT NULL);

ALTER TABLE "SessionExtension"
  ADD CONSTRAINT extension_minutes_positive CHECK ("minutes" > 0),
  ADD CONSTRAINT extension_amount_non_negative CHECK ("amount" >= 0);

-- A pooled account can only be IN_USE by exactly one live session.
ALTER TABLE "GameLicense"
  ADD CONSTRAINT license_in_use_has_session CHECK ("status" <> 'IN_USE' OR "assignedSessionId" IS NOT NULL),
  ADD CONSTRAINT license_one_per_session EXCLUDE USING gist ("assignedSessionId" WITH =, "launcherId" WITH =)
    WHERE ("status" = 'IN_USE');

-- ── Shifts: one open shift per cash drawer ──────────────────────────────────

ALTER TABLE "Shift"
  ADD CONSTRAINT shift_one_open_per_drawer EXCLUDE USING gist ("cashDrawerId" WITH =)
    WHERE ("status" IN ('OPEN', 'CLOSING')),
  ADD CONSTRAINT shift_opening_cash_non_negative CHECK ("openingCash" >= 0);

-- ── Wallet & loyalty ────────────────────────────────────────────────────────

ALTER TABLE "Wallet"
  ADD CONSTRAINT wallet_balances_non_negative CHECK (
    "cashBalance" >= 0 AND "bonusBalance" >= 0 AND "promoBalance" >= 0
    AND "refundBalance" >= 0 AND "timeBalanceMin" >= 0);

ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT wallet_tx_non_zero CHECK ("amount" <> 0),
  ADD CONSTRAINT wallet_tx_balance_non_negative CHECK ("balanceAfter" >= 0),
  ADD CONSTRAINT wallet_tx_reversal_has_target CHECK (("type" = 'REVERSAL') = ("reversesId" IS NOT NULL));

ALTER TABLE "LoyaltyTransaction"
  ADD CONSTRAINT loyalty_tx_non_zero CHECK ("points" <> 0),
  ADD CONSTRAINT loyalty_balance_non_negative CHECK ("balanceAfter" >= 0);

-- ── Payments & refunds ──────────────────────────────────────────────────────

ALTER TABLE "Payment"
  ADD CONSTRAINT payment_amount_positive CHECK ("amount" > 0),
  ADD CONSTRAINT payment_tip_non_negative CHECK ("tipAmount" >= 0),
  ADD CONSTRAINT payment_refund_bounded CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount" + "tipAmount"),
  ADD CONSTRAINT payment_target CHECK (num_nonnulls("billId", "orderId", "bookingId") >= 1);

ALTER TABLE "Refund"
  ADD CONSTRAINT refund_amount_positive CHECK ("amount" > 0);

ALTER TABLE "Order"
  ADD CONSTRAINT order_totals_non_negative CHECK (
    "subtotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "tipTotal" >= 0 AND "total" >= 0),
  ADD CONSTRAINT order_seat_has_station CHECK ("type" <> 'GAMING_SEAT' OR "deviceId" IS NOT NULL);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT order_item_qty_positive CHECK ("quantity" > 0);

ALTER TABLE "Bill"
  ADD CONSTRAINT bill_paid_bounded CHECK ("paidTotal" >= 0);

-- ── Accounting: double entry must balance ───────────────────────────────────

ALTER TABLE "JournalLine"
  ADD CONSTRAINT journal_line_one_side CHECK (
    "debit" >= 0 AND "credit" >= 0 AND (("debit" = 0) <> ("credit" = 0)));

CREATE OR REPLACE FUNCTION app.journal_balanced() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  diff numeric;
BEGIN
  SELECT COALESCE(SUM("debit"), 0) - COALESCE(SUM("credit"), 0) INTO diff
    FROM "JournalLine" WHERE "entryId" = NEW."entryId";
  IF diff <> 0 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced by %', NEW."entryId", diff
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$fn$;

-- Deferred: all lines of an entry are inserted, then checked at COMMIT.
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.journal_balanced();

-- ── RBAC scope consistency ──────────────────────────────────────────────────

ALTER TABLE "EmployeeRoleAssignment"
  ADD CONSTRAINT role_scope_shape CHECK (
       ("scope" = 'ORGANIZATION' AND "brandId" IS NULL AND "branchId" IS NULL)
    OR ("scope" = 'BRAND'        AND "brandId" IS NOT NULL AND "branchId" IS NULL)
    OR ("scope" = 'BRANCH'       AND "branchId" IS NOT NULL AND "brandId" IS NULL)),
  -- Prisma's @@unique treats NULLs as distinct; this closes that gap.
  ADD CONSTRAINT role_assignment_unique EXCLUDE USING gist (
    -- (scope is implied by which of brandId/branchId is set — see role_scope_shape)
    "employeeId" WITH =, "roleId" WITH =,
    (COALESCE("brandId",  '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE("branchId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =);

-- Platform catalog rows (organizationId NULL) must also be unique by key.
ALTER TABLE "Role" ADD CONSTRAINT role_key_unique_incl_templates EXCLUDE USING gist (
  (COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, "key" WITH =);
ALTER TABLE "Launcher" ADD CONSTRAINT launcher_key_unique_incl_catalog EXCLUDE USING gist (
  (COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, "key" WITH =);
ALTER TABLE "Game" ADD CONSTRAINT game_slug_unique_incl_catalog EXCLUDE USING gist (
  (COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, "slug" WITH =);

-- ── Misc ────────────────────────────────────────────────────────────────────

ALTER TABLE "DeviceCommand"
  ADD CONSTRAINT command_expiry_after_issue CHECK ("expiresAt" > "issuedAt");

ALTER TABLE "MaintenanceSession"
  ADD CONSTRAINT maintenance_reason_required CHECK (length(btrim("reason")) >= 3);

ALTER TABLE "ImpersonationSession"
  ADD CONSTRAINT impersonation_time_boxed CHECK ("expiresAt" > "startedAt" AND "expiresAt" <= "startedAt" + interval '8 hours'),
  ADD CONSTRAINT impersonation_reason_required CHECK (length(btrim("reason")) >= 10);

ALTER TABLE "PricingPlan"
  ADD CONSTRAINT pricing_rate_non_negative CHECK ("rate" >= 0),
  ADD CONSTRAINT pricing_rounding_positive CHECK ("roundingMinutes" >= 1);
