-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_inventory_purchasing (Phase 8)
-- Database guards for stock and purchasing. The API checks all of these too;
-- the constraints make them hold under concurrency and against any caller.
-- (StockMovement is already append-only since 0003.)
-- ─────────────────────────────────────────────────────────────────────────────

-- A movement always moves something; costs are never negative.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT stock_movement_nonzero CHECK ("quantity" <> 0),
  ADD CONSTRAINT stock_movement_cost_nonneg CHECK ("unitCost" >= 0);

-- Lots can run out but never below zero.
ALTER TABLE "StockLot"
  ADD CONSTRAINT stock_lot_qty_nonneg CHECK ("quantity" >= 0),
  ADD CONSTRAINT stock_lot_cost_nonneg CHECK ("unitCost" >= 0);

ALTER TABLE "StockLevel"
  ADD CONSTRAINT stock_level_reserved_nonneg CHECK ("reserved" >= 0);

ALTER TABLE "InventoryItem"
  ADD CONSTRAINT inventory_item_costs_nonneg CHECK ("averageCost" >= 0 AND ("lastPurchaseCost" IS NULL OR "lastPurchaseCost" >= 0)),
  ADD CONSTRAINT inventory_item_levels_nonneg CHECK ("minStock" >= 0 AND ("reorderQty" IS NULL OR "reorderQty" >= 0)),
  ADD CONSTRAINT inventory_item_pack_positive CHECK ("purchaseUnitQty" IS NULL OR "purchaseUnitQty" > 0);

-- Nothing is received twice: two people receiving the same delivery at once
-- can't push a line past what was ordered.
ALTER TABLE "PurchaseOrderLine"
  ADD CONSTRAINT po_line_ordered_positive CHECK ("quantityOrdered" > 0),
  ADD CONSTRAINT po_line_received_range CHECK ("quantityReceived" >= 0 AND "quantityReceived" <= "quantityOrdered"),
  ADD CONSTRAINT po_line_money_nonneg CHECK ("unitCost" >= 0 AND "lineTotal" >= 0 AND "taxRatePercent" >= 0);

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT po_totals_nonneg CHECK ("subtotal" >= 0 AND "taxTotal" >= 0 AND "total" >= 0);

-- An invoice is never paid more than it's for.
ALTER TABLE "SupplierInvoice"
  ADD CONSTRAINT supplier_invoice_amounts CHECK ("amount" >= 0 AND "taxAmount" >= 0 AND "paidAmount" >= 0 AND "paidAmount" <= "amount" + "taxAmount"),
  ADD CONSTRAINT supplier_invoice_dates CHECK ("dueDate" >= "invoiceDate");

ALTER TABLE "Supplier"
  ADD CONSTRAINT supplier_terms_range CHECK ("paymentTermsDays" BETWEEN 0 AND 365);

-- One warehouse name per branch (central warehouses: per organization).
CREATE UNIQUE INDEX warehouse_name_per_branch ON "Warehouse" ("organizationId", COALESCE("branchId", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));

-- Fast "what moved for this order item / PO line" lookups (voids, receipts).
CREATE INDEX stock_movement_reference ON "StockMovement" ("organizationId", "referenceType", "referenceId");
