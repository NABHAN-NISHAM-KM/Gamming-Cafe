# 06 · Roadmap

| Phase | Scope | Status |
|---|---|---|
| **1** | Architecture, requirements, ERD, database schema, RBAC, multi-tenancy | ✅ **Done** |
| 2 | Auth (JWT, refresh rotation, MFA), organizations, branches, zones, employees · NestJS API · Admin app | ✅ **Done** |
| 3 | Windows Agent (.NET 8 service), device enrollment, heartbeats, Live Floor, remote commands | ✅ **Done** |
| 4 | Gaming sessions, pricing engine, customer login, Shell UI, automatic expiry | ✅ **Done** |
| 5 | Games, launchers, update orchestration, peripheral center, connectivity, repair tools, diskless adapters | Next |
| 6 | Customers, wallet, membership, bookings, customer PWA (first cut) | |
| 7 | POS, restaurant, KDS, tables, in-seat ordering, payments, shifts | |
| 8 | Inventory, purchasing, suppliers | |
| 9 | Console / VR / simulator management, internet-café printing | |
| 10 | Tournaments, loyalty, promotions engine, CRM | |
| 11 | Reports, accounting, analytics | |
| 12 | Super Admin, subscriptions, SaaS billing, organization management | |
| 13 | Offline branch edge + sync, hardening, monitoring, backups, DR, load and chaos tests | |

## Phase 1 deliverables

- `packages/db`
  - Prisma schema: 121 tables in 14 context files.
  - 4 migrations: `init`, generated `rls`, `ledgers_and_audit`, `integrity_constraints`.
  - Tenant-scoped client and schema tooling.
- `packages/rbac`: 111 permissions (33 sensitive), 14 role templates, `authorize()`.
- `packages/contracts`: feature flags and resolution; signed device-command protocol.
- `infra/`: docker-compose (Postgres 17, Redis, optional S3 via SeaweedFS) and a database-role bootstrap.
- `.github/workflows/ci.yml`: typecheck, all tests, and real-Postgres RLS tests.
- `docs/01…06`.

**Tests:** 191 passing (170 without a database, plus 21 Postgres integration tests).

## Real-database verification (done)

Checked against PostgreSQL 17 in Docker:

- [x] `prisma migrate deploy` applies all four migrations cleanly.
- [x] `rls.integration.test.ts` passes (7 tests): no cross-org read, update, delete or insert; no tenant means zero rows; no leak between pooled transactions.
- [x] `prisma migrate diff --from-config-datasource --to-schema` is **empty**. Prisma ignores the hand-written `EXCLUDE`/CHECK constraints, triggers and policies, so `migrate dev` won't drop them. This is now a CI step.
- [x] `invariants.integration.test.ts` passes (14 tests): composite-FK cross-org block, booking overlap, freeing and moving bookings, one live session per device, idempotent top-ups and payments, append-only ledgers (even for the owner), non-negative balances, balanced journals, audit hash chain and tamper detection.

**Note:** the dev `arena_owner` is a Postgres superuser, which bypasses RLS. In production the migration role must be a plain owner, not a superuser.

## Phase 2 progress

- ✅ NestJS API (`apps/api`), described in [07-api](07-api.md):
  - EdDSA JWTs, refresh rotation with reuse detection, TOTP MFA, account lockout.
  - A per-request RLS transaction, deny-by-default route protection, resource-derived authorization targets.
  - Anti-escalation on role grants and custom roles, plan limits, a same-transaction audit trail.
- ✅ Migration `0005_auth_lookups`: security-definer functions for login, so no RLS policy is loosened.
- ✅ Migration `0006_catalog_ref_guards`: closes a cross-tenant gap on shared-catalog references (roles, games, launchers). Enforced by a static test and an integration test.
- ✅ Seed script (platform data + 2 demo tenants) and 18 end-to-end tests.
- ✅ Admin web app (`apps/admin`, Next.js 16):
  - Sign-in with an organization picker and TOTP step; dashboard with a setup checklist.
  - Branches and zones; employees (add, roles by branch, suspend, PIN); roles (templates and custom); 2-step sign-in setup by QR code.
  - Sensitive actions prompt for a reason, which is stored in the audit log.
  - Tokens are kept server-side in httpOnly cookies and never reach browser JavaScript; CSRF header check; refreshes are shared by concurrent requests so rotation never kills a live session.
