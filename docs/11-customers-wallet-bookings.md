# 11 · Customers, wallet, memberships, bookings & the customer app (Phase 6)

## Wallet

Each customer has one wallet in the organization's currency, with three buckets:

| Bucket | What | How it fills | How it empties |
|---|---|---|---|
| CASH | money paid in | top-up at the counter (cash/card) | paying for sessions, time, memberships |
| BONUS | free credit | a top-up bonus or an adjustment; expires (90 days by default) | spent **before** cash |
| TIME | prepaid minutes | time packages; membership bonus minutes | logging in at a PC |

**Ledger:**
- Every movement is an append-only `WalletTransaction` (+credit/−debit, with the
  balance after it).
- The `Wallet` row is a projection, updated in the same transaction with
  optimistic locking.
- The database refuses negative balances, so an overdraft is impossible even
  under concurrency.

**Idempotency:** every write carries an idempotency key, so a retried request
changes nothing. The e2e suite retries top-ups and payments to prove it.

**Paying with WALLET:** this works everywhere money is taken: session start,
extend, booking check-in, prepaid time, memberships. It writes a Payment
(method WALLET) on the bill, plus the matching debits: bonus first, then cash.
- Not enough credit → `insufficient_funds`, and nothing is taken.
- Frozen wallet → `wallet_frozen`.

**Staff actions:**

| Action | Permission |
|---|---|
| Top up (cash/card) | `wallet.topup` at the branch |
| Top up with a bonus | also `customer.adjust_wallet` (sensitive → a reason is required) |
| Adjust ± cash / bonus / minutes | `customer.adjust_wallet` + a reason; audited |
| Freeze / unfreeze | `customer.restrict` + a reason; audited |
| View history | `wallet.view_ledger` |

## Memberships

**Tiers** (`/membership-tiers`, `membership.manage`) set:
- price and duration, or "earned" (no price);
- discounts (gaming, restaurant, tournaments);
- bonus minutes;
- the booking window, and priority booking.

The seed creates **Silver** (AED 99 / 30 days, −10 %, 60 bonus min, book 10
days ahead), **Gold** (AED 199, −20 %, 180 min, 14 days) and **Legend**
(earned).

**Selling** (`membership.sell`, or the customer from the app with their wallet):
- The sale is one bill with one payment.
- **Same tier:** a renewal adds the period on top of what's left.
- **Different tier:** the old membership ends now. There's no proration in this
  version.
- The bonus minutes go to the TIME bucket.
- The customer's tier is set immediately: the next quote is discounted and the
  booking window grows.

**Expiry:** `MembershipExpiryService` (every 60 s, all tenants, via the
`app.memberships_due()` definer function) marks memberships EXPIRED. The
customer drops to their next best active tier, or none.

## Bookings

**Availability** (`GET /branches/:id/availability`): free stations per zone for
a window. A station isn't free if:
- it has an overlapping live booking;
- its running session will still be going at the start;
- it is in maintenance.

**Create:** by zone (the first N free stations for N players) or with specific
stations. The rules:

| Rule | Value |
|---|---|
| Duration | 30 min – 12 h |
| Players | up to 20 |
| Booking window | customers: their tier's window (default 7 days); staff: 60 days |
| Price | estimated from the rate card that applies at the start time |

**No double booking, ever:**
- A GiST exclusion constraint on `BookingResource(device, time range)` makes
  the database refuse overlapping live bookings, even when requests race. The
  test fires 3 bookings at once for the same PC; exactly 1 succeeds.
- A walk-in session can't be sold into a booking. `POST /devices/:id/sessions`
  returns `device_booked` with the minutes still free, and staff can sell up to
  that.

**Check-in** (`booking.create` + `station.start_session`):
- It starts a session on every booked station, until the booking ends.
- Payment is cash, card, wallet, prepaid time or pay later.
- Opens 15 minutes before the start.

**Automatic** (`BookingsService` sweep, every 30 s, via `app.bookings_due()`):
- CONFIRMED + 15 min late → **NO_SHOW** (the station is released).
- CHECKED_IN after the end → COMPLETED.
- An expired PENDING hold → CANCELLED.

**Cancelling:** staff can cancel any time (with a reason). Customers can cancel
in the app until 60 minutes before the start.

**Live Floor:** a tile shows the start time of a confirmed booking in the next
2 hours.

**Admin → Bookings:** a day timeline per station, new booking (live free count,
customer search or contact), and check-in / cancel / no-show.

## The customer file (admin → Customers)

**The list:**
- Search by name, username, phone (digits only, any format) or email.
- Filter by status (Active, Restricted, Banned, Pending) and by tag.
- Sort by newest, name, top spend, last visit or most points; 50 a page.
- Tick rows for **bulk actions**:
  - **Tag** them (`customer.edit`).
  - Give **bonus credit**: one audited adjustment each, with a reason; a retry
    skips those already credited (`customer.adjust_wallet`).
  - **Add to a segment**, new or existing hand-picked, then write the message
    in Marketing → Campaigns (`crm.campaign_send`).
