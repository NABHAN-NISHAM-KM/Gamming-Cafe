# 22 · Operations & growth

Waitlist, rota, insights, paying for ArenaOS, support sign-in, client releases, announcements, venue health, season passes, "find a team", card top-ups, spending limits and guardians, receipts, table QR ordering, "running late", the minors' curfew, and the Shell's newer touches. Migration `0027_ops_growth`.

## Venue admin

### Waitlist (`/waitlist`)

When the floor is full, staff add a name (and an optional phone number, party size and zone); app users join from their phone. Every 30 seconds, and straight after any change, the server looks for free stations: idle, enabled, not booked in the next hour, and in the zone asked for. A group needs that many free stations in one zone. The first in line is **offered** a station for 10 minutes: staff get a pop-up ("Call Wally — PC-07 is free"), and an app user gets a push. An offer nobody claims lapses, and the next person is offered. Someone who starts playing at the branch is marked **seated** automatically; staff can also mark someone seated or remove them.

| Method | Path | Permission |
|---|---|---|
| GET | /branches/:branchId/waitlist | booking.view |
| POST | /branches/:branchId/waitlist | booking.create |
| POST | /branches/:branchId/waitlist/:entryId/seat · /cancel | booking.create |

One place in line per app customer per branch (a partial unique index). Cross-venue work uses `app.waitlist_orgs()` (SECURITY DEFINER), which lists only the organizations that have someone waiting.

### Rota (`/rota`)

Shifts are planned per person for a week; **Copy last week** copies the previous week's shifts, skipping any that would overlap. Once a shift starts, it is compared with the first clock-in between two hours before it starts and its end:

- **on time** — clocked in at most 5 minutes late
- **late** — later than that, with the minutes shown
- **no-show** — the shift started and nobody clocked in

A person's shifts can't overlap (exclusion constraint); a shift is at most 16 hours long. Reading needs `employee.view`; planning needs `employee.manage`.

### Insights (`/insights`)

- **Expected busy hours** (`reports.operational`): for each hour of the next 7 days, the average number of stations in use at that weekday and hour over the last 8 weeks, plus bookings already made, as a share of the branch's stations. Each day shows its peak hour and its quiet hours.
- **Worth a look** (`reports.financial`), over 7 or 30 days:
  - a cashier with 3 or more refunds or voided items, and at least 3× the median of the other staff;
  - a closed till more than 5 short or over (ponytail: a fixed tolerance in any currency);
  - a station that went offline 5 or more times.
- **Station health** (`station.view`): each PC's last 24 hours (hottest CPU/GPU, disk, ping, packet loss) and its drop-offs this week. **Needs attention** flags ≥ 85 °C, disk ≥ 90 %, 3 or more drop-offs, packet loss ≥ 2 %, or no readings for 10 minutes while online.

| Method | Path |
|---|---|
| GET | /branches/:branchId/forecast · /anomalies?days= · /station-health |
| POST | /pricing-plans/:planId/preview `{ rate, days }` (pricing.manage) |

**Price preview** (Rates → edit a rate): what the sessions billed on that rate in the last week would have earned at the new price. Per-hour and per-minute rates scale with the price; flat passes are re-priced per session; package sessions are left out. It assumes the same players would have played as long.

### Receipts and table QR codes

- **Full receipt** (Orders → an order → **Full receipt**, `/receipt?bill=…`): the venue's legal name and tax number, every line, tax, payments and gaming time, as an A4 page to print. API `GET /bills/:billId/receipt` (pos.sell, scoped to the bill's branch).
- **Table QR codes** (Restaurant → Tables → **Print QR codes**, `/table-qr?branch=…`): one card per table. Scanning one opens the customer app's menu for that table, and orders go on the table's bill (`DINE_IN`). API `GET /branches/:branchId/table-qr` (restaurant.tables_manage).

### Season passes (Marketing → Loyalty → Season passes)

A season has a name, dates, a price (0 = free) and levels: `{ xp, reward: POINTS | MINUTES | BONUS, amount }`. Each level needs more XP than the one before. Players earn **1 XP per minute played** and **100 XP per challenge** finished during the season, and claim each level in the app. Rewards are points, free minutes (saved time) or bonus money that expires after 30 days. A paid pass is a normal sale paid from the wallet (system product `SYS-SEASON-PASS`), so the books and the wallets agree. A season people joined is switched off, not deleted. API: `GET/POST /seasons`, `PATCH/DELETE /seasons/:id` (loyalty.view / loyalty.manage).

### Game news

Games → a game's row → a news line (up to 140 characters, e.g. "New season out now"). It shows on that game's tile on every PC for 30 days; clearing it removes it. Sent through `PUT /games/:id/settings` with `news`.

### Billing (`/billing`, org.billing)

The plan, what the venue uses against its limits, invoices, and the plans on offer.

