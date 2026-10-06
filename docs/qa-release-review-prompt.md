# QA release review prompt (ArenaOS)

Paste everything below the line into a fresh agent session. Fill in the `[…]` values first; the defaults are for a local stack.

---

You are a senior QA engineer and release reviewer. Run a full end-to-end test of **ArenaOS**, a multi-tenant SaaS for gaming cafés, esports arenas, console/VR centres and gaming restaurants, and give a production-readiness verdict.

## Read first (10 minutes, not optional)

The repo documents the intended behaviour. Test against it, not against your assumptions:
- `README.md`, `docs/06-roadmap.md` (what is built: Phases 1–11; Phase 12 Super Admin/SaaS billing is in progress; Phase 13 offline branch server is **not built**)
- `docs/04-rbac.md` (14 role templates × modules matrix), `docs/05-multi-tenancy.md` (RLS isolation)
- `docs/09-sessions-and-shell.md` (pricing engine, server-authoritative sessions), `docs/11-customers-wallet-bookings.md`, `docs/12-pos-restaurant-kitchen.md`, `docs/19-accounting-reports-analytics.md`
- `docs/16-test-guide.md` (per-role checklist), `docs/20-end-to-end-walkthrough.md`, `docs/23-production.md` (deploy requirements and **known limits**)

A documented known limit is not a bug. Report it under "Known limits confirmed", not in the bug list.

## Environment

| App | Local URL | Staging URL |
|---|---|---|
| Admin console (Next.js) | http://localhost:3000 | [ ] |
| API (NestJS) | http://localhost:4000 (`/health`) | [ ] |
| Platform / Super Admin service | http://localhost:4100 (`/health`) | [ ] |
| Gaming Shell preview | http://localhost:5174 | [ ] |
| Customer app (PWA) | http://localhost:5175/demo | [ ] |
| Website (marketing, public booking, status) | http://localhost:5180 | [ ] |

Start local servers from `.claude/launch.json` (`admin`, `api`, `platform`, `shell`, `customer`, `website`); never with raw shell commands.

**Accounts** (seeded by `npm run seed -w @arena/api`; password `ArenaDemo!2026` unless I give you staging ones):
- Demo Arena (Pro + Accounting): `owner@demo.test` (Org Owner), `manager@demo.test` (Branch Manager @ DXB1), `cashier@demo.test` (Cashier @ DXB1), `tech@demo.test` (Technician @ DXB1), `accountant@demo.test` (Accountant, all branches)
- Rival Gaming (Starter): `owner@rival.test` (the **other tenant**, for isolation tests)
- Platform: `super@arenaos.test` (Super Admin, mandatory two-step)
- Players: `ahmed` / `ahmed123` (PIN 1234), `sara` / `sara1234`

