import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type Db, type TenantTx } from "@arena/db";
import type { PrintJobReport, PrintQuote } from "@arena/contracts";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";
import { CommandsService } from "../devices/commands.service.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import { DeviceRuntimeService } from "../devices/device-runtime.service.js";
import { DeviceHub, LiveBus, type Connection } from "../devices/live.js";
import { minorUnit } from "../pos/bills.js";
import { OrdersService } from "../pos/orders.service.js";
import { balances, toMinor } from "../wallet/wallet.js";

const LIVE = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;
/** The customer has this long to say yes on the Shell; staff this long to release a held job. */
const CONFIRM_SECONDS = 180;
const APPROVAL_SECONDS = 15 * 60;
const DEFAULT_MAX_PAGES = 100;
export const PRINT_SKU = { bw: "PRINT-BW", color: "PRINT-COLOR" } as const;

type Actor = { type: "EMPLOYEE" | "DEVICE" | "SYSTEM"; id: string | null };
type Settings = { requireApproval?: boolean; maxPages?: number };
type StatusMsg = { jobKey: string; status: "WAITING_STAFF" | "PRINTING" | "COMPLETED" | "CANCELLED" | "FAILED"; message: string };

/**
 * Internet-café printing. The station agent pauses every new spooler job and
 * reports it; the server prices it (per page, B/W or colour — the PRINT-BW /
 * PRINT-COLOR products, so branch prices and VAT apply), and the customer
 * approves it on the Shell: added to the session bill or paid from the
 * wallet. Only then is a signed PRINT_RELEASE sent — a job nobody pays for
 * never prints, and one nobody confirms is cancelled.
 */
