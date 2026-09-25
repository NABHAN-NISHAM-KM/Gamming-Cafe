-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_customers_bookings (Phase 6)
-- Background sweeps that run for all tenants: bookings that became no-shows,
-- finished, or whose unpaid hold expired; memberships that ran out. Each
-- definer function returns only ids + the next state; the work itself happens
-- in the owning tenant's transaction (RLS applies there).
-- ─────────────────────────────────────────────────────────────────────────────

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
     WHERE (b."status" = 'CONFIRMED' AND b."startsAt" + make_interval(mins => p_no_show_grace_min) < now())
        OR (b."status" = 'CHECKED_IN' AND b."endsAt" < now())
        OR (b."status" = 'PENDING' AND b."holdExpiresAt" IS NOT NULL AND b."holdExpiresAt" < now())
     ORDER BY b."startsAt"
     LIMIT 500
  $fn$;

CREATE OR REPLACE FUNCTION app.memberships_due()
  RETURNS TABLE (organization_id uuid, membership_id uuid, customer_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT m."organizationId", m."id", m."customerId"
      FROM "Membership" m
     WHERE m."status" = 'ACTIVE' AND m."expiresAt" IS NOT NULL AND m."expiresAt" <= now()
     ORDER BY m."expiresAt"
     LIMIT 500
  $fn$;

REVOKE ALL ON FUNCTION app.bookings_due(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.memberships_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bookings_due(int) TO arena_app;
GRANT EXECUTE ON FUNCTION app.memberships_due() TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "Booking", "Membership" TO arena_definer;
    ALTER FUNCTION app.bookings_due(int) OWNER TO arena_definer;
    ALTER FUNCTION app.memberships_due() OWNER TO arena_definer;
  END IF;
END $$;

-- Looking up a customer's upcoming bookings and a station's next booking.
CREATE INDEX IF NOT EXISTS "Booking_status_startsAt_idx" ON "Booking" ("status", "startsAt");
