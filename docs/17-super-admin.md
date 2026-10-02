# 17 · Super Admin (platform)

The Super Admin area is where ArenaOS operators run the platform itself: every organization, its subscription and modules, the plans, and a platform-wide audit trail. It is separate from the venue admin console in every layer.

| | Venue admin console | Super Admin |
|---|---|---|
| Sign-in page | `http://localhost:3000/login` (shared) | `http://localhost:3000/login` (shared) → lands in `/platform` |
| Backend | Tenant API, port 4000 | Platform service, port 4100 (`apps/api/src/platform`) |
| Database login | `arena_api` (RLS enforced) | `arena_platform_svc` (BYPASSRLS) — the tenant API never holds it |
| Token audience | `arena:staff` | `arena:platform` (10-minute access, 12-hour session) |
| Who | `Employee` of an organization | `User` with a `PlatformRoleAssignment` |
| Two-step sign-in | Optional (per user) | **Mandatory** — enrolment is forced on first sign-in |
| Browser cookies | `arena_at` / `arena_rt` | `arena_pat` / `arena_prt`, scoped to `/api/platform` |

**One sign-in page.** Everyone uses `/login`. The page tries the staff sign-in first; if the password is right but the account belongs to no organization, it continues with the platform's two-step step and opens `/platform`. A wrong password is rejected by the first check, so it is never counted twice toward lockout. `/login?next=/platform` (or the old `/platform/login` link) tries the platform first, which is how someone who is both venue staff and a Super Admin reaches the platform.

A staff token is refused by the platform service and a platform token is refused by the tenant API, so the two sessions never mix even in one browser.

## Running it

```bash
npm run dev -w @arena/api            # tenant API        http://localhost:4000
npm run dev:platform -w @arena/api   # platform service  http://localhost:4100
npm run dev -w @arena/admin          # both consoles     http://localhost:3000
```

The seed creates one Super Admin: **super@arenaos.test**, password `ArenaDemo!2026`, signing in at `/login`. On the first sign-in the page shows a QR code: scan it with an authenticator app (Google Authenticator, 1Password, Authy…) and enter the 6-digit code. After that, every sign-in asks for a code.

Lost the authenticator in development? Remove the factor and sign in again to re-enrol:

```sql
DELETE FROM "MfaFactor" WHERE "userId" = (SELECT id FROM "User" WHERE email = 'super@arenaos.test');
```

## Roles

Roles are granted in the database (`PlatformRoleAssignment`), never from the UI, and are re-read on every request, so revoking one takes effect immediately.

| Role | Can |
|---|---|
| `SUPER_ADMIN` | Everything: create and cancel organizations, subscriptions, plan prices and modules, per-organization module overrides |
| `PLATFORM_SUPPORT` | Read everything; suspend and reactivate organizations |
| `PLATFORM_BILLING` | Read everything; change subscriptions and plans |
| `PLATFORM_READONLY` | Read everything |

## What it does

- **Overview:** organizations by status, monthly recurring revenue (paying subscriptions), stations online, customers and staff, sign-ups per month, plan mix, recent platform actions.
- **Organizations:** search and filter; create an organization with its owner (a temporary password is shown once; the owner must set up two-step sign-in); detail with branches, owners, counts; suspend (signs out every staff member immediately and blocks sign-in), reactivate, cancel; change plan, status and limits; extend the billing period; turn modules on or off for one organization with a reason.
- **Plans & features:** edit price and limits; switch modules per plan.
- **Audit log:** every platform action is written to the hash-chained `AuditLog` (actor type `PLATFORM_ADMIN`), including sign-ins. Organization-scoped actions go into that organization's chain.
- **Platform admins:** who has which role, whether two-step sign-in is on, last sign-in.
- **Leads:** walkthrough requests, booked calls and free trials from the website, with type and status filters and a link to a trial's organization. Move each through New → Contacted → Won / Lost (audited). See [21 · Website](21-website.md); trials are opened by the same code as **New organization**.

## API

All routes are under `http://localhost:4100/v1/platform`. Authenticated routes need `Authorization: Bearer <platform access token>`.

| Method | Path | Roles |
|---|---|---|
| POST | /auth/login · /auth/mfa/verify · /auth/refresh · /auth/logout | public |
| GET | /auth/me · /overview · /organizations · /organizations/:id · /plans · /audit · /admins · /leads | any platform role |
| PATCH | /leads/:id | SUPER_ADMIN, PLATFORM_SUPPORT, PLATFORM_BILLING |
| POST | /organizations | SUPER_ADMIN |
| PATCH | /organizations/:id/status | SUPER_ADMIN, PLATFORM_SUPPORT (cancel: SUPER_ADMIN) |
| PATCH | /organizations/:id/subscription · /plans/:id | SUPER_ADMIN, PLATFORM_BILLING |
| PUT · DELETE | /organizations/:id/features/:key | SUPER_ADMIN |
| PUT | /plans/:id/features/:key | SUPER_ADMIN |

The website's public routes (`/v1/public/leads`, `/demo-slots`, `/demo`, `/trial`, `/releases`) are in [21](21-website.md).

Tests: `apps/api/test/platform.e2e.test.ts` (enrolment, code replay, token isolation both ways, read-only role, organization lifecycle and audit, refresh-token reuse, logout).
