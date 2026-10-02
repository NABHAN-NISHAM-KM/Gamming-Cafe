# 15 · Loyalty, promotions, tournaments & CRM (Phase 10)

Migration `0014_loyalty_promotions_tournaments`:

- **Brackets:** `Match.nextSlot`, `loserNextSlot`, `byeA` and `byeB`; `Tournament.swissRounds` and `prizesToWallet`.
- **Guards (CHECK constraints):**
  - customer points ≥ 0;
  - promotion uses ≤ limit and spend ≤ budget;
  - code uses ≤ max;
  - reward cost > 0 and stock ≥ 0;
  - tournament team counts.
- **Indexes:** a unique referral-code index and a notification inbox index.
- **Definer function:** `app.live_organizations()`, for the loyalty and CRM background sweeps.

Pure logic has its own unit tests:

- `tournaments/brackets.ts`
- `promotions/engine.ts`
- `crm/segments.ts`

## Loyalty

The points ledger (`LoyaltyTransaction`) is **append-only**. `Customer.loyaltyPoints` is a projection, updated by compare-and-set. Every movement carries an idempotency key, so retries never double-award.

**Earning rules** are set per organization:

| Source | Demo | When |
|---|---|---|
| GAMING | 1 pt / AED | Bill settles: its gaming-time lines. A per-minute rule (optional) pays on minutes actually played when the session ends |
| RESTAURANT | 1 pt / AED | Bill settles: its food and drink lines. Service lines such as entry fees earn nothing |
| BOOKING | 20 | Booking checked in |
| TOURNAMENT | 50 | Every player, when a tournament finishes |
| REFERRAL | 200 | The referred friend's first settled bill (paid to the referrer once) |
| BIRTHDAY | 100 | Hourly sweep, once a year |

How points move:

- **Membership multiplier:** the tier's `loyaltyMultiplier` scales earned points (not referral points).
- **Expiry:** earned points expire after the organization's `settings.loyalty.expiryDays` (default 365; 0 turns expiry off).
  - The hourly sweep expires the oldest points first (FIFO), never more than the balance.
  - Customers see what expires in the next 30 days.
- **Refunds** reverse the points earned on the refunded amount. Points already spent can't be clawed back past zero; the database CHECK holds the balance at 0 or above.
- **Manual adjustments** need `customer.adjust_points` (sensitive, with a reason).

**Rewards catalog.** Reward values are zod-validated:

| Type | What redeeming does |
|---|---|
| `FREE_MINUTES` | Adds time to the customer's time balance |
| `WALLET_CREDIT` | Adds bonus wallet credit, expiring in 90 days |
| `DISCOUNT_PERCENT` / `DISCOUNT_AMOUNT` / `PRODUCT` | Issues a **personal one-use code**, valid 90 days, through a hidden promotion |

Redeeming is idempotent. Stock is decremented conditionally, so it can't go negative.

**Challenges** (`loyalty/challenges.ts`) are milestones worth points once, set
by the owner in **Marketing → Loyalty → Challenges**: minutes played, days
visited, bookings kept or tournaments entered, with a target and the points.
They are the `Achievement` rows (`criteria = { type, target }`). Progress is
read from the customer's own history, so nothing extra is tracked. When a
session ends (and whenever the app shows the list), anything newly reached is
recorded once (`CustomerAchievement`), the points are paid (source
ACHIEVEMENT, idempotent) and the player gets a push. Turning a challenge off
hides it; points already given stay.

## Promotions engine

A promotion is a set of **conditions**, **effects**, a priority, a stackable flag and limits.

