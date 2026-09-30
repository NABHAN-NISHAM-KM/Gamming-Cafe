import { Body, ConflictException, Controller, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Patch, Post, Put, Query, Sse, type MessageEvent } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Observable } from "rxjs";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, LongLived, RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { LiveBus, type FloorEvent } from "../devices/live.js";
import { holdsPermission } from "@arena/rbac";
import { KitchenService } from "./kitchen.service.js";
import { OrdersService } from "./orders.service.js";
import { ShiftsService } from "./shifts.service.js";

const money = z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v), "invalid amount");
const Tender = z.object({ method: z.enum(["CASH", "CARD", "WALLET"]), amount: money.nullish(), tendered: money.nullish(), reference: z.string().max(100).nullish() }).strict();
const Order = z
  .object({
    type: z.enum(["COUNTER", "TAKEAWAY", "DINE_IN", "GAMING_SEAT"]),
    lines: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(50), modifierIds: z.array(z.uuid()).max(20).optional(), notes: z.string().max(200).nullish() }).strict()).min(1).max(60),
    customerId: z.uuid().nullish(),
    deviceId: z.uuid().nullish(),
    tableId: z.uuid().nullish(),
    billId: z.uuid().nullish(),
    discount: z.union([z.object({ kind: z.literal("PERCENT"), value: z.number().min(0).max(100) }), z.object({ kind: z.literal("AMOUNT"), value: money })]).nullish(),
    notes: z.string().max(300).nullish(),
    payments: z.array(Tender).max(4).optional(),
    promoCode: z.string().regex(/^[A-Za-z0-9-]{3,40}$/).nullish(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const Pay = z.object({ payments: z.array(Tender).min(1).max(4), idempotencyKey: z.string().min(8).max(100) }).strict();
const Reason = z.object({ reason: z.string().min(2).max(200) }).strict();
const Refund = z.object({ amount: money, destination: z.enum(["ORIGINAL_METHOD", "WALLET", "CASH"]).default("ORIGINAL_METHOD"), reason: z.string().min(2).max(200), idempotencyKey: z.string().min(8).max(100) }).strict();
const Bump = z.object({ to: z.enum(["ACCEPTED", "PREPARING", "READY", "SERVED"]) }).strict();
const Category = z.object({ name: z.string().min(1).max(60), sortOrder: z.number().int().min(0).max(1000).default(0), showInShell: z.boolean().default(true), isActive: z.boolean().default(true) }).strict();
const Product = z
  .object({
    categoryId: z.uuid(),
    name: z.string().min(1).max(80),
    description: z.string().max(300).nullish(),
    type: z.enum(["STOCK_ITEM", "RECIPE_ITEM", "COMBO", "SERVICE"]),
    sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,30}$/, "use 2–30 letters, digits or dashes").optional(),
    price: money,
    taxAppliesTo: z.enum(["ALL", "FOOD", "BEVERAGE", "MERCHANDISE", "SERVICE"]).default("FOOD"),
    kitchenStationId: z.uuid().nullish(),
    prepTimeMinutes: z.number().int().min(0).max(240).nullish(),
    availableInShell: z.boolean().default(true),
    modifierGroupIds: z.array(z.uuid()).max(10).optional(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
const ModGroup = z
  .object({
    name: z.string().min(1).max(60),
    minSelect: z.number().int().min(0).max(10),
    maxSelect: z.number().int().min(1).max(20),
    modifiers: z.array(z.object({ name: z.string().min(1).max(60), priceDelta: z.union([z.number(), z.string()]).transform(String).refine((v) => /^-?\d{1,7}(\.\d{1,3})?$/.test(v)) }).strict()).min(1).max(30),
  })
  .strict()
  .refine((g) => g.minSelect <= g.maxSelect && g.maxSelect <= g.modifiers.length, "min ≤ max ≤ number of options");
const BranchPrice = z.object({ price: money.nullish(), isAvailable: z.boolean().optional() }).strict();
const Table = z.object({ name: z.string().min(1).max(20), seats: z.number().int().min(1).max(40).default(4), zoneId: z.uuid().nullish(), mapX: z.number().int().min(0).max(100).default(0), mapY: z.number().int().min(0).max(100).default(0), isActive: z.boolean().default(true) }).strict();
const TableStatus = z.object({ status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "BILL_REQUESTED", "OUT_OF_SERVICE"]) }).strict();
const OpenShift = z.object({ cashDrawerId: z.uuid(), openingCash: money }).strict();
const Movement = z.object({ type: z.enum(["PAY_IN", "PAY_OUT", "SAFE_DROP"]), amount: money, reason: z.string().min(2).max(200) }).strict();
const CloseShift = z.object({ countedCash: money, denominations: z.record(z.string().regex(/^\d+(\.\d+)?$/), z.number().int().min(0).max(100_000)).nullish(), notes: z.string().max(300).nullish() }).strict();
const Drawer = z.object({ name: z.string().min(1).max(40) }).strict();
const Station = z.object({ name: z.string().min(1).max(40) }).strict();

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });
const can = (perm: Parameters<typeof holdsPermission>[1], branchId: string, brandId: string | null) => holdsPermission(principal(), perm, { organizationId: orgId(), brandId, branchId });

