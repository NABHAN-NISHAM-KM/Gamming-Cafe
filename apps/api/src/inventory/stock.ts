import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma, type TenantTx } from "@arena/db";
import { consumption, movingAverage, ZERO, type Num } from "./costing.js";

/**
 * The stock ledger. Every change is an append-only StockMovement (the
 * database rejects UPDATE/DELETE on it); StockLevel is a projection updated in
 * the same transaction with optimistic locking, so concurrent moves never
 * lose an update. Quantities are Decimals in the item's base unit.
 *
 * Sales may take stock below zero (the till never blocks a sale because a
 * count is off — it shows up as negative stock to investigate). Every manual
 * move out — waste, transfer, return to supplier — must have the stock.
 */

export type MoveType =
  | "PURCHASE_RECEIPT" | "SALE" | "RECIPE_CONSUMPTION" | "ADJUSTMENT" | "WASTE" | "TRANSFER_OUT" | "TRANSFER_IN"
  | "RETURN_TO_SUPPLIER" | "CUSTOMER_RETURN" | "STOCK_COUNT" | "ISSUE_TO_STATION";

export interface LotIn {
  lotCode?: string | null;
  serialNumber?: string | null;
  expiresAt?: Date | null;
}
export interface LotOut {
  lotCode: string | null;
  serialNumber: string | null;
  expiresAt: Date | null;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

export interface Move {
  itemId: string;
  warehouseId: string;
  type: MoveType;
  /** Signed change in base units. Give either this or `countTo`. */
  delta?: Num;
  /** Stock counts: set the level to this and record the difference. */
  countTo?: Num;
  /** Cost per base unit for stock coming in (receipts); otherwise the item's average cost is used. */
  unitCost?: Num | null;
  allowNegative?: boolean;
  lot?: LotIn | null;
  /** Take out of this lot (e.g. wasting an expired batch) instead of earliest-expiry-first. */
  lotId?: string | null;
  /** Lots to recreate on the way in (the other half of a transfer). */
  lotsIn?: LotOut[] | null;
  referenceType?: string | null;
  referenceId?: string | null;
  transferId?: string | null;
  employeeId?: string | null;
  reason?: string | null;
  idempotencyKey: string;
}

export interface MoveResult {
  applied: boolean;
  movementId: string;
  quantity: Prisma.Decimal;
  quantityAfter: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  lotsOut: LotOut[];
}

const D = (v: Num) => new Prisma.Decimal(v);

async function levelFor(t: TenantTx, organizationId: string, itemId: string, warehouseId: string) {
  const found = await t.stockLevel.findUnique({ where: { itemId_warehouseId: { itemId, warehouseId } } });
  if (found) return found;
  // ON CONFLICT, not catch-and-retry: a failed INSERT would abort the whole transaction.
  await t.$executeRaw`INSERT INTO "StockLevel" ("id", "organizationId", "itemId", "warehouseId", "updatedAt")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, ${itemId}::uuid, ${warehouseId}::uuid, now())
    ON CONFLICT ("itemId", "warehouseId") DO NOTHING`;
  return t.stockLevel.findUniqueOrThrow({ where: { itemId_warehouseId: { itemId, warehouseId } } });
}

/** One ledger movement. Idempotent on idempotencyKey. */
export async function moveStock(t: TenantTx, m: Move): Promise<MoveResult> {
  const prior = await t.stockMovement.findFirst({ where: { idempotencyKey: m.idempotencyKey } });
  if (prior) return { applied: false, movementId: prior.id, quantity: prior.quantity, quantityAfter: prior.quantityAfter, unitCost: prior.unitCost, lotsOut: [] };

  const item = await t.inventoryItem.findUnique({ where: { id: m.itemId }, select: { id: true, organizationId: true, name: true, averageCost: true, trackExpiry: true, trackSerial: true, isActive: true } });
  if (!item) throw new NotFoundException({ error: "item_not_found" });
  const wh = await t.warehouse.findUnique({ where: { id: m.warehouseId }, select: { id: true, isActive: true } });
  if (!wh) throw new NotFoundException({ error: "warehouse_not_found" });
  if (!wh.isActive) throw new ConflictException({ error: "warehouse_inactive" });

  for (let attempt = 0; attempt < 5; attempt++) {
    const lvl = await levelFor(t, item.organizationId, item.id, wh.id);
    const delta = m.countTo !== undefined ? D(m.countTo).sub(lvl.quantity) : D(m.delta ?? 0);
    if (delta.isZero()) {
      if (m.countTo !== undefined) return { applied: false, movementId: "", quantity: ZERO, quantityAfter: lvl.quantity, unitCost: item.averageCost, lotsOut: [] };
      throw new ConflictException({ error: "bad_quantity" });
    }
    const after = lvl.quantity.add(delta);
    if (delta.lt(0) && after.lt(0) && !m.allowNegative) {
      throw new ConflictException({ error: "insufficient_stock", item: item.name, onHand: lvl.quantity.toString(), needed: delta.neg().toString() });
    }
    const moved = await t.stockLevel.updateMany({ where: { id: lvl.id, version: lvl.version }, data: { quantity: after, version: { increment: 1 } } });
    if (moved.count !== 1) continue; // moved by someone else meanwhile — re-read

    // Receipts move the average cost; everything else is valued at it.
    let unitCost = item.averageCost;
    if (m.type === "PURCHASE_RECEIPT" && delta.gt(0)) {
      unitCost = D(m.unitCost ?? item.averageCost);
      await revalue(t, item.id, delta, unitCost, lvl.quantity, lvl.warehouseId);
    } else if (m.unitCost != null && delta.gt(0)) {
      unitCost = D(m.unitCost); // e.g. a transfer in carries the cost it left with
    }

    const lotsOut = delta.lt(0) && (item.trackExpiry || item.trackSerial) ? await takeFromLots(t, item.id, wh.id, delta.neg(), m.lotId ?? null) : [];
    if (delta.gt(0) && (item.trackExpiry || item.trackSerial)) {
      const lots = m.lotsIn?.length ? m.lotsIn : [{ lotCode: m.lot?.lotCode ?? null, serialNumber: m.lot?.serialNumber ?? null, expiresAt: m.lot?.expiresAt ?? null, quantity: delta, unitCost }];
      for (const l of lots) {
        await t.stockLot.create({ data: { organizationId: item.organizationId, itemId: item.id, warehouseId: wh.id, lotCode: l.lotCode, serialNumber: l.serialNumber, expiresAt: l.expiresAt, quantity: l.quantity, unitCost: l.unitCost } });
      }
    }

    const mv = await t.stockMovement.create({
      data: {
        organizationId: item.organizationId, itemId: item.id, warehouseId: wh.id, lotId: m.lotId ?? null, type: m.type, quantity: delta, unitCost, quantityAfter: after,
        referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null, transferId: m.transferId ?? null, employeeId: m.employeeId ?? null,
        reason: m.reason ?? null, idempotencyKey: m.idempotencyKey,
      },
    });
    return { applied: true, movementId: mv.id, quantity: delta, quantityAfter: after, unitCost, lotsOut };
  }
  throw new ConflictException({ error: "stock_busy" });
}

/** Moving-average cost across the whole organization's stock of the item. */
async function revalue(t: TenantTx, itemId: string, qtyIn: Prisma.Decimal, costIn: Prisma.Decimal, levelBefore: Prisma.Decimal, warehouseId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const item = await t.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, select: { averageCost: true } });
    const others = await t.stockLevel.aggregate({ where: { itemId, warehouseId: { not: warehouseId } }, _sum: { quantity: true } });
    const onHandBefore = (others._sum.quantity ?? ZERO).add(levelBefore);
    const avg = movingAverage(onHandBefore, item.averageCost, qtyIn, costIn);
    const done = await t.inventoryItem.updateMany({ where: { id: itemId, averageCost: item.averageCost }, data: { averageCost: avg, lastPurchaseCost: costIn } });
    if (done.count === 1) return;
  }
  throw new ConflictException({ error: "stock_busy" });
}