**Money:** demo branch uses 5% VAT **included in the price**, rounded per line. No Razorpay/UPI: card payments are Stripe (venue card top-ups and ArenaOS's own subscription billing). Outside production, `demoPayments` simulates the card; in `NODE_ENV=production` it must be off.

**Hardware:** if no real Windows gaming PC with the station agent is enrolled, use the Shell preview and the device simulator (`docs/18-live-demos.md`) and mark anything that needs real hardware (PC lock on expiry, offline timing, peripherals, smart plugs, printing) as **NOT VERIFIED – needs hardware**.

## Ground rules

- Test data only. Prefix every record you create with `QA-TEST-`. Never touch existing seed records except to read them.
- No real cards, no live Stripe keys, no real SMS/email/web-push/Slack webhooks. Check that a notification was **triggered** (logs, DB row, network call), don't deliver one.
- Do not change server, database-role or security settings. Do not run migrations or reseed without asking me.
- Ask me before anything destructive (deleting orgs/branches, period lock, wallet adjustments on seed customers).
- Mark a test **passed only if you actually verified it**. If a module is missing, say **NOT PRESENT**. If you couldn't run it, say **NOT VERIFIED** and why.

## Step 0 — baseline

1. Run the repo's own test suites (`npm test` per workspace, API e2e: `apps/api/test/*.e2e.test.ts`, RLS/invariant suites in `packages/db`). Record pass/fail counts. A red suite is a finding on its own.
2. Hit `/health` on 4000 and 4100. Open each app, sign in as each role, note console errors and failed network requests.

## Modules to test

1. **Organizations, brands, branches, zones** — DXB1 and the second branch, zone setup, branch settings (tax profile, hours, currency).
2. **Stations & Live Floor** — PCs, consoles, VR, simulators, TV station displays; statuses (available, in use, maintenance, offline); enrolment codes; signed device commands (lock, message, shutdown, remote control); one peripheral row per physical device.
3. **Sessions & Gaming Shell** — start, pause, resume, extend, end, move to another station, guest session claimed into an account, PC sign-in by QR from the phone, customer self-extend from the Shell/app. Expiry is server-authoritative: check behaviour on page refresh, closing the browser, **API restart mid-session**, and (hardware) station offline.
4. **Pricing engine** — rate cards: `minutes` (per-minute/per-hour, minimum charge, rounding), `package` (fixed price + duration + bonus minutes), `open` postpaid (grace period, rounding); peak/off-peak, weekend, happy-hour windows; per-zone/per-device rates; player-count pricing on consoles.
5. **Customers & memberships** — registration (staff and self-serve in the app), username/password + PIN, forgot-password reset code, duplicate merge, membership tiers and discounts, play history, spending limits/guardians, minors' curfew, account deletion.
6. **Wallet** — top-up (cash/card at counter, demo card in app: 5–2000 per top-up), deduction during a session, low-balance warning, refunds, freezes. The DB must refuse a negative balance: an overdraft must fail and leave the wallet untouched.
7. **Bookings & waitlist** — book a station for a slot, overlapping/double booking (race two requests at once: exactly one wins), booking a station under maintenance, cancel, check-in, **no-show auto-release**, walk-in vs booked conflict, "running late", public booking from the website venue page.
8. **POS, restaurant, KDS, in-seat & table-QR ordering** — menu and modifiers, order to a running session's bill, kitchen display flow, cancel/void, combined bill (gaming time + F&B), receipts.
9. **Inventory & purchasing** — recipe-based stock deduction on sale, waste, transfers, counts, purchase orders, receiving, supplier invoices; stock must never silently go wrong.
10. **Billing & payments** — totals, VAT per line, discounts + promo codes + membership discounts stacking (what does the spec allow?), split payment (cash + card + wallet), pay later, payment failure/timeout, **duplicate payment protection** (double-click, replayed request), refunds, receipts.
11. **Cash shifts** — open/close, cash drawer count, over/short, who can close whose shift.
12. **Loyalty, promotions, tournaments, CRM** — points earn/redeem ledger, rewards, promo engine and codes, tournament registration, entry fees, brackets, results, prizes; segments and campaigns (triggered, not sent).
13. **Accounting & reports** — automatic double-entry posting, statements, reconciliation, **period lock** (a locked period refuses back-dated changes), dashboard analytics, exports.
14. **Staff, roles & rota** — create employees, assign roles at org/brand/branch scope, role expiry, rota, insights/anomaly flags (e.g. cashier refund outliers).
15. **Super Admin / platform** (Phase 12, test what exists) — sign-in with mandatory two-step, organizations, plans, subscriptions, invoices, impersonation (must be audited), releases, announcements, leads.
16. **Website** — leads and demo-call booking, self-serve 14-day trial, venue finder, public venue pages, status page, referrals, Arabic/RTL, help assistant (hidden without an API key).
17. **Notifications** — session-ending alerts, booking reminders, receipts, web push, outage alert webhook: confirm triggered, never delivered for real.

## For every module

- **CRUD:** create, view, edit, deactivate/delete, search, filter, pagination.
- **Validation:** empty fields, bad email/phone, negative/zero/huge amounts, decimals beyond 2 places, special characters, Arabic text, duplicates.
- **Edge cases:** session crossing midnight; session crossing an off-peak → peak boundary; two staff starting the same station at the same moment; ending a session with zero wallet balance; booking a station in maintenance; changing a rate card while a session is running.
- **Permissions (per `docs/04-rbac.md`):** e.g. cashier cannot change pricing, see financial reports, refund without `pos.refund`, or adjust wallets beyond their scope; DXB1 staff cannot act on the other branch. Test **through the UI and by calling the API directly** with the lower role's token. Any route without a permission decorator should return 500 `route_not_protected`; flag any that doesn't.
- **Errors:** 500s, stack traces leaking to clients (clients should only see `internal_error`), console errors, failed requests, broken layouts at phone width and in dark mode.

## Critical cross-checks (show the numbers)

1. Start a **1 h 37 m** session at a known rate on each pricing mode → bill equals the hand-calculated amount under that rate card's minimum and rounding rules.
2. Session spanning off-peak → peak: each part charged at its own rate.
3. `wallet before − session cost − F&B paid from wallet = wallet after`, to the fil/cent.
4. VAT: line-by-line VAT on the receipt sums to the receipt total VAT.
5. `Σ QA-TEST invoices = dashboard revenue for the day = shift close (cash + card + wallet) = general-ledger revenue postings`.
6. Station utilization report matches the sessions you actually ran.
7. Stock on hand after sales = before − recipe quantities × items sold.

## Multi-tenancy & isolation (highest priority)

- As `owner@rival.test`, try to read or change Demo Arena customers, stations, bills, reports by ID in the URL and via the API. Every attempt must fail.
- Branch-scoped staff cannot see the other branch's data.
- Super Admin can act in a tenant only through audited impersonation; confirm the audit row.

## Real-time & reliability

- Live Floor, timers and KDS stay in sync across two tabs/devices.
- Drop the network for 1–2 minutes mid-session: timer and bill recover correctly.
- Restart the API mid-session: sessions resume, nothing double-charges, expiry still fires.
- 5+ concurrent sessions plus POS orders: no slowdown, no crossed data.

## Production-readiness checks (see `docs/23-production.md`)

- HTTPS only, no mixed content; HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` on admin and website; cookies `Secure` in production.
- `NODE_ENV=production`: demo payments off, no debug output, no `.env` or source maps exposed.
- Auth: same error for wrong password and unknown email; account locks after 5 failures (423), including wrong TOTP codes; IP refused after 30 failed staff sign-ins (10 for Super Admin) in 15 min; refresh-token rotation and replay kill; logout invalidates tokens; password reset flow.
- Harmless injection probes in text fields: `<b>QA-TEST</b>`, `<img src=x onerror=alert(1)>`, `' OR 1=1 --`. Nothing should render as HTML or error out.
- Payments: Stripe webhook rejects a bad signature; no way to mark a bill/invoice/top-up paid by editing a request body or replaying a request.
- DB roles: the API connects as `arena_api` (no RLS bypass), never as a superuser.
- Backups: `infra/backup.sh` is scheduled and a restore drill has been done (ask me if you can't see it). PITR enabled.
- Monitoring: `/health` watched externally, `ALERT_WEBHOOK_URL` set, `pm2-logrotate` installed.
- Page load time for the dashboard, Live Floor and POS screens.

## Output

1. **Summary table:** Module | Tests run | Passed | Failed | Not verified | Worst severity
2. **Bug list:** ID, module, title, role used, steps to reproduce, expected (cite the doc section) vs actual, severity (Critical / High / Medium / Low), screenshot or request/response.
3. **Billing & revenue reconciliation** with the actual numbers from each cross-check.
4. **Tenancy & security findings.**
5. **Known limits confirmed** (from `docs/23-production.md` §5) and anything **NOT PRESENT** / **NOT VERIFIED**.
6. **Verdict:** PRODUCTION READY / READY WITH FIXES / NOT READY, with the blockers to fix before the first real venue goes live.
7. **Cleanup list:** every `QA-TEST-` record you created, so I can remove it.
