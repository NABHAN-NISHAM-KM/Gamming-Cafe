import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { worksAt } from "@arena/rbac";
import { auditAs } from "../common/audit.service.js";
import { AnyStaff, RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { cash, sales, utilization } from "../reports/reports.service.js";

const day = z.iso.date();
const Range = z.object({ from: day, to: day }).refine((q) => q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) <= 62 * 86_400_000, "at most two months at a time");
const NewNote = z.object({ body: z.string().trim().min(1).max(500) }).strict();
const Days = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const DayQ = z.object({ date: day });

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });
const localDay = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** The branch, if the caller works there (any role). Other orgs' branches are simply not found (RLS). */
async function myBranch(branchId: string) {
  const b = await tx().branch.findUnique({ where: { id: branchId }, select: { id: true, brandId: true, timezone: true, name: true, code: true } });
  if (!b) throw new NotFoundException({ error: "not_found" });
  if (!worksAt(principal(), { organizationId: orgId(), brandId: b.brandId, branchId: b.id })) throw new ForbiddenException({ error: "forbidden", reason: "OUT_OF_SCOPE" });
  return b;
}

const hours = (from: Date, to: Date | null) => Math.round(((to ?? new Date()).getTime() - from.getTime()) / 360_000) / 10;

/**
 * The everyday staff loop at a branch: clocking in and out, notes for the next
 * shift, what players thought of their session, and the owner's end-of-day summary.
 */
@Controller()
export class StaffController {
  // ── attendance ───────────────────────────────────────────────────────────

  /** Am I clocked in (anywhere)? */
  @AnyStaff()
  @Get("clock")
  async myClock() {
    const open = await tx().timeClockEntry.findFirst({ where: { employeeId: principal().employeeId, clockOutAt: null }, include: { branch: { select: { id: true, name: true, code: true } } } });
    return { open: open ? { id: open.id, branch: open.branch, clockInAt: open.clockInAt, hours: hours(open.clockInAt, null) } : null };
  }

  @AnyStaff()
  @Post("branches/:branchId/clock-in")
  @HttpCode(200)
  async clockIn(@Param("branchId") branchId: string) {
    const b = await myBranch(branchId);
    if (await tx().timeClockEntry.findFirst({ where: { employeeId: principal().employeeId, clockOutAt: null }, select: { id: true } })) throw new ConflictException({ error: "already_clocked_in" });
    try {
      await tx().timeClockEntry.create({ data: { organizationId: orgId(), branchId: b.id, employeeId: principal().employeeId } });
    } catch (e) {
      if (String(e).includes("time_clock_one_open_per_employee")) throw new ConflictException({ error: "already_clocked_in" });
      throw e;
    }
    await auditAs(tx(), me(), { action: "staff.clock_in", entityType: "Employee", entityId: principal().employeeId, branchId: b.id });
    return this.myClock();
  }

  @AnyStaff()
  @Post("clock-out")
  @HttpCode(200)
  async clockOut() {
    const open = await tx().timeClockEntry.findFirst({ where: { employeeId: principal().employeeId, clockOutAt: null } });
    if (!open) throw new ConflictException({ error: "not_clocked_in" });
    const out = await tx().timeClockEntry.update({ where: { id: open.id }, data: { clockOutAt: new Date() } });
    await auditAs(tx(), me(), { action: "staff.clock_out", entityType: "Employee", entityId: principal().employeeId, branchId: open.branchId, after: { hours: hours(out.clockInAt, out.clockOutAt) } });
    return { open: null, worked: hours(out.clockInAt, out.clockOutAt) };
  }