/** Earliest expiry first (or one named lot). Lots are a best-effort breakdown of the level. */
async function takeFromLots(t: TenantTx, itemId: string, warehouseId: string, qty: Prisma.Decimal, lotId: string | null): Promise<LotOut[]> {
  const lots = lotId
    ? await t.stockLot.findMany({ where: { id: lotId, itemId, warehouseId } })
    : await t.stockLot.findMany({ where: { itemId, warehouseId, quantity: { gt: 0 } }, orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }] });
  if (lotId && !lots.length) throw new NotFoundException({ error: "lot_not_found" });
  const out: LotOut[] = [];
  let left = qty;
  for (const l of lots) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(l.quantity, left);
    if (take.lte(0)) continue;
    const upd = await t.stockLot.updateMany({ where: { id: l.id, quantity: l.quantity }, data: { quantity: l.quantity.sub(take) } });
    if (upd.count !== 1) throw new ConflictException({ error: "stock_busy" });
    out.push({ lotCode: l.lotCode, serialNumber: l.serialNumber, expiresAt: l.expiresAt, quantity: take, unitCost: l.unitCost });
    left = left.sub(take);
  }
  if (lotId && left.gt(0)) throw new ConflictException({ error: "insufficient_stock", hint: "That batch doesn't have that much left." });
  return out;
}