- **Export** the filtered list as CSV, up to 10,000 rows, optionally only those
  who agreed to marketing. Needs `customer.export` (owner, org admin) and a
  reason; the export is audited. Cells that a spreadsheet would run as a formula
  are neutralised.

**One customer, in tabs:**

| Tab | What |
|---|---|
| Overview | Total spend, time played, visits, spend per visit, last visit, member since; **warning flags**; membership, wallet, points; recent sessions |
| Activity | Sessions, orders, wallet and time movements, bookings, prints, points and memberships in one timeline, 25 at a time |
| Profile | Name, tags, phone, email, **date of birth** (game age ratings), home branch, language, marketing consent; mark phone/email **verified**; referrals both ways; favourite games; achievements |
| Restrictions | Bans and limits, active and past (see below) |
| Notes | Staff-only notes; only the author can delete theirs |
| Logins | Where and when they signed in: PC, app, kiosk |
| Tickets | Support tickets: open one, resolve it (`support.handle`) |

Plus **Print card**: a wallet-size card with name, username and a QR code of the
username. A barcode scanner at the counter types it into the customer search.
It doesn't sign the customer in at a PC.

Phone, email and date of birth are shown only with `customer.view_pii`, and only
those users can change them.

**Warning flags** (Overview):
- The wallet is frozen.
- A top-up was refunded within a day (last 90 days).
- Three or more manual wallet corrections in 30 days.
- Banned before.
- Another account looks like the same person: same name, same first and last
  name, or same last name and birth date. Those accounts are offered first
  when merging.

**Spend and play time.** `Customer.totalSpend`, `totalGamingMinutes` and
`lastVisitAt` are rebuilt from the source rows after every bill change and every
session end (`customers/stats.ts`), so calling it twice is harmless:
- Spend is money actually paid in: captured payments net of refunds. Wallet
  payments are left out, because the top-up was already counted.
- Minutes are the billed time of ended sessions.
- Migration `0022_customer_stats` filled them in for existing customers.

### Restrictions

`customer.restrict` (owner, org admin, branch manager, gaming manager); a reason
is required and audited. Each one is open-ended or lasts a number of days.

| Type | Scope | Effect |
|---|---|---|
| Ban | — | Can't sign in at a PC or in the app, start a session, book or earn points |
| Keep out of zones | zones | Sessions in those zones are refused (`customer_zone_blocked`) |
| Block games | games | Locked in the Shell's library; the agent refuses to launch them |
| Age limit | age | Treated as that age for game ratings, if younger than their real age |
| Daily play limit | minutes per day | Selling more than what's left today is refused (`daily_limit_reached`); a prepaid sign-in at the PC is shortened to what's left |
| No food & drink | — | Orders for them are refused (`customer_restaurant_blocked`) |

- **Status follows the restrictions:** any active ban → BANNED, anything else
  active → RESTRICTED, none → ACTIVE. Every sign-in check reads the status.
- **Timed ones lift themselves:** the membership sweep also returns customers
  to ACTIVE once their last restriction ends (`app.customer_status_due()`).
- **On the PC:** `START_SESSION.customer` carries `age` (already capped by an
  age limit) and `blockedGameIds`.
- **Limits:**
  - A ban doesn't end a game in progress; end it from the Live Floor.
  - A daily limit is checked when time is sold; a pay-at-the-end session isn't
    cut off mid-game.
  - Game blocks need the updated Windows agent on the PC.

### Contact verification

Staff press **Mark verified** after checking a phone number or email with the
customer, e.g. by calling the number. This sets `phoneVerifiedAt` /
`emailVerifiedAt`. Sending codes by SMS or email needs a messaging provider,
which isn't connected yet.

### Merging a duplicate account

Owner only (`customer.delete`, sensitive). Open the account the customer keeps
→ **Merge duplicate** → pick the duplicate:
1. **Money, prepaid time and points move** as ledger transfers
   (`TRANSFER_OUT` / `TRANSFER_IN`, `ADJUST` for points); the ledgers stay
   append-only. Transfers don't post to the books: the total owed to customers
   doesn't change. Bonus credit restarts its 90 days in the kept account.
2. **History is re-pointed:** sessions, orders, bills, payments, invoices,
   bookings, memberships, prints, screenshots, tickets, notifications, promo
   codes, ratings, restrictions, notes and referrals. Tournament entries move
   unless the kept account is already in that tournament. Favourites,
   achievements and tags are combined.
3. **The duplicate is erased**, as with **Erase**.

Refused if the duplicate's wallet is frozen or has a refund balance waiting.
Retrying is safe: every transfer has its own idempotency key.

## Customer app (`apps/customer`, PWA)

- **What it is:** a mobile-first web app, installable to the home screen
  (manifest + a service worker that caches only the app shell, never API data).
- **Venue link:** the first path segment, e.g. `https://…/demo`.
- **Screens:**
  - **Home:** wallet, prepaid time, membership, "playing now", next booking.
  - **Book:** zone, day, time, duration and players; live free count.
  - **My bookings** (cancel), **Shop** (time packages and memberships paid from
    the wallet), **Wallet** history, **Me**.
