import { ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { lineMoney, reorderQuantity, ZERO } from "./costing.js";
import { moveStock } from "./stock.js";

type Actor = { type: "EMPLOYEE"; id: string };
const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const q = (d: Prisma.Decimal | null | undefined) => (d ?? ZERO).toDecimalPlaces(4).toString();
const DEFAULT_APPROVAL_THRESHOLD = 2000;
const OPEN_PO = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] as const;
const RECEIVABLE = ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] as const;

export interface PoLineInput {
  itemId: string;
  quantity: string;
  unitCost: string;
  taxRatePercent?: string | null;
}
export interface ReceiveLine {
  lineId: string;
  quantity: string;
  unitCost?: string | null;
  lotCode?: string | null;
  expiresAt?: string | null;
  serialNumbers?: string[] | null;
}

async function minorUnitOf(t: TenantTx, currency: string) {
  return (await t.currency.findUnique({ where: { code: currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
}

/**
 * Suppliers, purchase orders (draft → approval above a limit → ordered →
 * received, partly or fully) and supplier invoices matched against what was
 * received. Receiving is the only way purchased stock enters the ledger.
 */
@Injectable()
export class PurchasingService {
  // ── purchase orders ──────────────────────────────────────────────────────

  async view(t: TenantTx, poId: string) {
    const po = await t.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        supplier: { select: { id: true, name: true, email: true, phone: true, paymentTermsDays: true } },
        warehouse: { select: { id: true, name: true, branchId: true, branch: { select: { code: true, name: true } } } },
        createdBy: { select: { id: true, displayName: true } },
        approvedBy: { select: { displayName: true } },
        purchaseOrderLines: { include: { item: { select: { id: true, sku: true, name: true, baseUnit: true, purchaseUnit: true, purchaseUnitQty: true, trackExpiry: true, trackSerial: true } } }, orderBy: { id: "asc" } },
        supplierInvoices: { select: { id: true, invoiceNumber: true, amount: true, taxAmount: true, paidAmount: true, status: true } },
      },
    });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    const unit = await minorUnitOf(t, po.currency);
    const receivedValue = po.purchaseOrderLines.reduce((a, l) => {
      const m = lineMoney(l.quantityReceived, l.unitCost, l.taxRatePercent, unit);
      return a.add(m.net).add(m.tax);
    }, ZERO);
    return {
      id: po.id, number: po.number, status: po.status, currency: po.currency, supplier: po.supplier, warehouse: po.warehouse, branchId: po.branchId,
      subtotal: po.subtotal.toFixed(unit), taxTotal: po.taxTotal.toFixed(unit), total: po.total.toFixed(unit), receivedValue: receivedValue.toFixed(unit),
      expectedAt: po.expectedAt, orderedAt: po.orderedAt, approvedAt: po.approvedAt, notes: po.notes, createdAt: po.createdAt, createdBy: po.createdBy, approvedBy: po.approvedBy?.displayName ?? null,
      lines: po.purchaseOrderLines.map((l) => ({
        id: l.id, item: { ...l.item, purchaseUnitQty: l.item.purchaseUnitQty?.toString() ?? null }, quantityOrdered: q(l.quantityOrdered), quantityReceived: q(l.quantityReceived),
        outstanding: q(l.quantityOrdered.sub(l.quantityReceived)), unitCost: l.unitCost.toFixed(4), taxRatePercent: l.taxRatePercent.toString(), lineTotal: l.lineTotal.toFixed(unit),
      })),
      invoices: po.supplierInvoices.map((i) => ({ ...i, amount: i.amount.toFixed(unit), taxAmount: i.taxAmount.toFixed(unit), paidAmount: i.paidAmount.toFixed(unit) })),
    };
  }

  private async priceLines(t: TenantTx, lines: PoLineInput[], currency: string) {
    if (!lines.length || lines.length > 200) throw new HttpException({ error: "bad_lines" }, 400);
    const ids = [...new Set(lines.map((l) => l.itemId))];
    if (ids.length !== lines.length) throw new HttpException({ error: "duplicate_item", hint: "Put each item on one line." }, 400);
    const items = await t.inventoryItem.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
    if (items.length !== ids.length) throw new NotFoundException({ error: "item_not_found" });
    const unit = await minorUnitOf(t, currency);
    let subtotal = ZERO;
    let tax = ZERO;
    const rows = lines.map((l) => {
      const qty = D(l.quantity);
      if (qty.lte(0)) throw new HttpException({ error: "bad_quantity" }, 400);
      const m = lineMoney(qty, l.unitCost, l.taxRatePercent ?? "0", unit);
      subtotal = subtotal.add(m.net);
      tax = tax.add(m.tax);
      return { itemId: l.itemId, quantityOrdered: qty, unitCost: D(l.unitCost), taxRatePercent: D(l.taxRatePercent ?? "0"), lineTotal: m.net };
    });
    return { rows, subtotal, tax, total: subtotal.add(tax) };
  }

  /** PO-2609-0007: per organization, numbered under an advisory lock (no gaps from races). */
  private async nextNumber(t: TenantTx, organizationId: string) {
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`po-number:${organizationId}`}))`;
    const n = await t.purchaseOrder.count();
    const d = new Date();
    return `PO-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}-${String(n + 1).padStart(4, "0")}`;
  }

  async create(t: TenantTx, x: { supplierId: string; warehouseId: string; expectedAt?: string | null; notes?: string | null; lines: PoLineInput[] }, actor: Actor) {
    const supplier = await t.supplier.findUnique({ where: { id: x.supplierId }, select: { id: true, currency: true, isActive: true, organizationId: true } });
    if (!supplier || !supplier.isActive) throw new NotFoundException({ error: "supplier_not_found" });
    const wh = await t.warehouse.findUnique({ where: { id: x.warehouseId }, select: { id: true, branchId: true, isActive: true } });
    if (!wh || !wh.isActive) throw new NotFoundException({ error: "warehouse_not_found" });
    const priced = await this.priceLines(t, x.lines, supplier.currency);
    const po = await t.purchaseOrder.create({
      data: {
        organizationId: supplier.organizationId, branchId: wh.branchId, warehouseId: wh.id, supplierId: supplier.id, number: await this.nextNumber(t, supplier.organizationId),
        currency: supplier.currency, subtotal: priced.subtotal, taxTotal: priced.tax, total: priced.total, expectedAt: x.expectedAt ? new Date(x.expectedAt) : null, notes: x.notes ?? null, createdById: actor.id,
        purchaseOrderLines: { create: priced.rows },
      },
    });
    await auditAs(t, actor, { action: "po.create", entityType: "PurchaseOrder", entityId: po.id, branchId: wh.branchId, after: { number: po.number, total: priced.total.toString(), lines: x.lines.length } });
    return this.view(t, po.id);
  }

  async update(t: TenantTx, poId: string, x: { expectedAt?: string | null; notes?: string | null; lines?: PoLineInput[] }, actor: Actor) {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    if (po.status !== "DRAFT") throw new ConflictException({ error: "po_not_editable", status: po.status, hint: "Only a draft can be changed." });
    const data: Prisma.PurchaseOrderUpdateInput = {};
    if (x.expectedAt !== undefined) data.expectedAt = x.expectedAt ? new Date(x.expectedAt) : null;
    if (x.notes !== undefined) data.notes = x.notes;
    if (x.lines) {
      const priced = await this.priceLines(t, x.lines, po.currency);
      await t.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: poId } });
      Object.assign(data, { subtotal: priced.subtotal, taxTotal: priced.tax, total: priced.total, purchaseOrderLines: { create: priced.rows } });
    }
    await t.purchaseOrder.update({ where: { id: poId }, data });
    await auditAs(t, actor, { action: "po.update", entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId, after: x });
    return this.view(t, poId);
  }

  /** Small orders are approved on submit; above the organization's limit a manager must approve. */
  async submit(t: TenantTx, poId: string, actor: Actor) {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    if (po.status !== "DRAFT") throw new ConflictException({ error: "bad_po_status", status: po.status });
    const org = await t.organization.findFirstOrThrow({ select: { settings: true } });
    const limit = Number((org.settings as { poApprovalThreshold?: number } | null)?.poApprovalThreshold ?? DEFAULT_APPROVAL_THRESHOLD);
    const needs = po.total.gt(limit);
    await t.purchaseOrder.update({ where: { id: poId }, data: needs ? { status: "PENDING_APPROVAL" } : { status: "APPROVED", approvedAt: new Date() } });
    await auditAs(t, actor, { action: "po.submit", entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId, after: { total: po.total.toString(), limit, status: needs ? "PENDING_APPROVAL" : "APPROVED" } });
    return this.view(t, poId);
  }

  /** Segregation of duties: whoever raised the order can't approve it. */
  async approve(t: TenantTx, poId: string, approve: boolean, note: string | null, actor: Actor) {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    if (po.status !== "PENDING_APPROVAL") throw new ConflictException({ error: "nothing_to_approve", status: po.status });
    if (po.createdById === actor.id) throw new ConflictException({ error: "cannot_approve_own_po" });
    await t.purchaseOrder.update({
      where: { id: poId },
      data: approve ? { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() } : { status: "DRAFT", notes: [po.notes, note && `Sent back: ${note}`].filter(Boolean).join("\n") || null },
    });
    await auditAs(t, actor, { action: approve ? "po.approve" : "po.reject", entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId, after: { total: po.total.toString(), note } });
    return this.view(t, poId);
  }

  async markOrdered(t: TenantTx, poId: string, actor: Actor) {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    if (po.status !== "APPROVED") throw new ConflictException({ error: "bad_po_status", status: po.status });
    await t.purchaseOrder.update({ where: { id: poId }, data: { status: "ORDERED", orderedAt: new Date() } });
    await auditAs(t, actor, { action: "po.ordered", entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId });
    return this.view(t, poId);
  }

  /**
   * Goods arrive: each line's received quantity goes into the PO's warehouse
   * at the line's cost (or the invoiced cost, if it changed), moving the
   * average cost. Never more than ordered — the database refuses it too.
   */
  async receive(t: TenantTx, poId: string, r: { lines: ReceiveLine[]; note?: string | null; idempotencyKey: string }, actor: Actor) {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId }, include: { purchaseOrderLines: { include: { item: { select: { name: true, trackExpiry: true, trackSerial: true } } } } } });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    const replay = await t.stockMovement.findFirst({ where: { idempotencyKey: { startsWith: `${r.idempotencyKey}:` } }, select: { id: true } });
    if (replay) return this.view(t, poId);
    if (!(RECEIVABLE as readonly string[]).includes(po.status)) throw new ConflictException({ error: "bad_po_status", status: po.status });
    if (!r.lines.length) throw new HttpException({ error: "bad_lines" }, 400);
    const received: Array<{ item: string; quantity: string }> = [];
    for (const [n, x] of r.lines.entries()) {
      const line = po.purchaseOrderLines.find((l) => l.id === x.lineId);
      if (!line) throw new NotFoundException({ error: "po_line_not_found" });
      const qty = D(x.quantity);
      if (qty.lte(0)) throw new HttpException({ error: "bad_quantity" }, 400);
      const outstanding = line.quantityOrdered.sub(line.quantityReceived);
      if (qty.gt(outstanding)) throw new ConflictException({ error: "over_receipt", item: line.item.name, outstanding: q(outstanding) });
      if (line.item.trackSerial && x.serialNumbers?.length && D(x.serialNumbers.length).cmp(qty) !== 0) throw new HttpException({ error: "serials_mismatch", item: line.item.name }, 400);
      // Conditional increment: a concurrent receipt of the same line can't double-count.
      const upd = await t.purchaseOrderLine.updateMany({ where: { id: line.id, quantityReceived: line.quantityReceived }, data: { quantityReceived: line.quantityReceived.add(qty) } });
      if (upd.count !== 1) throw new ConflictException({ error: "po_busy", hint: "Someone else is receiving this order — reload." });
      const cost = x.unitCost != null ? D(x.unitCost) : line.unitCost;
      const expiresAt = x.expiresAt ? new Date(x.expiresAt) : null;
      if (line.item.trackSerial && x.serialNumbers?.length) {
        // One lot per serial number (headsets, controllers, PC parts).
        for (const [k, sn] of x.serialNumbers.entries()) {
          await moveStock(t, { itemId: line.itemId, warehouseId: po.warehouseId, type: "PURCHASE_RECEIPT", delta: 1, unitCost: cost, lot: { serialNumber: sn, lotCode: x.lotCode ?? null, expiresAt }, referenceType: "PO_LINE", referenceId: line.id, employeeId: actor.id, reason: r.note ?? null, idempotencyKey: `${r.idempotencyKey}:${n}:${k}` });
        }
      } else {
        await moveStock(t, { itemId: line.itemId, warehouseId: po.warehouseId, type: "PURCHASE_RECEIPT", delta: qty, unitCost: cost, lot: { lotCode: x.lotCode ?? null, expiresAt }, referenceType: "PO_LINE", referenceId: line.id, employeeId: actor.id, reason: r.note ?? null, idempotencyKey: `${r.idempotencyKey}:${n}` });
      }
      received.push({ item: line.item.name, quantity: q(qty) });
    }
    const lines = await t.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId }, select: { quantityOrdered: true, quantityReceived: true } });
    const done = lines.every((l) => l.quantityReceived.gte(l.quantityOrdered));
    await t.purchaseOrder.update({ where: { id: poId }, data: { status: done ? "RECEIVED" : "PARTIALLY_RECEIVED", orderedAt: po.orderedAt ?? new Date() } });
    await auditAs(t, actor, { action: "po.receive", entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId, after: { received, note: r.note ?? null, status: done ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
    return this.view(t, poId);
  }

  /** The supplier won't send the rest: close a part-received order. */
  async close(t: TenantTx, poId: string, reason: string, actor: Actor) {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    if (po.status !== "PARTIALLY_RECEIVED") throw new ConflictException({ error: "bad_po_status", status: po.status });
    await t.purchaseOrder.update({ where: { id: poId }, data: { status: "RECEIVED", notes: [po.notes, `Closed short: ${reason}`].filter(Boolean).join("\n") } });
    await auditAs(t, actor, { action: "po.close_short", entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId, after: { reason } });
    return this.view(t, poId);
  }

  async cancel(t: TenantTx, poId: string, reason: string, actor: Actor) {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId }, include: { purchaseOrderLines: { select: { quantityReceived: true } } } });
    if (!po) throw new NotFoundException({ error: "po_not_found" });
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED"].includes(po.status) || po.purchaseOrderLines.some((l) => l.quantityReceived.gt(0))) {
      throw new ConflictException({ error: "not_cancellable", status: po.status, hint: "Goods were already received — close it instead." });
    }
    await t.purchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED", notes: [po.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
    await auditAs(t, actor, { action: "po.cancel", entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId, after: { reason } });
    return this.view(t, poId);
  }

  // ── reorder ──────────────────────────────────────────────────────────────

  /** Items at or under their minimum in a warehouse, net of what's already on order. */
  async suggestions(t: TenantTx, warehouseId: string) {
    const items = await t.inventoryItem.findMany({
      where: { isActive: true, minStock: { gt: 0 } },
      include: { stockLevels: { where: { warehouseId }, select: { quantity: true } }, defaultSupplier: { select: { id: true, name: true, isActive: true } } },
      orderBy: { name: "asc" },
    });
    const open = await t.purchaseOrderLine.findMany({ where: { purchaseOrder: { warehouseId, status: { in: [...OPEN_PO] } } }, select: { itemId: true, quantityOrdered: true, quantityReceived: true } });
    return items
      .map((i) => {
        const onHand = i.stockLevels[0]?.quantity ?? ZERO;
        const onOrder = open.filter((l) => l.itemId === i.id).reduce((a, l) => a.add(l.quantityOrdered.sub(l.quantityReceived)), ZERO);
        const need = reorderQuantity({ onHand, onOrder, minStock: i.minStock, reorderQty: i.reorderQty, purchaseUnitQty: i.purchaseUnitQty });
        return {
          itemId: i.id, sku: i.sku, name: i.name, baseUnit: i.baseUnit, purchaseUnit: i.purchaseUnit, purchaseUnitQty: i.purchaseUnitQty?.toString() ?? null,
          onHand: q(onHand), onOrder: q(onOrder), minStock: q(i.minStock), suggested: q(need), unitCost: (i.lastPurchaseCost ?? i.averageCost).toFixed(4),
          supplier: i.defaultSupplier?.isActive ? { id: i.defaultSupplier.id, name: i.defaultSupplier.name } : null,
        };
      })
      .filter((s) => D(s.suggested).gt(0));
  }

  /** One draft PO per supplier from the suggestions (items without a supplier are left out). */
  async draftFromSuggestions(t: TenantTx, warehouseId: string, itemIds: string[] | null, actor: Actor) {
    const all = await this.suggestions(t, warehouseId);
    const pick = all.filter((s) => s.supplier && (!itemIds || itemIds.includes(s.itemId)));
    const bySupplier = new Map<string, typeof pick>();
    for (const s of pick) bySupplier.set(s.supplier!.id, [...(bySupplier.get(s.supplier!.id) ?? []), s]);
    const created = [];
    for (const [supplierId, lines] of bySupplier) {
      created.push(await this.create(t, { supplierId, warehouseId, notes: "Drafted from reorder suggestions", lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.suggested, unitCost: l.unitCost })) }, actor));
    }
    return { created: created.map((p) => ({ id: p.id, number: p.number, supplier: p.supplier.name, total: p.total })), skipped: all.filter((s) => !s.supplier && (!itemIds || itemIds.includes(s.itemId))).map((s) => s.name) };
  }

  // ── supplier invoices ────────────────────────────────────────────────────

  async invoiceView(t: TenantTx, id: string) {
    const i = await t.supplierInvoice.findUnique({ where: { id }, include: { supplier: { select: { id: true, name: true } }, purchaseOrder: { select: { id: true, number: true } } } });
    if (!i) throw new NotFoundException({ error: "invoice_not_found" });
    const unit = await minorUnitOf(t, i.currency);
    const total = i.amount.add(i.taxAmount);
    // Three-way match: what we're billed vs what we ordered and actually received.
    let match: { receivedValue: string; difference: string; status: "MATCHED" | "OVER" | "UNDER" } | null = null;
    if (i.purchaseOrderId) {
      const po = await this.view(t, i.purchaseOrderId);
      const diff = total.sub(D(po.receivedValue));
      match = { receivedValue: po.receivedValue, difference: diff.toFixed(unit), status: diff.abs().lte(D(1).div(10 ** unit)) ? "MATCHED" : diff.gt(0) ? "OVER" : "UNDER" };
    }
    return {
      id: i.id, supplier: i.supplier, purchaseOrder: i.purchaseOrder, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, dueDate: i.dueDate, currency: i.currency, status: i.status,
      amount: i.amount.toFixed(unit), taxAmount: i.taxAmount.toFixed(unit), total: total.toFixed(unit), paidAmount: i.paidAmount.toFixed(unit), due: total.sub(i.paidAmount).toFixed(unit),
      overdue: ["UNPAID", "PARTIALLY_PAID"].includes(i.status) && i.dueDate < new Date(new Date().toDateString()), documentUrl: i.documentUrl, match,
    };
  }

  async createInvoice(t: TenantTx, x: { supplierId: string; purchaseOrderId?: string | null; invoiceNumber: string; invoiceDate: string; dueDate?: string | null; amount: string; taxAmount?: string | null }, actor: Actor) {
    const s = await t.supplier.findUnique({ where: { id: x.supplierId }, select: { id: true, organizationId: true, currency: true, paymentTermsDays: true } });
    if (!s) throw new NotFoundException({ error: "supplier_not_found" });
    let branchId: string | null = null;
    if (x.purchaseOrderId) {
      const po = await t.purchaseOrder.findUnique({ where: { id: x.purchaseOrderId }, select: { supplierId: true, branchId: true } });
      if (!po) throw new NotFoundException({ error: "po_not_found" });
      if (po.supplierId !== s.id) throw new ConflictException({ error: "po_other_supplier" });
      branchId = po.branchId;
    }
    if (await t.supplierInvoice.findFirst({ where: { supplierId: s.id, invoiceNumber: x.invoiceNumber } })) throw new ConflictException({ error: "invoice_duplicate", hint: "This supplier's invoice number is already recorded." });
    const invoiceDate = new Date(x.invoiceDate);
    const dueDate = x.dueDate ? new Date(x.dueDate) : new Date(invoiceDate.getTime() + s.paymentTermsDays * 86_400_000);
    if (dueDate < invoiceDate) throw new HttpException({ error: "bad_due_date" }, 400);
    const inv = await t.supplierInvoice.create({
      data: { organizationId: s.organizationId, supplierId: s.id, purchaseOrderId: x.purchaseOrderId ?? null, invoiceNumber: x.invoiceNumber, invoiceDate, dueDate, amount: x.amount, taxAmount: x.taxAmount ?? "0", currency: s.currency },
    });
    await auditAs(t, actor, { action: "supplier_invoice.create", entityType: "SupplierInvoice", entityId: inv.id, branchId, after: x });
    return this.invoiceView(t, inv.id);
  }

  /** Records money paid to the supplier (the bank transfer itself happens outside ArenaOS). */
  async payInvoice(t: TenantTx, id: string, p: { amount: string; method: string; reference?: string | null }, actor: Actor) {
    const inv = await t.supplierInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException({ error: "invoice_not_found" });
    if (["PAID", "VOID"].includes(inv.status)) throw new ConflictException({ error: "invoice_closed", status: inv.status });
    const amount = D(p.amount);
    const total = inv.amount.add(inv.taxAmount);
    const paid = inv.paidAmount.add(amount);
    if (amount.lte(0) || paid.gt(total)) throw new ConflictException({ error: "bad_amount", due: total.sub(inv.paidAmount).toFixed(2) });
    const upd = await t.supplierInvoice.updateMany({ where: { id, paidAmount: inv.paidAmount }, data: { paidAmount: paid, status: paid.gte(total) ? "PAID" : "PARTIALLY_PAID" } });
    if (upd.count !== 1) throw new ConflictException({ error: "invoice_busy" });
    await auditAs(t, actor, { action: "supplier_invoice.pay", entityType: "SupplierInvoice", entityId: id, after: { amount: amount.toString(), method: p.method, reference: p.reference ?? null } });
    return this.invoiceView(t, id);
  }

  async setInvoiceStatus(t: TenantTx, id: string, status: "DISPUTED" | "VOID" | "UNPAID", reason: string, actor: Actor) {
    const inv = await t.supplierInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException({ error: "invoice_not_found" });
    if (inv.status === "VOID" || inv.status === "PAID") throw new ConflictException({ error: "invoice_closed", status: inv.status });
    if (status === "VOID" && inv.paidAmount.gt(0)) throw new ConflictException({ error: "invoice_has_payments" });
    const next = status === "UNPAID" && inv.paidAmount.gt(0) ? "PARTIALLY_PAID" : status;
    await t.supplierInvoice.update({ where: { id }, data: { status: next } });
    await auditAs(t, actor, { action: `supplier_invoice.${status.toLowerCase()}`, entityType: "SupplierInvoice", entityId: id, after: { reason } });
    return this.invoiceView(t, id);
  }
}