// ── sales ────────────────────────────────────────────────────────────────────

/**
 * Where a branch's sales come out of: the bar store for bar items, the
 * kitchen store for kitchen items, else the branch store, else any active
 * warehouse at the branch. No warehouse → inventory isn't set up there, and
 * nothing is tracked.
 */
export async function salesWarehouse(t: TenantTx, branchId: string, stationName: string | null, cache?: Map<string, string | null>) {
  const want = stationName && /bar/i.test(stationName) ? "BAR" : stationName ? "KITCHEN" : "BRANCH_STORE";
  const k = `${branchId}:${want}`;
  if (cache?.has(k)) return cache.get(k)!;
  const all = await t.warehouse.findMany({ where: { branchId, isActive: true }, select: { id: true, type: true }, orderBy: { createdAt: "asc" } });
  const pick = all.find((w) => w.type === want) ?? all.find((w) => w.type === "BRANCH_STORE") ?? all[0];
  cache?.set(k, pick?.id ?? null);
  return pick?.id ?? null;
}

type OrderItemForStock = {
  id: string;
  quantity: Prisma.Decimal;
  modifiers: Prisma.JsonValue;
  product: {
    type: string;
    inventoryItemId: string | null;
    kitchenStation: { name: string } | null;
    recipeLines: Array<{ inventoryItemId: string; quantity: Prisma.Decimal; wastePct: Prisma.Decimal }>;
  } | null;
};

const ITEM_SELECT = {
  id: true, quantity: true, modifiers: true,
  product: { select: { type: true, inventoryItemId: true, kitchenStation: { select: { name: true } }, recipeLines: { select: { inventoryItemId: true, quantity: true, wastePct: true } } } },
} as const;

async function stockLines(t: TenantTx, it: OrderItemForStock) {
  if (!it.product) return new Map<string, { quantity: Prisma.Decimal; direct: boolean }>();
  const modIds = ((it.modifiers as Array<{ modifierId?: string }> | null) ?? []).map((m) => m.modifierId).filter((x): x is string => !!x);
  const mods = modIds.length ? await t.modifier.findMany({ where: { id: { in: modIds } }, select: { inventoryItemId: true, inventoryQty: true } }) : [];
  return consumption({
    quantity: Number(it.quantity),
    stockItemId: it.product.type === "STOCK_ITEM" ? it.product.inventoryItemId : null,
    recipe: it.product.recipeLines.map((r) => ({ itemId: r.inventoryItemId, quantity: r.quantity, wastePct: r.wastePct })),
    modifiers: mods.map((m) => ({ itemId: m.inventoryItemId, quantity: m.inventoryQty })),
  });
}

