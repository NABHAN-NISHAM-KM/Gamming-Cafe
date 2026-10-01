import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { LiveBus } from "../devices/live.js";
import { consumeOrder, returnOrderItems, stockForProducts } from "../inventory/stock.js";
import { reverseForRefund } from "../loyalty/points.js";
import { PromotionsService } from "../promotions/promotions.service.js";
import { moveMoney } from "../wallet/wallet.js";
import { fromMinor, minorUnit, openShiftOf, recomputeBill, recordPayment, toMinor } from "./bills.js";
import { cashChange, OrderPricingError, priceOrder, validateModifiers, type OrderDiscount, type TaxClass, type TaxProfileDef } from "./order-pricing.js";

export type OrderActor = { type: "EMPLOYEE"; id: string } | { type: "CUSTOMER"; id: string } | { type: "DEVICE"; id: string } | { type: "SYSTEM"; id: null };
export type PayInput = { method: "CASH" | "CARD" | "WALLET"; amount?: string | null; tendered?: string | null; reference?: string | null };

export interface PlaceOrder {
  branchId: string;
  channel: "POS" | "SHELL" | "WAITER" | "WEB";
  type: "COUNTER" | "TAKEAWAY" | "DINE_IN" | "GAMING_SEAT";
  lines: Array<{ productId: string; quantity: number; modifierIds?: string[]; notes?: string | null }>;
  customerId?: string | null;
  deviceId?: string | null;
  tableId?: string | null;
  billId?: string | null;
  discount?: { kind: "PERCENT"; value: number } | { kind: "AMOUNT"; value: string } | null;
  notes?: string | null;
  /** Pay straight away (counter sales). Without it the order goes on the bill (table / PC seat). */
  payments?: PayInput[];
  idempotencyKey: string;
  /** Server-generated charges (e.g. printing) may use products hidden from the Shell menu. */
  internal?: boolean;
  promoCode?: string | null;
}

