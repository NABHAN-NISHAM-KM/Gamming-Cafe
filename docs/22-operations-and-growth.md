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

### Gift cards (`/gift-cards`, migration `0031_gift_cards`)

Sell a prepaid code at the counter (cash or card); the player types it into the app (**Wallet → Redeem a gift card**) and the money lands in their wallet as cash.

- The code (16 characters, no 0/O/1/I/L) is shown **once**, at the sale: copy or print it. Only its SHA-256 is stored, so a lost code can't be looked up; the list shows each card by its last four characters.
- The sale is a bill with a `GIFT_CARD` line: no tax, and booked as *Gift cards outstanding* (a liability), not revenue. Redeeming moves it to *Customer wallets*. Reconciliation has a new check: the ledger's gift-card liability equals the unused cards.
- A card redeems once (an atomic claim plus a database check). A wrong, used or already-claimed code gives the same answer, and wrong guesses are throttled per customer (6 per 15 minutes).
- Sell: `wallet.topup` at the branch. List: `wallet.view_ledger`.
- Not built: voiding or refunding a sold card, expiry. Both need a refund path through the books first.

| Method | Path |
|---|---|
| POST | /gift-cards `{ branchId, amount, payment: { method: CASH \| CARD }, customerId?, idempotencyKey }` |
| GET | /gift-cards?status=&hint= |
| POST | /app/wallet/gift-card `{ code }` |

### Webhooks (`/integrations`, migration `0032_webhooks`)

Needs the **Public API & webhooks** plan feature (`PUBLIC_API`) and `integration.manage` (sensitive: asks for a reason). ArenaOS calls the venue's own HTTPS address when something happens.

- **What is sent.** Whatever the audit trail records, restricted to business families: `booking`, `customer`, `giftcard`, `loyalty`, `membership`, `order`, `payment`, `season`, `session`, `shift`, `station`, `stock`, `ticket`, `tournament`, `waitlist`, `wallet`. Staff, roles, billing and platform events never leave. Subscribe to `*`, a family (`booking.*`) or one action (`giftcard.sell`). A new endpoint hears only what happens after it was added.
- **The call.** `POST` with a JSON body `{ id, type, organizationId, createdAt, actor, entity, branchId, data }` (`data` is the audit entry's `after`) and the headers `Arena-Event`, `Arena-Delivery` (the event id, for de-duplicating) and `Arena-Signature: t=<unix seconds>,v1=<hex>`. The signature is `HMAC-SHA256(secret, "<t>.<raw body>")`; check it, and refuse a `t` that is old.
- **Secret.** `whsec_…`, shown once when the webhook is added or the secret is renewed, kept sealed with the server key.
- **Delivery.** At least once. A non-2xx answer or no answer within 5 seconds is retried after 1 min, 5 min, 30 min, 2 h and 12 h, then marked failed (**Try again** queues it afresh). 20 failures in a row switch the endpoint off, with the reason on the page. **Send test** sends a `webhook.test` event.
- **Safety.** HTTPS only; no addresses with a user name or password; the connection is refused if the name points at this machine, a private or link-local network (checked when connecting, so a name that changes later is still caught); redirects aren't followed. `WEBHOOK_ALLOW_PRIVATE=1` lifts this for tests only.
- Not built: API keys for reading data (they need their own sign-in path and a way to limit what a key can see).

| Method | Path |
|---|---|
| GET / POST | /webhooks (list with recent deliveries / add: `{ url, events, description? }`) |
| PUT / DELETE | /webhooks/:id (`{ events?, description?, isActive? }`) |
| POST | /webhooks/:id/rotate-secret · /webhooks/:id/test · /webhooks/deliveries/:deliveryId/retry |

Settings: `WEBHOOK_SWEEP_MS` (how often the worker looks, default 10 000).

### Settings from the console, mail and payment keys (migration `0033_platform_settings`)

**Super Admin → Settings** (Super Admin only) holds what used to live in a server file:

| Group | Settings | Applies |
|---|---|---|
| Mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `LEADS_NOTIFY_EMAIL` | within seconds |
| Payments | `BILLING_STRIPE_SECRET_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET`, `DEMO_PAYMENTS` | within seconds |
| Addresses | `ADMIN_URL`, `CUSTOMER_APP_URL`, `WEBSITE_URL` | within seconds |
| Phone notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | after a restart |
| Sales | `LEADS_WEBHOOK_URL`, `SALES_TIMEZONE`, `TRIAL_PLAN_CODE` | within seconds |

- A saved value wins over the server's environment; removing it (the bin button) brings the environment's value back. The page says for each setting whether it is *saved here*, *from the server* or *not set*.
- Secrets are sealed with the server key and **never sent back**: the page only learns whether one is set. The audit log records which settings changed, never their values.
- Both services read the table (the tenant API only reads it) and overlay it onto their config object, so everything that reads the config sees a change without a restart. The tenant API checks every 30 seconds (`SETTINGS_REFRESH_MS`); the platform service applies a save at once.
- **Stays on the server:** database logins, `REDIS_URL`, the signing and encryption keys, ports and CORS. They are needed before a service can read any setting, or decide who can sign in. The page lists them with the reason.
- Every value is checked before anything is saved (an invalid one saves nothing). `PUT /v1/platform/settings { values: { KEY: "value" | null } }`, `GET /v1/platform/settings`, `POST /v1/platform/settings/test-mail { to? }` (no address: only connects and signs in).

**Mail.** `MailService` (nodemailer) sends through the saved SMTP server and never throws; a failed send is reported to the caller. Used for:

- **Password-reset codes.** On the customer app's *Forgot password* screen, **E-mail me a code** (`POST /v1/app/:slug/forgot { username }`) sends a 6-digit code, valid 15 minutes, to the address on the account. The answer is always 204, so it can't be used to find out who has an account; at most 3 codes per account per 15 minutes. Staff can still hand out codes at the counter.
- **New leads**, to `LEADS_NOTIFY_EMAIL`.

**Venue card payments** (venue Settings → *Card top-ups in the app*): the owner pastes their own Stripe secret key and webhook signing secret. They are stored sealed (`v1.…`) in the gateway row and are never shown again; leaving a field blank keeps the saved one. A live key with test mode on (or the reverse) is refused. Pointing at the server's environment (`env:NAME`) still works for existing setups.

### The menu

The admin sidebar is grouped by the job: **Front desk** (counter, floor, sessions, bookings, waitlist, customers), **Sales & food**, **Gaming floor**, **Stock**, **Team**, **Money & insight** and **Setup**. A group can be folded away (remembered in the browser); the group holding the current page always stays open. Counter staff still start on the short menu. The Super Admin console is grouped as **Venues**, **Product** and **Setup & security**.

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
| **Venue health** | Per venue: stations online, sessions this week, last session, drop-offs, open alerts. Flags trials with no PCs, no stations online, no sessions this week, 20+ drop-offs, payment overdue, **a trial ending within 5 days (or already ended)**, and **sessions down by half or more on the previous four weeks' weekly average** (only venues that averaged 10+ a week). Below the table, **sign-ups by month**: how many are still on trial, paying, overdue or lost. |
| **Search** (Ctrl+K) | Type 2+ characters: venues (name, legal name, code, billing e-mail), the people who work at them (name, e-mail), leads and invoice numbers. `GET /v1/platform/search?q=`, any platform role. |
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
