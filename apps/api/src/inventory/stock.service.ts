import { ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { unitCost, ZERO } from "./costing.js";
import { moveStock } from "./stock.js";

type Actor = { type: "EMPLOYEE"; id: string };
const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const q = (d: Prisma.Decimal | null | undefined) => (d ?? ZERO).toDecimalPlaces(4).toString();
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);
const EXPIRY_SOON_DAYS = 7;

export type StockStatus = "OUT" | "LOW" | "OK" | "NEGATIVE";
const statusOf = (qty: Prisma.Decimal, min: Prisma.Decimal): StockStatus => (qty.lt(0) ? "NEGATIVE" : qty.isZero() ? "OUT" : min.gt(0) && qty.lte(min) ? "LOW" : "OK");

export interface AdjustInput {
  itemId: string;
  type: "ADJUSTMENT" | "WASTE" | "ISSUE_TO_STATION";
  quantity: string;
  lotId?: string | null;
  deviceId?: string | null;
  lot?: { lotCode?: string | null; expiresAt?: string | null } | null;
  unitCost?: string | null;
  reason: string;
  idempotencyKey: string;
}

/**
 * Items, warehouses and every manual stock operation — adjustments, waste,
 * transfers, stock counts — plus recipes and menu costing. All quantity
 * changes go through the stock ledger (stock.ts).
 */
@Injectable()
export class StockService {
  // ── views ────────────────────────────────────────────────────────────────

