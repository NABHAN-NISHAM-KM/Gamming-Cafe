import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { holdsPermission, type PermissionKey, type Target } from "@arena/rbac";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { StockService } from "./stock.service.js";

const qty = z.union([z.number(), z.string()]).transform(String).refine((v) => /^-?\d{1,9}(\.\d{1,4})?$/.test(v), "invalid quantity");
const cost = z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,9}(\.\d{1,4})?$/.test(v), "invalid amount");
const CATEGORIES = ["FOOD", "DRINK", "INGREDIENT", "GAMING_ACCESSORY", "CONTROLLER", "HEADSET", "MERCHANDISE", "PC_PART", "CONSUMABLE", "PACKAGING", "OTHER"] as const;

const Item = z
  .object({
    sku: z.string().regex(/^[A-Z0-9-]{2,30}$/),
    barcode: z.string().max(40).nullish(),
    name: z.string().min(1).max(80),
    category: z.enum(CATEGORIES),
    baseUnit: z.string().min(1).max(10),
    purchaseUnit: z.string().max(20).nullish(),
    purchaseUnitQty: cost.nullish(),
    minStock: cost.default("0"),
    reorderQty: cost.nullish(),
    trackExpiry: z.boolean().default(false),
    trackSerial: z.boolean().default(false),
    defaultSupplierId: z.uuid().nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();
const Warehouse = z.object({ name: z.string().min(1).max(60), type: z.enum(["CENTRAL", "BRANCH_STORE", "KITCHEN", "BAR", "TECH_STORE"]), branchId: z.uuid().nullish(), isActive: z.boolean().default(true) }).strict();
const Adjust = z
  .object({
    itemId: z.uuid(),
    type: z.enum(["ADJUSTMENT", "WASTE", "ISSUE_TO_STATION"]),
    quantity: qty,
    lotId: z.uuid().nullish(),
    deviceId: z.uuid().nullish(),
    lot: z.object({ lotCode: z.string().max(40).nullish(), expiresAt: z.iso.date().nullish() }).strict().nullish(),
    unitCost: cost.nullish(),
    reason: z.string().min(3).max(200),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const Transfer = z.object({ fromWarehouseId: z.uuid(), toWarehouseId: z.uuid(), lines: z.array(z.object({ itemId: z.uuid(), quantity: cost }).strict()).min(1).max(100), note: z.string().max(200).nullish(), idempotencyKey: z.string().min(8).max(100) }).strict();
const Count = z.object({ lines: z.array(z.object({ itemId: z.uuid(), counted: cost }).strict()).min(1).max(500), note: z.string().max(200).nullish(), idempotencyKey: z.string().min(8).max(100) }).strict();
const Recipe = z.object({ inventoryItemId: z.uuid().nullish(), lines: z.array(z.object({ inventoryItemId: z.uuid(), quantity: cost, wastePct: z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v)).nullish() }).strict()).max(40) }).strict();
const ModifierStock = z.object({ inventoryItemId: z.uuid().nullable(), inventoryQty: cost.nullable() }).strict();

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });

/** The authorization target of a warehouse: its branch, or the organization for a central one. */
export async function warehouseTarget(id: string): Promise<Target & { warehouseId: string }> {
  const w = await tx().warehouse.findUnique({ where: { id }, select: { id: true, branchId: true, branch: { select: { brandId: true } } } });
  if (!w) throw new NotFoundException({ error: "warehouse_not_found" });
  return w.branchId ? { organizationId: orgId(), brandId: w.branch!.brandId, branchId: w.branchId, warehouseId: w.id } : { organizationId: orgId(), warehouseId: w.id };
}

/** Warehouses the caller may use with this permission. */
export async function visibleWarehouses(perm: PermissionKey, branchId?: string | null) {
  const all = await tx().warehouse.findMany({ where: branchId ? { branchId } : {}, select: { id: true, branchId: true, branch: { select: { brandId: true } } } });
  return all.filter((w) => holdsPermission(principal(), perm, w.branchId ? { organizationId: orgId(), brandId: w.branch!.brandId, branchId: w.branchId } : { organizationId: orgId() })).map((w) => w.id);
}

/**
 * Stock: items, warehouses, levels, movements, adjustments/waste, transfers,
 * counts — and recipes & menu costing. Everything is checked against the
 * warehouse's branch (a central warehouse needs organization-wide access).
 */
