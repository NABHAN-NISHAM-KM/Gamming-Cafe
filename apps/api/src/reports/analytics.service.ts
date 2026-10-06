import { Prisma, type TenantTx } from "@arena/db";
import { money, takenOn, type ReportScope } from "./reports.service.js";

/**
 * The dashboard: what's happening right now, how today compares with the
 * same weekday last week, and — with Advanced analytics — this period against
 * the one before, daily trends and customer behaviour.
 *
 * Revenue here is the same figure as the Sales report: net of VAT, excluding
 * wallet top-ups and gift cards (the customer's money until spent).
 */

type Num = Prisma.Decimal | number | string | bigint | null | undefined;
const num = (v: Num) => Number(v ?? 0);
const change = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / Math.abs(before)) * 1000) / 10);

function inScope(s: ReportScope, column: Prisma.Sql) {
  if (s.branchIds === null) return Prisma.sql`TRUE`;
  if (!s.branchIds.length) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} = ANY(${s.branchIds}::uuid[])`;
}
const localDate = (ts: Prisma.Sql) => Prisma.sql`(${ts} AT TIME ZONE br."timezone")::date`;
/** A coarse UTC window (index-friendly) around local days [from, to]. */
const window = (ts: Prisma.Sql, from: string, to: string) => Prisma.sql`${ts} >= (${from}::date - 1) AND ${ts} < (${to}::date + 2) AND ${localDate(ts)} BETWEEN ${from}::date AND ${to}::date`;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Revenue and bills per local day. */
async function revenueByDay(t: TenantTx, s: ReportScope, from: string, to: string) {
  return t.$queryRaw<Array<{ day: Date; revenue: Prisma.Decimal | null; bills: bigint; takings: Prisma.Decimal | null }>>`
    WITH b AS (
      SELECT b."id", ${takenOn(Prisma.sql`b."id"`)} AS "taken", ${localDate(Prisma.sql`b."closedAt"`)} AS "day"
      FROM "Bill" b JOIN "Branch" br ON br."id" = b."branchId"
      WHERE b."status" = 'SETTLED' AND ${inScope(s, Prisma.sql`b."branchId"`)} AND ${window(Prisma.sql`b."closedAt"`, from, to)}
    ), net AS (
      SELECT b."id", SUM(i."lineTotal" - i."taxAmount") FILTER (WHERE i."productType" NOT IN ('WALLET_TOPUP', 'GIFT_CARD')) AS "revenue"
      FROM b JOIN "Order" o ON o."billId" = b."id" AND o."status" <> 'CANCELLED'
      JOIN "OrderItem" i ON i."orderId" = o."id" AND i."status" NOT IN ('VOIDED', 'REFUNDED')
      GROUP BY b."id"
    )
    SELECT b."day", SUM(net."revenue") AS "revenue", COUNT(*) AS "bills", SUM(b."taken") AS "takings"
    FROM b LEFT JOIN net ON net."id" = b."id" GROUP BY b."day"`;
}

/** Sessions started and hours played per local day. */
async function playByDay(t: TenantTx, s: ReportScope, from: string, to: string) {
  return t.$queryRaw<Array<{ day: Date; sessions: bigint; seconds: bigint }>>`
    SELECT ${localDate(Prisma.sql`gs."startedAt"`)} AS "day", COUNT(*) AS "sessions",
      SUM(CASE WHEN gs."endedAt" IS NOT NULL THEN GREATEST(gs."billedSeconds", 0) ELSE GREATEST(EXTRACT(EPOCH FROM (now() - gs."startedAt"))::int - gs."totalPausedSeconds", 0) END) AS "seconds"
    FROM "GamingSession" gs JOIN "Branch" br ON br."id" = gs."branchId"
    WHERE gs."startedAt" IS NOT NULL AND gs."status" <> 'CANCELLED' AND ${inScope(s, Prisma.sql`gs."branchId"`)} AND ${window(Prisma.sql`gs."startedAt"`, from, to)}
    GROUP BY 1`;
}

/** Customers who paid a bill or played in [from, to]. */
const activeCustomers = (s: ReportScope, from: string, to: string) => Prisma.sql`
  SELECT b."customerId" AS "id" FROM "Bill" b JOIN "Branch" br ON br."id" = b."branchId"
  WHERE b."customerId" IS NOT NULL AND b."status" = 'SETTLED' AND ${inScope(s, Prisma.sql`b."branchId"`)} AND ${window(Prisma.sql`b."closedAt"`, from, to)}
  UNION
  SELECT gs."customerId" FROM "GamingSession" gs JOIN "Branch" br ON br."id" = gs."branchId"
  WHERE gs."customerId" IS NOT NULL AND gs."startedAt" IS NOT NULL AND ${inScope(s, Prisma.sql`gs."branchId"`)} AND ${window(Prisma.sql`gs."startedAt"`, from, to)}`;

export async function overview(t: TenantTx, s: ReportScope, o: { today: string; days: number; advanced: boolean }) {
  const { currency, f } = await money(t);
  const days = o.days;
  const from = addDays(o.today, -(days - 1));
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);

  // ── right now ──
  const [live] = await t.$queryRaw<[{ playing: bigint; stations: bigint; online: bigint; openBills: bigint; due: Prisma.Decimal | null }]>`
    SELECT
      (SELECT COUNT(*) FROM "GamingSession" gs WHERE gs."status" IN ('ACTIVE', 'PAUSED', 'ENDING') AND ${inScope(s, Prisma.sql`gs."branchId"`)}) AS "playing",
      (SELECT COUNT(*) FROM "Device" d WHERE d."isEnabled" AND ${inScope(s, Prisma.sql`d."branchId"`)}) AS "stations",
      (SELECT COUNT(*) FROM "Device" d WHERE d."isEnabled" AND d."isOnline" AND ${inScope(s, Prisma.sql`d."branchId"`)}) AS "online",
      (SELECT COUNT(*) FROM "Bill" b WHERE b."status" IN ('OPEN', 'PARTIALLY_PAID') AND b."total" > 0 AND ${inScope(s, Prisma.sql`b."branchId"`)}) AS "openBills",
      (SELECT SUM(b."total" - b."paidTotal") FROM "Bill" b WHERE b."status" IN ('OPEN', 'PARTIALLY_PAID') AND b."total" > b."paidTotal" AND ${inScope(s, Prisma.sql`b."branchId"`)}) AS "due"`;

  // ── today vs the same weekday last week ──
  const weekAgo = addDays(o.today, -7);
  const todayRows = await revenueByDay(t, s, weekAgo, o.today);
  const on = (d: string) => todayRows.find((r) => r.day.toISOString().slice(0, 10) === d);
  const today = { revenue: num(on(o.today)?.revenue), bills: Number(on(o.today)?.bills ?? 0), takings: num(on(o.today)?.takings) };
  const lastWeek = { revenue: num(on(weekAgo)?.revenue), bills: Number(on(weekAgo)?.bills ?? 0) };

  const base = {
    currency, today: o.today,
    live: {
      playing: Number(live.playing), stations: Number(live.stations), online: Number(live.online),
      occupancyPct: Number(live.stations) ? Math.round((Number(live.playing) / Number(live.stations)) * 1000) / 10 : null,
      openBills: Number(live.openBills), due: f(live.due),
    },
    todayVsLastWeek: {
      revenue: f(today.revenue), revenueLastWeek: f(lastWeek.revenue), revenueChangePct: change(today.revenue, lastWeek.revenue),
      bills: today.bills, billsLastWeek: lastWeek.bills, takings: f(today.takings),
    },
  };
  if (!o.advanced) return { ...base, advanced: null };

  // ── this period vs the previous one ──
  const [rev, play] = await Promise.all([revenueByDay(t, s, prevFrom, o.today), playByDay(t, s, prevFrom, o.today)]);
  const inCur = (d: Date) => d.toISOString().slice(0, 10) >= from;
  const sum = <T,>(rows: T[], cur: boolean, pick: (r: T) => number, day: (r: T) => Date) => rows.filter((r) => inCur(day(r)) === cur).reduce((a, r) => a + pick(r), 0);
  const kpi = (cur: number, prev: number, fmt: (v: number) => string | number) => ({ value: fmt(cur), previous: fmt(prev), changePct: change(cur, prev) });
  const revenue = [sum(rev, true, (r) => num(r.revenue), (r) => r.day), sum(rev, false, (r) => num(r.revenue), (r) => r.day)] as const;
  const bills = [sum(rev, true, (r) => Number(r.bills), (r) => r.day), sum(rev, false, (r) => Number(r.bills), (r) => r.day)] as const;
  const sessions = [sum(play, true, (r) => Number(r.sessions), (r) => r.day), sum(play, false, (r) => Number(r.sessions), (r) => r.day)] as const;
  const hours = [sum(play, true, (r) => Number(r.seconds), (r) => r.day) / 3600, sum(play, false, (r) => Number(r.seconds), (r) => r.day) / 3600] as const;
  const round1 = (v: number) => Math.round(v * 10) / 10;

  // ── customers ──
  const [cust] = await t.$queryRaw<[{ active: bigint; activeBefore: bigint; returning: bigint }]>`
    WITH cur AS (${activeCustomers(s, from, o.today)}), prev AS (${activeCustomers(s, prevFrom, prevTo)}),
    seen_before AS (
      SELECT DISTINCT cur."id" FROM cur
      WHERE EXISTS (SELECT 1 FROM "Bill" b WHERE b."customerId" = cur."id" AND b."status" = 'SETTLED' AND b."closedAt" < (${from}::date - 1))
         OR EXISTS (SELECT 1 FROM "GamingSession" gs WHERE gs."customerId" = cur."id" AND gs."startedAt" < (${from}::date - 1))
    )
    SELECT (SELECT COUNT(*) FROM cur) AS "active", (SELECT COUNT(*) FROM prev) AS "activeBefore", (SELECT COUNT(*) FROM seen_before) AS "returning"`;
  // Customers aren't tied to one branch: sign-ups and the wallet float are organization-wide figures.
  const orgWide = s.branchIds === null;
  const [signups] = orgWide
    ? await t.$queryRaw<[{ cur: bigint; prev: bigint }]>`
        SELECT COUNT(*) FILTER (WHERE (c."createdAt" AT TIME ZONE o."defaultTimezone")::date >= ${from}::date) AS "cur",
               COUNT(*) FILTER (WHERE (c."createdAt" AT TIME ZONE o."defaultTimezone")::date BETWEEN ${prevFrom}::date AND ${prevTo}::date) AS "prev"
        FROM "Customer" c CROSS JOIN "Organization" o
        WHERE c."createdAt" >= (${prevFrom}::date - 1)`
    : [{ cur: 0n, prev: 0n }];
  const [float] = orgWide ? await t.$queryRaw<[{ v: Prisma.Decimal | null }]>`SELECT SUM("cashBalance" + "bonusBalance" + "promoBalance" + "refundBalance") AS v FROM "Wallet"` : [{ v: null }];
  const top = await t.$queryRaw<Array<{ id: string; name: string; spent: Prisma.Decimal; visits: bigint }>>`
    SELECT c."id", c."displayName" AS "name", SUM(p."amount" - p."refundedAmount") AS "spent", COUNT(DISTINCT p."billId") AS "visits"
    FROM "Payment" p JOIN "Branch" br ON br."id" = p."branchId" JOIN "Customer" c ON c."id" = p."customerId"
    WHERE p."status" = 'CAPTURED' AND p."method" <> 'WALLET' AND ${inScope(s, Prisma.sql`p."branchId"`)} AND ${window(Prisma.sql`p."createdAt"`, from, o.today)}
    GROUP BY c."id", c."displayName" ORDER BY 3 DESC LIMIT 5`;

  const series: Array<{ day: string; revenue: string; bills: number; sessions: number; hours: number }> = [];
  for (let d = from; d <= o.today; d = addDays(d, 1)) {
    const r = rev.find((x) => x.day.toISOString().slice(0, 10) === d);
    const p = play.find((x) => x.day.toISOString().slice(0, 10) === d);
    series.push({ day: d, revenue: f(r?.revenue), bills: Number(r?.bills ?? 0), sessions: Number(p?.sessions ?? 0), hours: round1(Number(p?.seconds ?? 0) / 3600) });
  }

  return {
    ...base,
    advanced: {
      days, from, previousFrom: prevFrom, previousTo: prevTo,
      kpis: {
        revenue: kpi(revenue[0], revenue[1], f),
        bills: kpi(bills[0], bills[1], (v) => v),
        averageBill: kpi(bills[0] ? revenue[0] / bills[0] : 0, bills[1] ? revenue[1] / bills[1] : 0, f),
        sessions: kpi(sessions[0], sessions[1], (v) => v),
        hoursPlayed: kpi(hours[0], hours[1], round1),
        activeCustomers: kpi(Number(cust.active), Number(cust.activeBefore), (v) => v),
        newCustomers: orgWide ? kpi(Number(signups.cur), Number(signups.prev), (v) => v) : null,
      },
      customers: {
        returningPct: Number(cust.active) ? Math.round((Number(cust.returning) / Number(cust.active)) * 1000) / 10 : null,
        walletFloat: orgWide ? f(float.v) : null,
        topSpenders: top.map((c) => ({ id: c.id, name: c.name, spent: f(c.spent), visits: Number(c.visits) })),
      },
      series,
    },
  };
}
