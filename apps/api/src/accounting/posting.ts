import { createHash } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { ensureChart, type Chart } from "./chart.js";

/**
 * The automatic poster: turns business documents into double-entry journal
 * entries.
 *
 * Each document type has a *builder* that says what the document is worth in
 * the books right now (a balanced set of lines). The poster compares that
 * with what it already booked for the document (PostingCursor.posted) and
 * books only the difference, dated the day the change happened. So:
 *  - a bill settled today books its revenue today;
 *  - the same bill voided next week books the reversal next week;
 *  - a document that hasn't changed is skipped (fingerprint), and a posting is
 *    keyed by (document, version) so it can never be booked twice.
 *
 * Money is handled in integer minor units throughout.
 */

export type DocType = "BILL" | "PAYMENT" | "REFUND" | "WALLET_TX" | "STOCK_MOVEMENT" | "CASH_MOVEMENT" | "SHIFT" | "SUPPLIER_INVOICE" | "EXPENSE";
export const DOC_TYPES: readonly DocType[] = ["BILL", "PAYMENT", "REFUND", "WALLET_TX", "STOCK_MOVEMENT", "CASH_MOVEMENT", "SHIFT", "SUPPLIER_INVOICE", "EXPENSE"];

/** account ref ("sk:<systemKey>" or "id:<accountId>") → signed minor units, debit positive */
type Lines = Map<string, number>;

interface Doc {
  type: DocType;
  id: string;
  fingerprint: string;
  branchId: string | null;
  currency: string;
  /** when the document happened (its first booking is dated this local day) */
  at: Date;
  description: string;
  lines: Lines;
}

export interface PostCtx {
  organizationId: string;
  chart: Chart;
  unitOf: (currency: string) => number;
  timezoneOf: (branchId: string | null) => string;
  /** books are closed up to and including this day (YYYY-MM-DD) */
  lockDate: string | null;
  now: Date;
}

const sk = (key: string) => `sk:${key}`;
const minor = (v: Prisma.Decimal | number | string | null | undefined, unit: number) => Math.round(Number(v ?? 0) * 10 ** unit);
const add = (l: Lines, ref: string, m: number) => {
  if (m) l.set(ref, (l.get(ref) ?? 0) + m);
};
/** Debit `a`, credit `b` (a negative amount flips the sides). */
const move = (l: Lines, debit: string, credit: string, m: number) => {
  add(l, debit, m);
  add(l, credit, -m);
};