- **Choosing a plan** — a trial converting, or a switch — opens an invoice for its first period and sends the owner to a card checkout page. **Pay by card** does the same for an open renewal invoice.
- When the platform's webhook confirms payment, the invoice is paid, the subscription runs on the chosen plan through the paid period, and a trial or overdue venue becomes active.
- Without `BILLING_STRIPE_SECRET_KEY`, the buttons become **Ask for …**, which files an upgrade request.
- **Need more?** files an upgrade request with a note (a Lead of kind `UPGRADE` for the sales team, through `app.request_upgrade()`).

The tenant API can only read subscriptions and invoices. Two SECURITY DEFINER functions, always for the caller's own organization, do the writing: `app.billing_open_invoice(plan)` (voids any other open invoice) and `app.billing_checkout_ref(invoice, ref)`.

| Method | Path |
|---|---|
| GET | /organization/usage (any staff) · /billing |
| POST | /organization/upgrade-request · /billing/plan `{ planId }` · /billing/invoices/:id/pay |

### Settings

- **Card top-ups in the app** — the venue's own Stripe account. Secrets are never stored: the gateway row names where they are, `env:STRIPE_SECRET_KEY` and `env:STRIPE_WEBHOOK_SECRET` (any names), and the server reads those environment variables. The card shows whether each was found. In Stripe, send `checkout.session.completed` to `/v1/app/<venue code>/stripe-webhook`. Reading needs `org.manage`; saving needs `payment.gateway_manage`, which asks for a reason.
- **Night curfew for young players** — e.g. under 18, 22:00–07:00 in the branch's time zone (`settings.minorCurfew`). See [the Shell](#gaming-shell).

### Banners above every page

- ArenaOS support signed in as the venue, with **End support session**.
- An overdue ArenaOS invoice.
- The plan's limit reached, or over 80 % used (owners and billing staff).
- Platform announcements, until each person dismisses them.

## Super Admin

| Page | What it does |
|---|---|
| Organizations → a venue → **Sign in as venue** | 15, 30 or 60 minutes as the venue's first active owner, with a reason recorded in the venue's audit log. Read-only unless a super admin ticks **Allow changes**. The console swaps in that venue session in the same browser (no refresh token: it simply runs out). The API checks the support session on every request and refuses changes when it's read-only (`IMPERSONATION_BLOCKED`). Ending it revokes the session immediately. |
| Organizations → a venue → **Invoices** | Every invoice; **Mark paid** (a bank transfer) or **Void** (billing roles). |
| **Venue health** | Per venue: stations online, sessions this week, last session, drop-offs, open alerts. Flags trials with no PCs, no stations online, no sessions this week, 20+ drop-offs, payment overdue. |
| **Releases** | Add a build (component, version, URL, SHA-256, signature, notes, first rollout %); publish, change the share (0–100 %), pause / resume, revoke. |
| **Announcements** | Title, message, info or warning, optional end; how many people and venues have seen it; **End now**. |
| **Leads** | Notes for the team and a next follow-up date on each lead. **To do today** shows follow-ups that are due and calls in the next 24 hours. Upgrade requests from venues appear as kind *Upgrade*. |

**Release rollout.** `GET /v1/public/releases/check?component&version&deviceId[&channel]` returns the newest published, unpaused, unrevoked build newer than the station's that the station is inside the rollout for. A station's bucket is a stable hash of release and device into 0–99, so raising the share only ever adds stations. ponytail: the Windows agent doesn't call this yet — updates still go out the existing way.

**The billing clock** (hourly in the platform service; `BILLING_SWEEP=off` turns it off):

- an active subscription ending within 7 days gets its renewal invoice;
- an open invoice past due makes the subscription and the venue `PAST_DUE`.

Suspending a venue stays a person's decision. `POST /v1/platform/billing/sweep` runs it on demand.

| Method | Path | Roles |
|---|---|---|
| POST | /organizations/:id/impersonate · /impersonation/:id/end | SUPER_ADMIN, PLATFORM_SUPPORT (changes: SUPER_ADMIN) |
| GET | /organizations/:id/impersonations · /organizations/:id/invoices · /releases · /announcements · /health | any platform role |
| PATCH | /invoices/:id `{ status: PAID \| VOID }` · POST /billing/sweep | SUPER_ADMIN, PLATFORM_BILLING |
| POST / PATCH | /releases · /releases/:id | SUPER_ADMIN |
| POST | /announcements · /announcements/:id/end | SUPER_ADMIN, PLATFORM_SUPPORT |
| PATCH | /leads/:id `{ status, staffNotes, nextActionAt }` | SUPER_ADMIN, PLATFORM_SUPPORT, PLATFORM_BILLING |
| POST | /v1/public/billing/stripe-webhook | public, signed |

## Customer app

