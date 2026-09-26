"use client";

// Shapes returned by the inventory & purchasing API (apps/api/src/inventory).

export type StockStatus = "OUT" | "LOW" | "OK" | "NEGATIVE";

export interface WarehouseSummary {
  id: string;
  name: string;
  type: "CENTRAL" | "BRANCH_STORE" | "KITCHEN" | "BAR" | "TECH_STORE";
  isActive: boolean;
  branch: { name: string; code: string } | null;
  items: number;
  value: string;
  alerts: number;
}

export interface Overview {
  warehouses: WarehouseSummary[];
  alerts: Array<{ warehouseId: string; itemId: string; name: string; sku: string; baseUnit: string; quantity: string; minStock: string; status: StockStatus }>;
  expiring: Array<{ lotId: string; warehouseId: string; itemId: string; name: string; baseUnit: string; lotCode: string | null; expiresAt: string; quantity: string; expired: boolean }>;
}

export interface StockRow {
  itemId: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: string | null;
  quantity: string;
  minStock: string;
  averageCost: string;
  value: string;
  status: StockStatus;
  tracked: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  expiringSoon: { quantity: string; first: string } | null;
  supplier: { id: string; name: string } | null;
}
export interface WarehouseStock {
  warehouse: { id: string; name: string; type: string; isActive: boolean; branch: { id: string; name: string; code: string } | null };
  totals: { value: string; low: number; out: number };
  rows: StockRow[];
}

export interface Item {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  baseUnit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: string | null;
  averageCost: string;
  lastPurchaseCost: string | null;
  minStock: string;
  reorderQty: string | null;
  trackExpiry: boolean;
  trackSerial: boolean;
  defaultSupplierId: string | null;
  defaultSupplier: { id: string; name: string } | null;
  isActive: boolean;
  onHand: string;
  value: string;
}

export interface Movement {
  id: string;
  createdAt: string;
  type: string;
  item: string;
  itemId: string;
  baseUnit: string;
  warehouse: string;
  warehouseId: string;
  quantity: string;
  quantityAfter: string;
  unitCost: string;
  value: string;
  reference: { type: string; id: string | null } | null;
  by: string | null;
  reason: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  address: string | null;
  paymentTermsDays: number;
  currency: string;
  notes: string | null;
  isActive: boolean;
  items: number;
  orders: number;
  owed: string;
}

export type PoStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
export interface PoRow {
  id: string;
  number: string;
  status: PoStatus;
  supplier: string;
  supplierId: string;
  warehouse: string;
  branch: string;
  total: string;
  currency: string;
  lines: number;
  expectedAt: string | null;
  createdAt: string;
  createdBy: string;
  createdById: string;
}
export interface PoView {
  id: string;
  number: string;
  status: PoStatus;
  currency: string;
  supplier: { id: string; name: string; email: string | null; phone: string | null; paymentTermsDays: number };
  warehouse: { id: string; name: string; branchId: string | null; branch: { code: string; name: string } | null };
  branchId: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  receivedValue: string;
  expectedAt: string | null;
  orderedAt: string | null;
  approvedAt: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; displayName: string };
  approvedBy: string | null;
  lines: Array<{
    id: string;
    item: { id: string; sku: string; name: string; baseUnit: string; purchaseUnit: string | null; purchaseUnitQty: string | null; trackExpiry: boolean; trackSerial: boolean };
    quantityOrdered: string;
    quantityReceived: string;
    outstanding: string;
    unitCost: string;
    taxRatePercent: string;
    lineTotal: string;
  }>;
  invoices: Array<{ id: string; invoiceNumber: string; amount: string; taxAmount: string; paidAmount: string; status: string }>;
}

export interface Suggestion {
  itemId: string;
  sku: string;
  name: string;
  baseUnit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: string | null;
  onHand: string;
  onOrder: string;
  minStock: string;
  suggested: string;
  unitCost: string;
  supplier: { id: string; name: string } | null;
}

export interface Invoice {
  id: string;
  supplier: { id: string; name: string };
  purchaseOrder: { id: string; number: string } | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "DISPUTED" | "VOID";
  amount: string;
  taxAmount: string;
  total: string;
  paidAmount: string;
  due: string;
  overdue: boolean;
  match: { receivedValue: string; difference: string; status: "MATCHED" | "OVER" | "UNDER" } | null;
}

export const CATEGORY_LABEL: Record<string, string> = {
  FOOD: "Food", DRINK: "Drink", INGREDIENT: "Ingredient", GAMING_ACCESSORY: "Gaming accessory", CONTROLLER: "Controller", HEADSET: "Headset",
  MERCHANDISE: "Merchandise", PC_PART: "PC part", CONSUMABLE: "Consumable", PACKAGING: "Packaging", OTHER: "Other",
};
export const MOVE_LABEL: Record<string, string> = {
  PURCHASE_RECEIPT: "Received", SALE: "Sold", RECIPE_CONSUMPTION: "Used in recipe", ADJUSTMENT: "Adjustment", WASTE: "Waste", TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in", RETURN_TO_SUPPLIER: "Returned to supplier", CUSTOMER_RETURN: "Customer return", STOCK_COUNT: "Stock count", ISSUE_TO_STATION: "Issued to PC",
};
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  DRAFT: "Draft", PENDING_APPROVAL: "Needs approval", APPROVED: "Approved", ORDERED: "Ordered", PARTIALLY_RECEIVED: "Part received", RECEIVED: "Received", CANCELLED: "Cancelled",
};
export const PO_TONE: Record<PoStatus, "neutral" | "warn" | "accent" | "ok" | "danger"> = {
  DRAFT: "neutral", PENDING_APPROVAL: "warn", APPROVED: "accent", ORDERED: "accent", PARTIALLY_RECEIVED: "warn", RECEIVED: "ok", CANCELLED: "neutral",
};
export const STATUS_TONE: Record<StockStatus, "ok" | "warn" | "danger"> = { OK: "ok", LOW: "warn", OUT: "danger", NEGATIVE: "danger" };

/** "48 pcs (2 cases)" */
export function qtyLabel(q: string | number, unit: string, pack?: string | null, packName?: string | null) {
  const n = Number(q);
  const base = `${Number.isInteger(n) ? n : n.toFixed(2)} ${unit}`;
  const p = pack ? Number(pack) : 0;
  if (!p || p <= 1 || !packName) return base;
  const packs = n / p;
  return `${base} (${Number.isInteger(packs) ? packs : packs.toFixed(1)} ${packName}${packs === 1 ? "" : "s"})`;
}
