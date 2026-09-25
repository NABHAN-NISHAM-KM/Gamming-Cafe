-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_catalog_ref_guards
-- Shared-catalog tables (Role, Game, Launcher…) hold both platform rows
-- (organizationId NULL) and tenant-private rows, so references to them cannot
-- use composite (id, organizationId) FKs. These triggers close the gap: a row
-- may reference a catalog entry only if that entry is platform-wide or owned
-- by the same organization.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.enforce_catalog_ref() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
DECLARE
  col   text := TG_ARGV[0];
  tbl   text := TG_ARGV[1];
  ref   uuid;
  owner uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I', col) USING NEW INTO ref;
  IF ref IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT "organizationId" FROM %I WHERE "id" = $1', tbl) USING ref INTO owner;
  IF owner IS NOT NULL AND owner IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION '%.% references a % owned by another organization', TG_TABLE_NAME, col, tbl
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('EmployeeRoleAssignment', 'roleId',     'Role'),
      ('Game',                   'launcherId', 'Launcher'),
      ('OrgGameSetting',         'gameId',     'Game'),
      ('GameInstallation',       'gameId',     'Game'),
      ('GameUpdateJob',          'gameId',     'Game'),
      ('GameLicense',            'gameId',     'Game'),
      ('GameLicense',            'launcherId', 'Launcher'),
      ('Tournament',             'gameId',     'Game'),
      ('CustomerFavoriteGame',   'gameId',     'Game')
    ) AS t(tbl, col, target)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION app.enforce_catalog_ref(%L, %L)',
      'catalog_ref_' || r.col, r.col, r.tbl, r.col, r.target);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "Role", "Game", "Launcher" TO arena_definer;
    ALTER FUNCTION app.enforce_catalog_ref() OWNER TO arena_definer;
  END IF;
END
$$;
