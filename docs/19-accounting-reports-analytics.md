# 19 · Accounting, reports & analytics (Phase 11)

Migrations:

- `0015_accounting`: `JournalEntry.documentId`, the `PostingCursor` table (with RLS), append-only journal entries, and guards on account codes and expense amounts.
- `0016_reporting_indexes`: date-range indexes on bill close, session start, shift close and refund times.

## The general ledger keeps itself

Nobody types sales into the books. A background **poster** (`accounting/posting.ts`, every 15 s, `ACCOUNTING_SWEEP_MS`) turns business documents into double-entry journal entries.

**The rule:**
- Each document has a builder. The builder says what the document is worth in the books *now*, as a balanced set of lines.
- The poster compares that with what it already booked for the document (`PostingCursor.posted`) and books only the **difference**.
- The first booking is dated the day the document happened. A later change is booked on the day it changed.
- Nothing already posted is ever edited. Entries and lines are append-only in the database; corrections are new entries.

| Document | Books |
|---|---|
| Settled bill | Dr customer tabs · Cr revenue by what was sold (gaming, food & drinks, merchandise, memberships, printing, tournaments & bookings) · Cr VAT. Top-ups and gift cards credit a **liability**, not revenue |
| Payment | Dr cash in drawers / card clearing / online clearing / customer wallets · Cr customer tabs (a booking prepayment: Cr customer wallets) |
| Refund | Dr refunds & returns + its share of VAT · Cr where the money went (drawer, wallet, card) |
| Wallet bonus, reward, adjustment, prize | Dr promotions / goodwill / prizes · Cr customer wallets (expiry and reversals mirror it). A credit with nothing behind it (an opening balance) is Dr owner's equity |
| Stock movement | Receipt: Dr inventory · Cr goods received not invoiced. Sale / recipe use: Dr cost of goods sold · Cr inventory. Waste / count: stock-loss account. Issue to a station: equipment expense. Transfers: nothing (value stays in the organization) |
| Drawer float, pay-in/out, safe drop | Between cash in drawers and cash in safe |
| Shift close | Counted cash from the drawer to the safe; any difference to cash over / short |
| Supplier invoice | Dr goods received not invoiced (or other expenses with no purchase order) + input VAT · Cr payables; payments Dr payables · Cr bank |
| Expense | Dr the chosen expense account + input VAT · Cr drawer (paid from a shift), safe (other cash) or bank |

**Revenue timing.** Revenue is recognised when a bill **settles**. An open tab isn't revenue yet. A voided line never reaches the books. Payments on an open tab sit as a credit on customer tabs until the bill settles.

**Exactly once.**
- Each booking of a document version has a stable id, and journal entries are unique by `(sourceType, sourceId)`.
- A per-organization advisory lock stops two API instances from posting the same organization at once. The sweep skips a busy organization; a manual "Post now" waits up to 4 s.
- Work runs in bounded batches (about 4 s each), well inside the tenant transaction's 10 s limit, so a large first backfill never times out.

**Money** is handled in integer minor units. Stock values are rounded per movement, and a stray minor unit goes to *Rounding differences*, never lost.

### Chart of accounts

Every organization gets a default chart on first use (`accounting/chart.ts`):
- assets 1xxx, liabilities 2xxx, equity 3xxx, revenue 4xxx, cost of sales 5xxx, operating expenses 6xxx;
- headers (x000) group accounts and are never posted to;
- system accounts can be renamed but not switched off;
- organizations add their own accounts (e.g. more expense accounts).

### By hand

- **Manual journal entries** (`accounting.post`, sensitive: a reason is required):
  - they must balance, use live non-header accounts and fall in an open period;
  - they can be reversed once;
  - automatic entries can't be reversed; correct the bill or document instead.
