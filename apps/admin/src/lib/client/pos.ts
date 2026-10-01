"use client";

// Shapes returned by the POS / restaurant / kitchen API (apps/api/src/pos).

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Array<{ id: string; name: string; priceDelta: string }>;
}

export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  barcode?: string | null;
  type: string;
  price: string;
  available: boolean;
  station: string | null;
  modifierGroups: ModifierGroup[];
}

export interface Menu {
  currency: string;
  /** Best sellers at this branch over the last 30 days (shown first on the till). */
  topProductIds?: string[];
  categories: Array<{ id: string; name: string; products: MenuProduct[] }>;
}

export interface BillView {
  id: string;
  number: string;
  status: "OPEN" | "PARTIALLY_PAID" | "SETTLED" | "VOID";
  currency: string;
  customer: { id: string; displayName: string } | null;
  table: { id: string; name: string } | null;
  openedAt: string;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  paidTotal: string;
  due: string;
  change?: string | null;
  sessions: Array<{ id: string; status: string; device: { name: string } }>;
  orders: Array<{
    id: string;
    number: string;
    type: string;
    status: string;
    deliverTo: string | null;
    total: string;
    orderItems: Array<{ id: string; nameSnapshot: string; quantity: number; lineTotal: string; modifiers: Array<{ name: string }> | null; status: string }>;
  }>;
  payments: Array<{ id: string; method: string; amount: string; refundedAmount: string; cashTendered: string | null; changeGiven: string | null; createdAt: string }>;
}

export interface ShiftReport {
  id: string;
  status: "OPEN" | "PENDING_APPROVAL" | "CLOSED";
  branchId: string;
  drawer: string;
  employee: string;
  currency: string;
  openedAt: string;
  closedAt: string | null;
  approvedBy: string | null;
  openingCash: string;
  expectedCash: string;
  countedCash: string | null;
  variance: string | null;
  sales: Record<string, string>;
  salesTotal: string;
  refunds: string;
  movements: Array<{ type: string; amount: string; reason: string | null; createdAt: string }>;
  orders: number;
}

export type TicketStatus = "NEW" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED";
export interface Ticket {
  id: string;
  status: TicketStatus;
  station: { id: string; name: string };
  deliverTo: string | null;
  notes: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  order: { id: string; number: string; type: string; channel: string; notes: string | null; customer: string | null };
  items: Array<{ id: string; nameSnapshot: string; quantity: number; modifiers: Array<{ name: string }> | null; notes: string | null; status: string }>;
}
export interface KitchenBoard {
  stations: Array<{ id: string; name: string }>;
  serverTime: string;
  tickets: Ticket[];
}

export interface TableRow {
  id: string;
  name: string;
  seats: number;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "CLEANING" | "BILL_REQUESTED" | "OUT_OF_SERVICE";
  zoneId: string | null;
  bill: { id: string; total: string; due: string; openedAt: string } | null;
}

export interface Tender {
  method: "CASH" | "CARD" | "WALLET";
  amount?: string | null;
  tendered?: string | null;
  reference?: string | null;
}

/** A line in the till before it's sent. `unit` is the display price incl. modifiers. */
export interface CartLine {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  modifierIds: string[];
  optionNames: string[];
  unit: number;
  notes?: string;
}

export const cartTotal = (lines: CartLine[]) => lines.reduce((a, l) => a + l.unit * l.quantity, 0);
export const money = (v: number | string, currency?: string) => `${currency ? `${currency} ` : ""}${Number(v).toFixed(2)}`;

export const ORDER_TYPE: Record<string, string> = { DINE_IN: "Dine in", GAMING_SEAT: "To seat", TAKEAWAY: "Takeaway", DELIVERY: "Delivery", PICKUP: "Pickup", COUNTER: "Counter" };

/** GET /branches/:id/orders — one row per order. */
export interface OrderView {
  id: string;
  number: string;
  type: string;
  status: "DRAFT" | "PLACED" | "ACCEPTED" | "IN_PROGRESS" | "READY" | "SERVED" | "COMPLETED" | "CANCELLED" | "REFUNDED";
  channel: string;
  deliverTo: string | null;
  notes: string | null;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  createdAt: string;
  cancelReason: string | null;
  customer: { id: string; displayName: string } | null;
  items: Array<{ id: string; nameSnapshot: string; quantity: number; unitPrice: string; lineTotal: string; modifiers: Array<{ name: string }> | null; notes: string | null; status: string }>;
  kitchenTickets: Array<{ id: string; status: string; station: { name: string } }>;
  bill: { id: string; number: string; status: string; total: string; paidTotal: string; due: string } | null;
}
