-- Production database roles. Run ONCE, as the cluster's superuser, before the first migration.
-- Passwords are never stored here: pass them from your secret manager.
--
--   psql "postgresql://postgres@DB_HOST/postgres" -v ON_ERROR_STOP=1 \
--     -v owner_pw="$OWNER_PW" -v api_pw="$API_PW" -v reporting_pw="$REPORTING_PW" -v platform_pw="$PLATFORM_PW" \
--     -f infra/postgres/production-roles.sql
--
-- Unlike the dev bootstrap (001_roles.sql), the migration role arena_owner is NOT a superuser,
-- so it cannot bypass Row-Level Security (every tenant table is FORCE ROW LEVEL SECURITY).
-- Creating the BYPASSRLS roles needs a real superuser; on managed Postgres where that is not
-- available, check that your provider allows BYPASSRLS before choosing it.

CREATE ROLE arena_app NOLOGIN NOBYPASSRLS;
CREATE ROLE arena_readonly NOLOGIN NOBYPASSRLS;
CREATE ROLE arena_platform NOLOGIN;
-- Owns the few SECURITY DEFINER lookup functions (login → memberships, device → org).
CREATE ROLE arena_definer NOLOGIN BYPASSRLS;

-- Migrations only. Member of arena_definer so migrations can hand those functions over
-- (membership does not pass on BYPASSRLS: that attribute is never inherited).
CREATE ROLE arena_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS IN ROLE arena_definer;

CREATE ROLE arena_api LOGIN PASSWORD :'api_pw' NOBYPASSRLS IN ROLE arena_app;
CREATE ROLE arena_reporting LOGIN PASSWORD :'reporting_pw' NOBYPASSRLS IN ROLE arena_readonly;
-- Super Admin service only (BYPASSRLS is set on the login role itself; it is not inheritable).
CREATE ROLE arena_platform_svc LOGIN PASSWORD :'platform_pw' BYPASSRLS IN ROLE arena_platform;

CREATE DATABASE arena OWNER arena_owner;
\connect arena
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO arena_owner;
-- Migration 0002 creates this schema if missing; made here so the new owner of the definer
-- functions has CREATE on it (ALTER FUNCTION … OWNER TO needs it when not a superuser).
CREATE SCHEMA app AUTHORIZATION arena_owner;
GRANT USAGE, CREATE ON SCHEMA app TO arena_definer;
