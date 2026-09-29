import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { period, scopeFor, sendCsv } from "../common/reporting.js";
import { AnyStaff, RequirePermission, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  accountLedger, balanceSheet, createAccount, createExpense, journal, listAccounts, listExpenses, orgMoney, postManual, profitAndLoss, profitSeries, reverseManual,
  setLockDate, trialBalance, updateAccount, updateExpense,
} from "./accounting.service.js";
import { postPending } from "./posting.js";
import { reconcile } from "./reconcile.js";

const day = z.iso.date();
const money = z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), "invalid amount");
const Account = z.object({ code: z.string().regex(/^[0-9]{3,6}$/), name: z.string().min(2).max(80), type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]), parentId: z.uuid().nullish() }).strict();
const AccountPatch = z.object({ name: z.string().min(2).max(80).optional(), isActive: z.boolean().optional(), parentId: z.uuid().nullable().optional() }).strict();
const Manual = z
  .object({
    entryDate: day,
    description: z.string().min(3).max(200),
    branchId: z.uuid().nullish(),
    lines: z.array(z.object({ accountId: z.uuid(), debit: money.nullish(), credit: money.nullish(), memo: z.string().max(200).nullish() }).strict()).min(2).max(50),
  })
  .strict();
const Reverse = z.object({ entryDate: day }).strict();
const Lock = z.object({ lockDate: day.nullable() }).strict();
const Expense = z
  .object({
    branchId: z.uuid(),
    accountId: z.uuid(),
    description: z.string().max(200).nullish(),
    amount: money,
    taxAmount: money.nullish(),
    paidVia: z.enum(["CASH", "CARD", "BANK_TRANSFER"]),
    fromDrawer: z.boolean().default(false),
    supplierId: z.uuid().nullish(),
    incurredAt: day,
  })
  .strict();
const ExpensePatch = Expense.omit({ branchId: true, fromDrawer: true }).partial().strict();
const Range = z.object({ from: day.optional(), to: day.optional(), branchId: z.uuid().optional(), format: z.enum(["json", "csv"]).default("json") });

