import { ConflictException, HttpException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { debitNormal, ensureChart, isHeader, type AccountType } from "./chart.js";
import { expensePaidFrom, localDay } from "./posting.js";

/**
 * Reading the books (statements, ledgers, journal) and the few things people
 * write by hand: manual journal entries, expenses, accounts and the period
 * lock. Everything else in the ledger is posted automatically (posting.ts).
 *
 * `branchIds` limits what the caller sees: null = the whole organization
 * (including entries not tied to a branch), otherwise only those branches.
 */
export interface Scope {
  branchIds: string[] | null;
}

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function branchSql(s: Scope) {
  if (s.branchIds === null) return Prisma.sql`TRUE`;
  if (!s.branchIds.length) return Prisma.sql`FALSE`;
  return Prisma.sql`e."branchId" = ANY(${s.branchIds}::uuid[])`;
}

export async function orgMoney(t: TenantTx) {
  const org = await t.organization.findFirstOrThrow({ select: { id: true, defaultCurrency: true, defaultTimezone: true, settings: true } });
  const unit = (await t.currency.findUnique({ where: { code: org.defaultCurrency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
  const lockDate = ((org.settings ?? {}) as { accounting?: { lockDate?: string } }).accounting?.lockDate ?? null;
  return { organizationId: org.id, currency: org.defaultCurrency, unit, timezone: org.defaultTimezone, lockDate, settings: (org.settings ?? {}) as Record<string, unknown> };
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  systemKey: string | null;
  parentId: string | null;
  isActive: boolean;
  debit: Prisma.Decimal | null;
  credit: Prisma.Decimal | null;
}

/** Every account with Σdebit / Σcredit over the lines matching `where` (entries alias e). */
async function sums(t: TenantTx, s: Scope, where: Prisma.Sql) {
  return t.$queryRaw<AccountRow[]>`
    SELECT a."id", a."code", a."name", a."type"::text AS "type", a."systemKey", a."parentId", a."isActive", x."debit", x."credit"
    FROM "LedgerAccount" a
    LEFT JOIN (
      SELECT l."accountId", SUM(l."debit") AS "debit", SUM(l."credit") AS "credit"
      FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
      WHERE ${where} AND ${branchSql(s)}
      GROUP BY l."accountId"
    ) x ON x."accountId" = a."id"
    ORDER BY a."code"`;
}

// ── accounts ────────────────────────────────────────────────────────────────

export async function listAccounts(t: TenantTx, organizationId: string) {
  await ensureChart(t, organizationId);
  const rows = await t.ledgerAccount.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, type: true, systemKey: true, parentId: true, isActive: true } });
  return rows.map((r) => ({ ...r, isHeader: isHeader(r.code), isSystem: !!r.systemKey }));
}

export async function createAccount(t: TenantTx, organizationId: string, a: { code: string; name: string; type: AccountType; parentId?: string | null }) {
  await ensureChart(t, organizationId);
  if (await t.ledgerAccount.findFirst({ where: { code: a.code } })) throw new ConflictException({ error: "account_code_taken" });
  if (a.parentId) {
    const p = await t.ledgerAccount.findUnique({ where: { id: a.parentId } });
    if (!p) throw new NotFoundException({ error: "parent_not_found" });
    if (p.type !== a.type) throw new ConflictException({ error: "parent_type_mismatch", hint: "An account sits under a header of the same type." });
  }
  return t.ledgerAccount.create({ data: { organizationId, code: a.code, name: a.name, type: a.type, parentId: a.parentId ?? null } });
}

export async function updateAccount(t: TenantTx, id: string, a: { name?: string; isActive?: boolean; parentId?: string | null }) {
  const acc = await t.ledgerAccount.findUnique({ where: { id } });
  if (!acc) throw new NotFoundException({ error: "account_not_found" });
  if (acc.systemKey && a.isActive === false) throw new ConflictException({ error: "system_account", hint: "Automatic postings use this account; it can be renamed but not switched off." });
  if (a.parentId) {
    const p = await t.ledgerAccount.findUnique({ where: { id: a.parentId } });
    if (!p || p.id === id) throw new NotFoundException({ error: "parent_not_found" });
    if (p.type !== acc.type) throw new ConflictException({ error: "parent_type_mismatch" });
  }
  return t.ledgerAccount.update({ where: { id }, data: { ...(a.name !== undefined ? { name: a.name } : {}), ...(a.isActive !== undefined ? { isActive: a.isActive } : {}), ...(a.parentId !== undefined ? { parentId: a.parentId } : {}) } });
}

// ── statements ──────────────────────────────────────────────────────────────

const fmt = (unit: number) => (v: Prisma.Decimal) => v.toFixed(unit);

export async function trialBalance(t: TenantTx, s: Scope, asOf: string) {
  const { currency, unit } = await orgMoney(t);
  const rows = await sums(t, s, Prisma.sql`e."entryDate" <= ${asOf}::date`);
  const f = fmt(unit);
  const lines = rows
    .filter((r) => r.debit || r.credit)
    .map((r) => {
      const d = D(r.debit);
      const c = D(r.credit);
      const net = d.sub(c);
      return { id: r.id, code: r.code, name: r.name, type: r.type, debit: f(net.gt(0) ? net : D(0)), credit: f(net.lt(0) ? net.neg() : D(0)) };
    });
  const total = (k: "debit" | "credit") => lines.reduce((a, l) => a.add(l[k]), D(0));
  return { asOf, currency, accounts: lines, totalDebit: f(total("debit")), totalCredit: f(total("credit")), balanced: total("debit").eq(total("credit")) };
}

/** Which statement section an income-statement account falls in. */
function sectionOf(r: { type: string; parentId: string | null }, byId: Map<string, AccountRow>): "revenue" | "costOfSales" | "operatingExpenses" | null {
  if (r.type === "REVENUE") return "revenue";
  if (r.type !== "EXPENSE") return null;
  let p = r.parentId ? byId.get(r.parentId) : undefined;
  for (let i = 0; p && i < 5; i++) {
    if (p.systemKey === "H_COST_OF_SALES") return "costOfSales";
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return "operatingExpenses";
}

export async function profitAndLoss(t: TenantTx, s: Scope, from: string, to: string) {
  const { currency, unit } = await orgMoney(t);
  const rows = await sums(t, s, Prisma.sql`e."entryDate" BETWEEN ${from}::date AND ${to}::date`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const f = fmt(unit);
  type Row = { id: string; code: string; name: string; amount: Prisma.Decimal };
  const sections: Record<"revenue" | "costOfSales" | "operatingExpenses", Row[]> = { revenue: [], costOfSales: [], operatingExpenses: [] };
  for (const r of rows) {
    const sec = sectionOf(r, byId);
    if (!sec || isHeader(r.code) || (!r.debit && !r.credit)) continue;
    const amount = sec === "revenue" ? D(r.credit).sub(D(r.debit)) : D(r.debit).sub(D(r.credit));
    sections[sec].push({ id: r.id, code: r.code, name: r.name, amount });
  }
  const total = (xs: Row[]) => xs.reduce((a, r) => a.add(r.amount), D(0));
  const revenue = total(sections.revenue);
  const cos = total(sections.costOfSales);
  const opex = total(sections.operatingExpenses);
  const out = (xs: Row[]) => ({ accounts: xs.map((r) => ({ ...r, amount: f(r.amount) })), total: f(total(xs)) });
  return {
    from, to, currency,
    revenue: out(sections.revenue), costOfSales: out(sections.costOfSales), grossProfit: f(revenue.sub(cos)),
    operatingExpenses: out(sections.operatingExpenses), netProfit: f(revenue.sub(cos).sub(opex)),
  };
}

/** Revenue / cost of sales / expenses / net per month (or day) — for charts. */
export async function profitSeries(t: TenantTx, s: Scope, from: string, to: string, bucket: "day" | "month") {
  const { currency, unit } = await orgMoney(t);
  const all = await t.ledgerAccount.findMany({ select: { id: true, code: true, type: true, systemKey: true, parentId: true } });
  const byId = new Map(all.map((a) => [a.id, { ...a, isActive: true, name: "", debit: null, credit: null }] as [string, AccountRow]));
  const rows = await t.$queryRaw<Array<{ period: Date; accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>>`
    SELECT date_trunc(${bucket}, e."entryDate")::date AS period, l."accountId", SUM(l."debit") AS "debit", SUM(l."credit") AS "credit"
    FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE e."entryDate" BETWEEN ${from}::date AND ${to}::date AND ${branchSql(s)}
    GROUP BY 1, 2 ORDER BY 1`;
  const periods = new Map<string, { revenue: Prisma.Decimal; costOfSales: Prisma.Decimal; operatingExpenses: Prisma.Decimal }>();
  for (const r of rows) {
    const a = byId.get(r.accountId);
    if (!a) continue;
    const sec = sectionOf(a, byId);
    if (!sec) continue;
    const key = r.period.toISOString().slice(0, 10);
    const p = periods.get(key) ?? { revenue: D(0), costOfSales: D(0), operatingExpenses: D(0) };
    p[sec] = p[sec].add(sec === "revenue" ? D(r.credit).sub(r.debit) : D(r.debit).sub(r.credit));
    periods.set(key, p);
  }
  const f = fmt(unit);
  return {
    currency, bucket,
    points: [...periods].map(([period, p]) => ({
      period, revenue: f(p.revenue), costOfSales: f(p.costOfSales), operatingExpenses: f(p.operatingExpenses), netProfit: f(p.revenue.sub(p.costOfSales).sub(p.operatingExpenses)),
    })),
  };
}

export async function balanceSheet(t: TenantTx, s: Scope, asOf: string) {
  const { currency, unit } = await orgMoney(t);
  const rows = await sums(t, s, Prisma.sql`e."entryDate" <= ${asOf}::date`);
  const f = fmt(unit);
  const pick = (type: AccountType) =>
    rows
      .filter((r) => r.type === type && !isHeader(r.code) && (r.debit || r.credit))
      .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: debitNormal(type) ? D(r.debit).sub(D(r.credit)) : D(r.credit).sub(D(r.debit)) }));
  const total = (xs: Array<{ amount: Prisma.Decimal }>) => xs.reduce((a, r) => a.add(r.amount), D(0));
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  // Profit not yet closed into retained earnings belongs to the owners.
  const earnings = total(pick("REVENUE")).sub(total(pick("EXPENSE")));
  const equityTotal = total(equity).add(earnings);
  const out = (xs: Array<{ id: string; code: string; name: string; amount: Prisma.Decimal }>) => xs.map((r) => ({ ...r, amount: f(r.amount) }));
  return {
    asOf, currency,
    assets: { accounts: out(assets), total: f(total(assets)) },
    liabilities: { accounts: out(liabilities), total: f(total(liabilities)) },
    equity: { accounts: out(equity), currentEarnings: f(earnings), total: f(equityTotal) },
    balanced: total(assets).eq(total(liabilities).add(equityTotal)),
  };
}

export async function accountLedger(t: TenantTx, s: Scope, accountId: string, from: string, to: string) {
  const { currency, unit } = await orgMoney(t);
  const acc = await t.ledgerAccount.findUnique({ where: { id: accountId }, select: { id: true, code: true, name: true, type: true } });
  if (!acc) throw new NotFoundException({ error: "account_not_found" });
  const sign = debitNormal(acc.type as AccountType) ? 1 : -1;
  const [open] = await t.$queryRaw<[{ bal: Prisma.Decimal | null }]>`
    SELECT SUM(l."debit" - l."credit") AS bal FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE l."accountId" = ${accountId}::uuid AND e."entryDate" < ${from}::date AND ${branchSql(s)}`;
  const lines = await t.$queryRaw<Array<{ entryId: string; entryDate: Date; description: string; sourceType: string; documentId: string | null; branchId: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal; memo: string | null }>>`
    SELECT e."id" AS "entryId", e."entryDate", e."description", e."sourceType", e."documentId", e."branchId", l."debit", l."credit", l."memo"
    FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE l."accountId" = ${accountId}::uuid AND e."entryDate" BETWEEN ${from}::date AND ${to}::date AND ${branchSql(s)}
    ORDER BY e."entryDate", e."createdAt", l."id"
    LIMIT 2000`;
  const f = fmt(unit);
  let bal = D(open.bal).mul(sign);
  const opening = bal;
  return {
    account: acc, from, to, currency, opening: f(opening),
    lines: lines.map((l) => {
      bal = bal.add(D(l.debit).sub(l.credit).mul(sign));
      return { ...l, entryDate: l.entryDate.toISOString().slice(0, 10), debit: f(D(l.debit)), credit: f(D(l.credit)), balance: f(bal) };
    }),
    closing: f(bal),
    truncated: lines.length === 2000,
  };
}

// ── journal ─────────────────────────────────────────────────────────────────

export async function journal(t: TenantTx, s: Scope, q: { from: string; to: string; sourceType?: string; search?: string; page: number }) {
  const { currency, unit } = await orgMoney(t);
  const where: Prisma.JournalEntryWhereInput = {
    entryDate: { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) },
    ...(q.sourceType ? { sourceType: q.sourceType } : {}),
    ...(q.search ? { description: { contains: q.search, mode: "insensitive" } } : {}),
    ...(s.branchIds === null ? {} : { branchId: { in: s.branchIds } }),
  };
  const take = 50;
  const [total, entries] = await Promise.all([
    t.journalEntry.count({ where }),
    t.journalEntry.findMany({
      where, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * take, take,
      include: { journalLines: { include: { account: { select: { code: true, name: true } } } }, branch: { select: { code: true } } },
    }),
  ]);
  const f = fmt(unit);
  return {
    currency, page: q.page, pageSize: take, total,
    entries: entries.map((e) => ({
      id: e.id, entryDate: e.entryDate.toISOString().slice(0, 10), description: e.description, sourceType: e.sourceType, documentId: e.documentId, reversesId: e.reversesId,
      branch: e.branch?.code ?? null, createdAt: e.createdAt,
      amount: f(e.journalLines.reduce((a, l) => a.add(l.debit), D(0))),
      lines: e.journalLines.map((l) => ({ accountId: l.accountId, code: l.account.code, name: l.account.name, debit: f(l.debit), credit: f(l.credit), memo: l.memo })),
    })),
  };
}

export interface ManualLine {
  accountId: string;
  debit?: string | null;
  credit?: string | null;
  memo?: string | null;
}

/** A hand-made journal entry. Must balance, use live non-header accounts and fall in an open period. */
export async function postManual(t: TenantTx, e: { entryDate: string; description: string; branchId?: string | null; lines: ManualLine[] }, employeeId: string, reversesId: string | null = null) {
  const { organizationId, currency, unit, lockDate } = await orgMoney(t);
  await ensureChart(t, organizationId);
  if (!DATE.test(e.entryDate)) throw new HttpException({ error: "bad_date" }, 400);
  if (lockDate && e.entryDate <= lockDate) throw new ConflictException({ error: "period_locked", lockDate, hint: "The books are closed up to this date. Date the entry after it." });
  const accounts = await t.ledgerAccount.findMany({ where: { id: { in: e.lines.map((l) => l.accountId) } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let dr = 0;
  let cr = 0;
  const lines = e.lines.map((l) => {
    const a = byId.get(l.accountId);
    if (!a) throw new NotFoundException({ error: "account_not_found", accountId: l.accountId });
    if (!a.isActive) throw new ConflictException({ error: "account_inactive", code: a.code });
    if (isHeader(a.code)) throw new ConflictException({ error: "header_account", code: a.code, hint: "Post to an account under the header." });
    const d = Math.round(Number(l.debit ?? 0) * 10 ** unit);
    const c = Math.round(Number(l.credit ?? 0) * 10 ** unit);
    if (d < 0 || c < 0 || (d > 0) === (c > 0)) throw new HttpException({ error: "bad_line", hint: "Each line has either a debit or a credit." }, 400);
    dr += d;
    cr += c;
    return { accountId: a.id, d, c, memo: l.memo ?? null };
  });
  if (lines.length < 2) throw new HttpException({ error: "too_few_lines" }, 400);
  if (dr !== cr) throw new ConflictException({ error: "unbalanced", debit: (dr / 10 ** unit).toFixed(unit), credit: (cr / 10 ** unit).toFixed(unit) });
  const entry = await t.journalEntry.create({
    data: {
      organizationId, branchId: e.branchId ?? null, entryDate: new Date(`${e.entryDate}T00:00:00Z`), description: e.description, sourceType: "MANUAL", sourceId: randomUUID(),
      currency, postedById: employeeId, reversesId,
    },
  });
  await t.journalLine.createMany({
    data: lines.map((l) => ({ organizationId, entryId: entry.id, accountId: l.accountId, debit: new Prisma.Decimal(l.d).div(10 ** unit), credit: new Prisma.Decimal(l.c).div(10 ** unit), memo: l.memo })),
  });
  return entry;
}

/** Undoes a manual entry with a mirror-image entry. Automatic entries are corrected at their source document. */
export async function reverseManual(t: TenantTx, id: string, entryDate: string, employeeId: string) {
  const e = await t.journalEntry.findUnique({ where: { id }, include: { journalLines: true } });
  if (!e) throw new NotFoundException({ error: "entry_not_found" });
  if (e.sourceType !== "MANUAL") throw new ConflictException({ error: "automatic_entry", hint: "Correct the bill, payment or document it came from; the books follow automatically." });
  if (e.reversesId) throw new ConflictException({ error: "is_reversal" });
  if (await t.journalEntry.findFirst({ where: { reversesId: id } })) throw new ConflictException({ error: "already_reversed" });
  return postManual(
    t,
    { entryDate, description: `Reversal of: ${e.description}`.slice(0, 200), branchId: e.branchId, lines: e.journalLines.map((l) => ({ accountId: l.accountId, debit: l.credit.toString(), credit: l.debit.toString(), memo: l.memo })) },
    employeeId,
    id,
  );
}

export async function setLockDate(t: TenantTx, lockDate: string | null) {
  const { organizationId, settings, timezone } = await orgMoney(t);
  if (lockDate !== null) {
    if (!DATE.test(lockDate)) throw new HttpException({ error: "bad_date" }, 400);
    if (lockDate >= localDay(new Date(), timezone)) throw new ConflictException({ error: "lock_in_future", hint: "Only past days can be closed." });
  }
  const accounting = { ...((settings["accounting"] as object) ?? {}), lockDate };
  await t.organization.update({ where: { id: organizationId }, data: { settings: { ...settings, accounting } as Prisma.InputJsonValue } });
  return { lockDate };
}

// ── expenses ────────────────────────────────────────────────────────────────

export interface ExpenseInput {
  branchId: string;
  accountId: string;
  description?: string | null;
  amount: string;
  taxAmount?: string | null;
  paidVia: "CASH" | "CARD" | "BANK_TRANSFER";
  fromDrawer?: boolean;
  supplierId?: string | null;
  incurredAt: string;
}

async function expenseAccount(t: TenantTx, accountId: string) {
  const a = await t.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!a || a.type !== "EXPENSE" || isHeader(a.code) || !a.isActive) throw new ConflictException({ error: "not_an_expense_account" });
  return a;
}

export async function createExpense(t: TenantTx, x: ExpenseInput, employeeId: string) {
  const { organizationId, currency, unit, lockDate } = await orgMoney(t);
  await ensureChart(t, organizationId);
  await expenseAccount(t, x.accountId);
  if (!DATE.test(x.incurredAt)) throw new HttpException({ error: "bad_date" }, 400);
  if (lockDate && x.incurredAt <= lockDate) throw new ConflictException({ error: "period_locked", lockDate });
  const net = Math.round(Number(x.amount) * 10 ** unit);
  const tax = Math.round(Number(x.taxAmount ?? 0) * 10 ** unit);
  if (!(net > 0) || tax < 0) throw new ConflictException({ error: "bad_amount" });
  let shiftId: string | null = null;
  if (x.fromDrawer) {
    if (x.paidVia !== "CASH") throw new HttpException({ error: "drawer_is_cash" }, 400);
    const shift = await t.shift.findFirst({ where: { employeeId, branchId: x.branchId, status: "OPEN" }, select: { id: true } });
    if (!shift) throw new ConflictException({ error: "no_open_shift", hint: "Open your shift to pay from the drawer." });
    shiftId = shift.id;
  }
  const e = await t.expense.create({
    data: {
      organizationId, branchId: x.branchId, category: x.accountId, description: x.description ?? null, amount: new Prisma.Decimal(net).div(10 ** unit), taxAmount: new Prisma.Decimal(tax).div(10 ** unit),
      currency, paidVia: x.paidVia, shiftId, supplierId: x.supplierId ?? null, incurredAt: new Date(`${x.incurredAt}T00:00:00Z`), createdById: employeeId,
    },
  });
  // Paid from the drawer: the drawer's own ledger shows the cash leaving (so the shift's expected cash is right).
  if (shiftId) {
    await t.cashMovement.create({ data: { organizationId, shiftId, type: "EXPENSE", amount: new Prisma.Decimal(-(net + tax)).div(10 ** unit), expenseId: e.id, employeeId, reason: x.description ?? "Expense" } });
  }
  return e;
}

export async function updateExpense(t: TenantTx, id: string, x: Partial<Omit<ExpenseInput, "branchId" | "fromDrawer">>) {
  const { unit, lockDate } = await orgMoney(t);
  const e = await t.expense.findUnique({ where: { id } });
  if (!e) throw new NotFoundException({ error: "expense_not_found" });
  const moneyChange = x.amount !== undefined || x.taxAmount !== undefined || x.paidVia !== undefined;
  // The drawer's cash movement is immutable: a drawer-paid expense keeps its amount.
  if (e.shiftId && moneyChange) throw new ConflictException({ error: "paid_from_drawer", hint: "Record a correcting expense instead." });
  if (x.accountId) await expenseAccount(t, x.accountId);
  if (x.incurredAt && !DATE.test(x.incurredAt)) throw new HttpException({ error: "bad_date" }, 400);
  if (lockDate && e.incurredAt.toISOString().slice(0, 10) <= lockDate) throw new ConflictException({ error: "period_locked", lockDate });
  const dec = (v: string) => new Prisma.Decimal(Math.round(Number(v) * 10 ** unit)).div(10 ** unit);
  if (x.amount !== undefined && !(Number(x.amount) > 0)) throw new ConflictException({ error: "bad_amount" });
  return t.expense.update({
    where: { id },
    data: {
      ...(x.accountId ? { category: x.accountId } : {}),
      ...(x.description !== undefined ? { description: x.description } : {}),
      ...(x.amount !== undefined ? { amount: dec(x.amount) } : {}),
      ...(x.taxAmount !== undefined ? { taxAmount: dec(x.taxAmount ?? "0") } : {}),
      ...(x.paidVia ? { paidVia: x.paidVia } : {}),
      ...(x.supplierId !== undefined ? { supplierId: x.supplierId } : {}),
      ...(x.incurredAt ? { incurredAt: new Date(`${x.incurredAt}T00:00:00Z`) } : {}),
    },
  });
}

export async function listExpenses(t: TenantTx, s: Scope, q: { from: string; to: string; branchId?: string }) {
  const { currency, unit } = await orgMoney(t);
  const rows = await t.expense.findMany({
    where: {
      incurredAt: { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) },
      ...(q.branchId ? { branchId: q.branchId } : s.branchIds === null ? {} : { branchId: { in: s.branchIds } }),
    },
    orderBy: [{ incurredAt: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: { branch: { select: { code: true } }, supplier: { select: { name: true } }, createdBy: { select: { displayName: true } } },
  });
  const accounts = new Map((await t.ledgerAccount.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.category))].filter((c) => /^[0-9a-f-]{36}$/.test(c)) } }, select: { id: true, code: true, name: true } })).map((a) => [a.id, a]));
  const f = fmt(unit);
  return {
    currency,
    total: f(rows.reduce((a, r) => a.add(r.amount).add(r.taxAmount), D(0))),
    expenses: rows.map((r) => ({
      id: r.id, branch: r.branch.code, branchId: r.branchId, account: accounts.get(r.category) ?? null, description: r.description, amount: f(r.amount), taxAmount: f(r.taxAmount),
      total: f(r.amount.add(r.taxAmount)), paidVia: r.paidVia, fromDrawer: !!r.shiftId, paidFrom: expensePaidFrom(r).slice(3), supplier: r.supplier?.name ?? null,
      incurredAt: r.incurredAt.toISOString().slice(0, 10), createdBy: r.createdBy.displayName, createdAt: r.createdAt,
    })),
  };
}