- **Conditions:**
  - days of week and hours;
  - branches and zones;
  - membership tiers and segments;
  - minimum spend;
  - first visit;
  - birthday (within 3 days, in the branch's time zone);
  - product categories.
- **Effects:**
  - percent or amount off time, food or everything;
  - bonus minutes;
  - a free product.
- **Limits:**
  - overall uses and budget;
  - uses per customer;
  - valid-from and valid-to dates.

### How a price is chosen

Evaluation is pure and deterministic (`engine.ts`):

1. Collect every **automatic** promotion that holds, plus the entered code's promotion.
2. Take the single **best non-stackable** promotion.
3. Add every **stackable** promotion.
4. **Cap the total** at the amount it applies to.

Where it applies:

- **POS orders:** the discount is combined into one AMOUNT line discount.
- **Prepaid session sales:** bonus minutes extend the session's expiry.

### Codes

- Codes are either shared (`WELCOME10`) or generated in batches for one customer each.
- Errors: `promo_code_invalid`, `promo_code_expired`, `promo_code_used_up`, `promo_code_not_yours`, `promo_not_applicable`, `promo_limit_reached`.
- **Redemption** takes a per-customer advisory lock, then runs conditional UPDATEs on uses, budget and code uses. Two tills can't overspend a budget.
- In test databases, seeded automatic promotions are **paused**, so other suites' prices don't move.

## Tournaments

- **Formats:**
  - single elimination;
  - double elimination (4+ teams, grand final);
  - round robin;
  - league;
  - Swiss (with a bye for an odd count).
- **Seeding:** seeds are spread in standard bracket order. Byes go to the top seeds and are walked over at start. Match slots carry `nextSlot` and `loserNextSlot` wiring, so reporting a result advances both players.
- **Entry:**
  - The team size is enforced, and a player can't be in two teams.
  - The **entry fee** is sold as a SERVICE product through the POS (idempotent). Customers pay from the wallet in the app; staff take any tender.
  - Withdrawing or cancelling the tournament refunds entry fees through the normal refund path.
- **Running it:**
  - Check-in, then start: close registration, seed, build matches.
  - Staff report scores (`tournament.score`). Draws are only allowed in round robin and league.
  - The next Swiss round is paired automatically from the standings.
  - Stations can be assigned to a match.
- **Finishing:**
  - Placements are computed from the bracket or the table.
  - With `prizesToWallet`, prizes go to the captain's wallet (tied places split them). Otherwise staff pay them out.
  - Every player earns TOURNAMENT points.
- **Standings:** 3 points for a win, 1 for a draw. Ties are broken by score difference, then score for.

## CRM

- **Segments:**
  - Built-in segments: NEW, REGULAR, VIP, INACTIVE, HIGH_SPENDER, COMPETITIVE, RESTAURANT_HEAVY and GAMING_HEAVY.
  - Custom segments use zod rules (visits, minutes, spend, recency, age, tier, consent).
  - Static segments have hand-picked members.
  - Segments are evaluated from per-customer metrics and refreshed on demand.
- **Campaigns:**
  - A campaign targets a segment on one channel: IN_APP, SHELL, SMS, EMAIL or WHATSAPP.
  - Messages are personalized with `{{firstName}}`, `{{points}}` and `{{code}}`. Unknown tokens are dropped.
  - A campaign can attach a promotion, and each recipient gets **their own code**.
- **Consent:** only customers who opted into marketing receive campaigns.
- **Idempotent sending:** one notification per campaign and customer (`campaign:<id>:<customer>`), so sending again only reaches new members.
- **Delivery by channel:**
  - IN_APP messages land in the customer app inbox.
  - SHELL messages are queued and shown on the customer's PC when their next session starts.
  - SMS, email and WhatsApp go to the dev outbox until a provider is connected.
- **Results:** a campaign reports delivered, read and converted (codes redeemed).

## Customer app

- **Rewards tab:**
  - points, a note on what expires soon, and the tier multiplier;
  - rewards to redeem (codes shown in place);
  - the invite code;
  - points history.
- **Tournaments** (from Home):
  - the list;
  - details with bracket or standings, and final placements;
  - entry with a team name and teammates' usernames, the fee paid from the wallet.
- **Inbox** (from Home, with an unread badge): campaign messages with their codes, marked read on open.
- **Sign-up** takes an optional friend's invite code.

## Admin

- **Tournaments:** create, open or close entries, register teams, seed, start, a live bracket with score entry, and standings.
- **Marketing:**
  - promotions (conditions, effects, limits, code batches);
  - loyalty rules and rewards;
  - segments;
  - campaigns (audience preview, send).
- **Customers:** a loyalty panel with balance, history, adjust and redeem.
- **POS and Live Floor:** a promo code field.