  /** Who worked when at a branch, with hours per person (open entries count up to now). */
  @RequirePermission("reports.staff")
  @Get("branches/:branchId/attendance")
  async attendance(@Param("branchId") branchId: string, @Query(new ZodPipe(Range)) q: z.infer<typeof Range>) {
    const b = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { timezone: true } });
    // Coarse UTC window, then exact local days.
    const rows = await tx().timeClockEntry.findMany({
      where: { branchId, clockInAt: { gte: new Date(Date.parse(q.from) - 86_400_000), lt: new Date(Date.parse(q.to) + 2 * 86_400_000) } },
      orderBy: { clockInAt: "desc" },
      include: { employee: { select: { id: true, displayName: true } } },
    });
    const entries = rows
      .map((r) => ({ id: r.id, day: localDay(r.clockInAt, b.timezone), employee: r.employee, clockInAt: r.clockInAt, clockOutAt: r.clockOutAt, hours: hours(r.clockInAt, r.clockOutAt), open: !r.clockOutAt }))
      .filter((r) => r.day >= q.from && r.day <= q.to);
    const people = new Map<string, { employee: { id: string; displayName: string }; hours: number; shifts: number }>();
    for (const e of entries) {
      const p = people.get(e.employee.id) ?? { employee: e.employee, hours: 0, shifts: 0 };
      p.hours = Math.round((p.hours + e.hours) * 10) / 10;
      p.shifts += 1;
      people.set(e.employee.id, p);
    }
    return { from: q.from, to: q.to, people: [...people.values()].sort((a, b) => b.hours - a.hours), entries };
  }

  // ── handover notes ───────────────────────────────────────────────────────

  /** Open notes, plus what was ticked off in the last day. */
  @AnyStaff()
  @Get("branches/:branchId/handover-notes")
  async notes(@Param("branchId") branchId: string) {
    await myBranch(branchId);
    const rows = await tx().handoverNote.findMany({
      where: { branchId, OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(Date.now() - 86_400_000) } }] },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: { author: { select: { displayName: true } } },
    });
    const ids = [...new Set(rows.map((r) => r.resolvedById).filter((x): x is string => !!x))];
    const resolvers = ids.length ? await tx().employee.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
    return rows.map((r) => ({ id: r.id, body: r.body, author: r.author.displayName, createdAt: r.createdAt, resolvedAt: r.resolvedAt, resolvedBy: resolvers.find((x) => x.id === r.resolvedById)?.displayName ?? null }));
  }

  @AnyStaff()
  @Post("branches/:branchId/handover-notes")
  async addNote(@Param("branchId") branchId: string, @Body(new ZodPipe(NewNote)) body: z.infer<typeof NewNote>) {
    const b = await myBranch(branchId);
    const n = await tx().handoverNote.create({ data: { organizationId: orgId(), branchId: b.id, authorId: principal().employeeId, body: body.body } });
    await auditAs(tx(), me(), { action: "handover.note", entityType: "HandoverNote", entityId: n.id, branchId: b.id });
    return { id: n.id };
  }

  @AnyStaff()
  @Post("handover-notes/:noteId/resolve")
  @HttpCode(200)
  async resolveNote(@Param("noteId") noteId: string) {
    const n = await tx().handoverNote.findUnique({ where: { id: noteId }, select: { id: true, branchId: true, resolvedAt: true } });
    if (!n) throw new NotFoundException({ error: "not_found" });
    await myBranch(n.branchId);
    if (n.resolvedAt) return { id: n.id };
    await tx().handoverNote.update({ where: { id: n.id }, data: { resolvedAt: new Date(), resolvedById: principal().employeeId } });
    await auditAs(tx(), me(), { action: "handover.resolve", entityType: "HandoverNote", entityId: n.id, branchId: n.branchId });
    return { id: n.id };
  }

  // ── feedback ─────────────────────────────────────────────────────────────

  @RequirePermission("reports.operational")
  @Get("branches/:branchId/feedback")
  async feedback(@Param("branchId") branchId: string, @Query(new ZodPipe(Days)) q: z.infer<typeof Days>) {
    const since = new Date(Date.now() - q.days * 86_400_000);
    const rows = await tx().sessionFeedback.findMany({ where: { branchId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 500 });
    const devices = await tx().device.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.deviceId))] } }, select: { id: true, name: true } });
    const custIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
    const customers = custIds.length ? await tx().customer.findMany({ where: { id: { in: custIds } }, select: { id: true, displayName: true } }) : [];
    const stars = [1, 2, 3, 4, 5].map((s) => rows.filter((r) => r.rating === s).length);
    return {
      days: q.days,
      count: rows.length,
      average: rows.length ? Math.round((rows.reduce((a, r) => a + r.rating, 0) / rows.length) * 10) / 10 : null,
      stars,
      recent: rows.slice(0, 30).map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, createdAt: r.createdAt, station: devices.find((d) => d.id === r.deviceId)?.name ?? null, customer: customers.find((c) => c.id === r.customerId)?.displayName ?? "Guest" })),
    };
  }

  // ── end of day ───────────────────────────────────────────────────────────

  /** One branch, one local day: the numbers an owner wants at closing time. */
  @RequirePermission("reports.financial")
  @Get("branches/:branchId/day-summary")
  async daySummary(@Param("branchId") branchId: string, @Query(new ZodPipe(DayQ)) q: z.infer<typeof DayQ>) {
    const b = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { name: true, code: true, timezone: true } });
    const scope = { branchIds: [branchId] };
    const p = { from: q.date, to: q.date };
    const [s, c, u] = await Promise.all([sales(tx(), scope, p), cash(tx(), scope, p), utilization(tx(), scope, p)]);
    const dayStart = new Date(Date.parse(q.date) - 86_400_000);
    const fb = (await tx().sessionFeedback.findMany({ where: { branchId, createdAt: { gte: dayStart, lt: new Date(Date.parse(q.date) + 2 * 86_400_000) } }, select: { rating: true, createdAt: true } })).filter((r) => localDay(r.createdAt, b.timezone) === q.date);
    const openNotes = await tx().handoverNote.count({ where: { branchId, resolvedAt: null } });
    return {
      date: q.date, branch: { name: b.name, code: b.code }, currency: s.currency,
      revenue: s.summary.revenue, takings: s.summary.takings, bills: s.summary.bills, refunds: s.summary.refunds, discounts: s.summary.discounts,
      sessions: u.summary.sessions, hoursPlayed: u.summary.hoursPlayed, occupancyPct: u.summary.occupancyPct,
      cash: { counted: c.totals.counted, expected: c.totals.expected, variance: c.totals.variance, shifts: c.totals.shifts, needingApproval: c.totals.needingApproval },
      // Food, drinks and shop items only: gaming time is in "sessions", and its quantity is minutes.
      topProducts: s.topProducts.filter((x) => !["GAMING_TIME", "WALLET_TOPUP", "GIFT_CARD", "MEMBERSHIP"].includes(x.type)).slice(0, 3).map((x) => ({ name: x.name, quantity: x.quantity, net: x.net })),
      feedback: { count: fb.length, average: fb.length ? Math.round((fb.reduce((a, r) => a + r.rating, 0) / fb.length) * 10) / 10 : null },
      openNotes,
    };
  }
}
