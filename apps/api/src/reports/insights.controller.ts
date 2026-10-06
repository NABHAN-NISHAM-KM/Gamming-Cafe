import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { RequirePermission } from "../common/decorators.js";
import { tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const STATIONS = ["GAMING_PC", "INTERNET_PC", "CONSOLE", "VR_HEADSET", "SIMULATOR"] as const;
const Days = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });
const Preview = z.object({ rate: z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,6}(\.\d{1,4})?$/.test(v), "a price"), days: z.number().int().min(1).max(90).default(7) }).strict();

/** Thresholds for "needs attention" on the station health board. */
const HOT_C = 85;
const DISK_PCT = 90;
const SILENT_MIN = 10;

async function branchOf(branchId: string) {
  const b = await tx().branch.findUnique({ where: { id: branchId }, select: { id: true, timezone: true, currency: true } });
  if (!b) throw new NotFoundException({ error: "not_found" });
  return b;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Looking ahead and catching problems: the expected busy hours for the next
 * week, unusual refunds/voids/cash differences, a health board for stations,
 * and what a price change would have earned last week.
 */
@Controller()
export class InsightsController {
  /**
   * Expected stations in use for each hour of the next 7 days: the average for
   * that weekday and hour over the last 8 weeks, plus bookings already made.
   */
  @RequirePermission("reports.operational")
  @Get("branches/:branchId/forecast")
  async forecast(@Param("branchId") branchId: string) {
    const b = await branchOf(branchId);
    const stations = await tx().device.count({ where: { branchId, isEnabled: true, kind: { in: [...STATIONS] } } });
    const history = await tx().$queryRaw<Array<{ dow: number; hr: number; avg: number }>>`
      WITH hours AS (
        SELECT h FROM generate_series(date_trunc('hour', now() - interval '56 days'), date_trunc('hour', now()) - interval '1 hour', interval '1 hour') AS h
      )
      SELECT EXTRACT(ISODOW FROM h AT TIME ZONE ${b.timezone})::int AS dow, EXTRACT(HOUR FROM h AT TIME ZONE ${b.timezone})::int AS hr,
             AVG((SELECT COUNT(*) FROM "GamingSession" s
                   WHERE s."branchId" = ${branchId}::uuid AND s."startedAt" IS NOT NULL AND s."status" <> 'CANCELLED'
                     AND s."startedAt" <= h + interval '30 minutes' AND COALESCE(s."endedAt", now()) > h + interval '30 minutes'))::float AS avg
        FROM hours GROUP BY 1, 2`;
    const avg = new Map(history.map((r) => [`${r.dow}:${r.hr}`, r.avg]));
    const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
    const end = new Date(start.getTime() + 7 * 86_400_000);
    const booked = await tx().bookingResource.findMany({ where: { isLive: true, deviceId: { not: null }, device: { branchId }, startsAt: { lt: end }, endsAt: { gt: start } }, select: { startsAt: true, endsAt: true } });
    const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: b.timezone, weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
    const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const hours: Array<{ at: Date; day: string; hour: number; expected: number; bookings: number; occupancyPct: number }> = [];
    for (let at = start.getTime(); at < end.getTime(); at += 3_600_000) {
      const d = new Date(at);
      const p = parts(d);
      const mid = at + 1_800_000;
      const bookings = booked.filter((r) => r.startsAt.getTime() <= mid && r.endsAt.getTime() > mid).length;
      const expected = Math.min(stations, (avg.get(`${DOW[p["weekday"]!]}:${Number(p["hour"])}`) ?? 0) + bookings);
      hours.push({ at: d, day: `${p["year"]}-${p["month"]}-${p["day"]}`, hour: Number(p["hour"]), expected: Math.round(expected * 10) / 10, bookings, occupancyPct: stations ? Math.round((expected / stations) * 100) : 0 });
    }
    const days = [...new Set(hours.map((h) => h.day))].map((day) => {
      const hs = hours.filter((h) => h.day === day);
      const peak = hs.reduce((a, h) => (h.expected > a.expected ? h : a), hs[0]!);
      return { day, peakHour: peak.hour, peakOccupancyPct: peak.occupancyPct, quietHours: hs.filter((h) => h.occupancyPct < 20).map((h) => h.hour) };
    });
    return { stations, timezone: b.timezone, basedOnWeeks: 8, hours, days };
  }

  /**
   * Things worth a look: a cashier refunding or voiding far more than the
   * others, a till that came up short or over, and stations that keep dropping off.
   */
  @RequirePermission("reports.financial")
  @Get("branches/:branchId/anomalies")
  async anomalies(@Param("branchId") branchId: string, @Query(new ZodPipe(Days)) q: z.infer<typeof Days>) {
    const b = await branchOf(branchId);
    const since = new Date(Date.now() - q.days * 86_400_000);
    const refunds = await tx().refund.groupBy({ by: ["requestedById"], where: { requestedById: { not: null }, createdAt: { gte: since }, payment: { branchId } }, _count: { _all: true }, _sum: { amount: true } });
    const voids = await tx().orderItem.groupBy({ by: ["voidedById"], where: { voidedById: { not: null }, status: "VOIDED", updatedAt: { gte: since }, order: { branchId } }, _count: { _all: true } });
    const shifts = await tx().shift.findMany({ where: { branchId, closedAt: { gte: since }, variance: { not: null } }, select: { id: true, closedAt: true, variance: true, employee: { select: { id: true, displayName: true } } } });
    const offline = await tx().alert.groupBy({ by: ["deviceId"], where: { type: "CLIENT_OFFLINE", openedAt: { gte: since }, device: { branchId } }, _count: { _all: true } });
    const people = new Map((await tx().employee.findMany({ where: { id: { in: [...refunds.map((r) => r.requestedById!), ...voids.map((v) => v.voidedById!)] } }, select: { id: true, displayName: true } })).map((e) => [e.id, e.displayName]));
    const devices = new Map((await tx().device.findMany({ where: { id: { in: offline.map((o) => o.deviceId!).filter(Boolean) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const unit = (await tx().currency.findUnique({ where: { code: b.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    // ponytail: a fixed tolerance of 5 in any currency; make it a branch setting if venues differ a lot.
    const tolerance = new Prisma.Decimal(5);
    const findings: Array<{ kind: string; severity: "warning" | "info"; title: string; detail: string; ref?: string }> = [];

    // "Far more than the others": 3× the median of everyone who did any, and at least 3 of them.
    const flag = (rows: Array<{ id: string; count: number; amount?: string }>, what: string) => {
      const med = median(rows.map((r) => r.count));
      for (const r of rows) if (r.count >= 3 && r.count >= 3 * Math.max(1, med) && rows.length > 1) findings.push({ kind: what, severity: "warning", title: `${people.get(r.id) ?? "Someone"}: ${r.count} ${what}`, detail: `The median for other staff is ${med}.${r.amount ? ` Total ${r.amount} ${b.currency}.` : ""}`, ref: r.id });
    };
    flag(refunds.map((r) => ({ id: r.requestedById!, count: r._count._all, amount: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(unit) })), "refunds");
    flag(voids.map((v) => ({ id: v.voidedById!, count: v._count._all })), "voided items");
    for (const s of shifts) {
      if (s.variance!.abs().lte(tolerance)) continue;
      findings.push({ kind: "cash", severity: "warning", title: `Till ${s.variance!.isNeg() ? "short" : "over"} by ${s.variance!.abs().toFixed(unit)} ${b.currency}`, detail: `${s.employee.displayName}'s shift closed ${s.closedAt!.toISOString()}.`, ref: s.id });
    }
    for (const o of offline) {
      if (o._count._all >= 5) findings.push({ kind: "offline", severity: o._count._all >= 15 ? "warning" : "info", title: `${devices.get(o.deviceId!) ?? "A station"} went offline ${o._count._all} times`, detail: "Check its network cable, power settings or the agent.", ref: o.deviceId! });
    }
    return { days: q.days, findings };
  }

  /** Every station's last 24 hours: temperatures, disk, network, how often it dropped off, and whether it needs attention. */
  @RequirePermission("station.view")
  @Get("branches/:branchId/station-health")
  async health(@Param("branchId") branchId: string) {
    await branchOf(branchId);
    const day = new Date(Date.now() - 86_400_000);
    const week = new Date(Date.now() - 7 * 86_400_000);
    const devices = await tx().device.findMany({ where: { branchId, isEnabled: true, kind: { in: ["GAMING_PC", "INTERNET_PC"] } }, select: { id: true, name: true, status: true, isOnline: true, zone: { select: { name: true } } }, orderBy: { name: "asc" } });
    const stats = await tx().$queryRaw<Array<{ deviceId: string; cpu: number | null; gpu: number | null; disk: number | null; ping: number | null; loss: number | null; last: Date | null; samples: number }>>`
      SELECT h."deviceId", MAX(h."cpuTempC") AS cpu, MAX(h."gpuTempC") AS gpu, MAX(h."diskPct") AS disk, AVG(h."pingMs") AS ping, AVG(h."packetLossPct") AS loss, MAX(h."at") AS last, COUNT(*)::int AS samples
        FROM "DeviceHeartbeat" h JOIN "Device" d ON d."id" = h."deviceId"
       WHERE d."branchId" = ${branchId}::uuid AND h."at" >= ${day}
       GROUP BY h."deviceId"`;
    const drops = await tx().alert.groupBy({ by: ["deviceId"], where: { type: "CLIENT_OFFLINE", openedAt: { gte: week }, device: { branchId } }, _count: { _all: true } });
    const open = await tx().alert.groupBy({ by: ["deviceId"], where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, device: { branchId } }, _count: { _all: true } });
    const by = new Map(stats.map((s) => [s.deviceId, s]));
    const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
    const rows = devices.map((d) => {
      const s = by.get(d.id);
      const dropped = drops.find((x) => x.deviceId === d.id)?._count._all ?? 0;
      const reasons: string[] = [];
      const hot = Math.max(s?.cpu ?? 0, s?.gpu ?? 0);
      if (hot >= HOT_C) reasons.push(`Ran at ${Math.round(hot)}°C`);
      if ((s?.disk ?? 0) >= DISK_PCT) reasons.push(`Disk ${Math.round(s!.disk!)}% full`);
      if (dropped >= 3) reasons.push(`Dropped off ${dropped}× this week`);
      if ((s?.loss ?? 0) >= 2) reasons.push(`${r1(s!.loss)}% packet loss`);
      if (d.isOnline && s?.last && Date.now() - s.last.getTime() > SILENT_MIN * 60_000) reasons.push("No readings for a while");
      return {
        id: d.id, name: d.name, zone: d.zone.name, status: d.status, online: d.isOnline,
        maxCpuTempC: r1(s?.cpu ?? null), maxGpuTempC: r1(s?.gpu ?? null), diskPct: r1(s?.disk ?? null), avgPingMs: r1(s?.ping ?? null), packetLossPct: r1(s?.loss ?? null),
        lastReadingAt: s?.last ?? null, droppedThisWeek: dropped, openAlerts: open.find((x) => x.deviceId === d.id)?._count._all ?? 0, needsAttention: reasons,
      };
    });
    return { stations: rows.sort((a, b) => b.needsAttention.length - a.needsAttention.length || a.name.localeCompare(b.name)), attention: rows.filter((r) => r.needsAttention.length).length };
  }

  /**
   * What the sessions billed on this rate in the last week would have earned at
   * another price. Package sessions are left as they were (they have their own price).
   */
  @RequirePermission("pricing.manage")
  @Post("pricing/plans/:planId/preview")
  @HttpCode(200)
  async preview(@Param("planId") planId: string, @Body(new ZodPipe(Preview)) body: z.infer<typeof Preview>) {
    const plan = await tx().pricingPlan.findUnique({ where: { id: planId }, select: { id: true, name: true, rate: true, billingMode: true, currency: true } });
    if (!plan) throw new NotFoundException({ error: "not_found" });
    const since = new Date(Date.now() - body.days * 86_400_000);
    const sessions = await tx().gamingSession.findMany({ where: { pricingPlanId: planId, pricingPackageId: null, endedAt: { gte: since }, status: { not: "CANCELLED" } }, select: { billedSeconds: true, amountDue: true } });
    const unit = (await tx().currency.findUnique({ where: { code: plan.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    const actual = sessions.reduce((a, s) => a.plus(s.amountDue), new Prisma.Decimal(0));
    // Rate-based billing scales with the rate; flat passes are re-priced per session.
    const next = new Prisma.Decimal(body.rate);
    const would = plan.rate.isZero() ? actual : plan.billingMode === "PER_HOUR" || plan.billingMode === "PER_MINUTE" ? actual.mul(next).div(plan.rate) : next.mul(sessions.length);
    const hours = sessions.reduce((a, s) => a + s.billedSeconds, 0) / 3600;
    return {
      plan: { id: plan.id, name: plan.name, rate: plan.rate.toFixed(unit), billingMode: plan.billingMode }, newRate: next.toFixed(unit), days: body.days, sessions: sessions.length, hours: Math.round(hours * 10) / 10,
      actual: actual.toFixed(unit), wouldHaveBeen: would.toFixed(unit), change: would.minus(actual).toFixed(unit), currency: plan.currency,
      note: "Assumes the same players would have played as long. A big price rise usually means fewer hours.",
    };
  }
}