- **Sign up:** username, password (8+), optional phone and date of birth. The
  date of birth is used for game age ratings on the PCs. The same login works
  at every PC.

### Booking flow and "Pay now"

The flow is **zone → day → pick PCs → length → time → pay**:
- **Zones:** only zones with stations are shown, and the branch with stations
  opens first.
- **Picking PCs:** each PC shows the times it's taken that day
  (`GET /app/stations`: names and taken periods, never who).
- **Times:** only times free on all the picked PCs can be chosen.
- **Price:** comes from `GET /app/estimate`.

At the end, the customer picks **Pay now** or **Pay at the venue**.
- **Pay now is a demo.** It uses a simulated card, and only appears when
  `demoPayments` is on: any non-production install, unless `DEMO_PAYMENTS=off`.
  It is never on in production; a real gateway replaces it in the payments
  phase.
- **Where the money goes:** the amount is recorded as a captured online payment
  on the booking and credited to the customer's wallet (`TOPUP`, reference
  BOOKING). Check-in then pays from the wallet. The money is counted once, and
  if plans change the credit stays theirs.
- **All or nothing:** the booking and the payment happen in one transaction. If
  either fails, neither exists.

### Security

- **Separate from staff:** customer routes (`/v1/app/*`) never enter the staff
  pipeline.
- **Own token:** each request carries a customer token (EdDSA, audience
  `arena:customer`, 12 h). It is bound to a `CustomerSession` row: logout, a
  ban or deletion ends it immediately.
- **Own records only:** the request runs in the customer's tenant as the
  CUSTOMER actor, and every query is filtered to that customer.
  - Other customers' bookings return 404.
  - Availability shows **counts**, not which stations or who has them.
- **Tokens aren't interchangeable:** staff and customer tokens are rejected on
  each other's routes, and one venue's accounts can't sign in at another.
- **Brute force:** throttles on login (20 attempts per 15 min per IP, 8 per
  account) and sign-up (5 per hour per IP). An unknown username gets a
  constant-time "burn" verify.
- **Same-origin:** in development, Vite proxies `/v1`. In production, serve it
  from the API's host. The CSP is `connect-src 'self'`.
- **Not yet:** online top-up needs a payment gateway (planned in the POS phase);
  customers top up at the counter.

Run it:

```bash
npm run dev -w @arena/customer    # http://localhost:5175/demo  (API on :4000)
```

Demo: `ahmed` / `ahmed123` has AED 150 + 20 bonus in the wallet and 2 h of prepaid time.

## Tests — `apps/api/test/customers.e2e.test.ts` (17)

- **Wallet:**
  - A top-up is credited once, even when retried.
  - A bonus needs rights and a reason.
  - The spend order is bonus first, then cash.
  - An overdraft is refused and leaves the wallet untouched.
  - A guest session can't be paid from a wallet.
  - Adjustments need a reason and are audited; a frozen wallet can't be spent.
- **Memberships:**
  - A Gold sale via the wallet sets the tier, adds bonus minutes, and gives 20 % off the next quote.
  - A renewal extends the period; expiry drops the tier.
  - Only owners manage tiers, and a sold tier needs a duration.
- **Bookings:**
  - A 3-way race for one PC gives exactly one winner, and overlaps are refused.
  - A walk-in session can't run into a booking; a shorter one can.
  - Check-in starts both sessions, paid from the wallet.
  - A no-show is released automatically.
  - Another organization gets 404.
- **Customer app:**
  - Sign-up, sign-in and profile; duplicate usernames and wrong passwords are refused.
  - Tokens aren't interchangeable, logout kills the token, and venues are separate.
  - Buying time and a membership from the wallet works, and insufficient funds are refused.
  - Booking respects the window, shows counts only, and a customer can't cancel someone else's booking.
  - Password guessing is throttled.

## Tests — `apps/api/test/customer-admin.e2e.test.ts` (4)

- **Bans:**
  - A cashier can't ban.
  - A ban sets BANNED, blocks app sign-in and session start; lifting it restores ACTIVE.
  - A one-second ban returns to ACTIVE by itself.
- **Restrictions on the PC:** a game block and an age limit arrive in `START_SESSION`
  (`blockedGameIds`, capped `age`); a zone block and a used-up daily limit refuse the session.
- **Profile:** birth date, home branch, tags (deduplicated) and language save; a
  future birth date is refused; the tag filter and sorting work; notes can only be
  deleted by their author; export needs `customer.export` and contains the tags;
  verifying a missing email is refused.
- **Merge:** wallet cash, prepaid time, notes, sessions and spend move to the kept
  account; the duplicate is erased; a second merge is refused.

The agent side (`clients/windows/tests`): a blocked game is refused by
`LaunchPolicy`, and `blockedGameIds` is read from `START_SESSION`.

**Debugging tip:** `TEST_LOGS=1 npm test -w @arena/api` prints server errors
during e2e tests (they're silent by default).