- ✅ Tests run against a separate `arena_test` database, so they never touch development data.

## Phase 3 summary

Details are in [08-stations-and-live-floor](08-stations-and-live-floor.md).

- **Windows agent** (.NET 8 service, `clients/windows`):
  - Enrolment by code, with a device key DPAPI-protected on the PC and proof-of-possession sign-in.
  - Heartbeats, WMI hardware inventory and NVIDIA GPU telemetry.
  - Verified-then-executed commands with a persisted replay guard, and safe mode for office PCs.
  - Installed with `install-agent.ps1`.
- **API:**
  - Batch enrolment codes; per-branch ES256 command-signing keys.
  - Commands delivered after commit and queued for offline PCs; per-type permissions; zone mass actions; Wake-on-LAN relayed through a PC on the same LAN.
  - Alerts: temperatures, disk, hardware change, offline.
  - The Live Floor stream (SSE) is authorized before any bytes are sent.
- **Admin:** Live Floor (status map, live metrics, alerts, station drawer, mass actions, layout editor) and Computers (station table, codes, retire).
- **Migrations:** `0007_devices` and `0008_signing_key_unique`.
- **Verified on real hardware:** the developer laptop was enrolled; its real hardware and metrics appeared; commands signed by the server were verified by the C# agent; a real LOW_DISK alert was raised.
- **Tests:** 244 in total (228 JavaScript + 16 .NET).
  - 14 device end-to-end tests.
  - A cross-language contract test (Node signs, C# verifies), regenerated in CI on a Windows runner.

## Phase 4 summary

Details are in [09-sessions-and-shell](09-sessions-and-shell.md).

- **Pricing engine:** integer money; plans at zone, branch or org level; time windows in the branch's timezone; tiers; packages, passes and postpaid rates; membership and staff discounts. Quotes are snapshotted onto each session.
- **Sessions:** start, extend, move and end, each writing the bill, order, payment or time-ledger entry in one transaction. Retries are idempotent.
- **Server-authoritative expiry:** a 2-second sweep across tenants. Warnings at 30/15/10/5/1 minutes, and "Ending soon" in the last 5. PCs are resynced when they reconnect, and expired sessions are closed after an API restart.
- **Customers and prepaid time:**
  - Sell time packages to an account.
  - Customers sign in at the PC with a password or PIN (throttled).
  - Unused time is refunded on logout.
- **Windows:**
  - The agent persists the session and keeps a local fail-safe lock.
  - The `ArenaOS.Shell` named pipe is hardened (FirstPipeInstance, tight ACL, strict parsing).
  - The WPF + WebView2 host checks that the pipe belongs to a Windows service.
  - The React Gaming Shell: lock screen, countdown, warnings, EN/AR.
- **Admin:** Start/extend/move/end on the Live Floor with live quotes and countdowns; Sessions, Customers and Rates pages.
- **Migration:** `0009_session_timers`.
- **Tests:** JavaScript suites all pass (including 19 session e2e + 17 pricing), and 34 .NET tests.

## Decisions to confirm with the product owner

1. **Deployment:** hybrid cloud + edge is the default; fully on-prem is supported. Do we need on-prem at launch?
2. **First payment gateways and countries:** this drives tax/e-invoicing work (e.g. UAE VAT and e-invoicing, KSA ZATCA).
3. **Shell UI stack:** decided — WPF host + WebView2 + React UI.
4. **Pooled game accounts:** confirm which publishers' terms allow café use before enabling `LICENSE_POOL` per org.
5. **Brand name:** "ArenaOS" is a working name.
