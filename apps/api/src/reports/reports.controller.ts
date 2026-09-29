import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { period, scopeFor, sendCsv } from "../common/reporting.js";
import { RequirePermissionAnyScope } from "../common/decorators.js";
import { tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { cash, sales, staff, utilization, vat } from "./reports.service.js";

const day = z.iso.date();
const Range = z
  .object({ from: day.optional(), to: day.optional(), branchId: z.uuid().optional(), format: z.enum(["json", "csv"]).default("json") })
  .refine((q) => !q.from || !q.to || q.from <= q.to, "from must not be after to")
  .refine((q) => !q.from || !q.to || Date.parse(q.to) - Date.parse(q.from) <= 400 * 86_400_000, "at most about a year at a time");
type Q = z.infer<typeof Range>;

/**
 * Reports. Each needs its reports.* permission at *some* scope and shows only
 * the branches the caller holds it for; CSV needs reports.export on top.
 */
@Controller("reports")
export class ReportsController {
  @RequirePermissionAnyScope("reports.financial")
  @Get("sales")
  async sales(@Query(new ZodPipe(Range)) q: Q, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const r = await sales(tx(), await scopeFor("reports.financial", q.branchId), p);
    if (q.format === "csv") {
      return sendCsv(res, `sales-by-product-${p.from}-${p.to}`, ["product", "category", "type", "quantity", "net", "cost", "margin", "margin %"], r.topProducts.map((x) => [x.name, x.category, x.type, x.quantity, x.net, x.cost, x.margin, x.marginPct]));
    }
    return r;
  }

  @RequirePermissionAnyScope("reports.financial")
  @Get("sales/daily")
  async daily(@Query(new ZodPipe(Range)) q: Q, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const r = await sales(tx(), await scopeFor("reports.financial", q.branchId), p);
    if (q.format === "csv") return sendCsv(res, `sales-by-day-${p.from}-${p.to}`, ["day", "bills", "total", "vat", "net"], r.byDay.map((x) => [x.day, x.bills, x.total, x.tax, x.net]));
    return r.byDay;
  }

  @RequirePermissionAnyScope("reports.financial")
  @Get("vat")
  async vat(@Query(new ZodPipe(Range)) q: Q, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const r = await vat(tx(), await scopeFor("reports.financial", q.branchId), p);
    if (q.format === "csv") {
      const rows: unknown[][] = [
        ...r.output.map((x) => ["Output VAT", x.rate, x.ratePercent, x.taxable, x.tax]),
        ["Output VAT", "Refunds", "", "", `-${r.refundAdjustment}`],
        ...r.input.map((x) => ["Input VAT", x.source, "", "", `-${x.tax}`]),
        ["Net payable", "", "", "", r.netPayable],
      ];
      return sendCsv(res, `vat-${p.from}-${p.to}`, ["section", "item", "rate %", "taxable", "vat"], rows);
    }
    return r;
  }

  @RequirePermissionAnyScope("reports.financial")
  @Get("cash")
  async cash(@Query(new ZodPipe(Range)) q: Q, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const r = await cash(tx(), await scopeFor("reports.financial", q.branchId), p);
    if (q.format === "csv") {
      return sendCsv(res, `cash-shifts-${p.from}-${p.to}`, ["closed", "branch", "drawer", "cashier", "status", "opening", "expected", "counted", "variance", "approved by"], r.shifts.map((x) => [x.closedAt, x.branch, x.drawer, x.cashier, x.status, x.openingCash, x.expectedCash, x.countedCash, x.variance, x.approvedBy]));
    }
    return r;
  }

  @RequirePermissionAnyScope("reports.operational")
  @Get("utilization")
  async utilization(@Query(new ZodPipe(Range)) q: Q, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const r = await utilization(tx(), await scopeFor("reports.operational", q.branchId), p);
    if (q.format === "csv") {
      return sendCsv(res, `utilization-${p.from}-${p.to}`, ["branch", "zone", "type", "stations", "sessions", "players", "hours", "occupancy %", "revenue", "revenue per station-day"], r.zones.map((z) => [z.branch, z.zone, z.type, z.stations, z.sessions, z.players, z.hours, z.occupancyPct, z.revenue, z.revenuePerStationDay]));
    }
    return r;
  }

  @RequirePermissionAnyScope("reports.staff")
  @Get("staff")
  async staff(@Query(new ZodPipe(Range)) q: Q, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const r = await staff(tx(), await scopeFor("reports.staff", q.branchId), p);
    if (q.format === "csv") {
      return sendCsv(res, `staff-${p.from}-${p.to}`, ["employee", "code", "home branch", "orders", "order value", "payments", "taken", "refunds", "refunded", "voids", "voided", "sessions started", "shifts", "cash variance"], r.staff.map((x) => [x.name, x.code, x.branch, x.orders, x.orderValue, x.payments, x.paid, x.refunds, x.refunded, x.voids, x.voided, x.sessions, x.shifts, x.variance]));
    }
    return r;
  }
}