| Where | What |
|---|---|
| Home | **Everything's busy** → join the waitlist (area, people); then "You're number 3 in line", and "PC-07 is free for you! Claim it by 20:40" when offered. **Leave** any time. |
| Home → **Season pass** | Join (free, or paid from the wallet), XP and the next reward, claim each level. |
| Home → **Find a team** | Post a game, how many players, when and a note (at most 3 open posts); others join; the host gets a push for each join and when the team is full. |
| Wallet → Top up | With the venue's gateway on: pay on a secure card page, come back, and the wallet is credited once the webhook confirms it (once, however often it's sent). Otherwise the demo card or "at the counter", as before. |
| Bookings | **Directions** opens maps for the branch. **Running late** (from an hour before until 15 minutes after the start) holds the station until 30 minutes after the start, once. |
| Me → **Spending limit** | A weekly limit on wallet spending (rolling 7 days, every way the wallet is spent). A child shows a 6-digit code (15 minutes); the parent enters it with the child's username, then sets a limit the child can't lift, or unlinks. |
| Me → **Receipts** | Every paid bill, opened as a receipt to save or print. |
| A table's QR code | `?table=<id>`: that table's menu; pay on the table's bill or from the wallet. |

| Method | Path |
|---|---|
| GET / POST / DELETE | /app/waitlist |
| GET / POST | /app/lfg · POST /app/lfg/:id/join · /leave · /close |
| GET | /app/seasons · POST /app/seasons/:id/join · /claim/:level |
| GET | /app/me/bills · /app/me/bills/:billId |
| GET / PUT | /app/me/spending · POST /app/me/guardian-code · POST /app/me/wards · PUT /app/me/wards/:id/spending · DELETE /app/me/wards/:id |
| GET / POST | /app/tables/:tableId · /app/tables/:tableId/orders |
| GET | /app/wallet/card · POST /app/wallet/checkout · POST /app/:slug/stripe-webhook (public, signed) |
| POST / GET | /app/bookings/:id/late · /app/bookings/:id/directions |

## Gaming Shell

- **Curfew for minors.** With a curfew set, a player younger than its age can't sign in during it ("Players under 18 can't play between 22:00 and 07:00"). Time sold to them stops when it starts, the same way a daily play limit does (`curfew_soon`). Age comes from the birth date on the account; a player without one isn't treated as a minor. Age-rated games were already hidden.
- **Call staff** takes an optional note, and shows the request's status: *Staff have your request* → *Someone is on the way* → *Sorted*.
- **End of session**: the log-out confirmation and the thank-you card show what was played and how many points to the next reward.
- **Game news** from the venue shows on game tiles (player action `news`).
- **Tournament check-in**: when check-in is open for a tournament the player is in, the home widget has **Check in**, then shows their next match and stations (`tournament_checkin`).
- **Ten minutes left**: a card with the best-value package for their rate (lowest price per minute) and any offer running now that needs no code, with **Add time**. Once per session and per extension.
- **Settings → Text size** (normal, large, larger) and **High contrast**, kept on the player's account and reset for the next player.

The Windows agent's list of allowed player actions includes `news` and `tournament_checkin`.

## Settings

| Variable | Used by | What for |
|---|---|---|
| `BILLING_STRIPE_SECRET_KEY` | API | Venues paying their ArenaOS plan by card |
| `BILLING_STRIPE_WEBHOOK_SECRET` | platform | Verifying "invoice paid" webhooks |
| `BILLING_SWEEP` | platform | `off` stops the hourly renewal and overdue checks |
| `ADMIN_URL` | API | Where card payments return the owner |
| any names a venue chooses | API | That venue's Stripe secret key and webhook secret for top-ups |
| `STRIPE_API_BASE` | API, tests | Points the Stripe client at a stand-in |
| `WAITLIST_SWEEP_MS` | API | How often the waitlist is checked (default 30 s) |

## Tests

`apps/api/test/ops-growth.e2e.test.ts` runs against real Postgres, both services, a simulated agent and a local stand-in for Stripe. It covers:

- **Waitlist:** an offer, a lapsed offer passing to the next person, one place in line per customer.
- **Rota:** overlaps refused, and only managers can plan.
- **Insights:** forecast, anomalies, station health and the price preview.
- **Account:** usage, an upgrade request becoming a lead, announcements read and ended.
- **Billing:** a card checkout and the signed webhook activating the plan.
- **Support sign-in:** read-only, then refused once ended.
- **Releases:** publish, pause and rollout share.
- **Season pass:** joining, and the spending limit blocking it.
- **Guardians:** linking with a code, and a limit the child can't lift.
- **Find a team.**
- **Card top-up:** credited once even when the webhook is replayed; receipts; table menu.
- **Running late.**
- **Curfew:** a session refused.

Unit checks cover the curfew window, version comparison and rollout buckets.