@Injectable()
export class PrintService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Printing");
  private sweeper?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
  ) {}

  onModuleInit() {
    this.gateway.handleStation("print_job", (c, m) => this.asDevice(c, (t) => this.received(t, c, { ...m.job, document: m.job.document ?? null })));
    this.gateway.handleStation("print_confirm", (c, m) => this.asDevice(c, (t) => this.confirm(t, c, m.jobKey, m.payWith)));
    this.gateway.handleStation("print_cancel", (c, m) => this.asDevice(c, (t) => this.customerCancel(t, c, m.jobKey)));
    this.gateway.handleStation("print_done", (c, m) => this.asDevice(c, (t) => this.done(t, c, m.jobKey, m.ok, m.detail ?? null)));
    this.sweeper = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 30_000);
    this.sweeper.unref();
  }
  onModuleDestroy() {
    clearInterval(this.sweeper);
  }

  /** Device-originated work runs as the DEVICE in its own tenant; after-commit work (commands, replies) runs after. */
  private async asDevice<T>(c: Connection, fn: (t: TenantTx) => Promise<T>): Promise<T | undefined> {
    const afterCommit: Array<() => void | Promise<void>> = [];
    try {
      const r = await this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, (t) =>
        requestStore.run({ tx: t, afterCommit, principal: null as never, decision: null, requestId: `print:${c.deviceId}`, ip: null, userAgent: null, reason: null }, () => fn(t)),
      );
      for (const f of afterCommit) await Promise.resolve(f()).catch(() => undefined);
      return r;
    } catch (e) {
      this.log.warn(`print message from ${c.deviceId} failed: ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
  }

  private send(deviceId: string, msg: { type: "print_quote"; quote: PrintQuote } | ({ type: "print_status" } & StatusMsg)) {
    const store = requestStore.getStore();
    const go = () => void this.hub.send(deviceId, msg);
    if (store) store.afterCommit.push(go);
    else go();
  }

  private settings(raw: Prisma.JsonValue): Settings {
    return ((raw as { print?: Settings } | null)?.print ?? {}) as Settings;
  }

  private async price(t: TenantTx, branchId: string, color: boolean) {
    const p = await t.product.findFirst({ where: { sku: color ? PRINT_SKU.color : PRINT_SKU.bw, isActive: true }, select: { id: true, price: true, productBranchPrices: { where: { branchId }, select: { price: true, isAvailable: true } } } });
    if (!p || p.productBranchPrices[0]?.isAvailable === false) return null;
    return { productId: p.id, unit: p.productBranchPrices[0]?.price ?? p.price };
  }

  private async publish(t: TenantTx, jobId: string) {
    const j = await t.printJob.findUniqueOrThrow({ where: { id: jobId }, select: { organizationId: true, branchId: true } });
    const store = requestStore.getStore();
    const go = () => this.bus.publish(j.organizationId, j.branchId, { type: "print", jobId });
    if (store) store.afterCommit.push(go);
    else go();
  }

  // ── from the station ──────────────────────────────────────────────────────

  async received(t: TenantTx, c: Connection, job: PrintJobReport) {
    const again = await t.printJob.findFirst({ where: { deviceId: c.deviceId, jobKey: job.jobKey } });
    if (again) return this.resend(t, c, again.id); // the agent re-reported after a reconnect

    const branch = await t.branch.findUniqueOrThrow({ where: { id: c.branchId }, select: { currency: true, settings: true } });
    const unit = await minorUnit(t, branch.currency);
    const s = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: [...LIVE] } }, select: { id: true, customerId: true } });
    const priced = await this.price(t, c.branchId, job.color);
    const unitPrice = priced?.unit ?? new Prisma.Decimal(0);
    const total = unitPrice.mul(job.pages * job.copies).toDecimalPlaces(unit, Prisma.Decimal.ROUND_HALF_UP);
    const maxPages = this.settings(branch.settings).maxPages ?? DEFAULT_MAX_PAGES;
    const refuse = !s ? "Sign in to print." : !priced ? "Printing isn't available here — please ask staff." : job.pages * job.copies > maxPages ? `That's more than ${maxPages} pages — please ask staff.` : null;

    const row = await t.printJob.create({
      data: {
        organizationId: c.organizationId, branchId: c.branchId, deviceId: c.deviceId, customerId: s?.customerId ?? null, sessionId: s?.id ?? null,
        jobKey: job.jobKey, printerName: job.printerName.slice(0, 120), documentName: job.document?.slice(0, 200) ?? null, pages: job.pages, copies: job.copies, isColor: job.color,
        unitPrice, total, status: refuse ? "CANCELLED" : "HELD", failureReason: refuse ? (s ? (priced ? "too_many_pages" : "not_set_up") : "no_session") : null,
        expiresAt: refuse ? null : new Date(Date.now() + CONFIRM_SECONDS * 1000),
      },
    });
    await this.publish(t, row.id);
    if (refuse) {
      await this.commands.issue(t, { deviceId: c.deviceId, type: "PRINT_CANCEL", payload: { jobKey: job.jobKey }, requestedBy: { type: "SYSTEM", id: null } });
      this.send(c.deviceId, { type: "print_status", jobKey: job.jobKey, status: "CANCELLED", message: refuse });
      return;
    }
    this.send(c.deviceId, { type: "print_quote", quote: this.quoteOf(row, branch.currency, unit, !!s?.customerId, !!this.settings(branch.settings).requireApproval) });
  }

  private quoteOf(j: { id: string; jobKey: string; documentName: string | null; pages: number; copies: number; isColor: boolean; unitPrice: Prisma.Decimal; total: Prisma.Decimal; expiresAt: Date | null }, currency: string, unit: number, wallet: boolean, needsStaff: boolean): PrintQuote {
    return {
      jobKey: j.jobKey, jobId: j.id, document: j.documentName, pages: j.pages, copies: j.copies, color: j.isColor, unitPrice: j.unitPrice.toFixed(unit), total: j.total.toFixed(unit),
      currency, canPayWithWallet: wallet, needsStaff, expiresAt: (j.expiresAt ?? new Date()).toISOString(),
    };
  }

  private async resend(t: TenantTx, c: Connection, jobId: string) {
    const j = await t.printJob.findUniqueOrThrow({ where: { id: jobId } });
    const branch = await t.branch.findUniqueOrThrow({ where: { id: j.branchId }, select: { currency: true, settings: true } });
    if (j.status === "HELD" && !j.payWith) return this.send(c.deviceId, { type: "print_quote", quote: this.quoteOf(j, branch.currency, await minorUnit(t, branch.currency), !!j.customerId, !!this.settings(branch.settings).requireApproval) });
    if (j.status === "HELD") return this.send(c.deviceId, { type: "print_status", jobKey: j.jobKey, status: "WAITING_STAFF", message: "Waiting for staff to release your print." });
    if (j.status === "PRINTING") return this.commands.issue(t, { deviceId: c.deviceId, type: "PRINT_RELEASE", payload: { jobKey: j.jobKey }, requestedBy: { type: "SYSTEM", id: null } });
    if (j.status === "CANCELLED") return this.commands.issue(t, { deviceId: c.deviceId, type: "PRINT_CANCEL", payload: { jobKey: j.jobKey }, requestedBy: { type: "SYSTEM", id: null } });
  }

  /** The customer said yes on the Shell. */
  async confirm(t: TenantTx, c: Connection, jobKey: string, payWith: "BILL" | "WALLET") {
    const j = await t.printJob.findFirst({ where: { deviceId: c.deviceId, jobKey } });
    if (!j || j.status !== "HELD" || j.payWith) return;
    if (payWith === "WALLET" && !j.customerId) return this.send(c.deviceId, { type: "print_status", jobKey, status: "CANCELLED", message: "Guests can't pay from a wallet." });
    const branch = await t.branch.findUniqueOrThrow({ where: { id: j.branchId }, select: { settings: true } });
    await t.printJob.update({ where: { id: j.id }, data: { payWith } });
    if (this.settings(branch.settings).requireApproval) {
      await t.printJob.update({ where: { id: j.id }, data: { expiresAt: new Date(Date.now() + APPROVAL_SECONDS * 1000) } });
      await this.publish(t, j.id);
      this.send(c.deviceId, { type: "print_status", jobKey, status: "WAITING_STAFF", message: "Sent to the front desk — staff will release it shortly." });
      return;
    }
    await this.chargeAndRelease(t, j.id, { type: "DEVICE", id: c.deviceId });
  }

  /** Staff release a held job (optionally switching how it's paid). */
  async staffRelease(t: TenantTx, jobId: string, payWith: "BILL" | "WALLET" | undefined, actor: Actor) {
    const j = await t.printJob.findUniqueOrThrow({ where: { id: jobId } });
    if (j.status !== "HELD") throw new ConflictException({ error: "print_not_held", status: j.status });
    if (payWith === "WALLET" && !j.customerId) throw new ConflictException({ error: "wallet_needs_customer" });
    if (payWith) await t.printJob.update({ where: { id: j.id }, data: { payWith } });
    else if (!j.payWith) await t.printJob.update({ where: { id: j.id }, data: { payWith: "BILL" } });
    const r = await this.chargeAndRelease(t, j.id, actor);
    if (r === "wallet_short") throw new ConflictException({ error: "insufficient_funds", hint: "Release it to the bill instead." });
    return r; // "released", or "session_ended" (the job was cancelled — keep that, don't roll it back)
  }

  /**
   * Charge (session bill or wallet) and tell the station to print. If the
   * wallet can't cover it, nothing is charged and the job waits for another choice.
   */
  async chargeAndRelease(t: TenantTx, jobId: string, actor: Actor): Promise<"released" | "wallet_short" | "session_ended"> {
    const j = await t.printJob.findUniqueOrThrow({ where: { id: jobId } });
    if (j.status !== "HELD") throw new ConflictException({ error: "print_not_held", status: j.status });
    const priced = await this.price(t, j.branchId, j.isColor);
    if (!priced) throw new ConflictException({ error: "printing_not_set_up" });
    const s = await t.gamingSession.findFirst({ where: { deviceId: j.deviceId, status: { in: [...LIVE] } }, select: { id: true } });
    if (!s) {
      await this.cancel(t, j.id, "no_session", "The session has ended — the print was cancelled.", actor);
      return "session_ended";
    }
    const payWith = (j.payWith as "BILL" | "WALLET" | null) ?? "BILL";
    // Check the wallet first: a failed payment mid-order would roll everything back, including this job's state.
    if (payWith === "WALLET" && j.customerId) {
      const b = await balances(t, j.customerId);
      if (b.frozen || b.cashMinor + b.bonusMinor < toMinor(j.total, b.unit)) {
        await t.printJob.update({ where: { id: j.id }, data: { payWith: null, expiresAt: new Date(Date.now() + CONFIRM_SECONDS * 1000) } });
        const branch = await t.branch.findUniqueOrThrow({ where: { id: j.branchId }, select: { currency: true, settings: true } });
        const again = await t.printJob.findUniqueOrThrow({ where: { id: j.id } });
        const notice = b.frozen ? "Your wallet can't be used right now — choose “Add to my bill”." : "Not enough in your wallet — choose “Add to my bill” instead.";
        this.send(j.deviceId, { type: "print_quote", quote: { ...this.quoteOf(again, branch.currency, b.unit, true, !!this.settings(branch.settings).requireApproval), notice } });
        return "wallet_short";
      }
    }
    {
      const o = await this.orders.place(
        t,
        {
          branchId: j.branchId, channel: "SHELL", type: "GAMING_SEAT", deviceId: j.deviceId, internal: true,
          lines: [{ productId: priced.productId, quantity: j.pages * j.copies, notes: j.documentName ? `Print: ${j.documentName}`.slice(0, 200) : null }],
          payments: payWith === "WALLET" ? [{ method: "WALLET" }] : undefined, idempotencyKey: `print:${j.id}`,
        },
        actor.type === "EMPLOYEE" && actor.id ? { type: "EMPLOYEE", id: actor.id } : { type: "DEVICE", id: j.deviceId },
      );
      await t.printJob.update({ where: { id: j.id }, data: { status: "PRINTING", orderItemId: o.items[0]?.id ?? null, expiresAt: null } });
    }
    await this.commands.issue(t, { deviceId: j.deviceId, type: "PRINT_RELEASE", payload: { jobKey: j.jobKey }, requestedBy: actor.type === "EMPLOYEE" && actor.id ? { type: "EMPLOYEE", id: actor.id } : { type: "SYSTEM", id: null } });
    await auditAs(t, actor, { action: "print.release", entityType: "PrintJob", entityId: j.id, branchId: j.branchId, after: { pages: j.pages, copies: j.copies, color: j.isColor, total: j.total.toString(), payWith } });
    await this.publish(t, j.id);
    this.send(j.deviceId, { type: "print_status", jobKey: j.jobKey, status: "PRINTING", message: `Printing ${j.pages * j.copies} page${j.pages * j.copies === 1 ? "" : "s"}…` });
    return "released";
  }

  async customerCancel(t: TenantTx, c: Connection, jobKey: string) {
    const j = await t.printJob.findFirst({ where: { deviceId: c.deviceId, jobKey } });
    if (!j || j.status !== "HELD") return;
    await this.cancel(t, j.id, "customer", "Print cancelled.", { type: "DEVICE", id: c.deviceId });
  }

  async cancel(t: TenantTx, jobId: string, reason: string, message: string, actor: Actor) {
    const j = await t.printJob.findUniqueOrThrow({ where: { id: jobId } });
    if (!["QUEUED", "HELD"].includes(j.status)) throw new ConflictException({ error: "print_not_held", status: j.status });
    await t.printJob.update({ where: { id: j.id }, data: { status: "CANCELLED", failureReason: reason, expiresAt: null } });
    await this.commands.issue(t, { deviceId: j.deviceId, type: "PRINT_CANCEL", payload: { jobKey: j.jobKey }, requestedBy: actor.type === "EMPLOYEE" && actor.id ? { type: "EMPLOYEE", id: actor.id } : { type: "SYSTEM", id: null } });
    if (actor.type === "EMPLOYEE") await auditAs(t, actor, { action: "print.cancel", entityType: "PrintJob", entityId: j.id, branchId: j.branchId, after: { reason } });
    await this.publish(t, j.id);
    this.send(j.deviceId, { type: "print_status", jobKey: j.jobKey, status: "CANCELLED", message });
  }

  /** The spooler finished (or failed) the released job. */
  async done(t: TenantTx, c: Connection, jobKey: string, ok: boolean, detail: string | null) {
    const j = await t.printJob.findFirst({ where: { deviceId: c.deviceId, jobKey } });
    if (!j || j.status !== "PRINTING") return;
    await t.printJob.update({ where: { id: j.id }, data: { status: ok ? "COMPLETED" : "FAILED", failureReason: ok ? null : (detail ?? "printer_error").slice(0, 200) } });
    if (!ok) {
      await this.runtime.openAlert(t, { deviceId: c.deviceId, organizationId: c.organizationId, branchId: c.branchId }, "PRINT_FAILED", "WARNING", `Print failed on ${j.printerName ?? "the printer"} — check it and refund the customer if needed`, { jobId: j.id, detail });
    }
    await this.publish(t, j.id);
    this.send(c.deviceId, { type: "print_status", jobKey, status: ok ? "COMPLETED" : "FAILED", message: ok ? "Your print is ready at the printer." : "The printer had a problem — please ask staff." });
  }

  /** Jobs nobody confirmed (or staff never released) are cancelled so the queue doesn't jam. */
  async sweep() {
    const due = await this.db.global.$queryRaw<Array<{ organization_id: string; job_id: string }>>`SELECT * FROM app.print_jobs_expired()`;
    for (const d of due) {
      const afterCommit: Array<() => void | Promise<void>> = [];
      try {
        await this.db.withTenant({ organizationId: d.organization_id, actorType: "SYSTEM", actorId: null }, (t) =>
          requestStore.run({ tx: t, afterCommit, principal: null as never, decision: null, requestId: `print-sweep:${d.job_id}`, ip: null, userAgent: null, reason: null }, async () => {
            const j = await t.printJob.findUnique({ where: { id: d.job_id }, select: { status: true, expiresAt: true } });
            if (!j || !["QUEUED", "HELD"].includes(j.status) || !j.expiresAt || j.expiresAt > new Date()) return;
            await this.cancel(t, d.job_id, "timeout", "Nobody confirmed the print in time — it was cancelled.", { type: "SYSTEM", id: null });
          }),
        );
        for (const f of afterCommit) await Promise.resolve(f()).catch(() => undefined);
      } catch (e) {
        this.log.warn(`sweep ${d.job_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ── staff ────────────────────────────────────────────────────────────────

  async list(t: TenantTx, branchId: string, open: boolean) {
    const rows = await t.printJob.findMany({
      where: { branchId, ...(open ? { status: { in: ["QUEUED", "HELD", "PRINTING"] } } : { createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { device: { select: { name: true } }, customer: { select: { displayName: true } } },
    });
    return rows.map((j) => ({
      id: j.id, status: j.status, device: j.device.name, customer: j.customer?.displayName ?? null, document: j.documentName, printer: j.printerName, pages: j.pages, copies: j.copies,
      color: j.isColor, unitPrice: j.unitPrice.toFixed(2), total: j.total.toFixed(2), payWith: j.payWith, failureReason: j.failureReason, expiresAt: j.expiresAt, createdAt: j.createdAt,
      waitingFor: j.status === "HELD" ? (j.payWith ? "STAFF" : "CUSTOMER") : null,
    }));
  }

  async byId(t: TenantTx, id: string) {
    const j = await t.printJob.findUnique({ where: { id }, select: { id: true, branchId: true } });
    if (!j) throw new NotFoundException({ error: "print_job_not_found" });
    return j;
  }
}
