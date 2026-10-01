import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { LiveBus } from "../devices/live.js";
import { fromMinor, minorUnit, toMinor } from "./bills.js";

type Actor = { type: "EMPLOYEE"; id: string };

/** Above this (branch currency) a closed shift waits for a manager's approval. */
const DEFAULT_VARIANCE_THRESHOLD = 5;

/**
 * Cash drawers and cashier shifts. The drawer is an append-only ledger
 * (CashMovement): opening float, cash sales, cash refunds, pay-ins/outs, safe
 * drops. Closing compares what the ledger says should be in the drawer with
 * what was counted; a variance above the branch threshold needs approval.
 */
@Injectable()
export class ShiftsService {
  constructor(@Inject(LiveBus) private readonly bus: LiveBus) {}

  async open(t: TenantTx, i: { branchId: string; cashDrawerId: string; openingCash: string }, actor: Actor) {
    const drawer = await t.cashDrawer.findFirst({ where: { id: i.cashDrawerId, branchId: i.branchId, isActive: true } });
    if (!drawer) throw new NotFoundException({ error: "drawer_not_found" });
    if (await t.shift.findFirst({ where: { employeeId: actor.id, branchId: i.branchId, status: "OPEN" }, select: { id: true } })) throw new ConflictException({ error: "shift_already_open" });
    const branch = await t.branch.findUniqueOrThrow({ where: { id: i.branchId }, select: { currency: true, organizationId: true } });
    const unit = await minorUnit(t, branch.currency);
    const opening = toMinor(i.openingCash, unit);
    if (opening < 0) throw new ConflictException({ error: "bad_amount" });
    let shift;
    try {
      shift = await t.shift.create({ data: { organizationId: branch.organizationId, branchId: i.branchId, cashDrawerId: drawer.id, employeeId: actor.id, currency: branch.currency, openingCash: fromMinor(opening, unit) } });
    } catch (e) {
      if (String(e).includes("shift_one_open_per_drawer") || String(e).includes("23P01")) throw new ConflictException({ error: "drawer_in_use", hint: "Someone else has this drawer open." });
      throw e;
    }
    if (opening > 0) await t.cashMovement.create({ data: { organizationId: branch.organizationId, shiftId: shift.id, type: "OPENING_FLOAT", amount: fromMinor(opening, unit), employeeId: actor.id } });
    await auditAs(t, actor, { action: "shift.open", entityType: "Shift", entityId: shift.id, branchId: i.branchId, after: { drawer: drawer.name, openingCash: i.openingCash } });
    return this.report(t, shift.id);
  }

  async movement(t: TenantTx, shiftId: string, m: { type: "PAY_IN" | "PAY_OUT" | "SAFE_DROP"; amount: string; reason: string }, actor: Actor) {
    const shift = await t.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundException({ error: "not_found" });
    if (shift.status !== "OPEN") throw new ConflictException({ error: "shift_not_open" });
    const unit = await minorUnit(t, shift.currency);
    const v = toMinor(m.amount, unit);
    if (v <= 0) throw new ConflictException({ error: "bad_amount" });
    const signed = m.type === "PAY_IN" ? v : -v;
    if (signed < 0 && (await this.expectedMinor(t, shiftId, unit)) + signed < 0) throw new ConflictException({ error: "not_enough_cash", hint: "The drawer doesn't hold that much." });
    await t.cashMovement.create({ data: { organizationId: shift.organizationId, shiftId, type: m.type, amount: fromMinor(signed, unit), employeeId: actor.id, reason: m.reason } });
    await auditAs(t, actor, { action: `shift.${m.type.toLowerCase()}`, entityType: "Shift", entityId: shiftId, branchId: shift.branchId, after: { amount: m.amount, reason: m.reason } });
    return this.report(t, shiftId);
  }

  private async expectedMinor(t: TenantTx, shiftId: string, unit: number) {
    const rows = await t.cashMovement.findMany({ where: { shiftId }, select: { amount: true } });
    return rows.reduce((a, r) => a + toMinor(r.amount, unit), 0);
  }

