import { Prisma, type TenantTx } from "@arena/db";

/**
 * Operational and financial reports, straight from the operational data (they
 * don't need the accounting add-on). Every date is the branch's local day, so
 * "Tuesday" means Tuesday in Dubai for a Dubai branch.
 *
 * `branchIds` = null means the whole organization, otherwise only these
 * branches (the caller's reach for the report's permission).
 */
export interface ReportScope {
  branchIds: string[] | null;
}
export interface Period {
  from: string;
  to: string;
}

type Num = Prisma.Decimal | number | string | bigint | null | undefined;
const num = (v: Num) => Number(v ?? 0);

/** `alias."branchId"` limited to the scope. */
function inScope(s: ReportScope, column: Prisma.Sql) {
  if (s.branchIds === null) return Prisma.sql`TRUE`;
  if (!s.branchIds.length) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} = ANY(${s.branchIds}::uuid[])`;
}

/**
 * A timestamp column within the period, in its branch's local time. The coarse
 * UTC window first lets Postgres use the (organizationId, branchId, time) index.
 */
function inPeriod(p: Period, ts: Prisma.Sql, tz: Prisma.Sql) {
  return Prisma.sql`${ts} >= (${p.from}::date - 1) AND ${ts} < (${p.to}::date + 2) AND (${ts} AT TIME ZONE ${tz})::date BETWEEN ${p.from}::date AND ${p.to}::date`;
}

export async function money(t: TenantTx) {
  const org = await t.organization.findFirstOrThrow({ select: { defaultCurrency: true } });
  const unit = (await t.currency.findUnique({ where: { code: org.defaultCurrency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
  return { currency: org.defaultCurrency, unit, f: (v: Num) => num(v).toFixed(unit) };
}

const TYPE_GROUP: Record<string, string> = {
  GAMING_TIME: "Gaming time", RECIPE_ITEM: "Food & drinks", COMBO: "Food & drinks", STOCK_ITEM: "Food & drinks", SERVICE: "Services",
  MEMBERSHIP: "Memberships", PRINTING: "Printing", BOOKING_FEE: "Bookings & events", TOURNAMENT_ENTRY: "Bookings & events",
  WALLET_TOPUP: "Wallet top-ups", GIFT_CARD: "Gift cards",
};
/** Top-ups and gift cards are the customer's money held for them — takings, not revenue. */
const NOT_REVENUE = new Set(["WALLET_TOPUP", "GIFT_CARD"]);

// ── sales ───────────────────────────────────────────────────────────────────

/**
 * Money taken in on a bill: cash and card. Wallet payments are left out, because the
 * top-up that funded them was already taken in (same rule as customer spend).
 */
export const takenOn = (billId: Prisma.Sql) =>
  Prisma.sql`(SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p WHERE p."billId" = ${billId} AND p."status" = 'CAPTURED' AND p."method" <> 'WALLET')`;

/** Settled bills in the period (the CTE every sales query starts from). */
const settledBills = (s: ReportScope, p: Period) => Prisma.sql`
  SELECT b."id", b."branchId", br."code" AS "branch", b."total", b."taxTotal", b."discountTotal", ${takenOn(Prisma.sql`b."id"`)} AS "taken",
         (b."closedAt" AT TIME ZONE br."timezone")::date AS "day", EXTRACT(HOUR FROM b."closedAt" AT TIME ZONE br."timezone")::int AS "hour",
         EXTRACT(ISODOW FROM b."closedAt" AT TIME ZONE br."timezone")::int AS "dow"
  FROM "Bill" b JOIN "Branch" br ON br."id" = b."branchId"
  WHERE b."status" = 'SETTLED' AND ${inScope(s, Prisma.sql`b."branchId"`)} AND ${inPeriod(p, Prisma.sql`b."closedAt"`, Prisma.sql`br."timezone"`)}`;

/** Sold lines on those bills (voided / refunded lines drop out), with their stock cost. */
const soldLines = (s: ReportScope, p: Period) => Prisma.sql`
  WITH b AS (${settledBills(s, p)}),
  cost AS (
    SELECT m."referenceId" AS "itemId", SUM(-m."quantity" * m."unitCost") AS "cost"
    FROM "StockMovement" m WHERE m."referenceType" = 'ORDER_ITEM' GROUP BY m."referenceId"
  )
  SELECT i."id", i."productId", i."nameSnapshot", i."productType"::text AS "productType", i."quantity", i."lineTotal", i."taxAmount", i."discountAmount",
         COALESCE(c."cost", 0) AS "cost", pc."name" AS "category", b."branch", b."day"
  FROM b
  JOIN "Order" o ON o."billId" = b."id" AND o."status" <> 'CANCELLED'
  JOIN "OrderItem" i ON i."orderId" = o."id" AND i."status" NOT IN ('VOIDED', 'REFUNDED')
  JOIN "Product" pr ON pr."id" = i."productId"
  JOIN "ProductCategory" pc ON pc."id" = pr."categoryId"
  LEFT JOIN cost c ON c."itemId" = i."id"`;

interface Line {
  id: string;
  productId: string;
  nameSnapshot: string;
  productType: string;
  quantity: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  cost: Prisma.Decimal;
  category: string;
  branch: string;
  day: Date;
}

export async function sales(t: TenantTx, s: ReportScope, p: Period) {
  const { currency, f } = await money(t);
  const bills = await t.$queryRaw<Array<{ branch: string; day: Date; hour: number; dow: number; total: Prisma.Decimal; taxTotal: Prisma.Decimal; discountTotal: Prisma.Decimal; taken: Prisma.Decimal }>>`${settledBills(s, p)}`;
  const lines = await t.$queryRaw<Line[]>`${soldLines(s, p)}`;
  const refunds = await t.$queryRaw<Array<{ destination: string; n: bigint; amount: Prisma.Decimal }>>`
    SELECT r."destination"::text AS "destination", COUNT(*) AS n, SUM(r."amount") AS "amount"
    FROM "Refund" r JOIN "Payment" pay ON pay."id" = r."paymentId" JOIN "Branch" br ON br."id" = pay."branchId"
    WHERE r."status" = 'SUCCEEDED' AND ${inScope(s, Prisma.sql`pay."branchId"`)} AND ${inPeriod(p, Prisma.sql`r."processedAt"`, Prisma.sql`br."timezone"`)}
    GROUP BY 1`;
  const methods = await t.$queryRaw<Array<{ method: string; n: bigint; amount: Prisma.Decimal }>>`
    SELECT pay."method"::text AS "method", COUNT(*) AS n, SUM(pay."amount") AS "amount"
    FROM "Payment" pay JOIN "Branch" br ON br."id" = pay."branchId"
    WHERE pay."status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND ${inScope(s, Prisma.sql`pay."branchId"`)}
      AND ${inPeriod(p, Prisma.sql`COALESCE(pay."capturedAt", pay."createdAt")`, Prisma.sql`br."timezone"`)}
    GROUP BY 1 ORDER BY 3 DESC`;

  const group = <K extends string>(key: (l: Line) => K) => {
    const m = new Map<K, { qty: number; gross: number; net: number; tax: number; cost: number; lines: number }>();
    for (const l of lines) {
      const k = key(l);
      const g = m.get(k) ?? { qty: 0, gross: 0, net: 0, tax: 0, cost: 0, lines: 0 };
      g.qty += num(l.quantity);
      g.gross += num(l.lineTotal);
      g.tax += num(l.taxAmount);
      g.net += num(l.lineTotal) - num(l.taxAmount);
      g.cost += num(l.cost);
      g.lines++;
      m.set(k, g);
    }
    return m;
  };
  const revenueLines = lines.filter((l) => !NOT_REVENUE.has(l.productType));
  const revenue = revenueLines.reduce((a, l) => a + num(l.lineTotal) - num(l.taxAmount), 0);
  const takings = bills.reduce((a, b) => a + num(b.taken), 0);
  const billed = bills.reduce((a, b) => a + num(b.total), 0);
  const refunded = refunds.reduce((a, r) => a + num(r.amount), 0);

  const byDay = new Map<string, { bills: number; total: number; tax: number }>();
  for (const b of bills) {
    const d = b.day.toISOString().slice(0, 10);
    const x = byDay.get(d) ?? { bills: 0, total: 0, tax: 0 };
    x.bills++;
    x.total += num(b.total);
    x.tax += num(b.taxTotal);
    byDay.set(d, x);
  }
  const byBranch = new Map<string, { bills: number; total: number }>();
  for (const b of bills) {
    const x = byBranch.get(b.branch) ?? { bills: 0, total: 0 };
    x.bills++;
    x.total += num(b.total);
    byBranch.set(b.branch, x);
  }
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const b of bills) heat[b.dow - 1]![b.hour]! += num(b.taken);

  const products = [...group((l) => l.productId as string)].map(([id, g]) => {
    const l = lines.find((x) => x.productId === id)!;
    return { productId: id, name: l.nameSnapshot, category: l.category, type: l.productType, quantity: g.qty, net: f(g.net), cost: f(g.cost), margin: g.cost > 0 ? f(g.net - g.cost) : null, marginPct: g.cost > 0 && g.net > 0 ? Math.round(((g.net - g.cost) / g.net) * 1000) / 10 : null };
  });

  return {
    from: p.from, to: p.to, currency,
    summary: {
      bills: bills.length,
      takings: f(takings), // cash and card taken in, incl. top-ups (wallet-paid bills were taken in at the top-up)
      discounts: f(bills.reduce((a, b) => a + num(b.discountTotal), 0)),
      tax: f(bills.reduce((a, b) => a + num(b.taxTotal), 0)),
      revenue: f(revenue), // net of VAT, excluding top-ups / gift cards
      costOfGoods: f(revenueLines.reduce((a, l) => a + num(l.cost), 0)),
      refunds: f(refunded),
      averageBill: f(bills.length ? billed / bills.length : 0),
    },
    byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, x]) => ({ day, bills: x.bills, total: f(x.total), tax: f(x.tax), net: f(x.total - x.tax) })),
    byBranch: [...byBranch].map(([branch, x]) => ({ branch, bills: x.bills, total: f(x.total) })).sort((a, b) => num(b.total) - num(a.total)),
    byType: [...group((l) => TYPE_GROUP[l.productType] ?? l.productType)].map(([name, g]) => ({ name, isRevenue: !lines.some((l) => (TYPE_GROUP[l.productType] ?? l.productType) === name && NOT_REVENUE.has(l.productType)), quantity: g.qty, net: f(g.net), tax: f(g.tax) })).sort((a, b) => num(b.net) - num(a.net)),
    byCategory: [...group((l) => l.category)].map(([name, g]) => ({ name, quantity: g.qty, net: f(g.net) })).sort((a, b) => num(b.net) - num(a.net)),
    byMethod: methods.map((m) => ({ method: m.method, payments: Number(m.n), amount: f(m.amount) })),
    refundsByDestination: refunds.map((r) => ({ destination: r.destination, refunds: Number(r.n), amount: f(r.amount) })),
    topProducts: products.sort((a, b) => num(b.net) - num(a.net)).slice(0, 25),
    /** takings by ISO weekday (Mon = row 0) × local hour */
    heatmap: heat.map((row) => row.map((v) => f(v))),
  };
}

// ── VAT ─────────────────────────────────────────────────────────────────────

export async function vat(t: TenantTx, s: ReportScope, p: Period) {
  const { currency, unit, f } = await money(t);
  const output = await t.$queryRaw<Array<{ rate: string | null; ratePercent: Prisma.Decimal | null; taxable: Prisma.Decimal; tax: Prisma.Decimal }>>`
    WITH l AS (${soldLines(s, p)}),
    x AS (
      SELECT l."id", l."lineTotal" - l."taxAmount" AS "taxable", e->>'name' AS "rate", (e->>'ratePercent')::numeric AS "ratePercent", (e->>'amountMinor')::numeric / (10 ^ ${unit}::int) AS "tax"
      FROM l JOIN "OrderItem" i ON i."id" = l."id" LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i."taxBreakdown") = 'array' THEN i."taxBreakdown" ELSE '[]'::jsonb END) e ON TRUE
      WHERE l."productType" NOT IN ('WALLET_TOPUP', 'GIFT_CARD')
    )
    SELECT "rate", "ratePercent", SUM("taxable") AS "taxable", SUM(COALESCE("tax", 0)) AS "tax" FROM x GROUP BY 1, 2 ORDER BY 2 DESC NULLS LAST`;
  // Money given back on a sale gives back its share of the VAT (same rule as the ledger).
  const [ref] = await t.$queryRaw<[{ vat: Prisma.Decimal | null }]>`
    SELECT SUM(CASE WHEN b."total" > 0 THEN ROUND(r."amount" * b."taxTotal" / b."total", ${unit}::int) ELSE 0 END) AS "vat"
    FROM "Refund" r JOIN "Payment" pay ON pay."id" = r."paymentId" JOIN "Bill" b ON b."id" = pay."billId" JOIN "Branch" br ON br."id" = pay."branchId"
    WHERE r."status" = 'SUCCEEDED' AND ${inScope(s, Prisma.sql`pay."branchId"`)} AND ${inPeriod(p, Prisma.sql`r."processedAt"`, Prisma.sql`br."timezone"`)}`;
  // Input VAT: supplier bills (branch = their purchase order's; org-wide ones only for org-wide readers) and expenses.
  const [inv] = await t.$queryRaw<[{ tax: Prisma.Decimal | null; n: bigint }]>`
    SELECT SUM(i."taxAmount") AS "tax", COUNT(*) AS n FROM "SupplierInvoice" i LEFT JOIN "PurchaseOrder" po ON po."id" = i."purchaseOrderId"
    WHERE i."status" <> 'VOID' AND i."invoiceDate" BETWEEN ${p.from}::date AND ${p.to}::date
      AND ${s.branchIds === null ? Prisma.sql`TRUE` : Prisma.sql`po."branchId" = ANY(${s.branchIds}::uuid[])`}`;
  const [exp] = await t.$queryRaw<[{ tax: Prisma.Decimal | null; n: bigint }]>`
    SELECT SUM(e."taxAmount") AS "tax", COUNT(*) AS n FROM "Expense" e
    WHERE e."incurredAt" BETWEEN ${p.from}::date AND ${p.to}::date AND ${inScope(s, Prisma.sql`e."branchId"`)}`;
  const outputTax = output.reduce((a, r) => a + num(r.tax), 0);
  const inputTax = num(inv.tax) + num(exp.tax);
  return {
    from: p.from, to: p.to, currency,
    output: output.map((r) => ({ rate: r.rate ?? "No VAT (exempt / zero-rated)", ratePercent: r.ratePercent === null ? 0 : num(r.ratePercent), taxable: f(r.taxable), tax: f(r.tax) })),
    outputTax: f(outputTax),
    refundAdjustment: f(num(ref.vat)),
    input: [{ source: "Supplier invoices", documents: Number(inv.n), tax: f(inv.tax) }, { source: "Expenses", documents: Number(exp.n), tax: f(exp.tax) }],
    inputTax: f(inputTax),
    netPayable: f(outputTax - num(ref.vat) - inputTax),
  };
}

// ── cash & shifts ───────────────────────────────────────────────────────────

export async function cash(t: TenantTx, s: ReportScope, p: Period) {
  const { currency, f } = await money(t);
  const shifts = await t.$queryRaw<Array<{ id: string; branch: string; drawer: string; cashier: string; status: string; openedAt: Date; closedAt: Date; openingCash: Prisma.Decimal; expectedCash: Prisma.Decimal | null; countedCash: Prisma.Decimal | null; variance: Prisma.Decimal | null; approvedBy: string | null }>>`
    SELECT s."id", br."code" AS "branch", d."name" AS "drawer", e."displayName" AS "cashier", s."status"::text AS "status", s."openedAt", s."closedAt",
           s."openingCash", s."expectedCash", s."countedCash", s."variance", a."displayName" AS "approvedBy"
    FROM "Shift" s JOIN "Branch" br ON br."id" = s."branchId" JOIN "CashDrawer" d ON d."id" = s."cashDrawerId" JOIN "Employee" e ON e."id" = s."employeeId"
    LEFT JOIN "Employee" a ON a."id" = s."approvedById"
    WHERE s."closedAt" IS NOT NULL AND ${inScope(s, Prisma.sql`s."branchId"`)} AND ${inPeriod(p, Prisma.sql`s."closedAt"`, Prisma.sql`br."timezone"`)}
    ORDER BY s."closedAt" DESC LIMIT 1000`;
  const flows = shifts.length
    ? await t.$queryRaw<Array<{ type: string; amount: Prisma.Decimal }>>`
        SELECT m."type"::text AS "type", SUM(m."amount") AS "amount" FROM "CashMovement" m WHERE m."shiftId" = ANY(${shifts.map((x) => x.id)}::uuid[]) GROUP BY 1`
    : [];
  const flow = (type: string) => num(flows.find((x) => x.type === type)?.amount);
  return {
    from: p.from, to: p.to, currency,
    totals: {
      shifts: shifts.length,
      openingFloats: f(flow("OPENING_FLOAT")), cashSales: f(flow("CASH_SALE")), cashRefunds: f(-flow("CASH_REFUND")), payIns: f(flow("PAY_IN")),
      payOuts: f(-flow("PAY_OUT")), safeDrops: f(-flow("SAFE_DROP")), expenses: f(-flow("EXPENSE")),
      expected: f(shifts.reduce((a, x) => a + num(x.expectedCash), 0)), counted: f(shifts.reduce((a, x) => a + num(x.countedCash), 0)),
      variance: f(shifts.reduce((a, x) => a + num(x.variance), 0)), needingApproval: shifts.filter((x) => x.status === "PENDING_APPROVAL").length,
    },
    shifts: shifts.map((x) => ({ ...x, openingCash: f(x.openingCash), expectedCash: f(x.expectedCash), countedCash: f(x.countedCash), variance: f(x.variance) })),
  };
}

// ── gaming utilization ──────────────────────────────────────────────────────

export async function utilization(t: TenantTx, s: ReportScope, p: Period) {
  const { currency, f } = await money(t);
  const days = Math.max(1, Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1);
  // Played time: billed seconds when the session is over, elapsed minus pauses while it's still running.
  const played = Prisma.sql`CASE WHEN gs."endedAt" IS NOT NULL THEN GREATEST(gs."billedSeconds", 0)
    ELSE GREATEST(EXTRACT(EPOCH FROM (now() - gs."startedAt"))::int - gs."totalPausedSeconds", 0) END`;
  const sessionsSql = Prisma.sql`
    SELECT gs."id", gs."zoneId", gs."deviceId", gs."branchId", gs."players", ${played} AS "seconds",
           EXTRACT(HOUR FROM gs."startedAt" AT TIME ZONE br."timezone")::int AS "hour", EXTRACT(ISODOW FROM gs."startedAt" AT TIME ZONE br."timezone")::int AS "dow"
    FROM "GamingSession" gs JOIN "Branch" br ON br."id" = gs."branchId"
    WHERE gs."startedAt" IS NOT NULL AND gs."status" <> 'CANCELLED' AND ${inScope(s, Prisma.sql`gs."branchId"`)} AND ${inPeriod(p, Prisma.sql`gs."startedAt"`, Prisma.sql`br."timezone"`)}`;
  const zones = await t.$queryRaw<Array<{ zoneId: string; zone: string; zoneType: string; branch: string; stations: bigint; sessions: bigint; players: bigint; seconds: bigint; revenue: Prisma.Decimal | null }>>`
    WITH gs AS (${sessionsSql}),
    rev AS (
      SELECT i."gamingSessionId" AS "sid", SUM(i."lineTotal" - i."taxAmount") AS "net"
      FROM "OrderItem" i JOIN gs ON gs."id" = i."gamingSessionId"
      WHERE i."productType" = 'GAMING_TIME' AND i."status" NOT IN ('VOIDED', 'REFUNDED') GROUP BY 1
    )
    SELECT z."id" AS "zoneId", z."name" AS "zone", z."type"::text AS "zoneType", br."code" AS "branch",
           (SELECT COUNT(*) FROM "Device" d WHERE d."zoneId" = z."id" AND d."isEnabled") AS "stations",
           COUNT(gs."id") AS "sessions", COALESCE(SUM(gs."players"), 0) AS "players", COALESCE(SUM(gs."seconds"), 0) AS "seconds", SUM(rev."net") AS "revenue"
    FROM "Zone" z JOIN "Branch" br ON br."id" = z."branchId"
    LEFT JOIN gs ON gs."zoneId" = z."id"
    LEFT JOIN rev ON rev."sid" = gs."id"
    WHERE z."isActive" AND ${inScope(s, Prisma.sql`z."branchId"`)}
    GROUP BY z."id", z."name", z."type", br."code"
    ORDER BY br."code", z."name"`;
  const stations = await t.$queryRaw<Array<{ deviceId: string; name: string; zone: string; branch: string; sessions: bigint; seconds: bigint }>>`
    WITH gs AS (${sessionsSql})
    SELECT d."id" AS "deviceId", d."name", z."name" AS "zone", br."code" AS "branch", COUNT(gs."id") AS "sessions", COALESCE(SUM(gs."seconds"), 0) AS "seconds"
    FROM "Device" d JOIN "Zone" z ON z."id" = d."zoneId" JOIN "Branch" br ON br."id" = d."branchId"
    LEFT JOIN gs ON gs."deviceId" = d."id"
    WHERE d."isEnabled" AND ${inScope(s, Prisma.sql`d."branchId"`)}
    GROUP BY d."id", d."name", z."name", br."code"`;
  const hours = await t.$queryRaw<Array<{ dow: number; hour: number; sessions: bigint }>>`WITH gs AS (${sessionsSql}) SELECT "dow", "hour", COUNT(*) AS "sessions" FROM gs GROUP BY 1, 2`;
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const h of hours) heat[h.dow - 1]![h.hour] = Number(h.sessions);
  const occ = (seconds: number, stationCount: number) => (stationCount ? Math.round((seconds / (stationCount * days * 86_400)) * 1000) / 10 : null);
  const station = (x: (typeof stations)[number]) => ({ deviceId: x.deviceId, name: x.name, zone: x.zone, branch: x.branch, sessions: Number(x.sessions), hours: Math.round(Number(x.seconds) / 360) / 10, occupancyPct: occ(Number(x.seconds), 1) });
  const byHours = [...stations].sort((a, b) => Number(b.seconds) - Number(a.seconds));
  const totalSeconds = zones.reduce((a, z) => a + Number(z.seconds), 0);
  const totalStations = zones.reduce((a, z) => a + Number(z.stations), 0);
  return {
    from: p.from, to: p.to, currency, days,
    summary: {
      sessions: zones.reduce((a, z) => a + Number(z.sessions), 0),
      hoursPlayed: Math.round(totalSeconds / 360) / 10,
      stations: totalStations,
      occupancyPct: occ(totalSeconds, totalStations), // share of all station-hours (24 h a day) that were played
      revenue: f(zones.reduce((a, z) => a + num(z.revenue), 0)),
    },
    zones: zones.map((z) => ({
      zoneId: z.zoneId, zone: z.zone, type: z.zoneType, branch: z.branch, stations: Number(z.stations), sessions: Number(z.sessions), players: Number(z.players),
      hours: Math.round(Number(z.seconds) / 360) / 10, occupancyPct: occ(Number(z.seconds), Number(z.stations)), revenue: f(z.revenue),
      revenuePerStationDay: Number(z.stations) ? f(num(z.revenue) / Number(z.stations) / days) : null,
    })),
    busiest: byHours.slice(0, 10).map(station),
    idlest: byHours.slice(-10).reverse().map(station),
    /** sessions started by ISO weekday (Mon = row 0) × local hour */
    heatmap: heat,
  };
}

// ── staff ───────────────────────────────────────────────────────────────────

export async function staff(t: TenantTx, s: ReportScope, p: Period) {
  const { currency, f } = await money(t);
  const rows = await t.$queryRaw<Array<{ id: string; name: string; code: string; branch: string | null; orders: bigint; orderValue: Prisma.Decimal | null; payments: bigint; paid: Prisma.Decimal | null; refunds: bigint; refunded: Prisma.Decimal | null; voids: bigint; voided: Prisma.Decimal | null; sessions: bigint; shifts: bigint; variance: Prisma.Decimal | null }>>`
    WITH o AS (
      SELECT o."employeeId" AS eid, COUNT(*) AS n, SUM(o."total") AS v FROM "Order" o JOIN "Branch" br ON br."id" = o."branchId"
      WHERE o."status" <> 'CANCELLED' AND o."placedAt" IS NOT NULL AND ${inScope(s, Prisma.sql`o."branchId"`)} AND ${inPeriod(p, Prisma.sql`o."placedAt"`, Prisma.sql`br."timezone"`)} GROUP BY 1
    ), pay AS (
      SELECT pay."employeeId" AS eid, COUNT(*) AS n, SUM(pay."amount") AS v FROM "Payment" pay JOIN "Branch" br ON br."id" = pay."branchId"
      WHERE pay."status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND ${inScope(s, Prisma.sql`pay."branchId"`)}
        AND ${inPeriod(p, Prisma.sql`COALESCE(pay."capturedAt", pay."createdAt")`, Prisma.sql`br."timezone"`)} GROUP BY 1
    ), ref AS (
      SELECT r."requestedById" AS eid, COUNT(*) AS n, SUM(r."amount") AS v FROM "Refund" r JOIN "Payment" pay ON pay."id" = r."paymentId" JOIN "Branch" br ON br."id" = pay."branchId"
      WHERE r."status" = 'SUCCEEDED' AND r."requestedById" IS NOT NULL AND ${inScope(s, Prisma.sql`pay."branchId"`)} AND ${inPeriod(p, Prisma.sql`r."processedAt"`, Prisma.sql`br."timezone"`)} GROUP BY 1
    ), vd AS (
      SELECT i."voidedById" AS eid, COUNT(*) AS n, SUM(i."lineTotal") AS v FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId" JOIN "Branch" br ON br."id" = o."branchId"
      WHERE i."status" = 'VOIDED' AND i."voidedById" IS NOT NULL AND ${inScope(s, Prisma.sql`o."branchId"`)} AND ${inPeriod(p, Prisma.sql`i."updatedAt"`, Prisma.sql`br."timezone"`)} GROUP BY 1
    ), ses AS (
      SELECT gs."startedById" AS eid, COUNT(*) AS n FROM "GamingSession" gs JOIN "Branch" br ON br."id" = gs."branchId"
      WHERE gs."startedAt" IS NOT NULL AND ${inScope(s, Prisma.sql`gs."branchId"`)} AND ${inPeriod(p, Prisma.sql`gs."startedAt"`, Prisma.sql`br."timezone"`)} GROUP BY 1
    ), sh AS (
      SELECT sh."employeeId" AS eid, COUNT(*) AS n, SUM(sh."variance") AS v FROM "Shift" sh JOIN "Branch" br ON br."id" = sh."branchId"
      WHERE sh."closedAt" IS NOT NULL AND ${inScope(s, Prisma.sql`sh."branchId"`)} AND ${inPeriod(p, Prisma.sql`sh."closedAt"`, Prisma.sql`br."timezone"`)} GROUP BY 1
    )
    SELECT e."id", e."displayName" AS "name", e."employeeCode" AS "code", hb."code" AS "branch",
      COALESCE(o.n, 0) AS "orders", o.v AS "orderValue", COALESCE(pay.n, 0) AS "payments", pay.v AS "paid", COALESCE(ref.n, 0) AS "refunds", ref.v AS "refunded",
      COALESCE(vd.n, 0) AS "voids", vd.v AS "voided", COALESCE(ses.n, 0) AS "sessions", COALESCE(sh.n, 0) AS "shifts", sh.v AS "variance"
    FROM "Employee" e LEFT JOIN "Branch" hb ON hb."id" = e."homeBranchId"
    LEFT JOIN o ON o.eid = e."id" LEFT JOIN pay ON pay.eid = e."id" LEFT JOIN ref ON ref.eid = e."id" LEFT JOIN vd ON vd.eid = e."id" LEFT JOIN ses ON ses.eid = e."id" LEFT JOIN sh ON sh.eid = e."id"
    WHERE COALESCE(o.n, 0) + COALESCE(pay.n, 0) + COALESCE(ref.n, 0) + COALESCE(vd.n, 0) + COALESCE(ses.n, 0) + COALESCE(sh.n, 0) > 0
    ORDER BY COALESCE(pay.v, 0) DESC, e."displayName"`;
  return {
    from: p.from, to: p.to, currency,
    staff: rows.map((r) => ({
      id: r.id, name: r.name, code: r.code, branch: r.branch, orders: Number(r.orders), orderValue: f(r.orderValue), payments: Number(r.payments), paid: f(r.paid),
      refunds: Number(r.refunds), refunded: f(r.refunded), voids: Number(r.voids), voided: f(r.voided), sessions: Number(r.sessions), shifts: Number(r.shifts), variance: f(r.variance),
    })),
  };
}
