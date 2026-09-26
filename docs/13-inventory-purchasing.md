# 13 · Inventory, purchasing & suppliers (Phase 8)

The code is in `apps/api/src/inventory`. The stock tables already existed in
the Phase 1 schema. Migration `0012_inventory_purchasing` adds the database
guards listed at the end.

| File | What it does |
|---|---|
| `costing.ts` | Pure maths (unit-tested): moving-average cost, recipe consumption, food cost, reorder quantities, PO line money |
| `stock.ts` | **The stock ledger:** every movement, lots and expiry, costing, and consumption from sales |
| `stock.service.ts` | Warehouse stock, overview, item detail, adjust / waste / issue, transfers, counts, recipes, menu costing |
| `purchasing.service.ts` | Purchase orders, receiving, reorder suggestions, supplier invoices |
| `inventory.controller.ts`, `purchasing.controller.ts` | REST endpoints, permission-checked on the warehouse's branch |

## Model

- **Warehouses** (stores) belong to a branch: branch store, kitchen, bar or
  tech store. A **central** warehouse has no branch and needs
  organization-wide access.
- **Items** are counted in a **base unit** (pcs, g, ml) and bought in a
  **purchase unit** ("case of 24").
  - Every quantity in the ledger is in base units. The base unit is locked
    once stock has moved.
  - Items can track **batches and expiry**, or **serial numbers** (headsets,
    controllers, PC parts).
- **The ledger:**
  - `StockMovement` is append-only. The database rejects UPDATE and DELETE,
    since 0003.
  - `StockLevel` is the current quantity per item and warehouse. It is updated
    in the same transaction with **optimistic locking** (`version`), so
    concurrent moves never lose an update.
  - Every movement carries an idempotency key, so retries are harmless.
- **Cost:** a **moving average** across the whole organization, updated on
  each receipt.
  - Negative stock doesn't dilute it.
  - Every other movement is valued at the current average; a transfer carries
    the cost it left with.

## Negative stock policy

- **Sales never block on stock**, because a miscount must not stop the till.
  A sale that takes stock below zero leaves it **negative**, and it shows up
  as an alert to investigate.
- **Manual moves out never go below zero:** waste, correction, issue to a PC,
  transfer out. They fail with `insufficient_stock`, and nothing moves.
- **Ready items (cans, snacks)** are the exception to the first rule:
  - When a branch tracks the linked stock item, the menu shows it **sold out
    at 0**, on the POS and on customers' PCs.
  - The till refuses more than is on the shelf: `sold_out` with `left`.

## Sales take stock out automatically

When an order is placed (POS, table, or in-seat from a PC), each line takes
out:

| Source | Amount |
|---|---|
| **Linked stock item** (a STOCK_ITEM product) | 1 base unit per unit sold (`SALE`) |
| **Recipe ingredients** (made-to-order items) | Quantity × (1 + planned waste %) per unit (`RECIPE_CONSUMPTION`) |
| **Chosen options** | Each option's ingredient, e.g. "Extra patty" → 1 patty, "Oat milk" → 200 ml |

- **Which store:**
  - Bar-station items come out of the branch's **bar** store.
  - Kitchen items come out of the **kitchen** store.
  - Anything else comes out of the **branch store**.
  - A branch with no warehouse doesn't track stock at all.
- **Voids and cancels:**
  - Voided or cancelled **before the kitchen starts** → the exact amounts go
    back (same store, same cost).
  - **After it starts** → the food was made, so the stock stays used.
  - Refunds don't touch stock.

## Stock operations (admin → Inventory)

| Operation | Permission | Notes |
|---|---|---|
| **Waste / correction / issue to a PC** | `inventory.adjust` (sensitive: reason required, audited) | Issue to PC records the device. Lots are used earliest-expiry first. |
| **Transfer** | `inventory.transfer` on both stores | All lines or none. Batches and expiry travel with the stock. |
| **Stock count** | `inventory.count` | Set what's on the shelf; the difference is recorded as `STOCK_COUNT`, and the variance value is returned and audited. |
| **Items and warehouses** | `inventory.manage` | — |

- **Overview:** stock value per store, items at or below their minimum,
  negative stock, and batches expiring within 7 days.

## Purchasing (admin → Purchasing)

