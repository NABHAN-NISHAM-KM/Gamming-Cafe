# 07 · API (Phase 2)

The NestJS app is in `apps/api`. All routes are under `/v1` except `/health`.

## Running locally

```bash
docker compose -f infra/docker-compose.yml up -d      # Postgres + Redis
cd packages/db && npx prisma migrate deploy && cd ../..
npm run keys -w @arena/api                            # dev JWT + MFA keys → .env (once)
npm run seed -w @arena/api                            # platform data + demo tenants
npm run dev  -w @arena/api                            # http://localhost:4000
```

The seed creates two organizations. Every account's password is `ArenaDemo!2026`.

| Login | Org | Role |
|---|---|---|
| owner@demo.test | Demo Arena (Pro plan) | Org Owner |
| manager@demo.test | Demo Arena | Branch Manager @ DXB1 |
| cashier@demo.test | Demo Arena | Cashier @ DXB1 |
| tech@demo.test | Demo Arena | Technician @ DXB1 |
| owner@rival.test | Rival Gaming (Starter plan) | Org Owner |

## Request pipeline

```
AuthGuard (global)        Bearer JWT (EdDSA, 15 min) → claims {sub, org, emp, sid}
TenantInterceptor (global)
  └─ db.withTenant(org)   one transaction; SET LOCAL app.current_org → RLS on
      ├─ PrincipalService session still live? employee ACTIVE? org not suspended?
      │                   grants + plan features + limits
      ├─ authorize()      target derived from route params (branchId/zoneId/employeeId/brandId)
      │                   under RLS: another org's id → 404, never 403
      └─ handler          tx() from AsyncLocalStorage; AuditService writes in the same tx
ErrorsFilter              ForbiddenError→403 {permission, reason} · TenantViolation→404 ·
                          P2002→409 · P2025→404 · anything else→500 (no internals leaked)
```

**Deny by default:** a route with none of `@Public()`, `@RequirePermission(key)`, `@RequirePermissionAnyScope(key)` or `@AnyStaff()` returns 500 `route_not_protected`.

**Sensitive actions:** send `X-Action-Reason: <text>`. The reason is required, then stored on the audit row.

## Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | /auth/login | public | `{email, password, organizationSlug?}`. Returns `409 organization_required` with a list when the user belongs to several orgs. Returns `{mfaRequired, mfaToken}` if TOTP is on. Locks the account after 5 failures (`423`). |
| POST | /auth/mfa/verify | public | `{mfaToken, code}`; codes can't be replayed |
| POST | /auth/refresh | public | rotation; replaying an old token revokes the whole session |
| POST | /auth/logout | public | `{refreshToken}`; the access token dies immediately too |
| GET | /auth/me | any staff | user, org, grants, features, limits |
| POST | /auth/mfa/totp/setup · /confirm | any staff | enrol an authenticator app |
| GET | /permissions | any staff | catalog |
| GET / PATCH | /organization | org.view / org.manage | slug, status and currency are platform-managed |
| GET / POST / PATCH | /brands, /brands/:brandId | org.view / org.manage | |
| GET | /branches | branch.view (any scope) | filtered to the branches the caller covers |
| GET / PATCH | /branches/:branchId | branch.view / branch.manage | |
| POST | /branches | branch.manage | enforces the plan's `MAX_BRANCHES` (402) |
| GET / POST | /branches/:branchId/zones | zone.view / zone.manage | |
| GET / PATCH / DELETE | /zones/:zoneId | zone.view / zone.manage | DELETE archives the zone |
| GET | /employees | employee.view (any scope) | filtered by home branch |
| POST | /employees | employee.manage over the home branch | invite plus roles; anti-escalation applies; enforces `MAX_EMPLOYEES` |
| PATCH | /employees/:employeeId | employee.manage | moving someone needs rights over the destination branch |
| POST | /employees/:employeeId/pin | employee.manage | POS / maintenance-mode PIN (argon2id) |
| POST / DELETE | /employees/:employeeId/roles[/:assignmentId] | employee.assign_roles | you can only grant or revoke what you hold at that scope; the last owner can't be removed |
| GET / POST / PATCH | /roles, /roles/:roleId | employee.view / employee.roles_manage | templates are read-only; custom roles are anti-escalation checked |

## Stations & Live Floor (Phase 3)

See [08-stations-and-live-floor](08-stations-and-live-floor.md).

