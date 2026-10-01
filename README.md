# ArenaOS

Multi-tenant SaaS for **gaming cafés, esports arenas, internet cafés, console / VR centres and gaming restaurants**. One ecosystem covers:
- a Super Admin platform;
- organization and branch management;
- a locked Windows gaming shell;
- sessions and billing;
- a unified POS, restaurant and KDS;
- inventory, bookings, tournaments, loyalty, CRM and accounting.

Everything syncs in real time and keeps working at the branch when the internet is down.

> **Status:** Phases 1–11 are complete: database, security and tenancy; API and admin; Windows station agent and Live Floor (verified on real hardware); sessions, pricing and the Gaming Shell; games and station tools; customers, wallet, bookings and the customer app; POS, restaurant, kitchen display, in-seat ordering and cash shifts; inventory, recipes, purchasing and suppliers; consoles, VR, simulators, TV station displays and internet-café printing; loyalty, promotions, tournaments and CRM; **a self-keeping general ledger, reports and dashboard analytics**. Phase 12 (Super Admin, subscriptions, SaaS billing) is next. See [docs/06-roadmap.md](docs/06-roadmap.md).

## Documentation

| | |
|---|---|
| [01 · Architecture](docs/01-architecture.md) | Hybrid cloud + branch edge, stack, modules, command protocol, session-expiry flow, security |
| [02 · Requirements](docs/02-requirements.md) | Actors, capability → entity → phase traceability, NFRs |
| [03 · ERD](docs/03-erd.md) | 129 tables by domain, database-enforced invariants |
| [04 · RBAC](docs/04-rbac.md) | Permission model, decision order, role × module matrix |
| [05 · Multi-tenancy](docs/05-multi-tenancy.md) | Three isolation layers, database roles, impersonation, tests |
| [06 · Roadmap](docs/06-roadmap.md) | Phases, progress, decisions |
| [07 · API](docs/07-api.md) | Running the API, request pipeline, endpoints, demo logins |
| [08 · Stations & Live Floor](docs/08-stations-and-live-floor.md) | Windows agent, enrolment, command security, monitoring, Live Floor |
| [09 · Sessions & Shell](docs/09-sessions-and-shell.md) | Pricing engine, server-authoritative sessions and expiry, customer login, Gaming Shell |
| [10 · Games & station tools](docs/10-games-and-station-tools.md) | Signed game library, detection, updates, peripherals, connectivity, repairs, diskless |
| [11 · Customers, wallet & bookings](docs/11-customers-wallet-bookings.md) | Wallet ledger, memberships, bookings, customer app (PWA) |
| [12 · POS, restaurant & kitchen](docs/12-pos-restaurant-kitchen.md) | Orders, bills, split payment, refunds, KDS, tables, in-seat ordering, shifts |
| [13 · Inventory & purchasing](docs/13-inventory-purchasing.md) | Stock ledger, recipes, waste, transfers, counts, purchase orders, receiving, supplier invoices |
| [14 · Consoles, VR & printing](docs/14-consoles-vr-printing.md) | Agentless stations, player pricing, TV station displays, smart-plug bridge, print control |
| [15 · Loyalty, promotions, tournaments & CRM](docs/15-loyalty-promotions-tournaments-crm.md) | Points ledger and rewards, promotions engine and codes, brackets and prizes, segments and campaigns |
| [16 · Full test guide](docs/16-test-guide.md) | Server setup, physical gaming-PC setup, and a checklist for every role and feature |
| [17 · Super Admin](docs/17-super-admin.md) | Platform service, sign-in with mandatory two-step, roles, organizations, plans, audit |
| [18 · Live demos & downloads](docs/18-live-demos.md) | In-browser demo venue, live demos on the website, desktop EXEs, APK, station installer |
| [19 · Accounting, reports & analytics](docs/19-accounting-reports-analytics.md) | Automatic double-entry posting, statements, reconciliation, period lock, reports, dashboard |
| [20 · End-to-end walkthrough](docs/20-end-to-end-walkthrough.md) | Super Admin → Owner builds a venue from zero → Customer → every staff role, on the real system |

## Repository

```
apps/admin          Next.js admin console (http://localhost:3000)
apps/api            NestJS API (auth, tenancy, stations, sessions, pricing, customers)
apps/customer       Customer app (PWA: wallet, bookings, shop — http://localhost:5175/demo)
apps/shell          Gaming Shell UI (React; runs inside ArenaShell.exe, preview on http://localhost:5174)
clients/windows     .NET 8 station agent (service), Shell host (WPF + WebView2), tests
packages/db         Prisma schema (per bounded context), migrations, RLS generator, tenant-scoped client
packages/rbac       Permission catalog, role templates, authorize()
packages/contracts  Feature flags, signed device-command protocol
infra/              docker-compose (Postgres 17, Redis, optional S3 via SeaweedFS), DB role bootstrap
docs/               Design documents
```

## Getting started

Requires Node 22+. The database-backed steps need Docker (or a local PostgreSQL 17).

```bash
npm install
npm run codegen -w @arena/db     # Prisma client + tenant model list
npm test                         # schema/tenancy/RBAC/protocol tests (no DB needed)
```

With a database:

```bash
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env
cd packages/db && npx prisma migrate deploy && cd ../..
npm run keys -w @arena/api       # dev JWT/MFA secrets → .env
npm run seed -w @arena/api       # platform data + demo tenants (see docs/07-api.md)
npm run dev  -w @arena/api       # API on http://localhost:4000
npm run dev  -w @arena/admin     # Admin on http://localhost:3000 (second terminal)
npm test                         # all unit + Postgres integration + API e2e tests
```
