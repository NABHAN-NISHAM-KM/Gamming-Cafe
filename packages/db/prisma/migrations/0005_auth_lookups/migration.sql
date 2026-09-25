-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_auth_lookups
-- Login must discover a user's organizations BEFORE a tenant is bound, which
-- RLS (correctly) forbids. Instead of loosening any policy, expose two
-- SECURITY DEFINER functions that return only the minimum needed.
--
-- They run as `arena_definer` (NOLOGIN BYPASSRLS, created by infra) when that
-- role exists; in local dev the owner is a superuser, which also bypasses RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.memberships_for_user(p_user uuid)
  RETURNS TABLE (
    organization_id uuid,
    slug text,
    display_name text,
    org_status "OrganizationStatus",
    employee_id uuid,
    employee_status "EmployeeStatus"
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT o."id", o."slug", o."displayName", o."status", e."id", e."status"
      FROM "Employee" e
      JOIN "Organization" o ON o."id" = e."organizationId"
     WHERE e."userId" = p_user
     ORDER BY o."displayName"
  $fn$;

-- Used by customer login / kiosk / QR flows where the venue is known by slug.
CREATE OR REPLACE FUNCTION app.org_by_slug(p_slug text)
  RETURNS TABLE (organization_id uuid, org_status "OrganizationStatus")
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT o."id", o."status" FROM "Organization" o WHERE o."slug" = p_slug
  $fn$;

REVOKE ALL ON FUNCTION app.memberships_for_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.org_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.memberships_for_user(uuid) TO arena_app;
GRANT EXECUTE ON FUNCTION app.org_by_slug(text) TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT USAGE ON SCHEMA public, app TO arena_definer;
    GRANT SELECT ON "Organization", "Employee" TO arena_definer;
    ALTER FUNCTION app.memberships_for_user(uuid) OWNER TO arena_definer;
    ALTER FUNCTION app.org_by_slug(text) OWNER TO arena_definer;
  END IF;
END
$$;