| Method | Path | Permission |
|---|---|---|
| POST / GET | /branches/:branchId/enrollment-tokens | station.manage |
| DELETE | /enrollment-tokens/:tokenId | station.manage over the code's branch |
| POST | /device/enroll | public (enrolment code + device public key) |
| WS | /device/ws | device proof-of-possession assertion |
| GET | /branches/:branchId/devices · /devices/:deviceId · /devices/:deviceId/commands | station.view |
| PATCH / DELETE | /devices/:deviceId | station.manage (DELETE = retire) |
| PUT | /zones/:zoneId/layout | station.manage |
| POST | /devices/:deviceId/commands | depends on the command type |
| POST | /zones/:zoneId/commands | station.mass_action plus the command type's permission |
| GET | /branches/:branchId/floor | station.view |
| GET (SSE) | /branches/:branchId/floor/events | station.view |
| POST | /alerts/:alertId/ack | station.view |

## Sessions, pricing & customers (Phase 4)

See [09-sessions-and-shell](09-sessions-and-shell.md). Money is returned as decimal strings in the branch currency.

| Method | Path | Permission |
|---|---|---|
| POST | /devices/:deviceId/sessions/quote | station.start_session |
| POST | /devices/:deviceId/sessions | station.start_session (+ pos.discount for a discount); `Idempotency-Key` |
| GET | /devices/:deviceId/session · /sessions/:sessionId | station.view |
| GET | /branches/:branchId/sessions?state=live\|recent | station.view |
| POST | /sessions/:sessionId/extend | station.extend_session; `Idempotency-Key` |
| POST | /sessions/:sessionId/end | station.end_session |
| POST | /sessions/:sessionId/move | station.move_session |
| GET | /pricing-plans | pricing.view |
| POST / PATCH | /pricing-plans · /pricing-plans/:planId · …/packages · …/packages/:packageId | pricing.manage over the plan's branch or zone |
| GET | /customers?q= · /customers/:customerId | customer.view (phone/email masked without customer.view_pii) |
| POST / PATCH | /customers · /customers/:customerId | customer.create / customer.edit |
| POST | /customers/:customerId/credentials | customer.reset_password |
| POST | /customers/:customerId/time | wallet.topup over the selling branch; `Idempotency-Key` |

Device WebSocket additions: `shell_login` / `shell_logout` → `shell_result`; `hello.activeSessionId`; `welcome.venue`.

**Demo customers** (seeded into Demo Arena): `ahmed` / `ahmed123` (PIN `1234`, 120 min prepaid) and `sara` / `sara1234`.

## Wallet, memberships & bookings (Phase 6)

See [11-customers-wallet-bookings](11-customers-wallet-bookings.md). Money payments accept `WALLET` wherever `CASH`/`CARD` are accepted.

| Method | Path | Permission |
|---|---|---|
| GET | /customers/:id/wallet | wallet.view_ledger |
| POST | /customers/:id/wallet/topup | wallet.topup (+ customer.adjust_wallet and a reason for a bonus) |
| POST | /customers/:id/wallet/adjust | customer.adjust_wallet + reason |
| POST | /customers/:id/wallet/freeze | customer.restrict + reason |
| GET · POST | /customers/:id/memberships | customer.view · membership.sell |
| POST | /customers/:id/memberships/:membershipId/cancel | membership.sell |
| GET · POST · PATCH | /membership-tiers · /membership-tiers/:tierId | membership.view · membership.manage |
| GET | /branches/:id/availability?zoneId&startsAt&minutes | booking.view |
| GET · POST | /branches/:id/bookings?date=YYYY-MM-DD\|upcoming=1 | booking.view · booking.create |
| GET | /bookings/:id | booking.view |
| POST | /bookings/:id/cancel · /no-show | booking.cancel |
| POST | /bookings/:id/check-in | booking.create + station.start_session |

**Customer app** (`/v1/app`, customer token):
- **Public:** `GET /:slug/venue`, `POST /:slug/register`, `POST /:slug/login`.
- **Signed in:** `/me`, `/logout`, `/wallet`, `/visits`, `/availability`, `/bookings` (list, create, `:id/cancel`), `/shop`, `/time`, `/memberships`.

## Loyalty, promotions, tournaments & CRM (Phase 10)

See [15-loyalty-promotions-tournaments-crm](15-loyalty-promotions-tournaments-crm.md). POS orders and session quote/start accept `promoCode`. Customer app registration accepts `referralCode`.