@Controller("accounting")
export class AccountingController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // ── chart of accounts ──

  @RequirePermissionAnyScope("accounting.view")
  @Get("accounts")
  accounts() {
    return listAccounts(tx(), orgId());
  }

  @RequirePermission("accounting.post")
  @Post("accounts")
  async createAccount(@Body(new ZodPipe(Account)) body: z.infer<typeof Account>) {
    const a = await createAccount(tx(), orgId(), body);
    await this.audit.record({ action: "ledger_account.create", entityType: "LedgerAccount", entityId: a.id, after: a });
    return a;
  }

  @RequirePermission("accounting.post")
  @Patch("accounts/:accountId")
  async updateAccount(@Param("accountId") id: string, @Body(new ZodPipe(AccountPatch)) body: z.infer<typeof AccountPatch>) {
    const a = await updateAccount(tx(), id, body);
    await this.audit.record({ action: "ledger_account.update", entityType: "LedgerAccount", entityId: id, after: body });
    return a;
  }

  @RequirePermissionAnyScope("accounting.view")
  @Get("accounts/:accountId/ledger")
  async ledger(@Param("accountId") id: string, @Query(new ZodPipe(Range)) q: z.infer<typeof Range>, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const l = await accountLedger(tx(), await scopeFor("accounting.view", q.branchId), id, p.from, p.to);
    if (q.format === "csv") {
      return sendCsv(res, `ledger-${l.account.code}-${p.from}-${p.to}`, ["date", "description", "source", "debit", "credit", "balance"], l.lines.map((x) => [x.entryDate, x.description, x.sourceType, x.debit, x.credit, x.balance]));
    }
    return l;
  }

  // ── statements ──

  @RequirePermissionAnyScope("accounting.view")
  @Get("trial-balance")
  async trialBalance(@Query(new ZodPipe(Range)) q: z.infer<typeof Range>, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const tb = await trialBalance(tx(), await scopeFor("accounting.view", q.branchId), p.to);
    if (q.format === "csv") return sendCsv(res, `trial-balance-${p.to}`, ["code", "account", "type", "debit", "credit"], tb.accounts.map((a) => [a.code, a.name, a.type, a.debit, a.credit]));
    return tb;
  }

  @RequirePermissionAnyScope("accounting.view")
  @Get("profit-and-loss")
  async profitAndLoss(@Query(new ZodPipe(Range)) q: z.infer<typeof Range>, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const pl = await profitAndLoss(tx(), await scopeFor("accounting.view", q.branchId), p.from, p.to);
    if (q.format === "csv") {
      const rows: unknown[][] = [];
      for (const [label, sec] of [["Revenue", pl.revenue], ["Cost of sales", pl.costOfSales], ["Operating expenses", pl.operatingExpenses]] as const) {
        for (const a of sec.accounts) rows.push([label, a.code, a.name, a.amount]);
        rows.push([label, "", "Total", sec.total]);
      }
      rows.push(["", "", "Gross profit", pl.grossProfit], ["", "", "Net profit", pl.netProfit]);
      return sendCsv(res, `profit-and-loss-${p.from}-${p.to}`, ["section", "code", "account", "amount"], rows);
    }
    return pl;
  }

  @RequirePermissionAnyScope("accounting.view")
  @Get("profit-series")
  async series(@Query(new ZodPipe(Range.extend({ bucket: z.enum(["day", "month"]).default("month") }))) q: z.infer<typeof Range> & { bucket: "day" | "month" }) {
    const p = await period(q);
    return profitSeries(tx(), await scopeFor("accounting.view", q.branchId), p.from, p.to, q.bucket);
  }

  @RequirePermissionAnyScope("accounting.view")
  @Get("balance-sheet")
  async balanceSheet(@Query(new ZodPipe(Range)) q: z.infer<typeof Range>, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const bs = await balanceSheet(tx(), await scopeFor("accounting.view", q.branchId), p.to);
    if (q.format === "csv") {
      const rows: unknown[][] = [];
      for (const [label, sec] of [["Assets", bs.assets], ["Liabilities", bs.liabilities], ["Equity", bs.equity]] as const) {
        for (const a of sec.accounts) rows.push([label, a.code, a.name, a.amount]);
        if (label === "Equity") rows.push([label, "", "Current earnings", bs.equity.currentEarnings]);
        rows.push([label, "", "Total", sec.total]);
      }
      return sendCsv(res, `balance-sheet-${p.to}`, ["section", "code", "account", "amount"], rows);
    }
    return bs;
  }

  // ── journal ──

  @RequirePermissionAnyScope("accounting.view")
  @Get("journal")
  async journal(@Query(new ZodPipe(Range.extend({ sourceType: z.string().max(30).optional(), search: z.string().max(100).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) }))) q: z.infer<typeof Range> & { sourceType?: string; search?: string; page: number }) {
    const p = await period(q);
    return journal(tx(), await scopeFor("accounting.view", q.branchId), { ...p, sourceType: q.sourceType, search: q.search, page: q.page });
  }

  @RequirePermission("accounting.post")
  @Post("journal")
  async postManual(@Body(new ZodPipe(Manual)) body: z.infer<typeof Manual>) {
    if (body.branchId && !(await tx().branch.findUnique({ where: { id: body.branchId } }))) throw new NotFoundException({ error: "branch_not_found" });
    const e = await postManual(tx(), body, principal().employeeId);
    await this.audit.record({ action: "journal.post", entityType: "JournalEntry", entityId: e.id, branchId: e.branchId, after: body });
    return e;
  }

  @RequirePermission("accounting.post")
  @Post("journal/:entryId/reverse")
  async reverse(@Param("entryId") id: string, @Body(new ZodPipe(Reverse)) body: z.infer<typeof Reverse>) {
    const e = await reverseManual(tx(), id, body.entryDate, principal().employeeId);
    await this.audit.record({ action: "journal.reverse", entityType: "JournalEntry", entityId: e.id, branchId: e.branchId, after: { reverses: id, entryDate: body.entryDate } });
    return e;
  }

  // ── period lock, sync, reconciliation ──

  @RequirePermissionAnyScope("accounting.view")
  @Get("settings")
  async settings() {
    const { lockDate, currency } = await orgMoney(tx());
    return { lockDate, currency };
  }

  @RequirePermission("accounting.post")
  @Put("lock")
  async lock(@Body(new ZodPipe(Lock)) body: z.infer<typeof Lock>) {
    const before = (await orgMoney(tx())).lockDate;
    const r = await setLockDate(tx(), body.lockDate);
    await this.audit.record({ action: "accounting.lock", entityType: "Organization", entityId: orgId(), before: { lockDate: before }, after: r });
    return r;
  }

  /** Books whatever changed since the last automatic run, right now. */
  @RequirePermissionAnyScope("accounting.view")
  @Post("sync")
  @HttpCode(200)
  async sync() {
    return (await postPending(tx(), orgId(), { waitMs: 4_000, budgetMs: 4_000 })) ?? { documents: 0, entries: 0, more: true, busy: true };
  }

  @RequirePermission("accounting.view")
  @Get("reconciliation")
  reconciliation() {
    return reconcile(tx());
  }

  // ── expenses ──

  @RequirePermissionAnyScope("accounting.view")
  @Get("expenses")
  async expenses(@Query(new ZodPipe(Range)) q: z.infer<typeof Range>, @Res({ passthrough: true }) res: Response) {
    const p = await period(q);
    const list = await listExpenses(tx(), await scopeFor("accounting.view", q.branchId), { ...p, branchId: q.branchId });
    if (q.format === "csv") {
      return sendCsv(res, `expenses-${p.from}-${p.to}`, ["date", "branch", "account", "description", "amount", "tax", "total", "paid via", "supplier", "recorded by"], list.expenses.map((e) => [e.incurredAt, e.branch, e.account ? `${e.account.code} ${e.account.name}` : "", e.description, e.amount, e.taxAmount, e.total, e.paidVia, e.supplier, e.createdBy]));
    }
    return list;
  }

  @AnyStaff()
  @Post("expenses")
  async createExpense(@Body(new ZodPipe(Expense)) body: z.infer<typeof Expense>) {
    authorizeFor("accounting.expense", await branchTarget(body.branchId));
    const e = await createExpense(tx(), body, principal().employeeId);
    await this.audit.record({ action: "expense.create", entityType: "Expense", entityId: e.id, branchId: e.branchId, after: body });
    return e;
  }

  @AnyStaff()
  @Patch("expenses/:expenseId")
  async updateExpense(@Param("expenseId") id: string, @Body(new ZodPipe(ExpensePatch)) body: z.infer<typeof ExpensePatch>) {
    const before = await tx().expense.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: "expense_not_found" });
    authorizeFor("accounting.expense", await branchTarget(before.branchId));
    const e = await updateExpense(tx(), id, body);
    await this.audit.record({ action: "expense.update", entityType: "Expense", entityId: id, branchId: e.branchId, before, after: e });
    return e;
  }
}

async function branchTarget(branchId: string) {
  const b = await tx().branch.findUnique({ where: { id: branchId }, select: { id: true, brandId: true } });
  if (!b) throw new NotFoundException({ error: "branch_not_found" });
  return { organizationId: orgId(), brandId: b.brandId, branchId: b.id };
}
