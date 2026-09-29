// Phase 11 end-to-end: the general ledger is fed automatically from real
// operations — counter sales (revenue net of VAT, cash in the drawer, cost of
// goods sold), voids after settlement, refunds, wallet top-ups and bonus
// credit, wallet spending, cash top-ups into the drawer, expenses, manual
// journals with reversal and the period lock — and the statements and the
// reconciliation add up. Against real Postgres and a listening API.
//
// The test database is shared with the other suites, so every assertion is
// about the *change* in an account's balance around an operation.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

process.env["ACCOUNTING_SWEEP_MS"] = "3600000"; // the test drives posting itself (POST /accounting/sync)
const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const key = () => randomUUID();
const n = (v: unknown) => Math.round(Number(v) * 100) / 100;

describe.skipIf(!HAS_DB)("Accounting: automatic posting, statements & reconciliation (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  let ownerT: string, cashierT: string, managerT: string, accountantT: string, waiterT: string, rivalT: string;
  let dxb1: string, demoOrg: string;
  const P: Record<string, any> = {};
  const A: Record<string, string> = {}; // account id by system key

  const call = async (token: string, method: string, path: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* CSV */
    }
    return { status: res.status, body: parsed, type: res.headers.get("content-type") ?? "" };
  };
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;
  const order = (token: string, body: Record<string, unknown>) => call(token, "POST", `/branches/${dxb1}/orders`, { idempotencyKey: key(), ...body });
  const ensureShift = async (token: string, float = "100") => {
    const mine = (await call(token, "GET", `/branches/${dxb1}/shifts/me`)).body;
    if (mine) return mine;
    const drawers = (await call(ownerT, "GET", `/branches/${dxb1}/cash-drawers`)).body as any[];
    let d = drawers.find((x) => x.shifts.length === 0);
    if (!d) d = (await call(ownerT, "POST", `/branches/${dxb1}/cash-drawers`, { name: `Till ${randomUUID().slice(0, 4)}` })).body;
    const r = await call(token, "POST", `/branches/${dxb1}/shifts`, { cashDrawerId: d.id, openingCash: float });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  /** Posts until nothing is pending (the shared test database may have a long history to backfill). */
  const sync = async () => {
    const total = { documents: 0, entries: 0, more: false };
    for (let i = 0; i < 300; i++) {
      const r = await call(ownerT, "POST", "/accounting/sync");
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      total.documents += r.body.documents;
      total.entries += r.body.entries;
      if (!r.body.more) return total;
    }
    throw new Error("posting never caught up");
  };
  /** Σ(debit − credit) per system account for the demo organization. */
  const balances = async () => {
    const r = await owner.query(
      `SELECT a."systemKey" AS k, COALESCE(SUM(l."debit" - l."credit"), 0) AS b FROM "LedgerAccount" a LEFT JOIN "JournalLine" l ON l."accountId" = a."id"
        WHERE a."organizationId" = $1 AND a."systemKey" IS NOT NULL GROUP BY a."systemKey"`,
      [demoOrg],
    );
    return Object.fromEntries(r.rows.map((x) => [x.k, n(x.b)])) as Record<string, number>;
  };
  /** Runs `fn`, posts, and returns how each account moved. */
  const moved = async (fn: () => Promise<unknown>) => {
    await sync();
    const before = await balances();
    await fn();
    await sync();
    const after = await balances();
    const d: Record<string, number> = {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const x = n((after[k] ?? 0) - (before[k] ?? 0));
      if (x) d[k] = x;
    }
    return d;
  };
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  const yesterday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() - 86_400_000));

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT, managerT, accountantT, waiterT, rivalT] = (await Promise.all(
      ["owner@demo.test", "cashier@demo.test", "manager@demo.test", "accountant@demo.test", "waiter@demo.test", "owner@rival.test"].map(login),
    )) as [string, string, string, string, string, string];
    demoOrg = (await owner.query(`SELECT id FROM "Organization" WHERE slug = 'demo'`)).rows[0].id;
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    // Keep canned drinks in stock however many times the suites have run.
    const bar = ((await call(ownerT, "GET", `/warehouses?branchId=${dxb1}`)).body as any[]).find((w) => w.name === "Bar store");
    const items = (await call(ownerT, "GET", "/inventory/items")).body as any[];
    const lines = ["INV-COLA", "INV-WATER"].map((sku) => items.find((i) => i.sku === sku)).filter(Boolean).map((i) => ({ itemId: i.id, counted: "500" }));
    if (bar && lines.length) await call(ownerT, "POST", `/warehouses/${bar.id}/counts`, { lines, note: "test restock", idempotencyKey: key() });
    const menu = (await call(cashierT, "GET", `/branches/${dxb1}/menu`)).body;
    for (const c of menu.categories) for (const p of c.products) P[p.sku] = p;
    await owner.query(`UPDATE "Shift" SET status = 'CLOSED', "closedAt" = now() WHERE status = 'OPEN'`);
    await owner.query(`UPDATE "ProductBranchPrice" SET "isAvailable" = true`);
    await owner.query(`UPDATE "RestaurantTable" SET status = 'AVAILABLE'`);
    await call(ownerT, "PUT", "/accounting/lock", { lockDate: null }, "test reset");
    for (const a of (await call(accountantT, "GET", "/accounting/accounts")).body as any[]) if (a.systemKey) A[a.systemKey] = a.id;
  }, 120_000);

  afterAll(async () => {
    await call(ownerT, "PUT", "/accounting/lock", { lockDate: null }, "test reset").catch(() => undefined);
    await app?.close();
    await owner.end();
  });

  describe("automatic posting", () => {
    it("every organization gets the default chart of accounts", () => {
      for (const k of ["CASH_DRAWER", "RECEIVABLE", "INVENTORY", "WALLET_LIABILITY", "VAT_PAYABLE", "GAMING_REVENUE", "FOOD_REVENUE", "COGS", "PROMO_EXPENSE"]) expect(A[k], k).toBeTruthy();
    });

    it("a cash sale books revenue net of VAT, the VAT, the cash and the cost of the cans — exactly once", async () => {
      await ensureShift(cashierT);
      let sale: any;
      const d = await moved(async () => {
        sale = (await order(cashierT, { type: "COUNTER", lines: [{ productId: P["DRK-COLA"].id, quantity: 2 }], payments: [{ method: "CASH", tendered: "20" }] })).body;
        expect(sale.bill.status).toBe("SETTLED");
      });
      const total = n(sale.total);
      const tax = n(sale.taxTotal);
      expect(d["CASH_DRAWER"]).toBe(total);
      expect(d["FOOD_REVENUE"]).toBe(-n(total - tax));
      expect(d["VAT_PAYABLE"]).toBe(-tax);
      expect(d["RECEIVABLE"] ?? 0).toBe(0); // settled: the tab is back to zero
      expect(d["COGS"]).toBeGreaterThan(0);
      expect(d["INVENTORY"]).toBe(-d["COGS"]!);

      // Posting again books nothing new, and the entries can't be edited or deleted.
      const again = await sync();
      expect(again.entries).toBe(0);
      const entry = (await owner.query(`SELECT id FROM "JournalEntry" WHERE "documentId" = $1`, [sale.bill.id])).rows[0];
      expect(entry).toBeTruthy();
      await expect(owner.query(`UPDATE "JournalEntry" SET description = 'x' WHERE id = $1`, [entry.id])).rejects.toThrow(/append-only/);
      await expect(owner.query(`DELETE FROM "JournalLine" WHERE "entryId" = $1`, [entry.id])).rejects.toThrow(/append-only/);
    });

    it("an open tab isn't revenue yet; a voided line never reaches the books; the settled bill does", async () => {
      const t = ((await call(waiterT, "GET", `/branches/${dxb1}/tables`)).body as any[]).find((x) => x.name === "T5");
      const o = (await order(waiterT, { type: "DINE_IN", tableId: t.id, lines: [{ productId: P["DRK-COLA"].id, quantity: 1 }, { productId: P["DRK-WATER"].id, quantity: 1 }] })).body;
      const water = o.items.find((i: any) => i.nameSnapshot.toLowerCase().includes("water"));
      const cola = o.items.find((i: any) => i.nameSnapshot.toLowerCase().includes("cola"));
      const open = await moved(async () => {
        const v = await call(managerT, "POST", `/order-items/${water.id}/void`, { reason: "never served" }, "never served");
        expect(v.status, JSON.stringify(v.body)).toBe(200);
      });
      expect(open["FOOD_REVENUE"] ?? 0).toBe(0); // only the cost of the cans moves while the tab is open
      const settled = await moved(async () => {
        const paid = await call(waiterT, "POST", `/bills/${o.bill.id}/pay`, { payments: [{ method: "CARD", reference: "T5" }], idempotencyKey: key() });
        expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      });
      expect(settled["CARD_CLEARING"]).toBe(n(cola.lineTotal));
      expect(settled["FOOD_REVENUE"]).toBe(-n(n(cola.lineTotal) - n(cola.taxAmount)));
      expect(settled["VAT_PAYABLE"]).toBe(-n(cola.taxAmount));
      expect(settled["RECEIVABLE"] ?? 0).toBe(0);
      await call(waiterT, "POST", `/tables/${t.id}/status`, { status: "AVAILABLE" });
    });

    it("a document that changes after it was booked books only the change, on the day it changed", async () => {
      const s = (await call(ownerT, "POST", "/suppliers", { name: `Ledger Supplies ${randomUUID().slice(0, 4)}` }, "new supplier")).body;
      let inv: any;
      const booked = await moved(async () => {
        const r = await call(ownerT, "POST", "/supplier-invoices", { supplierId: s.id, invoiceNumber: `INV-${randomUUID().slice(0, 6)}`, invoiceDate: yesterday(), amount: "300", taxAmount: "15" }, "bill in");
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        inv = r.body;
      });
      expect(booked).toEqual({ OTHER_EXPENSE: 300, INPUT_VAT: 15, AP: -315 });
      const paid = await moved(async () => {
        const r = await call(ownerT, "POST", `/supplier-invoices/${inv.id}/pay`, { amount: "100", method: "BANK_TRANSFER" }, "part payment");
        expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      });
      expect(paid).toEqual({ AP: 100, BANK: -100 });
      const entries = (await owner.query(`SELECT description, "entryDate"::text AS d FROM "JournalEntry" WHERE "documentId" = $1 ORDER BY "createdAt"`, [inv.id])).rows;
      expect(entries.map((e) => e.d)).toEqual([yesterday(), today()]); // the invoice on its date, the payment today
      expect(entries[1].description).toMatch(/\(change\)$/);
    });

    it("a refund books a return and takes the VAT share back; the cash leaves the drawer", async () => {
      await ensureShift(cashierT);
      await ensureShift(managerT);
      const o = (await order(cashierT, { type: "COUNTER", lines: [{ productId: P["DRK-WATER"].id, quantity: 4 }], payments: [{ method: "CASH", tendered: "50" }] })).body;
      const payment = (await call(cashierT, "GET", `/bills/${o.bill.id}`)).body.payments[0];
      await sync();
      const d = await moved(async () => {
        expect((await call(managerT, "POST", `/payments/${payment.id}/refund`, { amount: "5", destination: "CASH", reason: "flat", idempotencyKey: key() }, "flat water")).status).toBe(201);
      });
      const taxShare = Math.round((5 * n(o.taxTotal) * 100) / n(o.total)) / 100;
      expect(d["CASH_DRAWER"]).toBe(-5);
      expect(d["VAT_PAYABLE"]).toBe(taxShare);
      expect(d["SALES_RETURNS"]).toBe(n(5 - taxShare));
    });

    it("a wallet top-up is the customer's money (a liability), bonus credit is a promotion cost, and spending it is the sale", async () => {
      const c = (await call(cashierT, "POST", "/customers", { username: `a${randomUUID().slice(0, 8)}`, displayName: "Ledger Test", password: "secret123" })).body;
      const top = await moved(async () => {
        const r = await call(ownerT, "POST", `/customers/${c.id}/wallet/topup`, { branchId: dxb1, amount: "100", bonus: "10", payment: { method: "CARD" }, idempotencyKey: key() }, "opening promo");
        expect(r.status, JSON.stringify(r.body)).toBe(201);
      });
      expect(top).toEqual({ CARD_CLEARING: 100, WALLET_LIABILITY: -110, PROMO_EXPENSE: 10 }); // no revenue at all

      let sale: any;
      const spend = await moved(async () => {
        sale = (await order(cashierT, { type: "COUNTER", customerId: c.id, lines: [{ productId: P["DRK-COLA"].id, quantity: 1 }], payments: [{ method: "WALLET" }] })).body;
        expect(sale.bill.status).toBe("SETTLED");
      });
      expect(spend["WALLET_LIABILITY"]).toBe(n(sale.total));
      expect(spend["FOOD_REVENUE"]).toBe(-n(n(sale.total) - n(sale.taxTotal)));
    });

    it("cash taken for a top-up at the counter goes into the cashier's drawer (the shift count adds up)", async () => {
      const shift = await ensureShift(cashierT);
      const before = n((await call(cashierT, "GET", `/shifts/${shift.id}`)).body.expectedCash);
      const c = (await call(cashierT, "POST", "/customers", { username: `d${randomUUID().slice(0, 8)}`, displayName: "Drawer Test", password: "secret123" })).body;
      const d = await moved(async () => {
        expect((await call(cashierT, "POST", `/customers/${c.id}/wallet/topup`, { branchId: dxb1, amount: "50", payment: { method: "CASH" }, idempotencyKey: key() })).status).toBe(201);
      });
      expect(n((await call(cashierT, "GET", `/shifts/${shift.id}`)).body.expectedCash)).toBe(n(before + 50));
      expect(d).toEqual({ CASH_DRAWER: 50, WALLET_LIABILITY: -50 });
    });

    it("closing a shift moves the counted cash to the safe and books any shortage", async () => {
      const shift = await ensureShift(managerT, "40");
      const expected = n((await call(managerT, "GET", `/shifts/${shift.id}`)).body.expectedCash);
      const d = await moved(async () => {
        const r = await call(managerT, "POST", `/shifts/${shift.id}/close`, { countedCash: String(expected - 2) });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
      });
      expect(d["CASH_DRAWER"]).toBe(-expected);
      expect(d["CASH_SAFE"]).toBe(n(expected - 2));
      expect(d["CASH_OVER_SHORT"]).toBe(2);
    });
  });

  describe("expenses, manual journals & the period lock", () => {
    it("expenses: recorded by finance or the branch manager (not a cashier); paid from the drawer they leave the shift", async () => {
      const body = { branchId: dxb1, accountId: A["UTILITIES"], description: "Internet — September", amount: "200", taxAmount: "10", paidVia: "BANK_TRANSFER", incurredAt: today() };
      expect((await call(cashierT, "POST", "/accounting/expenses", body)).status).toBe(403);
      expect((await call(accountantT, "POST", "/accounting/expenses", { ...body, accountId: A["BANK"] })).body.error).toBe("not_an_expense_account");
      const bank = await moved(async () => {
        expect((await call(accountantT, "POST", "/accounting/expenses", body)).status).toBe(201);
      });
      expect(bank).toEqual({ UTILITIES: 200, INPUT_VAT: 10, BANK: -210 });

      const shift = await ensureShift(managerT);
      const before = n((await call(managerT, "GET", `/shifts/${shift.id}`)).body.expectedCash);
      const drawer = await moved(async () => {
        const r = await call(managerT, "POST", "/accounting/expenses", { branchId: dxb1, accountId: A["MAINTENANCE"], description: "Mouse repair", amount: "20", paidVia: "CASH", fromDrawer: true, incurredAt: today() });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
      });
      expect(drawer).toEqual({ MAINTENANCE: 20, CASH_DRAWER: -20 });
      expect(n((await call(managerT, "GET", `/shifts/${shift.id}`)).body.expectedCash)).toBe(n(before - 20));

      const list = (await call(managerT, "GET", `/accounting/expenses?from=${today()}&to=${today()}`)).body;
      expect(list.expenses.some((e: any) => e.description === "Mouse repair" && e.fromDrawer)).toBe(true);
    });

    it("manual journal: must balance, needs accounting.post with a reason, reverses once; automatic entries can't be reversed", async () => {
      const lines = (dr: string, cr: string) => [{ accountId: A["BANK"], debit: dr }, { accountId: A["OWNER_EQUITY"], credit: cr }];
      const entry = { entryDate: today(), description: "Owner capital injection", lines: lines("1000", "1000") };
      expect((await call(accountantT, "POST", "/accounting/journal", { ...entry, lines: lines("1000", "900") }, "capital")).body.error).toBe("unbalanced");
      expect((await call(accountantT, "POST", "/accounting/journal", entry)).status).toBe(403); // sensitive: no reason
      expect((await call(managerT, "POST", "/accounting/journal", entry, "capital")).status).toBe(403); // not their right
      expect((await call(accountantT, "POST", "/accounting/journal", { ...entry, lines: [{ accountId: A["H_ASSETS"], debit: "1" }, { accountId: A["OWNER_EQUITY"], credit: "1" }] }, "x-x")).body.error).toBe("header_account");
      let id = "";
      const d = await moved(async () => {
        const r = await call(accountantT, "POST", "/accounting/journal", entry, "owner put money in");
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        id = r.body.id;
      });
      expect(d).toEqual({ BANK: 1000, OWNER_EQUITY: -1000 });
      const rev = await moved(async () => {
        expect((await call(accountantT, "POST", `/accounting/journal/${id}/reverse`, { entryDate: today() }, "posted twice")).status).toBe(201);
      });
      expect(rev).toEqual({ BANK: -1000, OWNER_EQUITY: 1000 });
      expect((await call(accountantT, "POST", `/accounting/journal/${id}/reverse`, { entryDate: today() }, "again")).body.error).toBe("already_reversed");
      const auto = (await owner.query(`SELECT id FROM "JournalEntry" WHERE "organizationId" = $1 AND "sourceType" = 'BILL' LIMIT 1`, [demoOrg])).rows[0];
      expect((await call(accountantT, "POST", `/accounting/journal/${auto.id}/reverse`, { entryDate: today() }, "nope")).body.error).toBe("automatic_entry");
    });

    it("closing the books to yesterday blocks back-dated entries and expenses", async () => {
      expect((await call(accountantT, "PUT", "/accounting/lock", { lockDate: today() }, "close")).body.error).toBe("lock_in_future");
      expect((await call(accountantT, "PUT", "/accounting/lock", { lockDate: yesterday() }, "month end")).status).toBe(200);
      const back = { entryDate: yesterday(), description: "Back-dated", lines: [{ accountId: A["BANK"], debit: "1" }, { accountId: A["OWNER_EQUITY"], credit: "1" }] };
      expect((await call(accountantT, "POST", "/accounting/journal", back, "late")).body.error).toBe("period_locked");
      expect((await call(accountantT, "POST", "/accounting/expenses", { branchId: dxb1, accountId: A["RENT"], amount: "1", paidVia: "BANK_TRANSFER", incurredAt: yesterday() })).body.error).toBe("period_locked");
      expect((await call(accountantT, "GET", "/accounting/settings")).body.lockDate).toBe(yesterday());
      expect((await call(accountantT, "PUT", "/accounting/lock", { lockDate: null }, "reopen")).status).toBe(200);
    });
  });

  describe("statements, scoping & reconciliation", () => {
    it("the trial balance and the balance sheet balance; net profit = revenue − cost of sales − expenses", async () => {
      await sync();
      const tb = (await call(accountantT, "GET", `/accounting/trial-balance?to=${today()}`)).body;
      expect(tb.balanced).toBe(true);
      expect(tb.totalDebit).toBe(tb.totalCredit);
      const bs = (await call(accountantT, "GET", `/accounting/balance-sheet?to=${today()}`)).body;
      expect(bs.balanced).toBe(true);
      const pl = (await call(accountantT, "GET", `/accounting/profit-and-loss?from=${today()}&to=${today()}`)).body;
      expect(n(pl.netProfit)).toBe(n(n(pl.revenue.total) - n(pl.costOfSales.total) - n(pl.operatingExpenses.total)));
      expect(pl.operatingExpenses.accounts.some((a: any) => a.code === "6110" && n(a.amount) >= 200)).toBe(true);
      const series = (await call(accountantT, "GET", `/accounting/profit-series?from=${today()}&to=${today()}&bucket=day`)).body;
      expect(series.points.find((p: any) => p.period === today())?.netProfit).toBe(pl.netProfit);
    });

    it("a branch manager sees only their branch; cashiers see nothing; another organization without the add-on is refused", async () => {
      const j = (await call(managerT, "GET", `/accounting/journal?from=${today()}&to=${today()}`)).body;
      expect(j.entries.length).toBeGreaterThan(0);
      expect(j.entries.every((e: any) => e.branch === "DXB1")).toBe(true);
      const auh1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "AUH1").id;
      expect((await call(managerT, "GET", `/accounting/trial-balance?branchId=${auh1}`)).status).toBe(403);
      expect((await call(cashierT, "GET", "/accounting/trial-balance")).status).toBe(403);
      const rival = await call(rivalT, "GET", "/accounting/trial-balance");
      expect(rival.status).toBe(403);
      expect(rival.body.reason).toBe("FEATURE_DISABLED");
    });

    it("exports CSV (formula-safe) for those with reports.export", async () => {
      const csv = await call(accountantT, "GET", `/accounting/trial-balance?to=${today()}&format=csv`);
      expect(csv.status).toBe(200);
      expect(csv.type).toMatch(/text\/csv/);
      expect(String(csv.body).split("\r\n")[0]).toBe("code,account,type,debit,credit");
    });

    it("reconciliation: the ledger agrees with the wallets, the stock ledger and the supplier invoices", async () => {
      await sync();
      const r = (await call(accountantT, "GET", "/accounting/reconciliation")).body;
      expect(r.unposted).toBe(0);
      for (const k of ["WALLET_LIABILITY", "INVENTORY", "AP"]) {
        const c = r.checks.find((x: any) => x.key === k);
        expect(c, JSON.stringify(c)).toMatchObject({ ok: true });
      }
    });
  });
});
