# 18 · Live demos & downloads

The website runs the **real apps** against a simulated venue that lives in the browser, and the same demo ships as downloads. Nothing needs a server.

## How it works

`packages/demo` is an in-browser ArenaOS backend. `installDemo()` intercepts the app's `fetch` and `EventSource` calls and answers them:

- **Data:** responses captured from the real API for a seeded venue (Demo Arena: 2 branches, 18 PCs, consoles, VR, sim, 16 customers, live sessions, orders, bookings). Timestamps are shifted to "now" on first load.
- **Actions:** sessions (quote, start, extend, move, end, auto-expiry), station commands, customers and wallets, bookings, POS, bills and payments, kitchen tickets, tables, cash shifts, Super Admin actions. Everything else goes through a generic create / update / delete layer over the captured documents.
- **Shared state:** saved in `localStorage` and synced with `BroadcastChannel`, so the admin, Shell and customer demos on one origin are the same venue. Start a session on PC-01 in the admin and the Shell demo unlocks.
- **A living venue:** station metrics tick, sessions run out, walk-in players keep about 60% of PCs busy (PC-01 stays free for the Shell), and a simulated kitchen crew moves tickets along.

**Guided tour:** after sign-in, each demo shows a short tour (`packages/demo/src/tour.ts`) that points at the real controls, which it finds by their visible label. It shows once per demo per device. The **Tour** tab on the right edge restarts it, and `?tour` in the URL forces it.

Demo logins: staff `owner@demo.test` (and manager, cashier…) · Super Admin `super@arenaos.test` with any 6-digit code · all `ArenaDemo!2026`. Players: `ahmed` / `ahmed123` (PIN 1234), `sara` / `sara1234`.

## Building

```bash
npm run build:demos                                   # -> apps/website/live/{admin,app,shell}
powershell -File clients/windows/package-demos.ps1    # -> ArenaOS-Console.exe, ArenaOS-Shell-Demo.exe
powershell -File apps/customer/build-apk.ps1          # -> ArenaOS-Customer.apk (JDK 17 + Android SDK)
powershell -File clients/windows/package.ps1 -Installer   # -> ArenaOS-Station-Setup.exe (the real station)
```

Downloads are copied to `apps/website/downloads/`. They are build outputs and aren't committed.

- **Admin demo:** a Next.js static export (`ARENA_DEMO=1`, `basePath /live/admin`). Pages with an id in the URL are pre-rendered for the demo's ids plus a `_` page; the host serves `_` for ids created during the demo (`apps/website/serve.mjs`, `Arena.DemoHost`). Any other static host needs the same rewrite.
- **Desktop EXEs** (`clients/windows/src/Arena.DemoHost`): WebView2 windows that serve the bundled build from `https://demo.arena/`. Both share one WebView2 profile, so the Console and the Shell demo running together are one venue. The Console's start screen can also connect to a real ArenaOS server.
- **APK:** Capacitor 6 wraps the customer app demo build. It is debug-signed; a store release needs your own key.

## Refreshing the demo data

```bash
# 1. a fresh database: CREATE DATABASE arena_demo; migrate + seed with DATABASE_URL etc. pointed at it
# 2. API on 4010 and platform on 4110 against arena_demo (PORT / PLATFORM_PORT)
node packages/demo/scripts/enrich.mjs tokens      # enrolment codes; run the device simulator with them
node packages/demo/scripts/enrich.mjs activity    # customers, sessions, orders, bookings via the real API
cd apps/api && npx tsx ../../packages/demo/scripts/capture.ts   # -> packages/demo/src/fixtures/*.json
```

`node packages/demo/scripts/stack.mjs api|platform` runs the API (4010) or the platform service (4110) against `arena_demo` (the `demo-api` and `demo-platform` entries in `.claude/launch.json` do the same).

**Adding screens without re-capturing everything:** `capture-new.ts` captures only the screens built after the main capture (billing and usage, announcements, seasons, card payments, customer insights, waitlist, forecast, anomalies, station health, table QR codes, receipts, the rota, Super Admin releases / health / leads / website stats / invoices, and the customer app's waitlist, seasons, "find a team", spending limits, bills and saved card). It moves their timestamps back to the original capture time and merges them into the fixtures. It plans a sample week of shifts on the DXB1 branch the first time. Like `capture.ts`, it signs the demo super admin in by enrolling two-step sign-in, so delete that user's `MfaFactor` row in `arena_demo` first. Migrate `arena_demo` to the latest migration before running it.

```bash
cd apps/api && npx tsx ../../packages/demo/scripts/capture-new.ts
npm run build:demos
```
