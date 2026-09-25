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

## Tests (`apps/api/test/api.e2e.test.ts`, real Postgres)

18 scenarios:
- **Authentication:** same error for a wrong password and an unknown email; lockout; forged token; refresh rotation and replay kill; logout kill; TOTP enrol, verify and replay block.
- **Tenant isolation over HTTP:** list, read, update and create-under are all 404 for another org.
- **RBAC:** branch scoping; reasons; anti-escalation; last-owner protection; plan limits.
- **Audit:** a row is written in the same transaction as the change, and a failed request leaves no data and no audit row.