| Method | Path | Permission |
|---|---|---|
| GET | /promotions · /promotions/:id | promotion.view |
| POST · PATCH | /promotions · /promotions/:id | promotion.manage (sensitive) |
| POST | /promotions/:id/status · /promotions/:id/codes | promotion.manage (sensitive) |
| POST | /promotions/evaluate | promotion.view |
| GET · POST · PATCH | /loyalty/rules · /loyalty/rules/:id | loyalty.view · loyalty.manage |
| GET · POST · PATCH | /loyalty/rewards · /loyalty/rewards/:id | loyalty.view · loyalty.manage |
| GET | /customers/:id/loyalty | customer.view |
| POST | /customers/:id/loyalty/adjust | customer.adjust_points (sensitive) |
| POST | /customers/:id/loyalty/redeem | loyalty.redeem |
| GET | /tournaments · /tournaments/:id | tournament.view |
| POST | /tournaments · /tournaments/:id/status · /tournaments/:id/teams · /tournaments/:id/start | tournament.manage |
| PATCH | /tournaments/:id/seeds | tournament.manage |
| POST | /teams/:id/check-in · /teams/:id/withdraw | tournament.manage |
| POST | /matches/:id/result | tournament.score |
| POST | /matches/:id/stations | tournament.manage |
| GET | /segments · /segments/:id/members | crm.view |
| POST · PATCH | /segments · /segments/:id · POST /segments/:id/members | crm.campaign_send (sensitive) |
| POST | /segments/refresh | crm.view |
| GET · POST | /campaigns · /campaigns/:id · /campaigns/audience | crm.view |
| POST | /campaigns/:id/send · /campaigns/:id/cancel | crm.campaign_send (sensitive) |

**Customer app (`/v1/app/:venue`):** `GET /loyalty`, `POST /loyalty/redeem`, `GET /tournaments`, `GET /tournaments/:id`, `POST /tournaments/:id/register` (teammates by username, fee from the wallet), `GET /inbox`, `POST /inbox/:id/read`.

## Consoles, VR, station displays & printing (Phase 9)

See [14-consoles-vr-printing](14-consoles-vr-printing.md). Session start/quote accept `players` and `ageConfirmed`; pricing plans accept `includedPlayers` and `extraPlayerRate`.

| Method | Path | Permission |
|---|---|---|
| GET · POST | /branches/:id/stations | station.view · station.manage |
| PATCH | /devices/:id/station | station.manage |
| POST | /devices/:id/bridge | station.manage |
| POST | /devices/:id/power | station.shutdown |
| POST | /devices/:id/cleaned | station.start_session |
| GET · POST · PATCH | /devices/:id/accessories · /devices/:id/accessories/:accessoryId | station.view · station.manage |
| POST | /devices/:id/accessory-check | station.start_session |
| POST · DELETE | /devices/:id/display-pairing | station.manage |
| POST | /display/pair | public (one-time code, throttled) |
| GET | /display/state | public (display token) |
| GET | /branches/:id/print-jobs?open=1 | print.view |
| POST | /print-jobs/:id/release · /print-jobs/:id/cancel | print.release |
| GET · PUT | /branches/:id/print-settings | print.view · settings.manage |

**Device socket:** `print_job`, `print_confirm`, `print_cancel`, `print_done` → server replies `print_quote`, `print_status`; signed commands `PRINT_RELEASE`, `PRINT_CANCEL`, `POWER` (to the bridge).

## Inventory, purchasing & suppliers (Phase 8)

See [13-inventory-purchasing](13-inventory-purchasing.md). Warehouse endpoints are checked against the warehouse's branch (a central warehouse needs organization scope). Stock writes carry an `idempotencyKey`.

| Method | Path | Permission |
|---|---|---|
| GET · POST | /warehouses · PATCH /warehouses/:id | inventory.view · inventory.manage |
| GET | /inventory/overview?branchId | inventory.view |
| GET | /warehouses/:id/stock?q&category · /warehouses/:id/movements?itemId&type | inventory.view |
| GET · POST · PATCH | /inventory/items · /inventory/items/:id | inventory.view · inventory.manage |
| POST | /warehouses/:id/adjust (WASTE, ADJUSTMENT, ISSUE_TO_STATION) | inventory.adjust + reason |
| POST | /inventory/transfers | inventory.transfer (both stores) |
| POST | /warehouses/:id/counts | inventory.count |
| GET · PUT | /products/:id/recipe | restaurant.menu_manage |
| PUT | /modifiers/:id/stock | restaurant.menu_manage |
| GET | /menu/costing?branchId | restaurant.menu_manage |
| GET · POST · PATCH | /suppliers · /suppliers/:id | purchasing.view · purchasing.suppliers_manage |
| GET · POST | /purchase-orders?status&supplierId · /purchase-orders/:id | purchasing.view · purchasing.create |
| PATCH | /purchase-orders/:id (draft only) | purchasing.create |
| POST | /purchase-orders/:id/submit · /ordered · /cancel | purchasing.create |
| POST | /purchase-orders/:id/approve | purchasing.approve + reason (not the creator) |
| POST | /purchase-orders/:id/receive · /close | purchasing.receive |
| GET · POST | /warehouses/:id/reorder · /purchasing/reorder | purchasing.view · purchasing.create |
| GET · POST | /supplier-invoices?status&supplierId | purchasing.view · purchasing.suppliers_manage |
| POST | /supplier-invoices/:id/pay · /supplier-invoices/:id/status | purchasing.suppliers_manage |

