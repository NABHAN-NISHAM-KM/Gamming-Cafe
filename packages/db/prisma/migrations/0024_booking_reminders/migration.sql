-- ─────────────────────────────────────────────────────────────────────────────
-- 0024_booking_reminders
-- Confirmed bookings starting within 30 minutes whose customer has the app's
-- notifications on and hasn't been reminded yet. Across tenants, like
-- bookings_due(); the push itself is sent in the owning tenant.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.booking_reminders_due()
  RETURNS TABLE (organization_id uuid, booking_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT b."organizationId", b."id"
      FROM "Booking" b
     WHERE b."status" = 'CONFIRMED' AND b."customerId" IS NOT NULL
       AND b."startsAt" BETWEEN now() AND now() + interval '30 minutes'
       AND EXISTS (SELECT 1 FROM "PushSubscription" p WHERE p."customerId" = b."customerId")
       AND NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."organizationId" = b."organizationId" AND n."dedupeKey" = 'booking-reminder:' || b."id")
     ORDER BY b."startsAt"
     LIMIT 500
  $fn$;

REVOKE ALL ON FUNCTION app.booking_reminders_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.booking_reminders_due() TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "Booking", "PushSubscription", "Notification" TO arena_definer;
    ALTER FUNCTION app.booking_reminders_due() OWNER TO arena_definer;
  END IF;
END $$;