@Controller()
export class InventoryController {
  constructor(
    @Inject(StockService) private readonly inv: StockService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── warehouses ───────────────────────────────────────────────────────────

  @AnyStaff()
  @Get("warehouses")
  async warehouses(@Query("branchId") branchId?: string) {
    const ids = await visibleWarehouses("inventory.view", branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : null);
    if (!ids.length) authorizeFor("inventory.view", { organizationId: orgId() }); // nothing visible → a clear 403
    return (await this.inv.overview(tx(), ids)).warehouses;
  }

  @AnyStaff()
  @Post("warehouses")
  async addWarehouse(@Body(new ZodPipe(Warehouse)) body: z.infer<typeof Warehouse>) {
    let target: Target = { organizationId: orgId() };
    if (body.branchId) {
      const b = await tx().branch.findUnique({ where: { id: body.branchId }, select: { brandId: true } });
      if (!b) throw new NotFoundException({ error: "branch_not_found" });
      target = { organizationId: orgId(), brandId: b.brandId, branchId: body.branchId };
    } else if (body.type !== "CENTRAL") throw new ConflictException({ error: "branch_required", hint: "Only a central warehouse has no branch." });
    authorizeFor("inventory.manage", target);
    if (await tx().warehouse.findFirst({ where: { branchId: body.branchId ?? null, name: { equals: body.name, mode: "insensitive" } } })) throw new ConflictException({ error: "warehouse_name_taken" });
    const w = await tx().warehouse.create({ data: { ...body, branchId: body.branchId ?? null, organizationId: orgId() } });
    await this.audit.record({ action: "warehouse.create", entityType: "Warehouse", entityId: w.id, branchId: w.branchId, after: body });
    return w;
  }

  @AnyStaff()
  @Patch("warehouses/:id")
  async editWarehouse(@Param("id") id: string, @Body(new ZodPipe(Warehouse.pick({ name: true, isActive: true }).partial())) body: { name?: string; isActive?: boolean }) {
    authorizeFor("inventory.manage", await warehouseTarget(id));
    const w = await tx().warehouse.update({ where: { id }, data: body });
    await this.audit.record({ action: "warehouse.update", entityType: "Warehouse", entityId: id, branchId: w.branchId, after: body });
    return w;
  }

  @AnyStaff()
  @Get("warehouses/:id/stock")
  async stock(@Param("id") id: string, @Query("category") category?: string, @Query("q") q?: string) {
    authorizeFor("inventory.view", await warehouseTarget(id));
    return this.inv.warehouseStock(tx(), id, { category: (CATEGORIES as readonly string[]).includes(category ?? "") ? category : undefined, q: q?.slice(0, 60) || undefined });
  }

  @AnyStaff()
  @Get("warehouses/:id/movements")
  async whMovements(@Param("id") id: string, @Query("itemId") itemId?: string, @Query("type") type?: string, @Query("before") before?: string) {
    authorizeFor("inventory.view", await warehouseTarget(id));
    return this.inv.movements(tx(), { warehouseIds: [id], itemId: itemId && /^[0-9a-f-]{36}$/i.test(itemId) ? itemId : undefined, type: type && /^[A-Z_]{3,30}$/.test(type) ? type : undefined, before: before ? new Date(before) : undefined, limit: 200 });
  }

  // ── overview ─────────────────────────────────────────────────────────────

  @AnyStaff()
  @Get("inventory/overview")
  async overview(@Query("branchId") branchId?: string) {
    const ids = await visibleWarehouses("inventory.view", branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : null);
    if (!ids.length) authorizeFor("inventory.view", { organizationId: orgId() });
    return this.inv.overview(tx(), ids);
  }

  // ── items ────────────────────────────────────────────────────────────────

  @AnyStaff()
  @Get("inventory/items")
  async items(@Query("q") q?: string) {
    const ids = await visibleWarehouses("inventory.view");
    if (!ids.length) authorizeFor("inventory.view", { organizationId: orgId() });
    const needle = q?.trim().slice(0, 60);
    const items = await tx().inventoryItem.findMany({
      where: needle ? { OR: [{ name: { contains: needle, mode: "insensitive" } }, { sku: { contains: needle.toUpperCase() } }, { barcode: needle }] } : {},
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { defaultSupplier: { select: { id: true, name: true } }, stockLevels: { where: { warehouseId: { in: ids } }, select: { quantity: true } } },
    });
    return items.map(({ stockLevels, ...i }) => {
      const onHand = stockLevels.reduce((a, l) => a.add(l.quantity), i.minStock.mul(0));
      return {
        ...i, purchaseUnitQty: i.purchaseUnitQty?.toString() ?? null, averageCost: i.averageCost.toFixed(4), lastPurchaseCost: i.lastPurchaseCost?.toFixed(4) ?? null,
        minStock: i.minStock.toString(), reorderQty: i.reorderQty?.toString() ?? null, onHand: onHand.toString(), value: onHand.gt(0) ? onHand.mul(i.averageCost).toFixed(2) : "0.00",
      };
    });
  }

  @AnyStaff()
  @Get("inventory/items/:id")
  async item(@Param("id") id: string) {
    const ids = await visibleWarehouses("inventory.view");
    if (!ids.length) authorizeFor("inventory.view", { organizationId: orgId() });
    return this.inv.item(tx(), id, ids);
  }

  @AnyStaff()
  @Post("inventory/items")
  async addItem(@Body(new ZodPipe(Item)) body: z.infer<typeof Item>) {
    authorizeFor("inventory.manage", { organizationId: orgId() });
    if (await tx().inventoryItem.findFirst({ where: { sku: body.sku } })) throw new ConflictException({ error: "sku_taken" });
    if (body.defaultSupplierId && !(await tx().supplier.findUnique({ where: { id: body.defaultSupplierId }, select: { id: true } }))) throw new NotFoundException({ error: "supplier_not_found" });
    const i = await tx().inventoryItem.create({ data: { ...body, organizationId: orgId() } });
    await this.audit.record({ action: "inventory.item.create", entityType: "InventoryItem", entityId: i.id, after: body });
    return i;
  }

  @AnyStaff()
  @Patch("inventory/items/:id")
  async editItem(@Param("id") id: string, @Body(new ZodPipe(Item.partial())) body: Partial<z.infer<typeof Item>>) {
    authorizeFor("inventory.manage", { organizationId: orgId() });
    const before = await tx().inventoryItem.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: "item_not_found" });
    if (body.sku && body.sku !== before.sku && (await tx().inventoryItem.findFirst({ where: { sku: body.sku } }))) throw new ConflictException({ error: "sku_taken" });
    // Units define every quantity in the ledger; they can't change once stock has moved.
    if (body.baseUnit && body.baseUnit !== before.baseUnit && (await tx().stockMovement.count({ where: { itemId: id } }))) throw new ConflictException({ error: "unit_locked", hint: "Stock has moved in this unit — create a new item instead." });
    const i = await tx().inventoryItem.update({ where: { id }, data: body });
    await this.audit.record({ action: "inventory.item.update", entityType: "InventoryItem", entityId: id, before, after: body });
    return i;
  }

  // ── operations ───────────────────────────────────────────────────────────

  /** Adjustments and waste are sensitive (a reason is required and audited). */
  @AnyStaff()
  @Post("warehouses/:id/adjust")
  async adjust(@Param("id") id: string, @Body(new ZodPipe(Adjust)) body: z.infer<typeof Adjust>) {
    authorizeFor("inventory.adjust", await warehouseTarget(id));
    return this.inv.adjust(tx(), id, body, me());
  }

  @AnyStaff()
  @Post("inventory/transfers")
  async transfer(@Body(new ZodPipe(Transfer)) body: z.infer<typeof Transfer>) {
    authorizeFor("inventory.transfer", await warehouseTarget(body.fromWarehouseId));
    authorizeFor("inventory.transfer", await warehouseTarget(body.toWarehouseId));
    return this.inv.transfer(tx(), body, me());
  }

  @AnyStaff()
  @Post("warehouses/:id/counts")
  async count(@Param("id") id: string, @Body(new ZodPipe(Count)) body: z.infer<typeof Count>) {
    authorizeFor("inventory.count", await warehouseTarget(id));
    return this.inv.count(tx(), id, body, me());
  }

  // ── recipes & costing ────────────────────────────────────────────────────

  @AnyStaff()
  @Get("products/:id/recipe")
  recipe(@Param("id") id: string) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    return this.inv.recipe(tx(), id);
  }

  @AnyStaff()
  @Put("products/:id/recipe")
  setRecipe(@Param("id") id: string, @Body(new ZodPipe(Recipe)) body: z.infer<typeof Recipe>) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    return this.inv.setRecipe(tx(), id, body, me());
  }

  /** What an option (e.g. "extra cheese") takes out of stock. */
  @AnyStaff()
  @Put("modifiers/:id/stock")
  @HttpCode(200)
  async modifierStock(@Param("id") id: string, @Body(new ZodPipe(ModifierStock)) body: z.infer<typeof ModifierStock>) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    if (!!body.inventoryItemId !== !!body.inventoryQty) throw new ConflictException({ error: "item_and_quantity_together" });
    if (!(await tx().modifier.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException({ error: "not_found" });
    if (body.inventoryItemId && !(await tx().inventoryItem.findUnique({ where: { id: body.inventoryItemId }, select: { id: true } }))) throw new NotFoundException({ error: "item_not_found" });
    const m = await tx().modifier.update({ where: { id }, data: body });
    await this.audit.record({ action: "menu.modifier.stock", entityType: "Modifier", entityId: id, after: body });
    return m;
  }

  @AnyStaff()
  @Get("menu/costing")
  async costing(@Query("branchId") branchId?: string) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    return this.inv.costing(tx(), branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : null);
  }
}
