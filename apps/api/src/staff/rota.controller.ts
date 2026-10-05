import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { auditAs } from "../common/audit.service.js";
import { RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const Range = z
  .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .refine((q) => q.from < q.to && Date.parse(q.to) - Date.parse(q.from) <= 35 * 86_400_000, "at most five weeks");
const NewShift = z
  .object({ employeeId: z.uuid(), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), note: z.string().trim().max(200).nullish() })
  .strict()
  .refine((s) => s.startsAt < s.endsAt, "ends before it starts");
const Copy = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).strict();

/** Grace before a planned start counts as late. */
const LATE_AFTER_MIN = 5;
const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });
const overlap = (e: unknown) => String(e).includes("shift_plan_no_overlap");

/**
 * The rota: shifts planned per person, compared with when they actually
 * clocked in. A shift is "late" if the first clock-in came more than five
 * minutes after its start, and "missed" if it started and nobody clocked in.
 */
@Controller()
export class RotaController {
  @RequirePermission("employee.view")
  @Get("branches/:branchId/rota")
  async rota(@Param("branchId") branchId: string, @Query(new ZodPipe(Range)) q: z.infer<typeof Range>) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    const plans = await tx().shiftPlan.findMany({
      where: { branchId, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: { startsAt: "asc" },
      include: { employee: { select: { id: true, displayName: true } } },
    });
    const clocks = await tx().timeClockEntry.findMany({
      where: { branchId, clockInAt: { gte: new Date(from.getTime() - 12 * 3_600_000), lt: to } },
      select: { employeeId: true, clockInAt: true, clockOutAt: true },
      orderBy: { clockInAt: "asc" },
    });
    const now = new Date();
    const shifts = plans.map((p) => {
      // The clock-in that belongs to this shift: from two hours before it starts until it ends.
      const c = clocks.find((x) => x.employeeId === p.employeeId && x.clockInAt.getTime() >= p.startsAt.getTime() - 2 * 3_600_000 && x.clockInAt < p.endsAt);
      const lateMin = c ? Math.max(0, Math.round((c.clockInAt.getTime() - p.startsAt.getTime()) / 60_000)) : null;
      const status = c ? (lateMin! > LATE_AFTER_MIN ? "LATE" : "ON_TIME") : p.startsAt.getTime() + LATE_AFTER_MIN * 60_000 < now.getTime() ? "MISSED" : "PLANNED";
      return { id: p.id, employee: p.employee, startsAt: p.startsAt, endsAt: p.endsAt, note: p.note, clockInAt: c?.clockInAt ?? null, clockOutAt: c?.clockOutAt ?? null, lateMinutes: lateMin, status };
    });
    const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
    const people = new Map<string, { employee: { id: string; displayName: string }; planned: number; late: number; missed: number }>();
    for (const s of shifts) {
      const p = people.get(s.employee.id) ?? { employee: s.employee, planned: 0, late: 0, missed: 0 };
      p.planned += hours(s.startsAt, s.endsAt);
      if (s.status === "LATE") p.late++;
      if (s.status === "MISSED") p.missed++;
      people.set(s.employee.id, p);
    }
    return { shifts, people: [...people.values()].map((p) => ({ ...p, planned: Math.round(p.planned * 10) / 10 })) };
  }

  @RequirePermission("employee.manage")
  @Post("branches/:branchId/rota")
  async plan(@Param("branchId") branchId: string, @Body(new ZodPipe(NewShift)) body: z.infer<typeof NewShift>) {
    const emp = await tx().employee.findUnique({ where: { id: body.employeeId }, select: { id: true, status: true } });
    if (!emp || emp.status !== "ACTIVE") throw new NotFoundException({ error: "employee_not_found" });
    try {
      const row = await tx().shiftPlan.create({ data: { organizationId: orgId(), branchId, employeeId: body.employeeId, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), note: body.note ?? null } });
      await auditAs(tx(), me(), { action: "rota.plan", entityType: "ShiftPlan", entityId: row.id, branchId, after: { employeeId: row.employeeId, startsAt: row.startsAt, endsAt: row.endsAt } });
      return row;
    } catch (e) {
      if (overlap(e)) throw new ConflictException({ error: "shift_overlaps" });
      if (String(e).includes("shift_plan_order")) throw new ConflictException({ error: "shift_too_long", hint: "A shift is at most 16 hours." });
      throw e;
    }
  }

  @RequirePermission("employee.manage")
  @Delete("branches/:branchId/rota/:planId")
  @HttpCode(204)
  async remove(@Param("branchId") branchId: string, @Param("planId") planId: string) {
    const p = await tx().shiftPlan.findFirst({ where: { id: planId, branchId } });
    if (!p) throw new NotFoundException({ error: "not_found" });
    await tx().shiftPlan.delete({ where: { id: p.id } });
    await auditAs(tx(), me(), { action: "rota.remove", entityType: "ShiftPlan", entityId: p.id, branchId, before: { employeeId: p.employeeId, startsAt: p.startsAt, endsAt: p.endsAt } });
  }

  /** Copies one week's shifts a week later (skipping any that would overlap what's already planned). */
  @RequirePermission("employee.manage")
  @Post("branches/:branchId/rota/copy-week")
  @HttpCode(200)
  async copy(@Param("branchId") branchId: string, @Body(new ZodPipe(Copy)) body: z.infer<typeof Copy>) {
    const week = 7 * 86_400_000;
    const src = await tx().shiftPlan.findMany({ where: { branchId, startsAt: { gte: new Date(body.from), lt: new Date(body.to) } } });
    let copied = 0;
    for (const s of src) {
      // Inserted only where it fits, so one clash can't abort the rest of the transaction.
      const ok = await tx().$executeRaw`
        INSERT INTO "ShiftPlan" ("id", "organizationId", "branchId", "employeeId", "startsAt", "endsAt", "note", "updatedAt")
        SELECT gen_random_uuid(), ${orgId()}::uuid, ${branchId}::uuid, ${s.employeeId}::uuid, ${new Date(s.startsAt.getTime() + week)}, ${new Date(s.endsAt.getTime() + week)}, ${s.note}, now()
        WHERE NOT EXISTS (SELECT 1 FROM "ShiftPlan" x WHERE x."employeeId" = ${s.employeeId}::uuid
          AND tstzrange(x."startsAt", x."endsAt") && tstzrange(${new Date(s.startsAt.getTime() + week)}, ${new Date(s.endsAt.getTime() + week)}))`;
      copied += ok;
    }
    await auditAs(tx(), me(), { action: "rota.copy_week", entityType: "Branch", entityId: branchId, branchId, after: { copied, of: src.length } });
    return { copied, skipped: src.length - copied };
  }
}
