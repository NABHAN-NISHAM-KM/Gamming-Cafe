import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { visibleWarehouses, warehouseTarget } from "./inventory.controller.js";
import { PurchasingService } from "./purchasing.service.js";

const amount = z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,9}(\.\d{1,4})?$/.test(v), "invalid amount");
const Supplier = z
  .object({
    name: z.string().min(1).max(100),
    contactName: z.string().max(80).nullish(),
    email: z.email().max(120).nullish(),
    phone: z.string().max(30).nullish(),
    taxNumber: z.string().max(40).nullish(),
    address: z.string().max(300).nullish(),
    paymentTermsDays: z.number().int().min(0).max(365).default(30),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    notes: z.string().max(500).nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();
const Line = z.object({ itemId: z.uuid(), quantity: amount, unitCost: amount, taxRatePercent: z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,2}(\.\d{1,4})?$/.test(v)).nullish() }).strict();
const NewPo = z.object({ supplierId: z.uuid(), warehouseId: z.uuid(), expectedAt: z.iso.date().nullish(), notes: z.string().max(500).nullish(), lines: z.array(Line).min(1).max(200) }).strict();
const EditPo = z.object({ expectedAt: z.iso.date().nullish(), notes: z.string().max(500).nullish(), lines: z.array(Line).min(1).max(200).optional() }).strict();
const Receive = z
  .object({
    lines: z.array(z.object({ lineId: z.uuid(), quantity: amount, unitCost: amount.nullish(), lotCode: z.string().max(40).nullish(), expiresAt: z.iso.date().nullish(), serialNumbers: z.array(z.string().min(1).max(60)).max(500).nullish() }).strict()).min(1).max(200),
    note: z.string().max(200).nullish(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const Reason = z.object({ reason: z.string().min(3).max(200) }).strict();
const Decision = z.object({ approve: z.boolean(), note: z.string().max(200).nullish() }).strict();
const Draft = z.object({ warehouseId: z.uuid(), itemIds: z.array(z.uuid()).max(200).nullish() }).strict();
const Invoice = z
  .object({ supplierId: z.uuid(), purchaseOrderId: z.uuid().nullish(), invoiceNumber: z.string().min(1).max(40), invoiceDate: z.iso.date(), dueDate: z.iso.date().nullish(), amount, taxAmount: amount.nullish() })
  .strict();
const PayInvoice = z.object({ amount, method: z.enum(["BANK_TRANSFER", "CASH", "CARD", "CHEQUE"]), reference: z.string().max(80).nullish() }).strict();
const InvoiceStatus = z.object({ status: z.enum(["DISPUTED", "VOID", "UNPAID"]), reason: z.string().min(3).max(200) }).strict();

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });
const org = () => ({ organizationId: orgId() });

async function poTarget(id: string) {
  const po = await tx().purchaseOrder.findUnique({ where: { id }, select: { warehouseId: true } });
  if (!po) throw new NotFoundException({ error: "po_not_found" });
  return warehouseTarget(po.warehouseId);
}

/**
 * Suppliers, purchase orders and supplier invoices. A PO belongs to the
 * warehouse it's delivered to, so a branch manager handles their own branch's
 * orders; suppliers and invoices are organization-wide.
 */
@Controller()
export class PurchasingController {
  constructor(
    @Inject(PurchasingService) private readonly svc: PurchasingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── suppliers ────────────────────────────────────────────────────────────

  @AnyStaff()
  @Get("suppliers")
  async suppliers() {
    if (!(await visibleWarehouses("purchasing.view")).length) authorizeFor("purchasing.view", org());
    const rows = await tx().supplier.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { _count: { select: { inventoryItems: true, purchaseOrders: true } } } });
    const owed = await tx().supplierInvoice.groupBy({ by: ["supplierId"], where: { status: { in: ["UNPAID", "PARTIALLY_PAID", "DISPUTED"] } }, _sum: { amount: true, taxAmount: true, paidAmount: true } });
    return rows.map(({ _count, ...s }) => {
      const o = owed.find((x) => x.supplierId === s.id);
      const outstanding = o ? o._sum.amount!.add(o._sum.taxAmount!).sub(o._sum.paidAmount!).toFixed(2) : "0.00";
      return { ...s, items: _count.inventoryItems, orders: _count.purchaseOrders, owed: outstanding };
    });
  }

  @AnyStaff()
  @Post("suppliers")
  async addSupplier(@Body(new ZodPipe(Supplier)) body: z.infer<typeof Supplier>) {
    authorizeFor("purchasing.suppliers_manage", org());
    const currency = body.currency ?? (await tx().organization.findFirstOrThrow({ select: { defaultCurrency: true } })).defaultCurrency;
    const s = await tx().supplier.create({ data: { ...body, currency, organizationId: orgId() } });
    await this.audit.record({ action: "supplier.create", entityType: "Supplier", entityId: s.id, after: body });
    return s;
  }

  @AnyStaff()
  @Patch("suppliers/:id")
  async editSupplier(@Param("id") id: string, @Body(new ZodPipe(Supplier.omit({ currency: true }).partial())) body: Partial<z.infer<typeof Supplier>>) {
    authorizeFor("purchasing.suppliers_manage", org());
    const before = await tx().supplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: "supplier_not_found" });
    const s = await tx().supplier.update({ where: { id }, data: body });
    await this.audit.record({ action: "supplier.update", entityType: "Supplier", entityId: id, before, after: body });
    return s;
  }

  // ── purchase orders ──────────────────────────────────────────────────────

  @AnyStaff()
  @Get("purchase-orders")
  async list(@Query("status") status?: string, @Query("supplierId") supplierId?: string) {
    const ids = await visibleWarehouses("purchasing.view");
    if (!ids.length) authorizeFor("purchasing.view", org());
    const statuses = (status ?? "").split(",").filter((s) => /^[A-Z_]{4,20}$/.test(s));
    const rows = await tx().purchaseOrder.findMany({
      where: { warehouseId: { in: ids }, ...(statuses.length ? { status: { in: statuses as never } } : {}), ...(supplierId && /^[0-9a-f-]{36}$/i.test(supplierId) ? { supplierId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { supplier: { select: { name: true } }, warehouse: { select: { name: true, branch: { select: { code: true } } } }, createdBy: { select: { displayName: true } }, _count: { select: { purchaseOrderLines: true } } },
    });
    return rows.map((p) => ({
      id: p.id, number: p.number, status: p.status, supplier: p.supplier.name, supplierId: p.supplierId, warehouse: p.warehouse.name, branch: p.warehouse.branch?.code ?? "Central",
      total: p.total.toFixed(2), currency: p.currency, lines: p._count.purchaseOrderLines, expectedAt: p.expectedAt, createdAt: p.createdAt, createdBy: p.createdBy.displayName, createdById: p.createdById,
    }));
  }

  @AnyStaff()
  @Get("purchase-orders/:id")
  async get(@Param("id") id: string) {
    authorizeFor("purchasing.view", await poTarget(id));
    return this.svc.view(tx(), id);
  }

  @AnyStaff()
  @Post("purchase-orders")
  async create(@Body(new ZodPipe(NewPo)) body: z.infer<typeof NewPo>) {
    authorizeFor("purchasing.create", await warehouseTarget(body.warehouseId));
    return this.svc.create(tx(), body, me());
  }

  @AnyStaff()
  @Patch("purchase-orders/:id")
  async edit(@Param("id") id: string, @Body(new ZodPipe(EditPo)) body: z.infer<typeof EditPo>) {
    authorizeFor("purchasing.create", await poTarget(id));
    return this.svc.update(tx(), id, body, me());
  }

  @AnyStaff()
  @Post("purchase-orders/:id/submit")
  @HttpCode(200)
  async submit(@Param("id") id: string) {
    authorizeFor("purchasing.create", await poTarget(id));
    return this.svc.submit(tx(), id, me());
  }

  /** Sensitive: a reason is required either way. */
  @AnyStaff()
  @Post("purchase-orders/:id/approve")
  @HttpCode(200)
  async approve(@Param("id") id: string, @Body(new ZodPipe(Decision)) body: z.infer<typeof Decision>) {
    authorizeFor("purchasing.approve", await poTarget(id));
    return this.svc.approve(tx(), id, body.approve, body.note ?? null, me());
  }

  @AnyStaff()
  @Post("purchase-orders/:id/ordered")
  @HttpCode(200)
  async ordered(@Param("id") id: string) {
    authorizeFor("purchasing.create", await poTarget(id));
    return this.svc.markOrdered(tx(), id, me());
  }

  @AnyStaff()
  @Post("purchase-orders/:id/receive")
  @HttpCode(200)
  async receive(@Param("id") id: string, @Body(new ZodPipe(Receive)) body: z.infer<typeof Receive>) {
    authorizeFor("purchasing.receive", await poTarget(id));
    return this.svc.receive(tx(), id, body, me());
  }

  @AnyStaff()
  @Post("purchase-orders/:id/close")
  @HttpCode(200)
  async close(@Param("id") id: string, @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>) {
    authorizeFor("purchasing.receive", await poTarget(id));
    return this.svc.close(tx(), id, body.reason, me());
  }

  @AnyStaff()
  @Post("purchase-orders/:id/cancel")
  @HttpCode(200)
  async cancel(@Param("id") id: string, @Body(new ZodPipe(Reason)) body: z.infer<typeof Reason>) {
    authorizeFor("purchasing.create", await poTarget(id));
    return this.svc.cancel(tx(), id, body.reason, me());
  }

  // ── reorder ──────────────────────────────────────────────────────────────

  @AnyStaff()
  @Get("warehouses/:id/reorder")
  async suggestions(@Param("id") id: string) {
    authorizeFor("purchasing.view", await warehouseTarget(id));
    return this.svc.suggestions(tx(), id);
  }

  @AnyStaff()
  @Post("purchasing/reorder")
  async draft(@Body(new ZodPipe(Draft)) body: z.infer<typeof Draft>) {
    authorizeFor("purchasing.create", await warehouseTarget(body.warehouseId));
    return this.svc.draftFromSuggestions(tx(), body.warehouseId, body.itemIds ?? null, me());
  }

  // ── supplier invoices ────────────────────────────────────────────────────

  @AnyStaff()
  @Get("supplier-invoices")
  async invoices(@Query("status") status?: string, @Query("supplierId") supplierId?: string) {
    authorizeFor("purchasing.view", org());
    const statuses = (status ?? "").split(",").filter((s) => /^[A-Z_]{3,20}$/.test(s));
    const rows = await tx().supplierInvoice.findMany({
      where: { ...(statuses.length ? { status: { in: statuses as never } } : {}), ...(supplierId && /^[0-9a-f-]{36}$/i.test(supplierId) ? { supplierId } : {}) },
      orderBy: [{ dueDate: "asc" }],
      take: 200,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.svc.invoiceView(tx(), r.id)));
  }

  @AnyStaff()
  @Post("supplier-invoices")
  async addInvoice(@Body(new ZodPipe(Invoice)) body: z.infer<typeof Invoice>) {
    authorizeFor("purchasing.suppliers_manage", org());
    return this.svc.createInvoice(tx(), body, me());
  }

  @AnyStaff()
  @Post("supplier-invoices/:id/pay")
  @HttpCode(200)
  async payInvoice(@Param("id") id: string, @Body(new ZodPipe(PayInvoice)) body: z.infer<typeof PayInvoice>) {
    authorizeFor("purchasing.suppliers_manage", org());
    return this.svc.payInvoice(tx(), id, body, me());
  }

  @AnyStaff()
  @Post("supplier-invoices/:id/status")
  @HttpCode(200)
  async invoiceStatus(@Param("id") id: string, @Body(new ZodPipe(InvoiceStatus)) body: z.infer<typeof InvoiceStatus>) {
    authorizeFor("purchasing.suppliers_manage", org());
    if (body.status === "UNPAID" && !(await tx().supplierInvoice.findFirst({ where: { id, status: "DISPUTED" } }))) throw new ConflictException({ error: "not_disputed" });
    return this.svc.setInvoiceStatus(tx(), id, body.status, body.reason, me());
  }
}
