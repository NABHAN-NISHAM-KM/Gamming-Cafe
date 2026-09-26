import { Prisma } from "@arena/db";

/**
 * Pure stock maths — no database. Quantities are in the item's base unit
 * ("pcs", "g", "ml") and costs are per base unit, both as Decimals.
 */

/** Anything a Decimal can be built from. */
export type Num = Prisma.Decimal | number | string;
const D = (v: Num) => new Prisma.Decimal(v);
export const ZERO = D(0);

/**
 * Moving-average cost after receiving `qtyIn` at `costIn`. Stock that is
 * negative (sold before it was received) doesn't dilute the average — the
 * new average is simply the new cost then.
 */
export function movingAverage(onHandBefore: Num, avgBefore: Num, qtyIn: Num, costIn: Num): Prisma.Decimal {
  const held = Prisma.Decimal.max(D(onHandBefore), ZERO);
  const q = D(qtyIn);
  if (q.lte(0)) throw new Error("qtyIn must be positive");
  const total = held.add(q);
  return held.mul(D(avgBefore)).add(q.mul(D(costIn))).div(total).toDecimalPlaces(4);
}

export interface RecipeSource {
  /** Units of the product sold. */
  quantity: number;
  /** A STOCK_ITEM product sells one base unit of its linked item. */
  stockItemId: string | null;
  recipe: Array<{ itemId: string; quantity: Num; wastePct: Num }>;
  modifiers: Array<{ itemId: string | null; quantity: Num | null }>;
}

/**
 * What one order line takes out of stock: the linked stock item, each recipe
 * ingredient (plus its planned waste) and each chosen modifier's ingredient —
 * all times the quantity sold, summed per item.
 */
export function consumption(s: RecipeSource): Map<string, { quantity: Prisma.Decimal; direct: boolean }> {
  const out = new Map<string, { quantity: Prisma.Decimal; direct: boolean }>();
  const add = (itemId: string, qty: Prisma.Decimal, direct: boolean) => {
    const cur = out.get(itemId);
    out.set(itemId, { quantity: (cur?.quantity ?? ZERO).add(qty), direct: (cur?.direct ?? true) && direct });
  };
  const n = D(s.quantity);
  if (s.stockItemId) add(s.stockItemId, n, true);
  for (const r of s.recipe) add(r.itemId, D(r.quantity).mul(D(1).add(D(r.wastePct).div(100))).mul(n), false);
  for (const m of s.modifiers) if (m.itemId && m.quantity && D(m.quantity).gt(0)) add(m.itemId, D(m.quantity).mul(n), false);
  for (const [k, v] of out) out.set(k, { ...v, quantity: v.quantity.toDecimalPlaces(4) });
  return out;
}

/** Ingredient cost of one unit of a product at current average costs. */
export function unitCost(s: Omit<RecipeSource, "quantity">, avgCost: (itemId: string) => Num): Prisma.Decimal {
  let sum = ZERO;
  for (const [itemId, v] of consumption({ ...s, quantity: 1 })) sum = sum.add(v.quantity.mul(D(avgCost(itemId))));
  return sum.toDecimalPlaces(4);
}

/**
 * How much to reorder: enough to get back above the minimum — the item's
 * reorder quantity if set, else up to twice the minimum — less what's already
 * on order, rounded up to whole purchase units (cases).
 */
export function reorderQuantity(i: { onHand: Num; onOrder: Num; minStock: Num; reorderQty: Num | null; purchaseUnitQty: Num | null }): Prisma.Decimal {
  const available = D(i.onHand).add(D(i.onOrder));
  const min = D(i.minStock);
  if (min.lte(0) || available.gt(min)) return ZERO;
  const target = i.reorderQty && D(i.reorderQty).gt(0) ? available.add(D(i.reorderQty)) : min.mul(2);
  let need = target.sub(available);
  if (need.lte(0)) return ZERO;
  const pack = i.purchaseUnitQty ? D(i.purchaseUnitQty) : null;
  if (pack && pack.gt(0)) need = need.div(pack).ceil().mul(pack);
  return need.toDecimalPlaces(4);
}

/** Money for a PO line: quantity × cost, tax on top, each rounded to the currency. */
export function lineMoney(qty: Num, unitCostV: Num, taxRatePercent: Num, minorUnit: number) {
  const net = D(qty).mul(D(unitCostV)).toDecimalPlaces(minorUnit, Prisma.Decimal.ROUND_HALF_UP);
  const tax = net.mul(D(taxRatePercent)).div(100).toDecimalPlaces(minorUnit, Prisma.Decimal.ROUND_HALF_UP);
  return { net, tax };
}
