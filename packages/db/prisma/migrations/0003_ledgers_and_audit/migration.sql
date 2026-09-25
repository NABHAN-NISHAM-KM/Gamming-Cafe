-- ─────────────────────────────────────────────────────────────────────────────
-- 0003_ledgers_and_audit
--  * Append-only ledgers: UPDATE / DELETE / TRUNCATE are rejected by trigger
--    AND the privileges are revoked from runtime roles (defence in depth).
--    Corrections are always new rows (REVERSAL / ADJUST).
--  * Tamper-evident audit log: every AuditLog insert is hash-chained per
--    organization inside the database, so application bugs or a compromised
--    API cannot forge a consistent history.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION app.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'table "%" is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Insert a compensating row (REVERSAL / ADJUST) instead.';
END
$fn$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'WalletTransaction', 'LoyaltyTransaction', 'StockMovement', 'CashMovement',
    'JournalLine', 'SessionExtension', 'AuditLog'
  ] LOOP
    EXECUTE format('CREATE TRIGGER append_only_row BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation()', t);
    EXECUTE format('CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation()', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM arena_app, arena_platform', t);
  END LOOP;
END
$$;

-- ── Audit hash chain ────────────────────────────────────────────────────────

REVOKE ALL ON "AuditChainHead" FROM arena_app, arena_platform, arena_readonly;

-- Canonical payload that is hashed. jsonb::text is deterministic (keys are
-- stored sorted), so the chain can be re-verified purely in SQL.
CREATE OR REPLACE FUNCTION app.audit_payload(a "AuditLog") RETURNS text
  LANGUAGE sql IMMUTABLE AS $fn$
  SELECT jsonb_build_object(
    'id', a."id", 'organizationId', a."organizationId", 'branchId', a."branchId",
    'actorType', a."actorType", 'actorId', a."actorId", 'actorRole', a."actorRole",
    'impersonatorId', a."impersonatorId", 'deviceId', a."deviceId",
    'action', a."action", 'entityType', a."entityType", 'entityId', a."entityId",
    'before', a."before", 'after', a."after", 'reason', a."reason",
    'ip', a."ip", 'requestId', a."requestId",
    'createdAt', to_char(a."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text
$fn$;

CREATE OR REPLACE FUNCTION app.audit_chain() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $fn$
DECLARE
  k    uuid := COALESCE(NEW."organizationId", '00000000-0000-0000-0000-000000000000'::uuid);
  prev text;
  len  bigint;
BEGIN
  INSERT INTO "AuditChainHead" ("chainKey", "lastHash", "length", "updatedAt")
    VALUES (k, '', 0, now()) ON CONFLICT ("chainKey") DO NOTHING;
  -- Row lock serialises appends per org without blocking other orgs.
  SELECT "lastHash", "length" INTO prev, len FROM "AuditChainHead" WHERE "chainKey" = k FOR UPDATE;

  NEW."createdAt" := COALESCE(NEW."createdAt", now());
  NEW."prevHash"  := NULLIF(prev, '');
  NEW."chainSeq"  := len + 1;
  NEW."hash"      := encode(digest(COALESCE(prev, '') || '|' || app.audit_payload(NEW), 'sha256'), 'hex');

  UPDATE "AuditChainHead"
     SET "lastHash" = NEW."hash", "length" = "length" + 1, "updatedAt" = now()
   WHERE "chainKey" = k;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER audit_hash_chain BEFORE INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION app.audit_chain();

-- Returns the first row whose hash does not match the recomputed chain, or
-- no rows if the chain for this org is intact. Run by a nightly job.
CREATE OR REPLACE FUNCTION app.verify_audit_chain(org uuid)
  RETURNS TABLE (broken_id uuid, expected text, actual text)
  LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  r    "AuditLog";
  prev text := '';
  h    text;
BEGIN
  FOR r IN
    SELECT * FROM "AuditLog"
     WHERE "organizationId" IS NOT DISTINCT FROM org
     ORDER BY "chainSeq"
  LOOP
    h := encode(digest(prev || '|' || app.audit_payload(r), 'sha256'), 'hex');
    IF h <> r."hash" OR COALESCE(r."prevHash", '') <> prev THEN
      broken_id := r."id"; expected := h; actual := r."hash";
      RETURN NEXT;
      RETURN;
    END IF;
    prev := r."hash";
  END LOOP;
END
$fn$;