const LIVE_SESSION = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;
const FOOD_TYPES = ["STOCK_ITEM", "RECIPE_ITEM", "COMBO", "SERVICE"] as const;
const stamp = () => `${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

/**
 * Orders at the counter, at a table, or to a gaming seat (from the Shell).
 * Prices come from the menu (branch price overrides, modifiers) and the
 * branch's tax profile — never from the client. Kitchen items become tickets
 * on their station's display; everything lands on one bill per visit.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(PromotionsService) private readonly promotions: PromotionsService,
  ) {}

  // ── menu ─────────────────────────────────────────────────────────────────

  async menu(t: TenantTx, branchId: string, opts: { shellOnly?: boolean } = {}) {
    const branch = await t.branch.findUnique({ where: { id: branchId }, select: { currency: true } });
    if (!branch) throw new NotFoundException({ error: "branch_not_found" });
    const unit = await minorUnit(t, branch.currency);
    const cats = await t.productCategory.findMany({
      where: { isActive: true, ...(opts.shellOnly ? { showInShell: true } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, imageUrl: true, showInShell: true,
        products: {
          where: { isActive: true, type: { in: [...FOOD_TYPES] }, ...(opts.shellOnly ? { availableInShell: true } : {}) },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true, name: true, description: true, imageUrl: true, price: true, currency: true, type: true, sku: true, taxAppliesTo: true, prepTimeMinutes: true, requiresAgeCheck: true, inventoryItemId: true,
            kitchenStation: { select: { id: true, name: true } },
            productBranchPrices: { where: { branchId }, select: { price: true, isAvailable: true } },
            productModifierGroups: {
              orderBy: { sortOrder: "asc" },
              select: { modifierGroup: { select: { id: true, name: true, minSelect: true, maxSelect: true, modifiers: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, priceDelta: true } } } } },
            },
          },
        },
      },
    });
    // Stock items the branch has run out of show as sold out (on the POS and on customers' PCs).
    const onHand = await stockForProducts(t, branchId, cats.flatMap((c) => c.products.map((p) => ({ id: p.id, type: p.type, inventoryItemId: p.inventoryItemId, stationName: p.kitchenStation?.name ?? null }))));
    return {
      currency: branch.currency,
      categories: cats
        .map((c) => ({
          id: c.id, name: c.name, imageUrl: c.imageUrl, showInShell: c.showInShell,
          products: c.products.map((p) => {
            const bp = p.productBranchPrices[0];
            return {
              id: p.id, name: p.name, description: p.description, imageUrl: p.imageUrl, sku: p.sku, type: p.type, taxClass: p.taxAppliesTo, prepTimeMinutes: p.prepTimeMinutes,
              price: (bp?.price ?? p.price).toFixed(unit), available: (bp ? bp.isAvailable : true) && !(onHand.get(p.id)?.lte(0) ?? false), station: p.kitchenStation?.name ?? null,
              modifierGroups: p.productModifierGroups.map(({ modifierGroup: g }) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta.toFixed(unit) })) })),
            };
          }),
        }))
        .filter((c) => c.products.length > 0),
    };
  }

  private async taxProfile(t: TenantTx, branchId: string): Promise<TaxProfileDef | null> {
    const b = await t.branch.findUniqueOrThrow({ where: { id: branchId }, select: { taxProfile: { select: { pricesIncludeTax: true, taxRates: { select: { name: true, ratePercent: true, appliesTo: true } } } } } });
    if (!b.taxProfile) return null;
    return { pricesIncludeTax: b.taxProfile.pricesIncludeTax, rates: b.taxProfile.taxRates.map((r) => ({ name: r.name, ratePercent: Number(r.ratePercent), appliesTo: r.appliesTo as TaxClass })) };
  }

  // ── place ────────────────────────────────────────────────────────────────

  async place(t: TenantTx, i: PlaceOrder, actor: OrderActor) {
    const dup = await t.order.findFirst({ where: { idempotencyKey: i.idempotencyKey }, select: { id: true } });
    if (dup) return this.view(t, dup.id);
    if (!i.lines.length || i.lines.length > 60) throw new HttpException({ error: "bad_lines" }, 400);

    const branch = await t.branch.findUnique({ where: { id: i.branchId }, select: { id: true, code: true, currency: true, organizationId: true } });
    if (!branch) throw new NotFoundException({ error: "branch_not_found" });
    const unit = await minorUnit(t, branch.currency);
    const employeeId = actor.type === "EMPLOYEE" ? actor.id : null;

    // Where it goes and whose bill it joins.
    let billId = i.billId ?? null;
    let customerId = i.customerId ?? null;
    let deliverTo: string | null = null;
    let gamingSessionId: string | null = null;
    let tableId: string | null = null;
    if (i.type === "GAMING_SEAT") {
      if (!i.deviceId) throw new HttpException({ error: "device_required" }, 400);
      const device = await t.device.findFirst({ where: { id: i.deviceId, branchId: branch.id }, select: { id: true, name: true, zone: { select: { name: true } } } });
      if (!device) throw new NotFoundException({ error: "device_not_found" });
      const s = await t.gamingSession.findFirst({ where: { deviceId: device.id, status: { in: [...LIVE_SESSION] } }, select: { id: true, billId: true, customerId: true } });
      if (!s) throw new ConflictException({ error: "no_session", hint: "Nobody is playing on that PC." });
      billId = s.billId;
      gamingSessionId = s.id;
      customerId = s.customerId ?? customerId;
      deliverTo = `${device.name} · ${device.zone.name}`;
    } else if (i.type === "DINE_IN") {
      if (!i.tableId) throw new HttpException({ error: "table_required" }, 400);
      const table = await t.restaurantTable.findFirst({ where: { id: i.tableId, branchId: branch.id, isActive: true } });
      if (!table) throw new NotFoundException({ error: "table_not_found" });
      if (table.status === "OUT_OF_SERVICE") throw new ConflictException({ error: "table_out_of_service" });
      tableId = table.id;
      deliverTo = `Table ${table.name}`;
      billId ??= (await t.bill.findFirst({ where: { tableId: table.id, status: { in: ["OPEN", "PARTIALLY_PAID"] } }, orderBy: { openedAt: "desc" }, select: { id: true } }))?.id ?? null;
      if (table.status !== "OCCUPIED") await t.restaurantTable.update({ where: { id: table.id }, data: { status: "OCCUPIED" } });
    } else {
      deliverTo = i.type === "TAKEAWAY" ? "Takeaway" : "Counter";
    }
    if (billId) {
      const bill = await t.bill.findFirst({ where: { id: billId, branchId: branch.id }, select: { id: true, status: true, customerId: true } });
      if (!bill) throw new NotFoundException({ error: "bill_not_found" });
      if (bill.status === "VOID") throw new ConflictException({ error: "bill_void" });
      customerId ??= bill.customerId;
    } else {
      billId = (await t.bill.create({ data: { organizationId: branch.organizationId, branchId: branch.id, number: `${branch.code}-${stamp()}`, customerId, tableId, currency: branch.currency, openedById: employeeId } })).id;
    }

    // Price every line from the menu — the client only says what and how many.
    const ids = [...new Set(i.lines.map((l) => l.productId))];
    const products = await t.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true, type: true, isActive: true, availableInShell: true, price: true, taxAppliesTo: true, inventoryItemId: true, kitchenStationId: true, categoryId: true, kitchenStation: { select: { name: true, branchId: true } },
        productBranchPrices: { where: { branchId: branch.id }, select: { price: true, isAvailable: true } },
        productModifierGroups: { select: { modifierGroup: { select: { id: true, name: true, minSelect: true, maxSelect: true, modifiers: { where: { isActive: true }, select: { id: true, name: true, priceDelta: true } } } } } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const priceInputs = i.lines.map((l) => {
      const p = byId.get(l.productId);
      if (!p || !p.isActive || !(FOOD_TYPES as readonly string[]).includes(p.type)) throw new NotFoundException({ error: "product_not_found", productId: l.productId });
      const bp = p.productBranchPrices[0];
      if (bp && !bp.isAvailable) throw new ConflictException({ error: "sold_out", product: p.name });
      if (i.channel === "SHELL" && !p.availableInShell && !i.internal) throw new ConflictException({ error: "not_orderable_here", product: p.name });
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > (i.internal ? 10_000 : 50)) throw new HttpException({ error: "bad_quantity" }, 400);
      const groups = p.productModifierGroups.map(({ modifierGroup: g }) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, modifierIds: g.modifiers.map((m) => m.id), modifiers: g.modifiers }));
      const chosen = l.modifierIds ?? [];
      try {
        validateModifiers(groups, chosen);
      } catch (e) {
        if (e instanceof OrderPricingError) throw new ConflictException({ error: e.code, message: `${p.name}: ${e.message}`, product: p.name });
        throw e;
      }
      const mods = groups.flatMap((g) => g.modifiers).filter((m) => chosen.includes(m.id));
      return {
        product: p, line: l, mods,
        input: { unitMinor: toMinor(bp?.price ?? p.price, unit), quantity: l.quantity, modifiers: mods.map((m) => ({ name: m.name, priceDeltaMinor: toMinor(m.priceDelta, unit) })), taxClass: p.taxAppliesTo as TaxClass },
      };
    });
    // Ready items (cans, snacks) can't be sold past what's on the shelf.
    const onHand = await stockForProducts(t, branch.id, products.map((p) => ({ id: p.id, type: p.type, inventoryItemId: p.inventoryItemId, stationName: p.kitchenStation?.name ?? null })));
    const wanted = new Map<string, number>();
    for (const l of i.lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
    for (const [pid, qty] of wanted) {
      const left = onHand.get(pid);
      if (left !== undefined && left.lt(qty)) throw new ConflictException({ error: "sold_out", product: byId.get(pid)!.name, left: Math.max(0, Math.floor(Number(left))) });
    }
    // Promotions (automatic ones, and a promo code if given) come off on top of any manual discount.
    const lineUnit = (x: (typeof priceInputs)[number]) => x.input.unitMinor + x.input.modifiers.reduce((a, m) => a + m.priceDeltaMinor, 0);
    const subtotalMinor = priceInputs.reduce((a, x) => a + lineUnit(x) * x.input.quantity, 0);
    const promo = i.internal
      ? null
      : await this.promotions.evaluate(t, { branchId: branch.id, customerId, order: { lines: priceInputs.map((x) => ({ productId: x.product.id, categoryId: x.product.categoryId, quantity: x.input.quantity, unitMinor: lineUnit(x) })) } }, i.promoCode ?? null);
    const manualMinor = !i.discount ? 0 : i.discount.kind === "PERCENT" ? Math.round((subtotalMinor * i.discount.value) / 100) : toMinor(i.discount.value, unit);
    const totalDiscount = Math.min(subtotalMinor, manualMinor + (promo?.discountMinor ?? 0));
    const discount: OrderDiscount = totalDiscount > 0 ? { kind: "AMOUNT", valueMinor: totalDiscount } : null;
    let priced;
    try {
      priced = priceOrder(priceInputs.map((x) => x.input), await this.taxProfile(t, branch.id), discount);
    } catch (e) {
      if (e instanceof OrderPricingError) throw new ConflictException({ error: e.code, message: e.message });
      throw e;
    }

    // Kitchen routing: each product's station, resolved at this branch (by name for multi-branch menus).
    const stations = await t.kitchenStation.findMany({ where: { branchId: branch.id, isActive: true }, select: { id: true, name: true } });
    const stationFor = (p: (typeof products)[number]) => {
      if (!p.kitchenStation) return null;
      // At the counter a can from the fridge is handed straight over — no ticket.
      if ((i.type === "COUNTER" || i.type === "TAKEAWAY") && p.type === "STOCK_ITEM") return null;
      if (p.kitchenStation.branchId === branch.id) return p.kitchenStationId;
      return stations.find((s) => s.name.toLowerCase() === p.kitchenStation!.name.toLowerCase())?.id ?? stations[0]?.id ?? null;
    };

    const shift = await openShiftOf(t, employeeId, branch.id);
    const now = new Date();
    const count = await t.order.count({ where: { branchId: branch.id, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } });
    const order = await t.order.create({
      data: {
        organizationId: branch.organizationId, branchId: branch.id, number: `${i.channel === "SHELL" ? "S" : i.type === "DINE_IN" ? "T" : "A"}${String(count + 1).padStart(3, "0")}`,
        channel: i.channel, type: i.type, status: "PLACED", paymentState: "UNPAID", billId, customerId, deviceId: i.type === "GAMING_SEAT" ? i.deviceId! : null, gamingSessionId, tableId,
        employeeId, shiftId: shift?.id ?? null, deliverTo, subtotal: fromMinor(priced.subtotalMinor, unit), discountTotal: fromMinor(priced.discountMinor, unit), taxTotal: fromMinor(priced.taxMinor, unit),
        total: fromMinor(priced.totalMinor, unit), currency: branch.currency, notes: i.notes ?? null, placedAt: now, idempotencyKey: i.idempotencyKey,
      },
    });

    const ticketFor = new Map<string, string>();
    for (const [idx, x] of priceInputs.entries()) {
      const pl = priced.lines[idx]!;
      const stationId = stationFor(x.product);
      let kitchenTicketId: string | null = null;
      if (stationId) {
        if (!ticketFor.has(stationId)) {
          const tk = await t.kitchenTicket.create({ data: { organizationId: branch.organizationId, branchId: branch.id, orderId: order.id, stationId, deliverTo, customerLabel: null, notes: i.notes ?? null } });
          ticketFor.set(stationId, tk.id);
        }
        kitchenTicketId = ticketFor.get(stationId)!;
      }
      await t.orderItem.create({
        data: {
          organizationId: branch.organizationId, orderId: order.id, productId: x.product.id, kitchenTicketId, nameSnapshot: x.product.name, productType: x.product.type, quantity: x.line.quantity,
          unitPrice: fromMinor(pl.unitMinor, unit), modifiers: x.mods.map((m) => ({ modifierId: m.id, name: m.name, priceDelta: m.priceDelta.toFixed(unit) })) as Prisma.InputJsonValue,
          modifiersTotal: fromMinor(pl.modifiersMinor, unit), discountAmount: fromMinor(pl.discountMinor, unit), taxAmount: fromMinor(pl.taxMinor, unit), lineTotal: fromMinor(pl.netMinor, unit),
          taxBreakdown: pl.taxes as unknown as Prisma.InputJsonValue, status: kitchenTicketId ? "SENT_TO_KITCHEN" : "SERVED", notes: x.line.notes ?? null, gamingSessionId,
        },
      });
    }
    // Nothing for the kitchen (a can from the fridge): handed over at once.
    if (ticketFor.size === 0) await t.order.update({ where: { id: order.id }, data: { status: "SERVED" } });

    await consumeOrder(t, order.id, branch.id, employeeId);
    if (promo?.applied.length) await this.promotions.redeem(t, promo, { customerId, orderId: order.id });
    await recomputeBill(t, billId);
    // Paying now pays for THIS order (a seat order paid from the wallet mustn't settle the whole session bill).
    if (i.payments?.length) await this.pay(t, billId, i.payments, actor, `${i.idempotencyKey}:pay`, order.id, priced.totalMinor);
    else if (i.type !== "COUNTER" && i.type !== "TAKEAWAY") await t.order.update({ where: { id: order.id }, data: { paymentState: "ON_BILL" } });

    await auditAs(t, actor, { action: "order.place", entityType: "Order", entityId: order.id, branchId: branch.id, after: { number: order.number, type: i.type, channel: i.channel, total: fromMinor(priced.totalMinor, unit).toFixed(unit), items: i.lines.length } });
    for (const [stationId, ticketId] of ticketFor) this.bus.publish(branch.organizationId, branch.id, { type: "kitchen", ticket: { id: ticketId, stationId, status: "NEW", orderId: order.id } });
    const who = customerId ? (await t.customer.findUnique({ where: { id: customerId }, select: { displayName: true } }))?.displayName ?? null : null;
    this.bus.publish(branch.organizationId, branch.id, {
      type: "order", change: "placed",
      order: {
        id: order.id, number: order.number, type: i.type, channel: i.channel, deliverTo, customer: who, total: fromMinor(priced.totalMinor, unit).toFixed(unit), currency: branch.currency, notes: i.notes ?? null,
        items: priceInputs.map((x) => ({ name: x.product.name, quantity: Number(x.line.quantity) })),
      },
    });
    return this.view(t, order.id);
  }

  // ── pay ──────────────────────────────────────────────────────────────────

  /** Pays a bill with one or more tenders (split payment). Cash needs an open shift; change is worked out. */
  async pay(t: TenantTx, billId: string, payments: PayInput[], actor: OrderActor, key: string, orderId: string | null = null, forAmountMinor: number | null = null) {
    const bill = await t.bill.findUnique({ where: { id: billId }, select: { id: true, organizationId: true, branchId: true, currency: true, customerId: true, total: true, paidTotal: true, status: true } });
    if (!bill) throw new NotFoundException({ error: "bill_not_found" });
    if (bill.status === "VOID") throw new ConflictException({ error: "bill_void" });
    const unit = await minorUnit(t, bill.currency);
    let due = toMinor(bill.total, unit) - toMinor(bill.paidTotal, unit);
    if (forAmountMinor !== null) due = Math.min(due, forAmountMinor);
    const change: number[] = [];
    for (const [n, p] of payments.entries()) {
      const k = `${key}:${n}`;
      if (await t.payment.findFirst({ where: { idempotencyKey: k }, select: { id: true } })) continue; // retry of an applied tender
      if (due <= 0) throw new ConflictException({ error: "already_paid" });
      const amount = p.amount != null ? toMinor(p.amount, unit) : due;
      if (amount <= 0 || amount > due) throw new ConflictException({ error: "bad_amount", due: fromMinor(due, unit).toFixed(unit) });
      const tendered = p.method === "CASH" && p.tendered != null ? toMinor(p.tendered, unit) : null;
      if (tendered !== null) {
        try {
          change.push(cashChange(amount, tendered));
        } catch {
          throw new ConflictException({ error: "insufficient_cash", due: fromMinor(amount, unit).toFixed(unit) });
        }
      }
      await recordPayment(t, {
        bill: { id: bill.id, branchId: bill.branchId, currency: bill.currency }, method: p.method, amountMinor: amount, unit, key: k, customerId: bill.customerId,
        employeeId: actor.type === "EMPLOYEE" ? actor.id : null, orderId, reference: p.reference ?? null, tenderedMinor: tendered, requireShiftForCash: actor.type === "EMPLOYEE",
      });
      due -= amount;
    }
    const after = await recomputeBill(t, bill.id);
    if (after.status === "SETTLED") {
      const table = await t.bill.findUniqueOrThrow({ where: { id: bill.id }, select: { tableId: true } });
      if (table.tableId && !(await t.bill.count({ where: { tableId: table.tableId, status: { in: ["OPEN", "PARTIALLY_PAID"] } } }))) {
        await t.restaurantTable.update({ where: { id: table.tableId }, data: { status: "CLEANING" } });
      }
    }
    for (const o of await t.order.findMany({ where: { billId: bill.id }, select: { id: true } })) this.bus.publish(bill.organizationId, bill.branchId, { type: "order", change: "updated", order: { id: o.id } });
    return { ...(await this.billView(t, bill.id)), change: change.length ? fromMinor(change.reduce((a, b) => a + b, 0), unit).toFixed(unit) : null };
  }

  // ── changes after placing ────────────────────────────────────────────────

  async voidItem(t: TenantTx, itemId: string, reason: string, actor: Extract<OrderActor, { type: "EMPLOYEE" }>, canVoidCooked: boolean) {
    const item = await t.orderItem.findUnique({ where: { id: itemId }, include: { order: { select: { id: true, billId: true, branchId: true, status: true } }, kitchenTicket: { select: { status: true } } } });
    if (!item) throw new NotFoundException({ error: "not_found" });
    if (item.status === "VOIDED" || item.status === "REFUNDED") throw new ConflictException({ error: "already_voided" });
    const cooking = item.kitchenTicket && ["PREPARING", "READY", "SERVED"].includes(item.kitchenTicket.status);
    if ((cooking || item.status === "SERVED") && !canVoidCooked) throw new ConflictException({ error: "already_prepared", hint: "It's already being made — a manager can cancel it." });
    const paid = await t.bill.findUnique({ where: { id: item.order.billId ?? "" }, select: { status: true } });
    if (paid?.status === "SETTLED") throw new ConflictException({ error: "bill_settled", hint: "Refund it instead." });
    await t.orderItem.update({ where: { id: itemId }, data: { status: "VOIDED", voidedById: actor.id, voidReason: reason } });
    // Not started → the ingredients go back on the shelf. Cooked food stays used (it was made).
    if (!cooking && item.status !== "SERVED") await returnOrderItems(t, [itemId], item.order.branchId, actor.id, reason);
    await this.retotal(t, item.order.id);
    await auditAs(t, actor, { action: "order.void_item", entityType: "Order", entityId: item.order.id, branchId: item.order.branchId, after: { item: item.nameSnapshot, qty: item.quantity.toString(), amount: item.lineTotal.toString(), reason } });
    return this.view(t, item.order.id);
  }

  async cancel(t: TenantTx, orderId: string, reason: string, actor: Extract<OrderActor, { type: "EMPLOYEE" }>) {
    const o = await t.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, billId: true, branchId: true, organizationId: true, paymentState: true } });
    if (!o) throw new NotFoundException({ error: "not_found" });
    if (["CANCELLED", "COMPLETED", "REFUNDED"].includes(o.status)) throw new ConflictException({ error: "not_cancellable", status: o.status });
    if (o.paymentState === "PAID" && (await t.payment.count({ where: { orderId, status: "CAPTURED" } }))) throw new ConflictException({ error: "order_paid", hint: "Refund it instead." });
    const unstarted = await t.orderItem.findMany({ where: { orderId, status: { notIn: ["VOIDED", "REFUNDED", "SERVED"] }, OR: [{ kitchenTicketId: null }, { kitchenTicket: { status: { in: ["NEW", "ACCEPTED"] } } }] }, select: { id: true } });
    await t.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, cancelledById: actor.id } });
    await returnOrderItems(t, unstarted.map((x) => x.id), o.branchId, actor.id, reason);
    await t.orderItem.updateMany({ where: { orderId, status: { notIn: ["VOIDED", "REFUNDED"] } }, data: { status: "VOIDED", voidedById: actor.id, voidReason: reason } });
    const tickets = await t.kitchenTicket.findMany({ where: { orderId, status: { notIn: ["SERVED", "CANCELLED"] } }, select: { id: true, stationId: true } });
    await t.kitchenTicket.updateMany({ where: { id: { in: tickets.map((x) => x.id) } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (o.billId) await recomputeBill(t, o.billId);
    await auditAs(t, actor, { action: "order.cancel", entityType: "Order", entityId: orderId, branchId: o.branchId, after: { reason } });
    for (const tk of tickets) this.bus.publish(o.organizationId, o.branchId, { type: "kitchen", ticket: { id: tk.id, stationId: tk.stationId, status: "CANCELLED", orderId } });
    this.bus.publish(o.organizationId, o.branchId, { type: "order", change: "updated", order: { id: orderId } });
    return this.view(t, orderId);
  }

  /** Puts an unpaid order on the bill of whoever is playing at a PC (pay it with their session). */
  async moveToSeat(t: TenantTx, orderId: string, deviceId: string, actor: Extract<OrderActor, { type: "EMPLOYEE" }>) {
    const o = await t.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, status: true, billId: true, organizationId: true, branchId: true, paymentState: true } });
    if (!o) throw new NotFoundException({ error: "not_found" });
    if (["CANCELLED", "REFUNDED"].includes(o.status)) throw new ConflictException({ error: "not_movable", status: o.status });
    if (o.paymentState === "PAID" || (await t.payment.count({ where: { orderId, status: "CAPTURED" } }))) throw new ConflictException({ error: "order_paid" });
    const device = await t.device.findFirst({ where: { id: deviceId, branchId: o.branchId }, select: { id: true, name: true, zone: { select: { name: true } } } });
    if (!device) throw new NotFoundException({ error: "device_not_found" });
    const s = await t.gamingSession.findFirst({ where: { deviceId, status: { in: [...LIVE_SESSION] } }, select: { id: true, billId: true } });
    if (!s?.billId) throw new ConflictException({ error: "no_session", hint: "Nobody is playing on that PC." });
    if (s.billId === o.billId) throw new ConflictException({ error: "already_on_bill" });
    await t.order.update({ where: { id: orderId }, data: { billId: s.billId, gamingSessionId: s.id, paymentState: "ON_BILL" } });
    await t.orderItem.updateMany({ where: { orderId }, data: { gamingSessionId: s.id } });
    await recomputeBill(t, s.billId);
    if (o.billId) {
      const left = await recomputeBill(t, o.billId);
      if (left.status === "SETTLED" && left.tableId && !(await t.bill.count({ where: { tableId: left.tableId, status: { in: ["OPEN", "PARTIALLY_PAID"] } } }))) {
        await t.restaurantTable.update({ where: { id: left.tableId }, data: { status: "CLEANING" } });
      }
    }
    this.bus.publish(o.organizationId, o.branchId, { type: "order", change: "updated", order: { id: orderId } });
    await auditAs(t, actor, { action: "order.move_to_seat", entityType: "Order", entityId: orderId, branchId: o.branchId, after: { number: o.number, to: `${device.name} · ${device.zone.name}` } });
    return this.view(t, orderId);
  }

  /** Order totals = its live lines (voided lines drop out). */
  private async retotal(t: TenantTx, orderId: string) {
    const o = await t.order.findUniqueOrThrow({ where: { id: orderId }, select: { billId: true, currency: true } });
    const items = await t.orderItem.findMany({ where: { orderId, status: { notIn: ["VOIDED", "REFUNDED"] } }, select: { unitPrice: true, modifiersTotal: true, quantity: true, discountAmount: true, taxAmount: true, lineTotal: true } });
    const sum = (f: (x: (typeof items)[number]) => Prisma.Decimal) => items.reduce((a, x) => a.add(f(x)), new Prisma.Decimal(0));
    await t.order.update({
      where: { id: orderId },
      data: { subtotal: sum((x) => x.unitPrice.add(x.modifiersTotal).mul(x.quantity)), discountTotal: sum((x) => x.discountAmount), taxTotal: sum((x) => x.taxAmount), total: sum((x) => x.lineTotal), ...(items.length === 0 ? { status: "CANCELLED", cancelledAt: new Date() } : {}) },
    });
    if (o.billId) await recomputeBill(t, o.billId);
  }

  /**
   * Refund part or all of a payment. Cash comes out of the refunder's open
   * shift; WALLET credits the customer's wallet; card refunds are recorded
   * for the terminal (a gateway phase makes them automatic).
   */
  async refund(t: TenantTx, paymentId: string, r: { amount: string; destination: "ORIGINAL_METHOD" | "WALLET" | "CASH"; reason: string; idempotencyKey: string }, actor: Extract<OrderActor, { type: "EMPLOYEE" }>) {
    const done = await t.refund.findFirst({ where: { idempotencyKey: r.idempotencyKey } });
    if (done) return done;
    const p = await t.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.status !== "CAPTURED") throw new NotFoundException({ error: "payment_not_found" });
    const unit = await minorUnit(t, p.currency);
    const amount = toMinor(r.amount, unit);
    const left = toMinor(p.amount, unit) - toMinor(p.refundedAmount, unit);
    if (amount <= 0 || amount > left) throw new ConflictException({ error: "bad_amount", refundable: fromMinor(left, unit).toFixed(unit) });
    const dest = r.destination === "ORIGINAL_METHOD" ? (p.method === "CASH" ? "CASH" : p.method === "WALLET" ? "WALLET" : "ORIGINAL_METHOD") : r.destination;
    if (dest === "WALLET" && !p.customerId) throw new ConflictException({ error: "wallet_needs_customer" });
    const shift = await openShiftOf(t, actor.id, p.branchId);
    if (dest === "CASH" && !shift) throw new ConflictException({ error: "no_open_shift", hint: "Open your shift to give cash back." });
    const refund = await t.refund.create({
      data: {
        organizationId: p.organizationId, paymentId, amount: fromMinor(amount, unit), currency: p.currency, destination: dest, reason: r.reason, status: "SUCCEEDED",
        requestedById: actor.id, approvedById: actor.id, shiftId: shift?.id ?? null, idempotencyKey: r.idempotencyKey, processedAt: new Date(),
      },
    });
    await t.payment.update({ where: { id: paymentId }, data: { refundedAmount: { increment: fromMinor(amount, unit) } } });
    if (dest === "CASH") await t.cashMovement.create({ data: { organizationId: p.organizationId, shiftId: shift!.id, type: "CASH_REFUND", amount: fromMinor(-amount, unit), refundId: refund.id, paymentId, employeeId: actor.id, reason: r.reason } });
    if (dest === "WALLET") await moveMoney(t, { customerId: p.customerId!, bucket: "CASH", deltaMinor: amount, type: "REFUND", reason: r.reason, branchId: p.branchId, referenceType: "REFUND", referenceId: refund.id, paymentId, employeeId: actor.id, idempotencyKey: `${r.idempotencyKey}:wallet` });
    if (p.billId) {
      const bill = await recomputeBill(t, p.billId);
      await reverseForRefund(t, p.billId, amount, toMinor(bill.total, unit), refund.id);
    }
    await auditAs(t, actor, { action: "payment.refund", entityType: "Payment", entityId: paymentId, branchId: p.branchId, after: { amount: fromMinor(amount, unit).toFixed(unit), destination: dest, reason: r.reason } });
    return refund;
  }

  // ── views ────────────────────────────────────────────────────────────────

  async view(t: TenantTx, orderId: string) {
    const o = await t.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        orderItems: { orderBy: { createdAt: "asc" }, select: { id: true, nameSnapshot: true, quantity: true, unitPrice: true, modifiers: true, modifiersTotal: true, discountAmount: true, taxAmount: true, lineTotal: true, status: true, notes: true, kitchenTicketId: true } },
        kitchenTickets: { select: { id: true, status: true, station: { select: { name: true } } } },
        bill: { select: { id: true, number: true, status: true, total: true, paidTotal: true } },
        customer: { select: { id: true, displayName: true } },
      },
    });
    const unit = await minorUnit(t, o.currency);
    const f = (d: Prisma.Decimal) => d.toFixed(unit);
    const { idempotencyKey: _k, orderItems, bill, ...rest } = o;
    return {
      ...rest, subtotal: f(o.subtotal), discountTotal: f(o.discountTotal), taxTotal: f(o.taxTotal), total: f(o.total), tipTotal: f(o.tipTotal),
      items: orderItems.map((x) => ({ ...x, quantity: Number(x.quantity), unitPrice: f(x.unitPrice), modifiersTotal: f(x.modifiersTotal), discountAmount: f(x.discountAmount), taxAmount: f(x.taxAmount), lineTotal: f(x.lineTotal) })),
      bill: bill ? { ...bill, total: f(bill.total), paidTotal: f(bill.paidTotal), due: f(bill.total.sub(bill.paidTotal)) } : null,
    };
  }

  async billView(t: TenantTx, billId: string) {
    const b = await t.bill.findUniqueOrThrow({
      where: { id: billId },
      include: {
        customer: { select: { id: true, displayName: true } },
        table: { select: { id: true, name: true } },
        orders: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, type: true, status: true, deliverTo: true, total: true, orderItems: { where: { status: { notIn: ["VOIDED"] } }, select: { id: true, nameSnapshot: true, quantity: true, lineTotal: true, modifiers: true, status: true } } } },
        payments: { where: { status: "CAPTURED" }, orderBy: { createdAt: "asc" }, select: { id: true, method: true, amount: true, refundedAmount: true, cashTendered: true, changeGiven: true, createdAt: true } },
        gamingSessions: { select: { id: true, status: true, device: { select: { name: true } } } },
      },
    });
    const unit = await minorUnit(t, b.currency);
    const f = (d: Prisma.Decimal | null) => (d ? d.toFixed(unit) : null);
    return {
      id: b.id, number: b.number, status: b.status, currency: b.currency, customer: b.customer, table: b.table, openedAt: b.openedAt, closedAt: b.closedAt,
      subtotal: f(b.subtotal), discountTotal: f(b.discountTotal), taxTotal: f(b.taxTotal), total: f(b.total), paidTotal: f(b.paidTotal), due: f(b.total.sub(b.paidTotal)),
      sessions: b.gamingSessions,
      orders: b.orders.map((o) => ({ ...o, total: f(o.total), orderItems: o.orderItems.map((x) => ({ ...x, quantity: Number(x.quantity), lineTotal: f(x.lineTotal) })) })),
      payments: b.payments.map((p) => ({ ...p, amount: f(p.amount), refundedAmount: f(p.refundedAmount), cashTendered: f(p.cashTendered), changeGiven: f(p.changeGiven) })),
    };
  }
}