export const localDay = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A stable UUID for one posting of one document version (the exactly-once key). */
function postingId(type: string, id: string, fingerprint: string) {
  const h = createHash("sha256").update(`${type}|${id}|${fingerprint}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// ── account mapping ─────────────────────────────────────────────────────────

const MERCH_CATEGORIES = new Set(["GAMING_ACCESSORY", "CONTROLLER", "HEADSET", "MERCHANDISE", "PC_PART"]);

/** Where the net (tax-free) value of a sold line goes. */
function revenueAccount(productType: string, inventoryCategory: string | null) {
  switch (productType) {
    case "GAMING_TIME":
      return sk("GAMING_REVENUE");
    case "MEMBERSHIP":
      return sk("MEMBERSHIP_REVENUE");
    case "PRINTING":
      return sk("PRINTING_REVENUE");
    case "BOOKING_FEE":
    case "TOURNAMENT_ENTRY":
      return sk("EVENTS_REVENUE");
    case "WALLET_TOPUP":
      return sk("WALLET_LIABILITY"); // not revenue: the customer's money until spent
    case "GIFT_CARD":
      return sk("GIFT_CARD_LIABILITY");
    case "SERVICE":
      return sk("MERCH_REVENUE");
    case "STOCK_ITEM":
      return inventoryCategory && MERCH_CATEGORIES.has(inventoryCategory) ? sk("MERCH_REVENUE") : sk("FOOD_REVENUE");
    default: // RECIPE_ITEM, COMBO
      return sk("FOOD_REVENUE");
  }
}

/** Where money received by a payment method lands. */
export function methodAccount(method: string) {
  switch (method) {
    case "CASH":
      return sk("CASH_DRAWER");
    case "CARD":
      return sk("CARD_CLEARING");
    case "WALLET":
      return sk("WALLET_LIABILITY");
    case "ONLINE":
    case "QR":
      return sk("ONLINE_CLEARING");
    case "GIFT_CARD":
      return sk("GIFT_CARD_LIABILITY");
    case "LOYALTY_POINTS":
      return sk("PROMO_EXPENSE");
    default: // BANK_TRANSFER
      return sk("BANK");
  }
}

// ── candidates: documents whose booked version is out of date ───────────────

interface Candidate {
  id: string;
  fp: string;
}

const BATCH = 200;

async function candidates(t: TenantTx, type: DocType): Promise<Candidate[]> {
  const cursor = (alias: string) => Prisma.sql`LEFT JOIN "PostingCursor" c ON c."documentType" = ${type} AND c."documentId" = ${Prisma.raw(alias)}."id"`;
  switch (type) {
    case "BILL":
      return t.$queryRaw<Candidate[]>`
        SELECT b."id", b."version"::text AS fp FROM "Bill" b ${cursor("b")}
        WHERE b."status" IN ('SETTLED', 'VOID') AND (c."id" IS NULL OR c."fingerprint" <> b."version"::text)
        ORDER BY b."id" LIMIT ${BATCH}`;
    case "PAYMENT":
      return t.$queryRaw<Candidate[]>`
        SELECT p."id", p."status"::text AS fp FROM "Payment" p ${cursor("p")}
        WHERE (c."id" IS NULL OR c."fingerprint" <> p."status"::text)
        ORDER BY p."id" LIMIT ${BATCH}`;
    case "REFUND":
      return t.$queryRaw<Candidate[]>`
        SELECT r."id", r."status"::text AS fp FROM "Refund" r ${cursor("r")}
        WHERE (c."id" IS NULL OR c."fingerprint" <> r."status"::text)
        ORDER BY r."id" LIMIT ${BATCH}`;
    case "WALLET_TX":
      // Top-ups, spends and refunds are booked from their payment / bill / refund — except a
      // credit with nothing behind it (an opening balance brought over from an old system).
      return t.$queryRaw<Candidate[]>`
        SELECT w."id", '1' AS fp FROM "WalletTransaction" w ${cursor("w")}
        WHERE (w."type" IN ('BONUS_GRANT', 'BONUS_EXPIRE', 'ADJUSTMENT', 'REVERSAL') OR (w."type" = 'TOPUP' AND w."paymentId" IS NULL AND w."referenceType" IS NULL))
          AND w."bucket" <> 'TIME' AND c."id" IS NULL
        ORDER BY w."id" LIMIT ${BATCH}`;
    case "STOCK_MOVEMENT":
      // Transfers move stock inside the organization: no value changes hands.
      return t.$queryRaw<Candidate[]>`
        SELECT m."id", '1' AS fp FROM "StockMovement" m ${cursor("m")}
        WHERE m."type" NOT IN ('TRANSFER_OUT', 'TRANSFER_IN') AND c."id" IS NULL
        ORDER BY m."id" LIMIT ${BATCH}`;
    case "CASH_MOVEMENT":
      // Cash sales, cash refunds and drawer expenses are booked from their payment / refund / expense.
      return t.$queryRaw<Candidate[]>`
        SELECT m."id", '1' AS fp FROM "CashMovement" m ${cursor("m")}
        WHERE m."type" IN ('OPENING_FLOAT', 'PAY_IN', 'PAY_OUT', 'SAFE_DROP', 'CHANGE_CORRECTION') AND m."expenseId" IS NULL AND c."id" IS NULL
        ORDER BY m."id" LIMIT ${BATCH}`;
    case "SHIFT":
      return t.$queryRaw<Candidate[]>`
        SELECT s."id", (s."expectedCash"::text || '|' || s."countedCash"::text) AS fp FROM "Shift" s ${cursor("s")}
        WHERE s."status" IN ('CLOSED', 'PENDING_APPROVAL', 'APPROVED') AND s."countedCash" IS NOT NULL AND s."expectedCash" IS NOT NULL
          AND (c."id" IS NULL OR c."fingerprint" <> (s."expectedCash"::text || '|' || s."countedCash"::text))
        ORDER BY s."id" LIMIT ${BATCH}`;
    case "SUPPLIER_INVOICE": {
      const fp = Prisma.sql`(i."status"::text || '|' || i."amount"::text || '|' || i."taxAmount"::text || '|' || i."paidAmount"::text)`;
      return t.$queryRaw<Candidate[]>`
        SELECT i."id", ${fp} AS fp FROM "SupplierInvoice" i ${cursor("i")}
        WHERE (c."id" IS NULL OR c."fingerprint" <> ${fp})
        ORDER BY i."id" LIMIT ${BATCH}`;
    }
    case "EXPENSE": {
      const fp = Prisma.sql`(e."updatedAt"::text)`;
      return t.$queryRaw<Candidate[]>`
        SELECT e."id", ${fp} AS fp FROM "Expense" e ${cursor("e")}
        WHERE (c."id" IS NULL OR c."fingerprint" <> ${fp})
        ORDER BY e."id" LIMIT ${BATCH}`;
    }
  }
}

// ── builders: what each document is worth in the books now ─────────────────

async function buildBills(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const bills = await t.bill.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: {
      id: true, number: true, branchId: true, currency: true, status: true, closedAt: true, updatedAt: true,
      orders: {
        where: { status: { not: "CANCELLED" } },
        select: {
          orderItems: {
            where: { status: { notIn: ["VOIDED", "REFUNDED"] } },
            select: { productType: true, lineTotal: true, taxAmount: true, product: { select: { inventoryItem: { select: { category: true } } } } },
          },
        },
      },
    },
  });
  return bills.map((b) => {
    const unit = ctx.unitOf(b.currency);
    const lines: Lines = new Map();
    if (b.status !== "VOID") {
      for (const it of b.orders.flatMap((o) => o.orderItems)) {
        const gross = minor(it.lineTotal, unit);
        const tax = minor(it.taxAmount, unit);
        add(lines, sk("RECEIVABLE"), gross);
        add(lines, revenueAccount(it.productType, it.product.inventoryItem?.category ?? null), -(gross - tax));
        add(lines, sk("VAT_PAYABLE"), -tax);
      }
    }
    return { type: "BILL" as const, id: b.id, fingerprint: cs.find((c) => c.id === b.id)!.fp, branchId: b.branchId, currency: b.currency, at: b.closedAt ?? b.updatedAt, description: `Sales · bill ${b.number}`, lines };
  });
}

async function buildPayments(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const pays = await t.payment.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: { id: true, branchId: true, currency: true, method: true, status: true, amount: true, billId: true, bookingId: true, capturedAt: true, createdAt: true, bill: { select: { number: true } } },
  });
  return pays.map((p) => {
    const lines: Lines = new Map();
    // Refunded payments were captured first; the refunds are their own documents.
    if (["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)) {
      move(lines, methodAccount(p.method), paymentCreditAccount(p), minor(p.amount, ctx.unitOf(p.currency)));
    }
    return {
      type: "PAYMENT" as const, id: p.id, fingerprint: cs.find((c) => c.id === p.id)!.fp, branchId: p.branchId, currency: p.currency, at: p.capturedAt ?? p.createdAt,
      description: `${p.method.toLowerCase().replace("_", " ")} payment${p.bill ? ` · bill ${p.bill.number}` : p.bookingId ? " · booking prepay" : ""}`, lines,
    };
  });
}

/** A bill payment settles the customer's tab; a booking prepayment is credited to their wallet. */
const paymentCreditAccount = (p: { billId: string | null; bookingId: string | null }) => (p.billId ? sk("RECEIVABLE") : p.bookingId ? sk("WALLET_LIABILITY") : sk("RECEIVABLE"));

async function buildRefunds(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const refunds = await t.refund.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: {
      id: true, amount: true, currency: true, destination: true, status: true, processedAt: true, createdAt: true, reason: true,
      payment: { select: { method: true, branchId: true, billId: true, bookingId: true, bill: { select: { number: true, total: true, taxTotal: true } } } },
    },
  });
  return refunds.map((r) => {
    const unit = ctx.unitOf(r.currency);
    const lines: Lines = new Map();
    if (r.status === "SUCCEEDED") {
      const amount = minor(r.amount, unit);
      const out = r.destination === "CASH" ? sk("CASH_DRAWER") : r.destination === "WALLET" ? sk("WALLET_LIABILITY") : methodAccount(r.payment.method);
      if (r.payment.bill) {
        // Money back on a sale: the refunded share of its tax comes off VAT, the rest is a return.
        const total = minor(r.payment.bill.total, unit);
        const tax = total > 0 ? Math.round((amount * minor(r.payment.bill.taxTotal, unit)) / total) : 0;
        add(lines, sk("SALES_RETURNS"), amount - tax);
        add(lines, sk("VAT_PAYABLE"), tax);
      } else {
        add(lines, paymentCreditAccount(r.payment), amount);
      }
      add(lines, out, -amount);
    }
    return {
      type: "REFUND" as const, id: r.id, fingerprint: cs.find((c) => c.id === r.id)!.fp, branchId: r.payment.branchId, currency: r.currency, at: r.processedAt ?? r.createdAt,
      description: `Refund${r.payment.bill ? ` · bill ${r.payment.bill.number}` : ""} · ${r.reason}`.slice(0, 200), lines,
    };
  });
}

async function buildWalletTx(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const txs = await t.walletTransaction.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: { id: true, type: true, amount: true, currency: true, branchId: true, referenceType: true, reason: true, reversesId: true, createdAt: true },
  });
  const reversed = new Map(
    (await t.walletTransaction.findMany({ where: { id: { in: txs.map((x) => x.reversesId).filter((x): x is string => !!x) } }, select: { id: true, type: true, referenceType: true } })).map((x) => [x.id, x]),
  );
  const expenseFor = (type: string, referenceType: string | null) =>
    type === "ADJUSTMENT" ? (referenceType === "TOURNAMENT" ? sk("PRIZES_EXPENSE") : sk("GOODWILL_EXPENSE")) : sk("PROMO_EXPENSE");
  return txs.map((w) => {
    const lines: Lines = new Map();
    const signed = minor(w.amount, ctx.unitOf(w.currency));
    const orig = w.type === "REVERSAL" ? (w.reversesId ? reversed.get(w.reversesId) : undefined) : w;
    // A reversal mirrors what it reverses; reversing a top-up/spend is booked from its payment or refund.
    if (orig && ["BONUS_GRANT", "BONUS_EXPIRE", "ADJUSTMENT"].includes(orig.type)) {
      // Credit to the wallet (+) is a cost to the business; a debit (−) gives it back.
      move(lines, expenseFor(orig.type, orig.referenceType), sk("WALLET_LIABILITY"), signed);
    } else if (w.type === "TOPUP") {
      // Opening balance: the money was received before ArenaOS kept the books.
      move(lines, sk("OWNER_EQUITY"), sk("WALLET_LIABILITY"), signed);
    }
    return {
      type: "WALLET_TX" as const, id: w.id, fingerprint: "1", branchId: w.branchId, currency: w.currency, at: w.createdAt,
      description: `Wallet ${w.type.toLowerCase().replace("_", " ")}${w.reason ? ` · ${w.reason}` : ""}`.slice(0, 200), lines,
    };
  });
}

async function buildStock(t: TenantTx, ctx: PostCtx, cs: Candidate[], currency: string): Promise<Doc[]> {
  const mvs = await t.stockMovement.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: { id: true, type: true, quantity: true, unitCost: true, createdAt: true, reason: true, item: { select: { name: true } }, warehouse: { select: { branchId: true } } },
  });
  const unit = ctx.unitOf(currency);
  return mvs.map((m) => {
    const lines: Lines = new Map();
    const value = Math.round(Number(m.quantity.mul(m.unitCost)) * 10 ** unit); // signed: + into stock
    switch (m.type) {
      case "PURCHASE_RECEIPT":
        move(lines, sk("INVENTORY"), sk("GRNI"), value);
        break;
      case "SALE":
      case "RECIPE_CONSUMPTION":
      case "CUSTOMER_RETURN":
        move(lines, sk("INVENTORY"), sk("COGS"), value);
        break;
      case "RETURN_TO_SUPPLIER":
        move(lines, sk("INVENTORY"), sk("GRNI"), value);
        break;
      case "ISSUE_TO_STATION":
        move(lines, sk("INVENTORY"), sk("EQUIPMENT_EXPENSE"), value);
        break;
      default: // ADJUSTMENT, WASTE, STOCK_COUNT
        move(lines, sk("INVENTORY"), sk("STOCK_LOSS"), value);
    }
    return {
      type: "STOCK_MOVEMENT" as const, id: m.id, fingerprint: "1", branchId: m.warehouse.branchId, currency, at: m.createdAt,
      description: `Stock ${m.type.toLowerCase().replaceAll("_", " ")} · ${m.item.name}`.slice(0, 200), lines,
    };
  });
}

async function buildCash(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const mvs = await t.cashMovement.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: { id: true, type: true, amount: true, reason: true, createdAt: true, shift: { select: { branchId: true, currency: true } } },
  });
  return mvs.map((m) => {
    const lines: Lines = new Map();
    const signed = minor(m.amount, ctx.unitOf(m.shift.currency)); // + into the drawer
    if (m.type === "CHANGE_CORRECTION") move(lines, sk("CASH_DRAWER"), sk("CASH_OVER_SHORT"), signed);
    else move(lines, sk("CASH_DRAWER"), sk("CASH_SAFE"), signed); // float, pay-in/out, safe drops: drawer ↔ safe
    return {
      type: "CASH_MOVEMENT" as const, id: m.id, fingerprint: "1", branchId: m.shift.branchId, currency: m.shift.currency, at: m.createdAt,
      description: `Drawer ${m.type.toLowerCase().replaceAll("_", " ")}${m.reason ? ` · ${m.reason}` : ""}`.slice(0, 200), lines,
    };
  });
}

async function buildShifts(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const shifts = await t.shift.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: { id: true, branchId: true, currency: true, expectedCash: true, countedCash: true, closedAt: true, updatedAt: true, employee: { select: { displayName: true } }, cashDrawer: { select: { name: true } } },
  });
  return shifts.map((s) => {
    const unit = ctx.unitOf(s.currency);
    const expected = minor(s.expectedCash, unit);
    const counted = minor(s.countedCash, unit);
    const lines: Lines = new Map();
    // Closing: the counted cash goes to the safe; any difference is over/short.
    add(lines, sk("CASH_DRAWER"), -expected);
    add(lines, sk("CASH_SAFE"), counted);
    add(lines, sk("CASH_OVER_SHORT"), expected - counted);
    return {
      type: "SHIFT" as const, id: s.id, fingerprint: cs.find((c) => c.id === s.id)!.fp, branchId: s.branchId, currency: s.currency, at: s.closedAt ?? s.updatedAt,
      description: `Shift close · ${s.cashDrawer.name} · ${s.employee.displayName}`, lines,
    };
  });
}

async function buildSupplierInvoices(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const invs = await t.supplierInvoice.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: { id: true, invoiceNumber: true, invoiceDate: true, amount: true, taxAmount: true, paidAmount: true, status: true, currency: true, purchaseOrderId: true, supplier: { select: { name: true } }, purchaseOrder: { select: { branchId: true } } },
  });
  return invs.map((i) => {
    const unit = ctx.unitOf(i.currency);
    const lines: Lines = new Map();
    if (i.status !== "VOID") {
      const net = minor(i.amount, unit);
      const tax = minor(i.taxAmount, unit);
      // Stock bought on a purchase order was booked to GRNI when received; other bills are expenses.
      add(lines, i.purchaseOrderId ? sk("GRNI") : sk("OTHER_EXPENSE"), net);
      add(lines, sk("INPUT_VAT"), tax);
      add(lines, sk("AP"), -(net + tax));
      move(lines, sk("AP"), sk("BANK"), minor(i.paidAmount, unit));
    }
    return {
      type: "SUPPLIER_INVOICE" as const, id: i.id, fingerprint: cs.find((c) => c.id === i.id)!.fp, branchId: i.purchaseOrder?.branchId ?? null, currency: i.currency, at: i.invoiceDate,
      description: `Supplier invoice ${i.invoiceNumber} · ${i.supplier.name}`.slice(0, 200), lines,
    };
  });
}

async function buildExpenses(t: TenantTx, ctx: PostCtx, cs: Candidate[]): Promise<Doc[]> {
  const exps = await t.expense.findMany({
    where: { id: { in: cs.map((c) => c.id) } },
    select: { id: true, branchId: true, category: true, description: true, amount: true, taxAmount: true, currency: true, paidVia: true, shiftId: true, incurredAt: true },
  });
  return exps.map((e) => {
    const unit = ctx.unitOf(e.currency);
    const lines: Lines = new Map();
    const net = minor(e.amount, unit);
    const tax = minor(e.taxAmount, unit);
    const account = ctx.chart.byId.has(e.category) ? `id:${e.category}` : sk("OTHER_EXPENSE");
    add(lines, account, net);
    add(lines, sk("INPUT_VAT"), tax);
    add(lines, expensePaidFrom(e), -(net + tax));
    return {
      type: "EXPENSE" as const, id: e.id, fingerprint: cs.find((c) => c.id === e.id)!.fp, branchId: e.branchId, currency: e.currency, at: e.incurredAt,
      description: `Expense${e.description ? ` · ${e.description}` : ""}`.slice(0, 200), lines,
    };
  });
}

/** Cash from a drawer (with a shift) or from the safe; anything else from the bank. */
export const expensePaidFrom = (e: { paidVia: string; shiftId: string | null }) => (e.paidVia === "CASH" ? (e.shiftId ? sk("CASH_DRAWER") : sk("CASH_SAFE")) : sk("BANK"));

// ── posting ─────────────────────────────────────────────────────────────────

function resolve(ctx: PostCtx, ref: string) {
  const id = ref.startsWith("sk:") ? ctx.chart.byKey.get(ref.slice(3)) : ref.slice(3);
  if (!id || !ctx.chart.byId.has(id)) throw new Error(`unknown ledger account ${ref}`);
  return id;
}

/** Books the difference between a document's current value and what's already booked. */
async function postDoc(t: TenantTx, ctx: PostCtx, doc: Doc): Promise<boolean> {
  const where = { organizationId_documentType_documentId: { organizationId: ctx.organizationId, documentType: doc.type, documentId: doc.id } };
  const cursor = await t.postingCursor.findUnique({ where });
  if (cursor?.fingerprint === doc.fingerprint) return false;
  const booked = new Map(Object.entries((cursor?.posted ?? {}) as Record<string, string>).map(([k, v]) => [k, Number(v)]));
  const delta: Lines = new Map();
  for (const ref of new Set([...doc.lines.keys(), ...booked.keys()])) add(delta, ref, (doc.lines.get(ref) ?? 0) - (booked.get(ref) ?? 0));
  // Builders are balanced by construction; a stray minor unit is parked, never lost.
  const off = [...delta.values()].reduce((a, b) => a + b, 0);
  if (off) {
    add(delta, sk("ROUNDING"), -off);
    add(doc.lines, sk("ROUNDING"), -off);
  }

  if (delta.size) {
    const tz = ctx.timezoneOf(doc.branchId);
    let day = localDay(cursor ? ctx.now : doc.at, tz);
    if (ctx.lockDate && day <= ctx.lockDate) day = nextDay(ctx.lockDate); // closed period: book on the first open day
    const unit = ctx.unitOf(doc.currency);
    const entry = await t.journalEntry.create({
      data: {
        organizationId: ctx.organizationId, branchId: doc.branchId, entryDate: new Date(`${day}T00:00:00Z`), description: cursor ? `${doc.description} (change)` : doc.description,
        sourceType: doc.type, sourceId: postingId(doc.type, doc.id, doc.fingerprint), documentId: doc.id, currency: doc.currency,
      },
    });
    await t.journalLine.createMany({
      data: [...delta].map(([ref, m]) => ({
        organizationId: ctx.organizationId, entryId: entry.id, accountId: resolve(ctx, ref),
        debit: m > 0 ? new Prisma.Decimal(m).div(10 ** unit) : 0, credit: m < 0 ? new Prisma.Decimal(-m).div(10 ** unit) : 0,
      })),
    });
  }
  const posted = Object.fromEntries([...doc.lines].filter(([, m]) => m !== 0).map(([k, m]) => [k, String(m)]));
  await t.postingCursor.upsert({
    where,
    create: { organizationId: ctx.organizationId, documentType: doc.type, documentId: doc.id, fingerprint: doc.fingerprint, posted },
    update: { fingerprint: doc.fingerprint, posted },
  });
  return delta.size > 0;
}

export async function postingContext(t: TenantTx, organizationId: string, now = new Date()): Promise<PostCtx> {
  const chart = await ensureChart(t, organizationId);
  const org = await t.organization.findFirstOrThrow({ select: { defaultTimezone: true, settings: true } });
  const branches = new Map((await t.branch.findMany({ select: { id: true, timezone: true } })).map((b) => [b.id, b.timezone]));
  const units = new Map((await t.currency.findMany({ select: { code: true, minorUnit: true } })).map((c) => [c.code, c.minorUnit]));
  const lock = ((org.settings ?? {}) as { accounting?: { lockDate?: string } }).accounting?.lockDate ?? null;
  return {
    organizationId, chart, now, lockDate: lock,
    unitOf: (c) => units.get(c) ?? 2,
    timezoneOf: (b) => (b && branches.get(b)) || org.defaultTimezone,
  };
}

export interface PostResult {
  documents: number;
  entries: number;
  /** true when a batch was full — more work is waiting */
  more: boolean;
}

/**
 * Books everything that changed since the last run, for the current tenant.
 * Takes a per-organization advisory lock, so two API instances never post the
 * same organization at once: the background sweep skips a busy organization,
 * an on-demand sync waits (up to `waitMs`) for the other run to finish.
 *
 * Work is bounded (`maxBatches`, `budgetMs`) so a large backfill never runs
 * into the tenant transaction's time limit — `more` says there's more to do.
 */
export async function postPending(
  t: TenantTx,
  organizationId: string,
  opts: { maxBatches?: number; budgetMs?: number; waitMs?: number; now?: Date } = {},
): Promise<PostResult | null> {
  const started = Date.now();
  for (;;) {
    const [{ locked }] = await t.$queryRaw<[{ locked: boolean }]>`SELECT pg_try_advisory_xact_lock(hashtext('arena:accounting'), hashtext(${organizationId})) AS locked`;
    if (locked) break;
    if (Date.now() - started >= (opts.waitMs ?? 0)) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
  const deadline = Date.now() + (opts.budgetMs ?? 4_000);
  const ctx = await postingContext(t, organizationId, opts.now);
  const orgCurrency = (await t.organization.findFirstOrThrow({ select: { defaultCurrency: true } })).defaultCurrency;
  const out: PostResult = { documents: 0, entries: 0, more: false };
  let batches = 0;
  for (const type of DOC_TYPES) {
    for (;;) {
      if ((opts.maxBatches !== undefined && batches >= opts.maxBatches) || Date.now() > deadline) {
        out.more = true;
        return out;
      }
      const cs = await candidates(t, type);
      if (!cs.length) break;
      batches++;
      const docs =
        type === "BILL" ? await buildBills(t, ctx, cs)
        : type === "PAYMENT" ? await buildPayments(t, ctx, cs)
        : type === "REFUND" ? await buildRefunds(t, ctx, cs)
        : type === "WALLET_TX" ? await buildWalletTx(t, ctx, cs)
        : type === "STOCK_MOVEMENT" ? await buildStock(t, ctx, cs, orgCurrency)
        : type === "CASH_MOVEMENT" ? await buildCash(t, ctx, cs)
        : type === "SHIFT" ? await buildShifts(t, ctx, cs)
        : type === "SUPPLIER_INVOICE" ? await buildSupplierInvoices(t, ctx, cs)
        : await buildExpenses(t, ctx, cs);
      for (const d of docs) {
        out.documents++;
        if (await postDoc(t, ctx, d)) out.entries++;
      }
      if (cs.length < BATCH) break;
    }
  }
  return out;
}

/** The value a manual entry or the poster would give an amount string, in minor units. */
export const toMinorUnits = minor;
