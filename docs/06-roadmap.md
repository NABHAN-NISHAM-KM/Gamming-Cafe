# 06 · Roadmap

| Phase | Scope | Status |
|---|---|---|
| **1** | Architecture, requirements, ERD, database schema, RBAC, multi-tenancy | ✅ **Done** |
| 2 | Auth (JWT, refresh rotation, MFA), organizations, branches, zones, employees · NestJS API · Admin app | ✅ **Done** |
| 3 | Windows Agent (.NET 8 service), device enrollment, heartbeats, Live Floor, remote commands | ✅ **Done** |
| 4 | Gaming sessions, pricing engine, customer login, Shell UI, automatic expiry | ✅ **Done** |
| 5 | Games, launchers, update orchestration, peripheral center, connectivity, repair tools, diskless adapters | ✅ **Done** |
| 6 | Customers, wallet, membership, bookings, customer PWA (first cut) | ✅ **Done** |
| 7 | POS, restaurant, KDS, tables, in-seat ordering, payments, shifts | ✅ **Done** |
| 8 | Inventory, purchasing, suppliers | ✅ **Done** |
| 9 | Console / VR / simulator management, internet-café printing | ✅ **Done** |
| 10 | Tournaments, loyalty, promotions engine, CRM | ✅ **Done** |
| 11 | Reports, accounting, analytics | ✅ **Done** |
| 12 | Super Admin, subscriptions, SaaS billing, organization management | Next |
| 13 | Offline branch edge + sync, hardening, monitoring, backups, DR, load and chaos tests | Started: production roles, backups, outage alerts, sign-in hardening ([23-production](23-production.md)) |

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

## Phase 11 summary

Details are in [19-accounting-reports-analytics](19-accounting-reports-analytics.md).

- **General ledger that keeps itself:** a background poster books bills, payments, refunds, wallet credits, stock, drawer movements, shift closes, supplier invoices and expenses as double-entry entries.
  - Each document books only the change since it was last booked, on the day it changed.
  - Exactly once, per document version; entries are append-only.
- **Chart of accounts** per organization; manual journal entries (balanced, reason required, reversible once); expenses (drawer-paid ones leave the shift); period lock.
- **Statements:** trial balance, profit & loss, balance sheet, account ledgers, journal; branch-scoped; CSV.
- **Reconciliation** of wallets, inventory, payables and drawers against the ledger, nightly.
- **Reports:** sales (with stock-cost margins), VAT, cash & shifts, gaming utilization, staff; branch-local days; CSV.
- **Dashboard analytics:** live status, today vs last week and, with Advanced analytics, period comparisons, trends and customer insight.
- **Fix:** counter cash for top-ups, memberships and time packages now reaches the cashier's drawer.
- **Admin:** Finance and Reports pages; a new dashboard.
- **Migrations:** `0015_accounting`, `0016_reporting_indexes`.
- **Tests:** 24 new API tests (15 accounting e2e, 7 reports e2e, 2 CSV).

## Phase 10 summary

Details are in [15-loyalty-promotions-tournaments-crm](15-loyalty-promotions-tournaments-crm.md).

- **Loyalty:**
  - Append-only points ledger; points for gaming and food spend, minutes played, bookings kept, tournaments, referrals and birthdays.
  - Tier multipliers; FIFO expiry; refunds reverse the points they earned.
  - A rewards catalog: free minutes, wallet credit, or personal one-use discount and product codes.
- **Promotions engine:**
  - Pure and deterministic: conditions, effects, the best non-stackable promotion plus stackables, capped.
  - Happy hours, weekend bonus minutes, birthday and first-visit offers, shared and personal codes.
  - Uses, budgets and per-customer limits are enforced by conditional UPDATEs under a per-customer lock.
  - Applied to POS orders and prepaid session sales.
- **Tournaments:**
  - Single and double elimination, round robin, league and Swiss; seeding with byes.
  - Entry fees through the POS (the wallet in the app); refunds on withdraw or cancel.
  - Score reporting; automatic advancement and Swiss pairing; placements, wallet prizes and points.
- **CRM:**
  - Built-in and custom segments, plus static lists.
  - Consent-only campaigns (in-app inbox, Shell message at the next session, or the outbox for SMS, email and WhatsApp) with personal codes.
  - Idempotent sends; conversion tracking.
- **Customer app:** Rewards tab, tournaments (bracket, standings, entry), inbox, invite code at sign-up.
- **Admin:** Tournaments and Marketing pages; loyalty panel on customers; promo codes on the POS and Live Floor.
- **Migration:** `0014_loyalty_promotions_tournaments`.
- **Tests:** 414 JavaScript (18 engagement e2e + 15 brackets + 10 promotions + 3 segments) and 74 .NET.

## Phase 9 summary

Details are in [14-consoles-vr-printing](14-consoles-vr-printing.md).

- **Agentless stations** (consoles, VR, sim rigs): sold like PCs with the server's timer as the only clock.
  - Per-player console pricing; minimum age with a guest age check.
  - VR cleaning between players; gear checks with floor alerts.
- **TV station displays:**
  - Paired once with a one-time code; show first names, countdowns, warnings and "time's up".
  - Token hashed and revocable.
- **Smart-plug power:** through one branch bridge PC via signed POWER commands, delayed off after time's up, LAN-only (checked on the server and on the agent).
- **Internet-café printing:**
  - The agent holds every spooler job until the customer approves the price on the Shell (bill or wallet), or staff release it.
  - Signed release/cancel; retry-safe; timeouts; failure alerts.
- **Admin:** Consoles & VR and Printing pages; players and age on the Live Floor; player pricing on rates.
- **Migration:** `0013_stations_printing`.
- **Tests:** 368 JavaScript (15 stations/printing e2e + 6 pricing) and 74 .NET.