- **Expenses** (`accounting.expense`, at the expense's branch):
  - paid by bank, company card, cash from the safe, or cash from the recorder's open drawer;
  - a drawer payment writes an EXPENSE cash movement, so the shift's expected cash stays right, and its amount can't be edited afterwards.
- **Period lock:** closes the books up to a past day.
  - Manual entries and expenses can't be dated into a closed period.
  - Automatic changes to old documents are booked on the first open day.

### Reconciliation

`GET /accounting/reconciliation` compares each control account with what operations hold. It runs nightly, and differences go to the audit log.

| Ledger | Operations |
|---|---|
| Customer wallets | Σ wallet money balances (cash + bonus + promo + refund) |
| Inventory | Σ stock ledger value (per movement, rounded) |
| Accounts payable | Σ unpaid supplier invoices |
| Cash in drawers | Σ cash expected in open shifts |

A drawer difference usually means cash was taken without an open shift.

### Statements

- Trial balance, profit & loss (with a daily or monthly series), balance sheet (including current earnings), account ledger with running balance, and the journal.
- All can be filtered to one branch. Readers with branch-level `accounting.view` see only their branches. Entries not tied to a branch, such as supplier bills without a purchase order, are for organization-wide readers only.
- Accounting is an **add-on** (feature `ACCOUNTING`): Enterprise, or an override per organization. The demo organization has it.

## Reports

`/reports/*` read the operational data directly, so they work without the accounting add-on.
- Days are the **branch's local day**.
- Each report needs its permission at some scope, and shows only the branches the reader holds it for.
- Every report exports CSV (`reports.export`). Cells that would start a spreadsheet formula are defused.

| Report | Permission | Contents |
|---|---|---|
| Sales | reports.financial | Taken in (cash and card, incl. top-ups; wallet-paid bills were taken in at the top-up) vs revenue (net of VAT, excluding top-ups), by day, branch, what was sold, category and payment method; refunds; top products with **stock-cost margin**; weekday × hour heatmap |
| VAT | reports.financial | Output VAT by rate (from each line's tax breakdown), minus the VAT share of refunds, minus input VAT (supplier invoices, expenses) = net payable |
| Cash & shifts | reports.financial | Closed shifts with expected, counted and variance; floats, cash sales, refunds, pay-ins/outs, safe drops, expenses |
| Gaming utilization | reports.operational | Per zone: stations, sessions, hours, occupancy (share of 24 h station-time), revenue, revenue per station-day; busiest and quietest stations; start-time heatmap |
| Staff | reports.staff | Per employee: orders, payments taken, refunds, voids, sessions started, shifts and cash variance |

## Analytics (dashboard)

`GET /analytics/overview?days=7|30|90` (reports.operational):

- **Right now:** who's playing, stations online, open tabs and what's still due.
- **Today vs the same weekday last week:** revenue and bills.
- **With Advanced analytics** (feature `ADVANCED_REPORTS`, Pro and up):
  - this period vs the previous one: revenue, bills, average bill, sessions, hours played, active and new customers;
  - daily revenue and daily hours played, as two charts (never two scales on one axis);
  - returning-customer share, top customers, and money held in wallets.

Revenue means the same thing everywhere: dashboard, Sales report and profit & loss.

## Fixed along the way

Cash taken at the counter for wallet top-ups, memberships and time packages now goes into the cashier's open drawer, like any POS sale. Before, those shifts always closed "over".

## Admin

| Page | What |
|---|---|
| **Dashboard** | The analytics above; the setup checklist only until setup is done |
| **Finance** | Overview (P&L, balance sheet); Journal (filter, drill into lines, manual entries, reverse); Accounts (chart with balances, trial balance, ledger per account, add accounts); Expenses; Close & reconcile (checks, period lock). "Post now" books the last few seconds' changes |
| **Reports** | Sales, VAT, Cash & shifts, Gaming utilization, Staff; charts with hover readouts and tables alongside; CSV links |

Demo login: `accountant@demo.test` (Accountant: `accounting.*`, `reports.*`).

## Tests

- `test/accounting.e2e.test.ts` (15): the default chart; a cash sale (revenue net of VAT, VAT, cash, cost of the cans, exactly once, entries immutable); an open tab and voided lines; a document changing after it was booked; refunds; wallet top-up, bonus and spending; cash top-ups reaching the drawer; shift close; expenses (permissions, drawer); manual journals (balance, reason, reversal); the period lock; statements that balance; branch scoping, cashiers and plan gating; CSV; reconciliation.
- `test/reports.e2e.test.ts` (7): a sale in sales and VAT; top-ups are takings, not revenue; cash and staff; utilization per branch; permissions and isolation; the dashboard agreeing with the sales report; CSV.
- `test/csv.test.ts` (2): quoting and formula defusing.
