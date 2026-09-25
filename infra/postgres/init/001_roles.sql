-- DEV ONLY passwords. In staging/production these roles are created by
-- infrastructure (Terraform) with secrets from the secret manager.
--
--   arena_owner     table owner; runs migrations only (POSTGRES_USER)
--   arena_api       runtime API / workers / edge sync  → member of arena_app (RLS enforced)
--   arena_reporting read replica / BI                   → member of arena_readonly (RLS enforced)
--   arena_platform_svc  Super Admin service             → BYPASSRLS (attribute is not inheritable,
--                                                         so it is set on the login role itself)

CREATE ROLE arena_app NOLOGIN NOBYPASSRLS;
CREATE ROLE arena_readonly NOLOGIN NOBYPASSRLS;
CREATE ROLE arena_platform NOLOGIN;
-- Owns the few SECURITY DEFINER lookup functions (e.g. login → memberships).
CREATE ROLE arena_definer NOLOGIN BYPASSRLS;

CREATE ROLE arena_api LOGIN PASSWORD 'arena_api_dev' NOBYPASSRLS IN ROLE arena_app;
CREATE ROLE arena_reporting LOGIN PASSWORD 'arena_reporting_dev' NOBYPASSRLS IN ROLE arena_readonly;
CREATE ROLE arena_platform_svc LOGIN PASSWORD 'arena_platform_dev' BYPASSRLS IN ROLE arena_platform;
