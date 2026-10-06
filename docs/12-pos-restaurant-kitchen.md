# 12 · POS, restaurant, kitchen, in-seat ordering & shifts (Phase 7)

Phase 7 uses tables that were already in the Phase 1 schema (orders, bills,
payments, refunds, kitchen tickets, tables, shifts, cash movements), so there is
**no new migration**. The code is in `apps/api/src/pos`:

| File | What it does |
|---|---|
| `order-pricing.ts` | Pure pricing: lines, modifiers, discount, tax, change (unit-tested) |
| `bills.ts` | Bill totals, recording payments, the caller's open shift (shared with sessions) |
| `orders.service.ts` | Menu, placing orders, split payment, voids, cancels, refunds, views |
| `kitchen.service.ts` | The KDS board, bumping tickets, telling the customer's PC |
| `shifts.service.ts` | Open, cash movements, X/Z report, close with count, approval |
| `seat-ordering.service.ts` | Menu and orders from the Gaming Shell over the device socket |
| `pos.controller.ts` | REST endpoints, permission-checked on the owning branch |

## Money rules

- Everything is computed in **integer minor units**. Prices come from the menu
  (with any branch override) plus modifier price changes. The client never
  sends a price.
- **Tax:** the branch's tax profile applies (demo: 5 % VAT, included in the
  price). Tax is rounded per line, so the receipt adds up line by line.
- **Discount:** a percent or a fixed amount, spread over the lines. Needs
  `pos.discount`.
- **Idempotency:** every order and payment carries an idempotency key. Each
  tender is keyed `key:n`, so a retried split payment never charges twice.
  Paying locks the bill row, so two tills paying the same bill at once get
  one payment and one `already_paid`.
- **Payments:** CASH, CARD or WALLET, split across up to 4 tenders.
  - The last tender may omit its amount, meaning "the rest". The server's
    total always wins.
  - Paying more than is due → `bad_amount`. Cash tendered below the amount →
    `insufficient_cash`.
  - The change is recorded on the payment.
- **Cash needs an open shift.** Staff taking cash without one get
  `no_open_shift`. Card and wallet work without a shift.

## Orders and bills

| Type | Goes on | Delivered to |
|---|---|---|
| COUNTER / TAKEAWAY | a new bill (pay now, or leave it open to pay later) | counter |
| GAMING_SEAT | the **live session's bill** on that PC | "PC-07 · VIP" |
| DINE_IN | the table's open bill; the table becomes OCCUPIED | "Table T3" |

- A bill stays **OPEN while a session is live** on it. Play time is added when
  the session ends, and food can be paid any time.
- When a table's bill is settled, the table goes to **CLEANING**. Staff mark
  it free again, and it can't be marked free while a bill is open.
- **Voids:**
  - Before the kitchen starts: `pos.void_item`.
  - After it starts: also `restaurant.cancel_order` (sensitive, reason
    required, audited).
- **Refunds** (`pos.refund`, reason required, idempotent):
  - Back to the original method.
  - As cash from the refunding cashier's drawer.
  - Or as wallet credit.
  - Partial refunds are allowed up to what was paid.
  - A refund on a settled bill is a return: the bill stays settled (nothing is
    owed again) and the refund shows under refunds in the reports. Before a bill
    is settled, a refund gives the tender back and that amount is due again.

## Kitchen (KDS)

- Each product can have a kitchen station (Kitchen, Bar…). An order makes **one
  ticket per station**.
  - A menu shared across branches finds that branch's station by name.
  - A ready item (a can) sold at the counter makes no ticket and is handed
    over at once.
- **Tickets move:** NEW → PREPARING → READY → SERVED. The order status follows
  its tickets (in progress / ready / served).
- **Live updates:** every change is pushed on the branch's live bus.
  - The Kitchen page listens over SSE (`/branches/:id/kitchen/events`), and
    also polls every 30 s as a fallback.
  - It shows late tickets in red after 12 min and chimes for new ones.
- **In-seat orders:** when a ticket is started, ready or served, the server
  sends an `order_status` to the ordering PC. The Shell shows it as a toast
  and in the order tracker.

## In-seat ordering (Gaming Shell)

```
Shell ──menu_request──▶ Agent (pipe) ──▶ API (device WS) ──▶ menu (shell categories/products only)
Shell ──place_order {lines: productId, qty, modifierIds; payWith BILL|WALLET}──▶ … ──▶ order_result
API ──order_status {orderId, number, status, message}──▶ Agent ──▶ Shell
```

- The Shell sends **only ids and counts**. The server prices the order, and
  resolves the PC and live session from the authenticated device socket.
- **BILL** adds the order to the session bill. **WALLET** is offered only when
  a customer account is signed in, and it pays exactly this order (never the
  whole session bill).
- **Validation:**
  - The agent and server both validate (≤30 lines, qty 1–20, strict parsing
    in C#).
  - The WebView host only forwards whitelisted message types.
- **Offline or no session:** the agent answers the Shell at once, with a
  friendly error.

## Shifts and the cash drawer

- **Open** a shift on a drawer with an opening float.
  - One open shift per drawer, enforced by a database exclusion constraint:
    `drawer_in_use`.
  - One per cashier per branch.
- **Movements:** pay-in, pay-out and safe drop, each with a reason. Cash
  sales, change and cash refunds are recorded automatically.
- **X-report** (any time): sales by method, refunds, drawer movements and
  expected cash.
- **Close:** enter the counted cash; the variance is stored.
  - Above the branch's `cashVarianceThreshold` (default 5.00), the shift goes
    to **PENDING_APPROVAL**.
  - A manager with `shift.approve` approves it, and it can't be their own
    shift.
  - The Z-report totals are frozen on the shift.

## Admin

| Page | For | What |
|---|---|---|
| **POS** | cashier, manager | Menu grid with options; counter / takeaway / to a PC / table; customer; discount; split payment with change; open bills; **My shift** (open, X-report, cash in/out, close, all shifts + approve) |
| **Kitchen** | kitchen staff | Columns New / Cooking / Ready, timers, one-tap bump, station filter (remembered), full-screen, live |
| **Restaurant** | waiter, manager | Tables by status, add to a table's order, its bill (void, refund, pay); **Menu** (products, categories, option groups, branch price, sold out / 86) |

## Demo data (`npm run seed -w @arena/api`)

- **Stations:** Kitchen and Bar at every branch; a "Front desk" cash drawer.
- **Tables:** T1–T6 at DXB1.
- **Menu:** Burgers, Snacks, Pizza, Drinks, Coffee, with option groups
  (Extras, Size, Milk, Dip).
- **Staff:** `waiter@demo.test` and `kitchen@demo.test`, same password as the
  other demo staff.

## Tests

| Suite | Count | What it covers |
|---|---|---|
| `test/order-pricing.test.ts` | 8 | Pricing, rounding, discounts, modifiers, change |
| `test/pos.e2e.test.ts` | 10 | See below |
| `.NET StationTests` | — | Seat orders carry only ids and counts |

`pos.e2e` runs against real Postgres and covers:
- the menu;
- counter cash with shift, change and a retried payment;
- options and sold out;
- a table with split payment;
- the KDS flow;
- in-seat orders over the device socket, wallet and bill;
- voids;
- refunds (all three destinations);
- shifts with variance approval;
- tenant isolation.
