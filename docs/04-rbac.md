# 04 · RBAC

Authorization combines **permission**, **scope** and **feature flag**, and is always decided **server-side**. The code is in `packages/rbac`:
- `permissions.ts` is the catalog and the single source of truth.
- `roles.ts` holds the 14 org role templates.
- `evaluate.ts` holds `authorize()`.

## Model

```
Permission (key "module.action", sensitive?)  ← code catalog, synced to DB on deploy
Role (org-owned, or platform template with organizationId = NULL)
  └─ RolePermission
EmployeeRoleAssignment (employee, role, scope = ORGANIZATION | BRAND | BRANCH, expiresAt?)
PlatformRoleAssignment (User → SUPER_ADMIN | PLATFORM_SUPPORT | PLATFORM_BILLING | PLATFORM_READONLY)
```

- One employee can hold several roles at different scopes, for example Cashier @ DXB1 plus Gaming Manager @ brand "Arena VIP".
- A database CHECK enforces the scope shape (brand/branch ids match the scope type). An `EXCLUDE` constraint prevents duplicate assignments.
- **Platform Super Admin is not an org role.** It uses a separate guard, and it can act inside a tenant only through audited impersonation (see [05-multi-tenancy](05-multi-tenancy.md)).

## Decision order — `authorize(principal, permission, target, {reason})`

1. **Tenant:** `target.organizationId ≠ principal.organizationId` → `WRONG_TENANT`. This applies even to owners.
2. **Feature:** the module's feature flag must be enabled for the org's plan or override, otherwise `FEATURE_DISABLED`. For example, `restaurant.*` requires `RESTAURANT`.
3. **Impersonation:** money-moving and privilege-granting actions are refused while impersonating (`IMPERSONATION_BLOCKED`).
4. **Grant and scope:** a non-expired grant must contain the permission (else `NOT_GRANTED`) and cover the target:
   - ORG covers everything;
   - BRAND covers that brand's branches;
   - BRANCH covers only that branch, never org-level resources (else `OUT_OF_SCOPE`).
5. **Sensitive actions** (33 of 111) require a written reason (else `REASON_REQUIRED`). The reason is stored in `AuditLog.reason`.

## Enforcement points (Phase 2+)

- **HTTP:** `@RequirePermission('pos.refund')` guard. The target branch is resolved **from the entity being touched** (loaded under RLS), never from the request body.
- **WebSocket:** joining a room calls the same `authorize()`.
- **Device maintenance mode:** the agent sends the PIN/RFID to the server, which checks `station.maintenance` and `shell.tools` and returns a short-lived signed grant listing the tools that may be unlocked.
- **List endpoints:** `branchesWith()` gives the branch ids to filter by. `null` means all branches.
- **Every allowed sensitive action and every denied attempt** is written to `AuditLog`.

## Spec examples → keys

`station.start_session · station.end_session · station.remote_control · station.maintenance · station.shutdown · customer.view · customer.edit · customer.adjust_wallet · pos.sell · pos.refund · pos.discount · restaurant.cancel_order · inventory.adjust · reports.financial · shell.disable`. All are present, and `rbac.test.ts` asserts it.

## Role templates × modules

Generated with `npm run docs:matrix -w @arena/rbac`.

| Module (perms) | org owner | org admin | branch manager | gaming manager | system admin | cashier | receptionist | restaurant manager | waiter | kitchen staff | inventory manager | accountant | technician | tournament manager |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| org (3) | ● | ● | · | · | · | · | · | · | · | · | · | ◐ | · | · |
| branch (2) | ● | ● | ◐ | · | ◐ | · | · | · | · | · | ◐ | ◐ | · | · |
| zone (2) | ● | ● | ● | ◐ | ● | ◐ | ◐ | · | ◐ | · | · | · | ◐ | ◐ |
| station (18) | ● | ● | ◐ | ◐ | ◐ | ◐ | ◐ | · | ◐ | · | · | · | ◐ | ◐ |
| shell (3) | ● | ◐ | ◐ | ◐ | ● | · | · | · | · | · | · | · | · | · |
| diskless (2) | ● | ● | ◐ | · | ● | · | · | · | · | · | · | · | ◐ | · |
| game (5) | ● | ● | ● | ● | ● | ◐ | · | · | · | · | · | · | ◐ | ◐ |
| pricing (2) | ● | ● | ◐ | ◐ | · | ◐ | · | · | · | · | · | · | · | · |
| customer (10) | ● | ◐ | ◐ | ◐ | · | ◐ | ◐ | ◐ | ◐ | · | · | · | · | ◐ |
| wallet (2) | ● | ● | ● | ● | · | ● | · | · | · | · | · | ◐ | · | · |
| membership (3) | ● | ● | ● | ◐ | · | ◐ | ◐ | · | · | · | · | · | · | · |
| booking (4) | ● | ● | ● | ● | · | ◐ | ◐ | · | · | · | · | · | · | ◐ |
| pos (8) | ● | ● | ● | ◐ | · | ◐ | · | ◐ | ◐ | · | · | · | · | · |
| shift (4) | ● | ● | ● | ◐ | · | ◐ | · | ● | · | · | · | ◐ | · | · |
| restaurant (4) | ● | ● | ● | · | · | ◐ | · | ● | ◐ | · | · | · | · | · |
| kds (2) | ● | ● | ● | · | · | ◐ | · | ● | ◐ | ● | · | · | · | · |
| inventory (5) | ● | ● | ● | · | · | · | · | ● | · | ◐ | ● | ◐ | ◐ | · |
| purchasing (5) | ● | ● | ● | · | · | · | · | ◐ | · | · | ● | ◐ | · | · |
| employee (4) | ● | ● | ◐ | · | · | · | · | · | · | · | · | · | · | · |
| tournament (3) | ● | ● | ● | ● | · | ◐ | ◐ | · | · | · | · | · | · | ● |
| loyalty (3) | ● | ● | ● | · | · | ◐ | · | · | · | · | · | · | · | · |
| promotion (2) | ● | ● | ◐ | · | · | · | · | ◐ | · | · | · | · | · | · |
| crm (2) | ● | ● | ◐ | · | · | · | · | · | · | · | · | · | · | · |
| reports (4) | ● | ● | ● | ◐ | · | · | · | ◐ | · | · | ◐ | ● | · | · |
| accounting (3) | ● | ● | ◐ | · | · | · | · | · | · | · | · | ● | · | · |
| payment (1) | ● | · | · | · | · | · | · | · | · | · | · | · | · | · |
| notification (1) | ● | ● | · | · | ● | · | · | · | · | · | · | · | · | · |
| integration (1) | ● | · | · | · | ● | · | · | · | · | · | · | · | · | · |
| audit (1) | ● | ● | ● | · | ● | · | · | · | · | · | · | ● | · | · |
| support (1) | ● | ● | ● | ● | ● | ● | ● | · | · | · | · | · | ● | · |
| settings (1) | ● | ● | ● | · | · | · | · | · | · | · | · | · | · | · |

● all · ◐ some · `·` none — 111 permissions, 33 sensitive.

**Separation of duties** (asserted in tests):
- Technician, System Admin, Kitchen and Waiter can't touch wallets or refunds.
- A cashier can't refund; that needs a manager.
- Org Admin can't change payment gateways, API keys, customer erasure, or disable the shell. Only the Owner can.