  async warehouseStock(t: TenantTx, warehouseId: string, opts: { category?: string; q?: string } = {}) {
    const wh = await t.warehouse.findUnique({ where: { id: warehouseId }, include: { branch: { select: { id: true, name: true, code: true } } } });
    if (!wh) throw new NotFoundException({ error: "warehouse_not_found" });
    const items = await t.inventoryItem.findMany({
      where: {
        isActive: true,
        ...(opts.category ? { category: opts.category as never } : {}),
        ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { sku: { contains: opts.q.toUpperCase() } }, { barcode: opts.q }] } : {}),
      },
      orderBy: { name: "asc" },
      include: { stockLevels: { where: { warehouseId }, select: { quantity: true } }, defaultSupplier: { select: { id: true, name: true } } },
    });
    const soon = new Date(Date.now() + EXPIRY_SOON_DAYS * 86_400_000);
    const lots = await t.stockLot.groupBy({ by: ["itemId"], where: { warehouseId, quantity: { gt: 0 }, expiresAt: { lte: soon } }, _sum: { quantity: true }, _min: { expiresAt: true } });
    const rows = items.map((i) => {
      const qty = i.stockLevels[0]?.quantity ?? ZERO;
      const l = lots.find((x) => x.itemId === i.id);
      return {
        itemId: i.id, sku: i.sku, name: i.name, category: i.category, baseUnit: i.baseUnit, purchaseUnit: i.purchaseUnit, purchaseUnitQty: i.purchaseUnitQty?.toString() ?? null,
        quantity: q(qty), minStock: q(i.minStock), averageCost: i.averageCost.toFixed(4), value: money(Prisma.Decimal.max(qty, ZERO).mul(i.averageCost)),
        status: statusOf(qty, i.minStock), tracked: i.stockLevels.length > 0, trackExpiry: i.trackExpiry, trackSerial: i.trackSerial,
        expiringSoon: l ? { quantity: q(l._sum.quantity), first: l._min.expiresAt } : null, supplier: i.defaultSupplier,
      };
    });
    return {
      warehouse: { id: wh.id, name: wh.name, type: wh.type, isActive: wh.isActive, branch: wh.branch },
      totals: { value: money(rows.reduce((a, r) => a.add(D(r.value)), ZERO)), low: rows.filter((r) => r.status === "LOW").length, out: rows.filter((r) => r.tracked && (r.status === "OUT" || r.status === "NEGATIVE")).length },
      rows,
    };
  }

  /** At-a-glance for the given warehouses: value, what's low, what's expiring. */
  async overview(t: TenantTx, warehouseIds: string[]) {
    const whs = await t.warehouse.findMany({ where: { id: { in: warehouseIds } }, orderBy: [{ branchId: "asc" }, { name: "asc" }], include: { branch: { select: { name: true, code: true } } } });
    const levels = await t.stockLevel.findMany({ where: { warehouseId: { in: warehouseIds } }, include: { item: { select: { id: true, name: true, sku: true, baseUnit: true, minStock: true, averageCost: true, isActive: true } } } });
    const soon = new Date(Date.now() + EXPIRY_SOON_DAYS * 86_400_000);
    const lots = await t.stockLot.findMany({ where: { warehouseId: { in: warehouseIds }, quantity: { gt: 0 }, expiresAt: { lte: soon } }, orderBy: { expiresAt: "asc" }, take: 50, include: { item: { select: { name: true, baseUnit: true } } } });
    const alerts = levels
      .filter((l) => l.item.isActive && statusOf(l.quantity, l.item.minStock) !== "OK")
      .map((l) => ({ warehouseId: l.warehouseId, itemId: l.itemId, name: l.item.name, sku: l.item.sku, baseUnit: l.item.baseUnit, quantity: q(l.quantity), minStock: q(l.item.minStock), status: statusOf(l.quantity, l.item.minStock) }))
      .sort((a, b) => ["NEGATIVE", "OUT", "LOW"].indexOf(a.status) - ["NEGATIVE", "OUT", "LOW"].indexOf(b.status));
    return {
      warehouses: whs.map((w) => {
        const mine = levels.filter((l) => l.warehouseId === w.id);
        return { id: w.id, name: w.name, type: w.type, isActive: w.isActive, branch: w.branch, items: mine.length, value: money(mine.reduce((a, l) => a.add(Prisma.Decimal.max(l.quantity, ZERO).mul(l.item.averageCost)), ZERO)), alerts: alerts.filter((a) => a.warehouseId === w.id).length };
      }),
      alerts,
      expiring: lots.map((l) => ({ lotId: l.id, warehouseId: l.warehouseId, itemId: l.itemId, name: l.item.name, baseUnit: l.item.baseUnit, lotCode: l.lotCode, expiresAt: l.expiresAt, quantity: q(l.quantity), expired: !!l.expiresAt && l.expiresAt < new Date(new Date().toDateString()) })),
    };
  }

  async item(t: TenantTx, itemId: string, warehouseIds: string[]) {
    const i = await t.inventoryItem.findUnique({ where: { id: itemId }, include: { defaultSupplier: { select: { id: true, name: true } } } });
    if (!i) throw new NotFoundException({ error: "item_not_found" });
    const [levels, lots, moves, usedIn] = await Promise.all([
      t.stockLevel.findMany({ where: { itemId, warehouseId: { in: warehouseIds } }, include: { warehouse: { select: { id: true, name: true, branch: { select: { code: true } } } } } }),
      t.stockLot.findMany({ where: { itemId, warehouseId: { in: warehouseIds }, quantity: { gt: 0 } }, orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }] }),
      this.movements(t, { itemId, warehouseIds, limit: 50 }),
      t.recipeLine.findMany({ where: { inventoryItemId: itemId }, select: { quantity: true, product: { select: { id: true, name: true } } } }),
    ]);
    return {
      ...i, purchaseUnitQty: i.purchaseUnitQty?.toString() ?? null, averageCost: i.averageCost.toFixed(4), lastPurchaseCost: i.lastPurchaseCost?.toFixed(4) ?? null, minStock: q(i.minStock), reorderQty: i.reorderQty ? q(i.reorderQty) : null,
      levels: levels.map((l) => ({ warehouse: l.warehouse, quantity: q(l.quantity), status: statusOf(l.quantity, i.minStock) })),
      lots: lots.map((l) => ({ id: l.id, warehouseId: l.warehouseId, lotCode: l.lotCode, serialNumber: l.serialNumber, expiresAt: l.expiresAt, quantity: q(l.quantity), unitCost: l.unitCost.toFixed(4) })),
      movements: moves,
      usedIn: usedIn.map((r) => ({ productId: r.product.id, product: r.product.name, quantity: q(r.quantity) })),
    };
  }

  async movements(t: TenantTx, f: { itemId?: string; warehouseIds: string[]; type?: string; limit?: number; before?: Date }) {
    const rows = await t.stockMovement.findMany({
      where: { warehouseId: { in: f.warehouseIds }, ...(f.itemId ? { itemId: f.itemId } : {}), ...(f.type ? { type: f.type as never } : {}), ...(f.before ? { createdAt: { lt: f.before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(f.limit ?? 100, 500),
      include: { item: { select: { name: true, baseUnit: true } }, warehouse: { select: { name: true } }, employee: { select: { displayName: true } } },
    });
    return rows.map((m) => ({
      id: m.id, createdAt: m.createdAt, type: m.type, item: m.item.name, itemId: m.itemId, baseUnit: m.item.baseUnit, warehouse: m.warehouse.name, warehouseId: m.warehouseId,
      quantity: q(m.quantity), quantityAfter: q(m.quantityAfter), unitCost: m.unitCost.toFixed(4), value: money(m.quantity.mul(m.unitCost)),
      reference: m.referenceType ? { type: m.referenceType, id: m.referenceId } : null, by: m.employee?.displayName ?? null, reason: m.reason,
    }));
  }

  // ── operations ───────────────────────────────────────────────────────────

  async adjust(t: TenantTx, warehouseId: string, a: AdjustInput, actor: Actor) {
    const qty = D(a.quantity);
    if (qty.isZero()) throw new HttpException({ error: "bad_quantity" }, 400);
    // Waste and issuing always take stock out; an adjustment can go either way.
    const delta = a.type === "ADJUSTMENT" ? qty : qty.abs().neg();
    let referenceType: string | null = null;
    let referenceId: string | null = null;
    if (a.type === "ISSUE_TO_STATION") {
      if (!a.deviceId) throw new HttpException({ error: "device_required" }, 400);
      const wh = await t.warehouse.findUniqueOrThrow({ where: { id: warehouseId }, select: { branchId: true } });
      const dev = await t.device.findFirst({ where: { id: a.deviceId, ...(wh.branchId ? { branchId: wh.branchId } : {}) }, select: { id: true } });
      if (!dev) throw new NotFoundException({ error: "device_not_found" });
      referenceType = "DEVICE";
      referenceId = dev.id;
    }
    const r = await moveStock(t, {
      itemId: a.itemId, warehouseId, type: a.type, delta, lotId: a.lotId ?? null, unitCost: delta.gt(0) ? (a.unitCost ?? null) : null,
      lot: a.lot ? { lotCode: a.lot.lotCode ?? null, expiresAt: a.lot.expiresAt ? new Date(a.lot.expiresAt) : null } : null,
      referenceType, referenceId, employeeId: actor.id, reason: a.reason, idempotencyKey: a.idempotencyKey,
    });
    if (r.applied) {
      const wh = await t.warehouse.findUniqueOrThrow({ where: { id: warehouseId }, select: { branchId: true } });
      await auditAs(t, actor, { action: `stock.${a.type.toLowerCase()}`, entityType: "InventoryItem", entityId: a.itemId, branchId: wh.branchId, after: { warehouseId, quantity: delta.toString(), value: money(delta.mul(r.unitCost)), reason: a.reason } });
    }
    return { quantity: q(r.quantity), quantityAfter: q(r.quantityAfter), value: money(r.quantity.mul(r.unitCost)) };
  }

  /** Both halves in one transaction: out of one warehouse, into the other, at the same cost. */
  async transfer(t: TenantTx, x: { fromWarehouseId: string; toWarehouseId: string; lines: Array<{ itemId: string; quantity: string }>; note?: string | null; idempotencyKey: string }, actor: Actor) {
    if (x.fromWarehouseId === x.toWarehouseId) throw new HttpException({ error: "same_warehouse" }, 400);
    const transferId = randomUUID();
    const out: Array<{ itemId: string; quantity: string; value: string }> = [];
    for (const [n, l] of x.lines.entries()) {
      const qty = D(l.quantity);
      if (qty.lte(0)) throw new HttpException({ error: "bad_quantity" }, 400);
      const o = await moveStock(t, { itemId: l.itemId, warehouseId: x.fromWarehouseId, type: "TRANSFER_OUT", delta: qty.neg(), transferId, referenceType: "TRANSFER", referenceId: transferId, employeeId: actor.id, reason: x.note ?? null, idempotencyKey: `${x.idempotencyKey}:${n}:out` });
      await moveStock(t, {
        itemId: l.itemId, warehouseId: x.toWarehouseId, type: "TRANSFER_IN", delta: qty, unitCost: o.unitCost, lotsIn: o.lotsOut.length ? o.lotsOut : null,
        transferId, referenceType: "TRANSFER", referenceId: transferId, employeeId: actor.id, reason: x.note ?? null, idempotencyKey: `${x.idempotencyKey}:${n}:in`,
      });
      out.push({ itemId: l.itemId, quantity: q(qty), value: money(qty.mul(o.unitCost)) });
    }
    const from = await t.warehouse.findUniqueOrThrow({ where: { id: x.fromWarehouseId }, select: { branchId: true } });
    await auditAs(t, actor, { action: "stock.transfer", entityType: "Warehouse", entityId: x.fromWarehouseId, branchId: from.branchId, after: { to: x.toWarehouseId, lines: out, note: x.note ?? null } });
    return { transferId, lines: out };
  }

  /** A stock count: set each counted item to what's on the shelf and record the difference. */
  async count(t: TenantTx, warehouseId: string, c: { lines: Array<{ itemId: string; counted: string }>; note?: string | null; idempotencyKey: string }, actor: Actor) {
    const countId = randomUUID();
    const seen = new Set<string>();
    const lines = [];
    let net = ZERO;
    let gross = ZERO;
    for (const [n, l] of c.lines.entries()) {
      if (seen.has(l.itemId)) throw new HttpException({ error: "duplicate_item" }, 400);
      seen.add(l.itemId);
      const counted = D(l.counted);
      if (counted.lt(0)) throw new HttpException({ error: "bad_quantity" }, 400);
      const r = await moveStock(t, { itemId: l.itemId, warehouseId, type: "STOCK_COUNT", countTo: counted, allowNegative: true, referenceType: "COUNT", referenceId: countId, employeeId: actor.id, reason: c.note ?? "Stock count", idempotencyKey: `${c.idempotencyKey}:${n}` });
      const value = r.quantity.mul(r.unitCost);
      net = net.add(value);
      gross = gross.add(value.abs());
      lines.push({ itemId: l.itemId, counted: q(counted), expected: q(r.quantityAfter.sub(r.quantity)), difference: q(r.quantity), value: money(value) });
    }
    const wh = await t.warehouse.findUniqueOrThrow({ where: { id: warehouseId }, select: { branchId: true } });
    await auditAs(t, actor, { action: "stock.count", entityType: "Warehouse", entityId: warehouseId, branchId: wh.branchId, after: { countId, items: lines.length, variance: money(net), note: c.note ?? null } });
    return { countId, lines, variance: money(net), varianceAbs: money(gross), itemsOff: lines.filter((l) => !D(l.difference).isZero()).length };
  }

  // ── recipes & costing ────────────────────────────────────────────────────

  async recipe(t: TenantTx, productId: string) {
    const p = await t.product.findUnique({
      where: { id: productId },
      select: {
        id: true, name: true, type: true, price: true, inventoryItemId: true,
        inventoryItem: { select: { id: true, name: true, baseUnit: true, averageCost: true } },
        recipeLines: { include: { inventoryItem: { select: { id: true, name: true, baseUnit: true, averageCost: true } } } },
      },
    });
    if (!p) throw new NotFoundException({ error: "not_found" });
    const cost = unitCost(
      { stockItemId: p.type === "STOCK_ITEM" ? p.inventoryItemId : null, recipe: p.recipeLines.map((r) => ({ itemId: r.inventoryItemId, quantity: r.quantity, wastePct: r.wastePct })), modifiers: [] },
      (id) => (id === p.inventoryItem?.id ? p.inventoryItem.averageCost : p.recipeLines.find((r) => r.inventoryItemId === id)?.inventoryItem.averageCost ?? ZERO),
    );
    return {
      productId: p.id, name: p.name, type: p.type, price: p.price.toFixed(2), stockItem: p.inventoryItem ? { id: p.inventoryItem.id, name: p.inventoryItem.name, baseUnit: p.inventoryItem.baseUnit } : null,
      lines: p.recipeLines.map((r) => ({ inventoryItemId: r.inventoryItemId, name: r.inventoryItem.name, baseUnit: r.inventoryItem.baseUnit, quantity: q(r.quantity), wastePct: r.wastePct.toString(), cost: money(r.quantity.mul(D(1).add(r.wastePct.div(100))).mul(r.inventoryItem.averageCost)) })),
      cost: money(cost),
    };
  }

  async setRecipe(t: TenantTx, productId: string, r: { inventoryItemId?: string | null; lines: Array<{ inventoryItemId: string; quantity: string; wastePct?: string | null }> }, actor: Actor) {
    const p = await t.product.findUnique({ where: { id: productId }, select: { id: true, organizationId: true, type: true } });
    if (!p) throw new NotFoundException({ error: "not_found" });
    const ids = [...new Set([...r.lines.map((l) => l.inventoryItemId), ...(r.inventoryItemId ? [r.inventoryItemId] : [])])];
    if ((await t.inventoryItem.count({ where: { id: { in: ids } } })) !== ids.length) throw new NotFoundException({ error: "item_not_found" });
    if (new Set(r.lines.map((l) => l.inventoryItemId)).size !== r.lines.length) throw new HttpException({ error: "duplicate_item" }, 400);
    if (r.inventoryItemId !== undefined) {
      if (r.inventoryItemId && p.type !== "STOCK_ITEM") throw new ConflictException({ error: "stock_link_needs_stock_item", hint: "Only ready items (cans, snacks) link 1:1 to a stock item; made-to-order items use a recipe." });
      await t.product.update({ where: { id: productId }, data: { inventoryItemId: r.inventoryItemId } });
    }
    await t.recipeLine.deleteMany({ where: { productId } });
    if (r.lines.length) await t.recipeLine.createMany({ data: r.lines.map((l) => ({ organizationId: p.organizationId, productId, inventoryItemId: l.inventoryItemId, quantity: l.quantity, wastePct: l.wastePct ?? "0" })) });
    await auditAs(t, actor, { action: "menu.recipe.set", entityType: "Product", entityId: productId, after: r });
    return this.recipe(t, productId);
  }

  /**
   * Food cost per menu item: ingredient cost at average cost against the
   * price without VAT (using a branch's tax profile when given).
   */
  async costing(t: TenantTx, branchId: string | null) {
    const products = await t.product.findMany({
      where: { isActive: true, type: { in: ["STOCK_ITEM", "RECIPE_ITEM", "COMBO"] } },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      select: {
        id: true, name: true, type: true, price: true, taxAppliesTo: true, inventoryItemId: true, category: { select: { name: true } },
        inventoryItem: { select: { averageCost: true } },
        recipeLines: { select: { inventoryItemId: true, quantity: true, wastePct: true, inventoryItem: { select: { averageCost: true } } } },
        productBranchPrices: branchId ? { where: { branchId }, select: { price: true } } : false,
      },
    });
    const profile = branchId ? (await t.branch.findUnique({ where: { id: branchId }, select: { taxProfile: { select: { pricesIncludeTax: true, taxRates: { select: { ratePercent: true, appliesTo: true } } } } } }))?.taxProfile : null;
    return products.map((p) => {
      const cost = unitCost(
        { stockItemId: p.type === "STOCK_ITEM" ? p.inventoryItemId : null, recipe: p.recipeLines.map((r) => ({ itemId: r.inventoryItemId, quantity: r.quantity, wastePct: r.wastePct })), modifiers: [] },
        (id) => (id === p.inventoryItemId ? (p.inventoryItem?.averageCost ?? ZERO) : (p.recipeLines.find((r) => r.inventoryItemId === id)?.inventoryItem.averageCost ?? ZERO)),
      );
      const gross = (p.productBranchPrices as Array<{ price: Prisma.Decimal | null }> | undefined)?.[0]?.price ?? p.price;
      const rate = (profile?.taxRates ?? []).filter((r) => r.appliesTo === "ALL" || r.appliesTo === p.taxAppliesTo).reduce((a, r) => a.add(r.ratePercent), ZERO);
      const net = profile?.pricesIncludeTax ? gross.div(D(1).add(rate.div(100))) : gross;
      const costed = p.recipeLines.length > 0 || (p.type === "STOCK_ITEM" && !!p.inventoryItemId);
      return {
        productId: p.id, name: p.name, category: p.category.name, type: p.type, price: gross.toFixed(2), netPrice: money(net), cost: money(cost), costed,
        foodCostPct: costed && net.gt(0) ? cost.div(net).mul(100).toDecimalPlaces(1).toString() : null,
        margin: costed ? money(net.sub(cost)) : null,
      };
    });
  }
}