```
DRAFT ──submit──▶ APPROVED (total ≤ limit)                 ──ordered──▶ ORDERED ──receive──▶ PARTIALLY_RECEIVED ──receive──▶ RECEIVED
          └────▶ PENDING_APPROVAL ──approve (not the creator)──▶ APPROVED           └──────────── close short ──────────────┘
                        └─ send back ─▶ DRAFT                     cancel: any time before anything is received
```

- **Approval limit:**
  - `Organization.settings.poApprovalThreshold`, default 2,000.
  - Above it, someone with `purchasing.approve` must approve, never the
    person who raised it. The approval is sensitive: a reason is required.
- **Receiving:**
  - Each line's received quantity enters the PO's warehouse at the order's
    cost, or the invoiced cost if it changed. This moves the average cost.
  - Batch and expiry are recorded, and serial-tracked items take one serial
    per unit.
  - **Never more than ordered:** refused in the API (`over_receipt`), by a
    conditional update, and by a database CHECK.
  - A retried receipt with the same key changes nothing.
- **Reorder:**
  - For each store: items at or under their minimum, **net of what's already
    on order**.
  - The suggested amount is the item's reorder quantity, or up to 2 × the
    minimum, rounded up to whole cases.
  - One click drafts **one PO per supplier**.
- **Supplier invoices:**
  - Recorded per supplier; the invoice number is unique per supplier.
  - The due date comes from the supplier's payment terms.
  - Linked to a PO, an invoice is **matched** against the value actually
    received: MATCHED / OVER / UNDER.
  - Payments are recorded in parts and can never exceed the invoice. The
    database checks this too.
  - Invoices can be disputed or resolved, and voided if unpaid.

## Recipes & food cost (admin → Restaurant → Menu)

- **Stock links:**
  - Made-to-order items get a **recipe**: ingredients, quantity per portion,
    waste %.
  - Ready items link **1:1 to a stock item**.
  - Options can take an ingredient (`PUT /modifiers/:id/stock`).
- **Food cost:** ingredient cost at today's average cost, against the price
  without VAT, with food-cost % and margin per item.

## Database guards (0012)

| Guard | Rule |
|---|---|
| Movements | Non-zero quantity, cost ≥ 0 |
| Lots | Quantity ≥ 0 |
| Items | Costs and levels ≥ 0 |
| PO lines | 0 ≤ received ≤ ordered |
| PO totals | ≥ 0 |
| Supplier invoices | Paid ≤ amount + tax; due date ≥ invoice date |
| Suppliers | Payment terms 0–365 days |
| Warehouses | Name unique per branch |
| Movements | Index by reference (fast void and receipt lookups) |

## Plans

| Plan | Inventory | Purchasing |
|---|---|---|
| Starter | ✅ | ❌ (`FEATURE_DISABLED`) |
| Pro, Enterprise | ✅ | ✅ |

## Demo data

- **Stores:** DXB1 has Main, Kitchen, Bar and Tech stores, plus a Central
  warehouse. AUH1 doesn't track stock.
- **Suppliers:** 3.
- **Items:** 26, from buns to spare headsets (serial-numbered), with opening
  stock received through real POs.
- **Recipes:** every menu item. Cola, energy drink and water are linked
  1:1.
- **Options:** cheese, bacon, extra patty, milk and oat milk take stock.
- **To show the alerts:** energy drinks are low, and one milk batch expires in
  3 days.
- **Work in progress:**
  - one order on its way (to receive);
  - one headset order waiting for approval, raised by the inventory manager
    (approve it as `manager@demo.test`);
  - one unpaid supplier invoice.
- **Login:** `inventory@demo.test` (inventory manager, organization-wide).

## Tests

| Suite | Count | Covers |
|---|---|---|
| `test/inventory-costing.test.ts` | 8 | Moving average, consumption, unit cost, reorder, PO money |
| `test/inventory.e2e.test.ts` | 21 | See below |

`inventory.e2e` covers:
- visibility per role;
- low-stock and expiry alerts;
- recipe and option consumption from the right store;
- idempotent orders;
- void before and after cooking;
- sold out from stock;
- waste with a reason;
- a three-way waste race;
- all-or-nothing transfers;
- counts;
- issuing serial-numbered gear to a PC;
- the append-only ledger;
- the full PO lifecycle with average cost;
- approval by another person;
- serial receipts;
- invoice match, part-payment and overpayment;
- reorder → draft;
- food cost;
- tenant isolation;
- the Starter plan feature gate.