## Phase 8 summary

Details are in [13-inventory-purchasing](13-inventory-purchasing.md).

- **Stock ledger:**
  - Append-only movements, with levels updated under optimistic locking.
  - Moving-average cost; batches and expiry used earliest-expiry first; serial numbers for gear.
  - Idempotent everywhere.
- **Sales use stock:** POS, table and in-seat orders take out stock items, recipe ingredients (with planned waste) and option ingredients from the right store.
  - A void before cooking puts them back.
  - Ready items show sold out at zero.
- **Operations:**
  - Waste, corrections and issuing gear to a PC (sensitive, with a reason).
  - All-or-nothing transfers between stores.
  - Stock counts with variance value.
  - Overview: value, low stock and expiring batches.
- **Purchasing:**
  - Suppliers, and POs with an approval limit (never approved by their creator).
  - Partial receipts; over-receipt refused at the API and in the database.
  - Reorder suggestions net of what's on order → one draft PO per supplier.
  - Supplier invoices matched to what was received, paid in parts.
- **Menu costing:** recipe editor and food-cost % per item (price without VAT).
- **Admin:** Inventory and Purchasing pages; recipes and food cost in Restaurant → Menu.
- **Migration:** `0012_inventory_purchasing` (database guards).
- **Tests:** 347 JavaScript (21 inventory e2e + 8 costing unit) and 51 .NET.

## Phase 7 summary

Details are in [12-pos-restaurant-kitchen](12-pos-restaurant-kitchen.md).

- **Orders:**
  - Counter, takeaway, to a PC (on the live session's bill) and dine-in (on the table's bill).
  - Server-side pricing with options, branch prices, discounts and per-line VAT.
  - Sold-out (86) items are refused.
- **Payments:**
  - Split tenders (cash / card / wallet) with change; idempotent per tender.
  - Voids (a sensitive override once cooked) and refunds (original method, cash or wallet).
- **Kitchen display:**
  - One ticket per station; start → ready → served.
  - Live over SSE; timers and late alerts.
  - The customer's PC is told when food is on its way.
- **In-seat ordering:**
  - The Gaming Shell Food screen: menu, options, cart, add to bill or pay from wallet, order tracker.
  - It sends ids and counts only; the server prices everything.
- **Shifts:** open with a float, pay-in/out and safe drops, X/Z reports, close with a count, and manager approval above the variance limit.
- **Admin:** POS, Kitchen and Restaurant pages (tables and menu management).
- **Migration:** none (Phase 1 schema).
- **Tests:** 318 JavaScript (10 POS e2e + 8 pricing unit) and 51 .NET.

## Phase 6 summary

Details are in [11-customers-wallet-bookings](11-customers-wallet-bookings.md).

- **Wallet:**
  - Cash, bonus and prepaid-minutes buckets on one append-only ledger. Overdrafts are impossible (a database check), retries are safe (idempotency keys), and bonus credit is spent first.
  - WALLET is a payment method everywhere: sessions, extensions, check-in, time packages, memberships.
- **Memberships:**
  - Tiers with discounts, bonus minutes and a booking window.
  - Sold at the counter or in the app. A renewal adds a period; expiry drops the tier automatically.
- **Bookings:**
  - Availability by zone and station. No double booking, enforced by the database even under a race.
  - Walk-in sessions can't overlap a booking.
  - Check-in starts the sessions; no-shows are released automatically.
  - Admin day timeline; upcoming bookings shown on floor tiles.
- **Customer app** (`apps/customer`, PWA):
  - Sign up and sign in, wallet, time, membership, book and cancel, buy with the wallet.
  - Separate customer tokens, per-customer isolation, throttled login.
- **Migration:** `0011_customers_bookings`.
- **Tests:** 299 JavaScript (17 new e2e) and 50 .NET.

## Phase 5 summary

Details are in [10-games-and-station-tools](10-games-and-station-tools.md).

- **Game catalog:**
  - A platform catalog (18 popular titles, 6 launchers, browsers and tools), plus custom games per organization.
  - Games can be enabled, featured, limited to zones and age-rated.
- **Signed station config:** the list of what a PC may launch is signed with the branch key, cached for offline use, and re-checked locally (session, age, installed; interpreters never run).
- **Detection:** games from Steam and Epic manifests and catalog executables; peripherals via Plug and Play, with the vendor named; boot mode (local disk or iSCSI/diskless).
- **Updates:** branch-wide, launcher-driven, a few PCs at a time, idle PCs only, resumed when offline PCs return.
- **Gaming Shell:**
  - Library with search and categories, one-tap play, age locks, "now playing".
  - Platforms, Apps and Internet; Connection (live ping); Peripherals (mouse speed, presets, reset per customer); Support (call staff, 3 self-fixes).
- **Live Floor:**
  - Playing and help badges on tiles.
  - Drawer: repairs, connection, peripherals, installed games, boot.
  - Alerts: peripheral missing, network degraded, help requested.
- **Migration:** `0010_games_and_station_tools`.
- **Tests:** 282 JavaScript (13 games e2e + 5 unit) and 50 .NET.

## Decisions to confirm with the product owner

1. **Deployment:** hybrid cloud + edge is the default; fully on-prem is supported. Do we need on-prem at launch?
2. **First payment gateways and countries:** this drives tax/e-invoicing work (e.g. UAE VAT and e-invoicing, KSA ZATCA).
3. **Shell UI stack:** decided — WPF host + WebView2 + React UI.
4. **Pooled game accounts:** confirm which publishers' terms allow café use before enabling `LICENSE_POOL` per org.
5. **Brand name:** "ArenaOS" is a working name.