async function branchOf(kind: "order" | "bill" | "ticket" | "item" | "payment" | "shift" | "table", id: string) {
  const branchId =
    kind === "order" ? (await tx().order.findUnique({ where: { id }, select: { branchId: true } }))?.branchId
    : kind === "bill" ? (await tx().bill.findUnique({ where: { id }, select: { branchId: true } }))?.branchId
    : kind === "ticket" ? (await tx().kitchenTicket.findUnique({ where: { id }, select: { branchId: true } }))?.branchId
    : kind === "item" ? (await tx().orderItem.findUnique({ where: { id }, select: { order: { select: { branchId: true } } } }))?.order.branchId
    : kind === "payment" ? (await tx().payment.findUnique({ where: { id }, select: { branchId: true } }))?.branchId
    : kind === "shift" ? (await tx().shift.findUnique({ where: { id }, select: { branchId: true } }))?.branchId
    : (await tx().restaurantTable.findUnique({ where: { id }, select: { branchId: true } }))?.branchId;
  if (!branchId) throw new NotFoundException({ error: "not_found" });
  const b = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { brandId: true } });
  return { organizationId: orgId(), brandId: b.brandId, branchId };
}

/**
 * POS, restaurant and kitchen: menu management, orders (counter / table /
 * seat), bills and split payments, voids, refunds, the kitchen display,
 * tables, and cashier shifts. Permissions are checked against the branch the
 * thing belongs to.
 */