  /** X-report (open shift) or Z-report (closed): cash expected, sales by method, refunds, movements. */
  async report(t: TenantTx, shiftId: string) {
    const shift = await t.shift.findUnique({ where: { id: shiftId }, include: { cashDrawer: { select: { name: true } }, employee: { select: { displayName: true } }, approvedBy: { select: { displayName: true } } } });
    if (!shift) throw new NotFoundException({ error: "not_found" });
    const unit = await minorUnit(t, shift.currency);
    const f = (m: number) => fromMinor(m, unit).toFixed(unit);
    const moves = await t.cashMovement.findMany({ where: { shiftId }, orderBy: { createdAt: "asc" }, select: { type: true, amount: true, reason: true, createdAt: true } });
    const pays = await t.payment.findMany({ where: { shiftId, status: "CAPTURED" }, select: { method: true, amount: true, refundedAmount: true } });
    const refunds = await t.refund.findMany({ where: { shiftId, status: "SUCCEEDED" }, select: { amount: true, destination: true } });
    const byMethod: Record<string, number> = {};
    for (const p of pays) byMethod[p.method] = (byMethod[p.method] ?? 0) + toMinor(p.amount, unit);
    const byType: Record<string, number> = {};
    for (const m of moves) byType[m.type] = (byType[m.type] ?? 0) + toMinor(m.amount, unit);
    const expected = moves.reduce((a, m) => a + toMinor(m.amount, unit), 0);
    const orders = await t.order.count({ where: { shiftId } });
    return {
      id: shift.id, status: shift.status, branchId: shift.branchId, drawer: shift.cashDrawer.name, employee: shift.employee.displayName, currency: shift.currency,
      openedAt: shift.openedAt, closedAt: shift.closedAt, approvedBy: shift.approvedBy?.displayName ?? null, notes: shift.notes,
      openingCash: shift.openingCash.toFixed(unit),
      expectedCash: shift.expectedCash?.toFixed(unit) ?? f(expected),
      countedCash: shift.countedCash?.toFixed(unit) ?? null,
      variance: shift.variance?.toFixed(unit) ?? null,
      sales: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, f(v)])),
      salesTotal: f(Object.values(byMethod).reduce((a, b) => a + b, 0)),
      refunds: f(refunds.reduce((a, r) => a + toMinor(r.amount, unit), 0)),
      drawer_: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, f(v)])),
      movements: moves.map((m) => ({ ...m, amount: m.amount.toFixed(unit) })),
      orders,
    };
  }

  async close(t: TenantTx, shiftId: string, c: { countedCash: string; denominations?: Record<string, number> | null; notes?: string | null }, actor: Actor, canCloseOthers: boolean) {
    const shift = await t.shift.findUnique({ where: { id: shiftId }, include: { branch: { select: { settings: true } } } });
    if (!shift) throw new NotFoundException({ error: "not_found" });
    if (shift.employeeId !== actor.id && !canCloseOthers) throw new ConflictException({ error: "not_your_shift" });
    if (shift.status !== "OPEN") throw new ConflictException({ error: "shift_not_open" });
    const unit = await minorUnit(t, shift.currency);
    const expected = await this.expectedMinor(t, shiftId, unit);
    const counted = toMinor(c.countedCash, unit);
    if (counted < 0) throw new ConflictException({ error: "bad_amount" });
    const variance = counted - expected;
    const threshold = toMinor((shift.branch.settings as { cashVarianceThreshold?: number } | null)?.cashVarianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD, unit);
    const report = await this.report(t, shiftId);
    const after = await t.shift.update({
      where: { id: shiftId },
      data: {
        status: Math.abs(variance) > threshold ? "PENDING_APPROVAL" : "CLOSED", expectedCash: fromMinor(expected, unit), countedCash: fromMinor(counted, unit),
        variance: fromMinor(variance, unit), denominations: (c.denominations ?? undefined) as Prisma.InputJsonValue | undefined, notes: c.notes ?? null, closedAt: new Date(),
        totals: { sales: report.sales, salesTotal: report.salesTotal, refunds: report.refunds, orders: report.orders, drawer: report.drawer_ } as Prisma.InputJsonValue,
      },
    });
    await auditAs(t, actor, { action: "shift.close", entityType: "Shift", entityId: shiftId, branchId: shift.branchId, after: { expected: fromMinor(expected, unit).toFixed(unit), counted: c.countedCash, variance: fromMinor(variance, unit).toFixed(unit), status: after.status } });
    if (after.status === "PENDING_APPROVAL") {
      // Over the branch limit: tell the managers now, not at the next report.
      const amount = fromMinor(variance, unit).toFixed(unit);
      const alert = await t.alert.create({
        data: {
          organizationId: shift.organizationId, branchId: shift.branchId, type: "CASH_VARIANCE", severity: "WARNING", dedupeKey: `CASH_VARIANCE:${shiftId}`,
          title: `${report.employee} closed ${report.drawer} ${variance > 0 ? "over" : "short"} by ${shift.currency} ${amount.replace("-", "")}`,
          detail: { shiftId, employee: report.employee, drawer: report.drawer, expected: fromMinor(expected, unit).toFixed(unit), counted: fromMinor(counted, unit).toFixed(unit), variance: amount },
        },
      });
      this.bus.publish(shift.organizationId, shift.branchId, { type: "alert", alert });
    }
    return this.report(t, shiftId);
  }

  async approve(t: TenantTx, shiftId: string, note: string | null, actor: Actor) {
    const shift = await t.shift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundException({ error: "not_found" });
    if (shift.status !== "PENDING_APPROVAL") throw new ConflictException({ error: "nothing_to_approve", status: shift.status });
    if (shift.employeeId === actor.id) throw new ConflictException({ error: "cannot_approve_own_shift" });
    await t.shift.update({ where: { id: shiftId }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), notes: note ? `${shift.notes ? `${shift.notes}\n` : ""}Approved: ${note}` : shift.notes } });
    for (const a of await t.alert.findMany({ where: { dedupeKey: `CASH_VARIANCE:${shiftId}`, status: { in: ["OPEN", "ACKNOWLEDGED"] } } })) {
      const alert = await t.alert.update({ where: { id: a.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
      this.bus.publish(shift.organizationId, shift.branchId, { type: "alert", alert });
    }
    await auditAs(t, actor, { action: "shift.approve", entityType: "Shift", entityId: shiftId, branchId: shift.branchId, after: { variance: shift.variance?.toString(), note } });
    return this.report(t, shiftId);
  }
}
