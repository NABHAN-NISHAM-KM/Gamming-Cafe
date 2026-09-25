-- ─────────────────────────────────────────────────────────────────────────────
-- 0009_session_timers
-- The server-authoritative session clock runs for ALL tenants in the
-- background (no user is logged in). This definer function returns only what
-- the timer needs — ids and expiry — for live sessions expiring within the
-- horizon. Each session is then processed inside its own tenant transaction.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.session_timers(p_horizon interval)
  RETURNS TABLE (organization_id uuid, session_id uuid, device_id uuid, expires_at timestamptz, status "SessionStatus", warnings_sent int[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT s."organizationId", s."id", s."deviceId", s."expiresAt", s."status", s."warningsSent"
      FROM "GamingSession" s
     WHERE s."status" IN ('ACTIVE', 'ENDING')
       AND s."expiresAt" IS NOT NULL
       AND s."expiresAt" <= now() + p_horizon
     ORDER BY s."expiresAt"
     LIMIT 500
  $fn$;

REVOKE ALL ON FUNCTION app.session_timers(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.session_timers(interval) TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "GamingSession" TO arena_definer;
    ALTER FUNCTION app.session_timers(interval) OWNER TO arena_definer;
  END IF;
END
$$;