@Controller()
export class PosController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(KitchenService) private readonly kitchen: KitchenService,
    @Inject(ShiftsService) private readonly shifts: ShiftsService,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  // ── menu ─────────────────────────────────────────────────────────────────

  @RequirePermission("pos.sell")
  @Get("branches/:branchId/menu")
  menu(@Param("branchId") branchId: string) {
    return this.orders.menu(tx(), branchId);
  }

  @AnyStaff()
  @Get("menu/manage")
  async manage() {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    const [categories, products, groups, stations] = await Promise.all([
      tx().productCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      tx().product.findMany({
        where: { type: { in: ["STOCK_ITEM", "RECIPE_ITEM", "COMBO", "SERVICE"] } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { productModifierGroups: { select: { modifierGroupId: true } }, productBranchPrices: { select: { branchId: true, price: true, isAvailable: true } }, kitchenStation: { select: { id: true, name: true } } },
      }),
      tx().modifierGroup.findMany({ include: { modifiers: { orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } }),
      tx().kitchenStation.findMany({ select: { id: true, name: true, branchId: true }, orderBy: { name: "asc" } }),
    ]);
    return { categories, products: products.map(({ productModifierGroups, ...p }) => ({ ...p, modifierGroupIds: productModifierGroups.map((g) => g.modifierGroupId) })), modifierGroups: groups, stations };
  }

  @AnyStaff()
  @Post("product-categories")
  async createCategory(@Body(new ZodPipe(Category)) body: z.infer<typeof Category>) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    const c = await tx().productCategory.create({ data: { ...body, organizationId: orgId() } });
    await this.audit.record({ action: "menu.category.create", entityType: "ProductCategory", entityId: c.id, after: c });
    return c;
  }

  @AnyStaff()
  @Patch("product-categories/:id")
  async updateCategory(@Param("id") id: string, @Body(new ZodPipe(Category.partial())) body: Partial<z.infer<typeof Category>>) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    const c = await tx().productCategory.update({ where: { id }, data: body });
    await this.audit.record({ action: "menu.category.update", entityType: "ProductCategory", entityId: id, after: c });
    return c;
  }

  @AnyStaff()
  @Post("products")
  async createProduct(@Body(new ZodPipe(Product)) body: z.infer<typeof Product>) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    const { modifierGroupIds, sku, ...data } = body;
    const org = await tx().organization.findFirstOrThrow({ select: { defaultCurrency: true } });
    const code = sku ?? `M-${randomBytes(3).toString("hex").toUpperCase()}`;
    if (await tx().product.findFirst({ where: { sku: code } })) throw new ConflictException({ error: "sku_taken" });
    const p = await tx().product.create({ data: { ...data, sku: code, currency: org.defaultCurrency, organizationId: orgId() } });
    if (modifierGroupIds?.length) await tx().productModifierGroup.createMany({ data: modifierGroupIds.map((g, i) => ({ organizationId: orgId(), productId: p.id, modifierGroupId: g, sortOrder: i })) });
    await this.audit.record({ action: "menu.product.create", entityType: "Product", entityId: p.id, after: body });
    return p;
  }

  @AnyStaff()
  @Patch("products/:id")
  async updateProduct(@Param("id") id: string, @Body(new ZodPipe(Product.partial())) body: Partial<z.infer<typeof Product>>) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    const before = await tx().product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    const { modifierGroupIds, sku, ...data } = body;
    const p = await tx().product.update({ where: { id }, data: { ...data, ...(sku ? { sku } : {}) } });
    if (modifierGroupIds) {
      await tx().productModifierGroup.deleteMany({ where: { productId: id } });
      if (modifierGroupIds.length) await tx().productModifierGroup.createMany({ data: modifierGroupIds.map((g, i) => ({ organizationId: orgId(), productId: id, modifierGroupId: g, sortOrder: i })) });
    }
    await this.audit.record({ action: "menu.product.update", entityType: "Product", entityId: id, before, after: body });
    return p;
  }

  /** Branch price override and "sold out" (86). The kitchen can mark sold out too. */
  @AnyStaff()
  @Put("products/:id/branches/:branchId")
  async branchPrice(@Param("id") id: string, @Param("branchId") branchId: string, @Body(new ZodPipe(BranchPrice)) body: z.infer<typeof BranchPrice>) {
    const b = await tx().branch.findUnique({ where: { id: branchId }, select: { brandId: true } });
    if (!b) throw new NotFoundException({ error: "branch_not_found" });
    const priceChange = body.price !== undefined;
    if (priceChange || !can("kds.bump", branchId, b.brandId)) authorizeFor("restaurant.menu_manage", { organizationId: orgId(), brandId: b.brandId, branchId });
    if (!(await tx().product.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException({ error: "not_found" });
    const row = await tx().productBranchPrice.upsert({
      where: { productId_branchId: { productId: id, branchId } },
      create: { organizationId: orgId(), productId: id, branchId, price: body.price ?? null, isAvailable: body.isAvailable ?? true },
      update: { ...(priceChange ? { price: body.price ?? null } : {}), ...(body.isAvailable !== undefined ? { isAvailable: body.isAvailable } : {}) },
    });
    await this.audit.record({ action: body.isAvailable === false ? "menu.sold_out" : "menu.branch_price", entityType: "Product", entityId: id, branchId, after: body });
    return row;
  }

  @AnyStaff()
  @Post("modifier-groups")
  async createGroup(@Body(new ZodPipe(ModGroup)) body: z.infer<typeof ModGroup>) {
    authorizeFor("restaurant.menu_manage", { organizationId: orgId() });
    const g = await tx().modifierGroup.create({
      data: { organizationId: orgId(), name: body.name, minSelect: body.minSelect, maxSelect: body.maxSelect, modifiers: { create: body.modifiers.map((m, i) => ({ name: m.name, priceDelta: m.priceDelta, sortOrder: i })) } },
      include: { modifiers: true },
    });
    await this.audit.record({ action: "menu.modifier_group.create", entityType: "ModifierGroup", entityId: g.id, after: body });
    return g;
  }

  @RequirePermission("restaurant.menu_manage")
  @Post("branches/:branchId/kitchen-stations")
  async createStation(@Param("branchId") branchId: string, @Body(new ZodPipe(Station)) body: z.infer<typeof Station>) {
    const s = await tx().kitchenStation.create({ data: { organizationId: orgId(), branchId, name: body.name } });
    await this.audit.record({ action: "kitchen.station.create", entityType: "KitchenStation", entityId: s.id, branchId, after: body });
    return s;
  }

  // ── orders & bills ───────────────────────────────────────────────────────

  @RequirePermission("pos.sell")
  @Post("branches/:branchId/orders")
  async place(@Param("branchId") branchId: string, @Body(new ZodPipe(Order)) body: z.infer<typeof Order>) {
    const b = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { brandId: true } });
    const target = { organizationId: orgId(), brandId: b.brandId, branchId };
    if (body.type === "DINE_IN") authorizeFor("restaurant.order", target);
    if (body.discount) authorizeFor("pos.discount", target);
    return this.orders.place(tx(), { ...body, branchId, channel: "POS" }, me());
  }

  @RequirePermission("pos.sell")
  @Get("branches/:branchId/bills")
  async bills(@Param("branchId") branchId: string, @Query("open") open?: string) {
    const rows = await tx().bill.findMany({
      where: { branchId, ...(open ? { status: { in: ["OPEN", "PARTIALLY_PAID"] } } : { openedAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }) },
      orderBy: { openedAt: "desc" },
      take: 100,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.orders.billView(tx(), r.id)));
  }

  @AnyStaff()
  @Get("bills/:id")
  async bill(@Param("id") id: string) {
    authorizeFor("pos.sell", await branchOf("bill", id));
    return this.orders.billView(tx(), id);
  }

  @AnyStaff()
  @Post("bills/:id/pay")
  @HttpCode(200)
  async pay(@Param("id") id: string, @Body(new ZodPipe(Pay)) body: z.infer<typeof Pay>) {
    authorizeFor("pos.sell", await branchOf("bill", id));
    return this.orders.pay(tx(), id, body.payments, me(), body.idempotencyKey);
  }

  @RequirePermission("pos.sell")
  @Get("branches/:branchId/orders")
  async list(@Param("branchId") branchId: string, @Query("open") open?: string) {
    const rows = await tx().order.findMany({
      where: { branchId, channel: { not: "SYSTEM" }, ...(open ? { status: { in: ["PLACED", "ACCEPTED", "IN_PROGRESS", "READY"] } } : { createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.orders.view(tx(), r.id)));
  }

  @AnyStaff()
  @Get("orders/:id")
  async order(@Param("id") id: string) {
    authorizeFor("pos.sell", await branchOf("order", id));
    return this.orders.view(tx(), id);
  }

  @AnyStaff()
  @Post("orders/:id/cancel")
  @HttpCode(200)
  async cancel(@Param("id") id: string, @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>) {
    authorizeFor("restaurant.cancel_order", await branchOf("order", id));
    return this.orders.cancel(tx(), id, body.reason, me());
  }

  /** Before the kitchen starts: pos.void_item. After: restaurant.cancel_order (sensitive). */
  @AnyStaff()
  @Post("order-items/:id/void")
  @HttpCode(200)
  async voidItem(@Param("id") id: string, @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>) {
    const target = await branchOf("item", id);
    authorizeFor("pos.void_item", target);
    // Once the kitchen has started, voiding is a sensitive override (reason required).
    const item = await tx().orderItem.findUniqueOrThrow({ where: { id }, select: { status: true, kitchenTicket: { select: { status: true } } } });
    const cooked = item.status === "SERVED" || ["PREPARING", "READY", "SERVED"].includes(item.kitchenTicket?.status ?? "");
    if (cooked && can("restaurant.cancel_order", target.branchId, target.brandId)) authorizeFor("restaurant.cancel_order", target);
    return this.orders.voidItem(tx(), id, body.reason, me(), cooked && can("restaurant.cancel_order", target.branchId, target.brandId));
  }

  @AnyStaff()
  @Post("payments/:id/refund")
  async refund(@Param("id") id: string, @Body(new ZodPipe(Refund)) body: z.infer<typeof Refund>) {
    authorizeFor("pos.refund", await branchOf("payment", id));
    return this.orders.refund(tx(), id, body, me());
  }

  // ── kitchen display ──────────────────────────────────────────────────────

  @RequirePermission("kds.view")
  @Get("branches/:branchId/kitchen")
  board(@Param("branchId") branchId: string, @Query("stationId") stationId?: string) {
    return this.kitchen.board(tx(), branchId, stationId && /^[0-9a-f-]{36}$/i.test(stationId) ? stationId : null);
  }

  @AnyStaff()
  @Post("kitchen-tickets/:id/bump")
  @HttpCode(200)
  async bump(@Param("id") id: string, @Body(new ZodPipe(Bump)) body: z.infer<typeof Bump>) {
    authorizeFor("kds.bump", await branchOf("ticket", id));
    return this.kitchen.bump(tx(), id, body.to, me());
  }

  @RequirePermission("kds.view")
  @LongLived()
  @Sse("branches/:branchId/kitchen/events")
  kitchenEvents(@Param("branchId") branchId: string): Observable<MessageEvent> {
    const org = orgId();
    return new Observable<MessageEvent>((sub) => {
      const off = this.bus.subscribe(org, branchId, (e: FloorEvent) => {
        if (e.type === "kitchen") sub.next({ type: "kitchen", data: e });
      });
      const ping = setInterval(() => sub.next({ type: "ping", data: { at: new Date().toISOString() } }), 20_000);
      sub.next({ type: "ready", data: { at: new Date().toISOString() } });
      return () => {
        off();
        clearInterval(ping);
      };
    });
  }

  // ── tables ───────────────────────────────────────────────────────────────

  @RequirePermission("restaurant.order")
  @Get("branches/:branchId/tables")
  async tables(@Param("branchId") branchId: string) {
    const tables = await tx().restaurantTable.findMany({ where: { branchId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, seats: true, status: true, zoneId: true, mapX: true, mapY: true } });
    const bills = await tx().bill.findMany({ where: { branchId, tableId: { in: tables.map((t) => t.id) }, status: { in: ["OPEN", "PARTIALLY_PAID"] } }, select: { id: true, tableId: true, total: true, paidTotal: true, openedAt: true } });
    return tables.map((t) => {
      const b = bills.find((x) => x.tableId === t.id);
      return { ...t, bill: b ? { id: b.id, total: b.total.toFixed(2), due: b.total.sub(b.paidTotal).toFixed(2), openedAt: b.openedAt } : null };
    });
  }

  @RequirePermission("restaurant.tables_manage")
  @Post("branches/:branchId/tables")
  async addTable(@Param("branchId") branchId: string, @Body(new ZodPipe(Table)) body: z.infer<typeof Table>) {
    if (await tx().restaurantTable.findFirst({ where: { branchId, name: body.name } })) throw new ConflictException({ error: "table_name_taken" });
    const t = await tx().restaurantTable.create({ data: { ...body, organizationId: orgId(), branchId, qrToken: randomBytes(16).toString("base64url") } });
    await this.audit.record({ action: "table.create", entityType: "RestaurantTable", entityId: t.id, branchId, after: body });
    return t;
  }

  @AnyStaff()
  @Patch("tables/:id")
  async editTable(@Param("id") id: string, @Body(new ZodPipe(Table.pick({ name: true, seats: true }).partial())) body: { name?: string; seats?: number }) {
    const target = await branchOf("table", id);
    authorizeFor("restaurant.tables_manage", target);
    if (body.name && (await tx().restaurantTable.findFirst({ where: { branchId: target.branchId!, name: body.name, id: { not: id } } }))) throw new ConflictException({ error: "table_name_taken" });
    const t = await tx().restaurantTable.update({ where: { id }, data: body, select: { id: true, name: true, seats: true } });
    await this.audit.record({ action: "table.update", entityType: "RestaurantTable", entityId: id, branchId: target.branchId, after: body });
    return t;
  }

  @AnyStaff()
  @Post("tables/:id/status")
  @HttpCode(200)
  async tableStatus(@Param("id") id: string, @Body(new ZodPipe(TableStatus)) body: z.infer<typeof TableStatus>) {
    const target = await branchOf("table", id);
    authorizeFor(body.status === "OUT_OF_SERVICE" ? "restaurant.tables_manage" : "restaurant.order", target);
    if (body.status === "AVAILABLE" && (await tx().bill.count({ where: { tableId: id, status: { in: ["OPEN", "PARTIALLY_PAID"] } } }))) throw new ConflictException({ error: "table_has_open_bill" });
    return tx().restaurantTable.update({ where: { id }, data: { status: body.status }, select: { id: true, name: true, status: true } });
  }

  // ── shifts & drawers ─────────────────────────────────────────────────────

  @RequirePermission("shift.open")
  @Get("branches/:branchId/cash-drawers")
  drawers(@Param("branchId") branchId: string) {
    return tx().cashDrawer.findMany({ where: { branchId, isActive: true }, select: { id: true, name: true, shifts: { where: { status: "OPEN" }, select: { id: true, employee: { select: { displayName: true } } } } }, orderBy: { name: "asc" } });
  }

  @RequirePermission("settings.manage")
  @Post("branches/:branchId/cash-drawers")
  async addDrawer(@Param("branchId") branchId: string, @Body(new ZodPipe(Drawer)) body: z.infer<typeof Drawer>) {
    const d = await tx().cashDrawer.create({ data: { organizationId: orgId(), branchId, name: body.name } });
    await this.audit.record({ action: "drawer.create", entityType: "CashDrawer", entityId: d.id, branchId, after: body });
    return d;
  }

  /** The caller's open shift at this branch (or null). */
  @RequirePermission("shift.open")
  @Get("branches/:branchId/shifts/me")
  async myShift(@Param("branchId") branchId: string) {
    const s = await tx().shift.findFirst({ where: { branchId, employeeId: principal().employeeId, status: "OPEN" }, select: { id: true } });
    return s ? this.shifts.report(tx(), s.id) : null;
  }

  @RequirePermission("shift.open")
  @Post("branches/:branchId/shifts")
  open(@Param("branchId") branchId: string, @Body(new ZodPipe(OpenShift)) body: z.infer<typeof OpenShift>) {
    return this.shifts.open(tx(), { branchId, ...body }, me());
  }

  @RequirePermission("shift.view_all")
  @Get("branches/:branchId/shifts")
  async shiftList(@Param("branchId") branchId: string) {
    const rows = await tx().shift.findMany({ where: { branchId }, orderBy: { openedAt: "desc" }, take: 50, select: { id: true } });
    return Promise.all(rows.map((r) => this.shifts.report(tx(), r.id)));
  }

  @AnyStaff()
  @Get("shifts/:id")
  async shift(@Param("id") id: string) {
    const target = await branchOf("shift", id);
    const own = (await tx().shift.findUniqueOrThrow({ where: { id }, select: { employeeId: true } })).employeeId === principal().employeeId;
    authorizeFor(own ? "shift.open" : "shift.view_all", target);
    return this.shifts.report(tx(), id);
  }

  @AnyStaff()
  @Post("shifts/:id/movements")
  async movement(@Param("id") id: string, @Body(new ZodPipe(Movement)) body: z.infer<typeof Movement>) {
    authorizeFor("shift.cash_movement", await branchOf("shift", id));
    return this.shifts.movement(tx(), id, body, me());
  }

  @AnyStaff()
  @Post("shifts/:id/close")
  @HttpCode(200)
  async close(@Param("id") id: string, @Body(new ZodPipe(CloseShift)) body: z.infer<typeof CloseShift>) {
    const target = await branchOf("shift", id);
    authorizeFor("shift.open", target);
    return this.shifts.close(tx(), id, body, me(), can("shift.approve", target.branchId, target.brandId));
  }

  @AnyStaff()
  @Post("shifts/:id/approve")
  @HttpCode(200)
  async approve(@Param("id") id: string, @Body(new ZodPipe(z.object({ note: z.string().max(200).nullish() }).strict())) body: { note?: string | null }) {
    authorizeFor("shift.approve", await branchOf("shift", id));
    if (body.note && body.note.length < 2) throw new HttpException({ error: "bad_note" }, 400);
    return this.shifts.approve(tx(), id, body.note ?? null, me());
  }
}