/** Take a new order's ingredients and stock items out of the branch's stores. */
export async function consumeOrder(t: TenantTx, orderId: string, branchId: string, employeeId: string | null) {
  const items = await t.orderItem.findMany({ where: { orderId, status: { notIn: ["VOIDED", "REFUNDED"] } }, select: ITEM_SELECT });
  const cache = new Map<string, string | null>();
  for (const it of items) {
    const wh = await salesWarehouse(t, branchId, it.product?.kitchenStation?.name ?? null, cache);
    if (!wh) return; // inventory not set up at this branch
    for (const [itemId, v] of await stockLines(t, it)) {
      await moveStock(t, {
        itemId, warehouseId: wh, type: v.direct ? "SALE" : "RECIPE_CONSUMPTION", delta: v.quantity.neg(), allowNegative: true,
        referenceType: "ORDER_ITEM", referenceId: it.id, employeeId, idempotencyKey: `use:${it.id}:${itemId}`,
      });
    }
  }
}

/** A voided line the kitchen never started goes back on the shelf. */
export async function returnOrderItems(t: TenantTx, itemIds: string[], branchId: string, employeeId: string | null, reason: string) {
  if (!itemIds.length) return;
  const items = await t.orderItem.findMany({ where: { id: { in: itemIds } }, select: ITEM_SELECT });
  for (const it of items) {
    // Only what was actually taken out comes back (same warehouse, same amount).
    const taken = await t.stockMovement.findMany({ where: { referenceType: "ORDER_ITEM", referenceId: it.id, quantity: { lt: 0 } }, select: { itemId: true, warehouseId: true, quantity: true, type: true, unitCost: true } });
    for (const mv of taken) {
      await moveStock(t, {
        itemId: mv.itemId, warehouseId: mv.warehouseId, type: mv.type as MoveType, delta: mv.quantity.neg(), unitCost: mv.unitCost,
        referenceType: "ORDER_ITEM", referenceId: it.id, employeeId, reason: `void: ${reason}`, idempotencyKey: `unuse:${it.id}:${mv.itemId}`,
      });
    }
  }
}

/**
 * On hand for STOCK_ITEM products at a branch, for "sold out" on the menu:
 * product id → quantity, only where the branch actually tracks that item.
 */
export async function stockForProducts(t: TenantTx, branchId: string, products: Array<{ id: string; type: string; inventoryItemId: string | null; stationName: string | null }>) {
  const out = new Map<string, Prisma.Decimal>();
  const tracked = products.filter((p) => p.type === "STOCK_ITEM" && p.inventoryItemId);
  if (!tracked.length) return out;
  const cache = new Map<string, string | null>();
  const pairs: Array<{ productId: string; itemId: string; warehouseId: string }> = [];
  for (const p of tracked) {
    const wh = await salesWarehouse(t, branchId, p.stationName, cache);
    if (wh) pairs.push({ productId: p.id, itemId: p.inventoryItemId!, warehouseId: wh });
  }
  if (!pairs.length) return out;
  const levels = await t.stockLevel.findMany({ where: { OR: pairs.map((x) => ({ itemId: x.itemId, warehouseId: x.warehouseId })) }, select: { itemId: true, warehouseId: true, quantity: true } });
  for (const x of pairs) {
    const l = levels.find((y) => y.itemId === x.itemId && y.warehouseId === x.warehouseId);
    if (l) out.set(x.productId, l.quantity);
  }
  return out;
}