## POS, restaurant, kitchen & shifts (Phase 7)

See [12-pos-restaurant-kitchen](12-pos-restaurant-kitchen.md). Orders and payments carry an `idempotencyKey`.

| Method | Path | Permission |
|---|---|---|
| GET | /branches/:id/menu | pos.sell |
| GET | /menu/manage | restaurant.menu_manage |
| POST · PATCH | /product-categories · /product-categories/:id | restaurant.menu_manage |
| POST · PATCH | /products · /products/:id | restaurant.menu_manage |
| PUT | /products/:id/branches/:branchId | restaurant.menu_manage (sold-out only: kds.bump) |
| POST | /modifier-groups | restaurant.menu_manage |
| POST | /branches/:id/kitchen-stations | restaurant.menu_manage |
| POST | /branches/:id/orders | pos.sell (+ restaurant.order for DINE_IN, pos.discount for a discount) |
| GET | /branches/:id/orders?open=1 · /orders/:id | pos.sell |
| POST | /orders/:id/cancel | restaurant.cancel_order + reason |
| POST | /order-items/:id/void | pos.void_item (+ restaurant.cancel_order + reason once cooked) |
| GET | /branches/:id/bills?open=1 · /bills/:id | pos.sell |
| POST | /bills/:id/pay | pos.sell (cash needs an open shift) |
| POST | /payments/:id/refund | pos.refund + reason |
| GET | /branches/:id/kitchen?stationId | kds.view |
| GET (SSE) | /branches/:id/kitchen/events | kds.view |
| POST | /kitchen-tickets/:id/bump | kds.bump |
| GET · POST | /branches/:id/tables | restaurant.order · restaurant.tables_manage |
| POST | /tables/:id/status | restaurant.order (OUT_OF_SERVICE: restaurant.tables_manage) |
| GET · POST | /branches/:id/cash-drawers | shift.open · settings.manage |
| GET | /branches/:id/shifts/me | shift.open |
| POST | /branches/:id/shifts | shift.open |
| GET | /branches/:id/shifts · /shifts/:id | shift.view_all (own shift: shift.open) |
| POST | /shifts/:id/movements | shift.cash_movement |
| POST | /shifts/:id/close | shift.open (someone else's: shift.approve) |
| POST | /shifts/:id/approve | shift.approve (not your own) |

**Device socket:** `menu_request` → `menu`; `place_order` → `order_result`; server push `order_status`.

## Games & station tools (Phase 5)

See [10-games-and-station-tools](10-games-and-station-tools.md).

| Method | Path | Permission |
|---|---|---|
| GET | /games?branchId= | game.view (install counts per branch) |
| POST · PATCH | /games · /games/:gameId | game.manage (org). Custom games only; the platform catalog is read-only |
| PUT | /games/:gameId/settings | game.manage: enabled, featured, sort order, min-age override, allowed zones |
| GET | /games/:gameId/installations?branchId= | game.view |
| GET | /launchers · /shell-apps · /peripheral-presets | game.view |
| POST · PATCH | /shell-apps · /shell-apps/:appId | game.manage |
| POST | /peripheral-presets | shell.configure |
| POST | /branches/:branchId/game-scan | game.update |
| GET · POST | /branches/:branchId/game-updates | game.view · game.update |
| POST | /game-updates/:jobId/cancel | game.update over the job's branch |
| GET | /devices/:deviceId/tools | station.view: playing, network, boot, games, peripherals |
| PUT | /branches/:branchId/connectivity-targets | settings.manage |
| GET · POST | /branches/:branchId/diskless | diskless.view · diskless.manage |
| PATCH | /diskless/:integrationId | diskless.manage |

**Commands:**
- `RUN_REPAIR {action}` needs station.restart and takes allow-listed actions only.
- `SCAN_GAMES` needs game.update.
- `UPDATE_GAME` is issued only by the update orchestrator.

## Tests (`apps/api/test/api.e2e.test.ts`, real Postgres)

18 scenarios:
- **Authentication:** same error for a wrong password and an unknown email; lockout; forged token; refresh rotation and replay kill; logout kill; TOTP enrol, verify and replay block.
- **Tenant isolation over HTTP:** list, read, update and create-under are all 404 for another org.
- **RBAC:** branch scoping; reasons; anti-escalation; last-owner protection; plan limits.
- **Audit:** a row is written in the same transaction as the change, and a failed request leaves no data and no audit row.
