// Phase 11 end-to-end: the reports (sales, VAT, cash & shifts, gaming
// utilization, staff) follow real operations, respect each reader's branches
// and export CSV. The test database is shared with the other suites, so the
// sales assertions are about what changed around an operation.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

process.env["ACCOUNTING_SWEEP_MS"] = "3600000";
const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const n = (v: unknown) => Math.round(Number(v) * 100) / 100;

describe.skipIf(!HAS_DB)("Reports (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  let ownerT: string, cashierT: string, managerT: string, accountantT: string, rivalT: string;
  let dxb1: string, auh1: string;
  const P: Record<string, any> = {};

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
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  const range = () => `from=${today()}&to=${today()}`;
  const ensureShift = async (token: string) => {
    const mine = (await call(token, "GET", `/branches/${dxb1}/shifts/me`)).body;
    if (mine) return mine;
    const drawers = (await call(ownerT, "GET", `/branches/${dxb1}/cash-drawers`)).body as any[];
    let d = drawers.find((x) => x.shifts.length === 0);
    if (!d) d = (await call(ownerT, "POST", `/branches/${dxb1}/cash-drawers`, { name: `Till ${randomUUID().slice(0, 4)}` })).body;
    return (await call(token, "POST", `/branches/${dxb1}/shifts`, { cashDrawerId: d.id, openingCash: "100" })).body;
  };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT, managerT, accountantT, rivalT] = (await Promise.all(["owner@demo.test", "cashier@demo.test", "manager@demo.test", "accountant@demo.test", "owner@rival.test"].map(login))) as [string, string, string, string, string];
    const branches = (await call(ownerT, "GET", "/branches")).body as any[];
    dxb1 = branches.find((b) => b.code === "DXB1").id;
    auh1 = branches.find((b) => b.code === "AUH1").id;
    const bar = ((await call(ownerT, "GET", `/warehouses?branchId=${dxb1}`)).body as any[]).find((w) => w.name === "Bar store");
    const items = (await call(ownerT, "GET", "/inventory/items")).body as any[];
    const cola = items.find((i) => i.sku === "INV-COLA");
    if (bar && cola) await call(ownerT, "POST", `/warehouses/${bar.id}/counts`, { lines: [{ itemId: cola.id, counted: "500" }], note: "test restock", idempotencyKey: randomUUID() });
    const menu = (await call(cashierT, "GET", `/branches/${dxb1}/menu`)).body;
    for (const c of menu.categories) for (const p of c.products) P[p.sku] = p;
    await owner.query(`UPDATE "Shift" SET status = 'CLOSED', "closedAt" = now() WHERE status = 'OPEN'`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await owner.end();
  });

  it("a sale shows up in sales (by day, type, method, product with its cost) and in output VAT", async () => {
    const before = (await call(managerT, "GET", `/reports/sales?${range()}`)).body;
    const vatBefore = (await call(managerT, "GET", `/reports/vat?${range()}`)).body;
    await ensureShift(cashierT);
    const o = (await call(cashierT, "POST", `/branches/${dxb1}/orders`, { idempotencyKey: randomUUID(), type: "COUNTER", lines: [{ productId: P["DRK-COLA"].id, quantity: 3 }], payments: [{ method: "CASH", tendered: "50" }] })).body;
    expect(o.bill.status).toBe("SETTLED");
    const after = (await call(managerT, "GET", `/reports/sales?${range()}`)).body;
    expect(after.summary.bills).toBe(before.summary.bills + 1);
    expect(n(after.summary.takings)).toBe(n(n(before.summary.takings) + n(o.total)));
    expect(n(after.summary.revenue)).toBe(n(n(before.summary.revenue) + n(o.total) - n(o.taxTotal)));
    const day = (r: any) => r.byDay.find((d: any) => d.day === today());
    expect(day(after).bills).toBe((day(before)?.bills ?? 0) + 1);
    const cash = (r: any) => n(r.byMethod.find((m: any) => m.method === "CASH")?.amount ?? 0);
    expect(cash(after)).toBe(n(cash(before) + n(o.total)));
    const cola = after.topProducts.find((p: any) => p.productId === P["DRK-COLA"].id);
    expect(cola.quantity).toBeGreaterThanOrEqual(3);
    expect(n(cola.cost)).toBeGreaterThan(0); // the cans' stock cost follows the sale
    expect(cola.marginPct).not.toBeNull();
    const vatAfter = (await call(managerT, "GET", `/reports/vat?${range()}`)).body;
    expect(n(vatAfter.outputTax)).toBe(n(n(vatBefore.outputTax) + n(o.taxTotal)));
    expect(vatAfter.output.find((r: any) => r.ratePercent === 5)).toBeTruthy();
  });

  it("a top-up is takings but not revenue", async () => {
    const before = (await call(managerT, "GET", `/reports/sales?${range()}`)).body;
    const c = (await call(cashierT, "POST", "/customers", { username: `r${randomUUID().slice(0, 8)}`, displayName: "Report Test", password: "secret123" })).body;
    expect((await call(cashierT, "POST", `/customers/${c.id}/wallet/topup`, { branchId: dxb1, amount: "40", payment: { method: "CARD" }, idempotencyKey: randomUUID() })).status).toBe(201);
    const after = (await call(managerT, "GET", `/reports/sales?${range()}`)).body;
    expect(n(after.summary.takings)).toBe(n(n(before.summary.takings) + 40));
    expect(after.summary.revenue).toBe(before.summary.revenue);
    expect(after.byType.find((x: any) => x.name === "Wallet top-ups")).toMatchObject({ isRevenue: false });
  });

  it("cash & shifts lists closed shifts with their variance; staff credits the cashier", async () => {
    const shift = await ensureShift(cashierT);
    const expected = n((await call(cashierT, "GET", `/shifts/${shift.id}`)).body.expectedCash);
    expect((await call(cashierT, "POST", `/shifts/${shift.id}/close`, { countedCash: String(expected - 1) })).status).toBe(200);
    const r = (await call(accountantT, "GET", `/reports/cash?${range()}`)).body;
    expect(r.shifts.find((s: any) => s.id === shift.id)).toMatchObject({ cashier: "Cara Cashier", variance: "-1.00" });
    const st = (await call(managerT, "GET", `/reports/staff?${range()}`)).body;
    const cara = st.staff.find((s: any) => s.name === "Cara Cashier");
    expect(cara.orders).toBeGreaterThan(0);
    expect(cara.shifts).toBeGreaterThan(0);
  });

  it("utilization covers every zone of the reader's branches", async () => {
    const r = (await call(managerT, "GET", `/reports/utilization?${range()}`)).body;
    expect(r.zones.length).toBeGreaterThan(0);
    expect(r.zones.every((z: any) => z.branch === "DXB1")).toBe(true); // the manager's branch only
    expect(r.heatmap).toHaveLength(7);
    expect(r.heatmap[0]).toHaveLength(24);
    const org = (await call(ownerT, "GET", `/reports/utilization?${range()}`)).body;
    expect(new Set(org.zones.map((z: any) => z.branch))).toEqual(new Set(["DXB1", "AUH1"]));
  });

  it("each report needs its permission, stays within the reader's branches, and other organizations see none of it", async () => {
    expect((await call(cashierT, "GET", "/reports/sales")).status).toBe(403);
    expect((await call(managerT, "GET", `/reports/sales?branchId=${auh1}`)).status).toBe(403);
    expect((await call(managerT, "GET", `/reports/sales?branchId=${dxb1}`)).status).toBe(200);
    expect((await call(rivalT, "GET", `/reports/sales?branchId=${dxb1}`)).status).toBe(404);
    const rival = (await call(rivalT, "GET", `/reports/sales?${range()}`)).body;
    expect(rival.byBranch.every((b: any) => b.branch === "SHJ1")).toBe(true);
    expect((await call(accountantT, "GET", "/reports/sales?from=2026-02-10&to=2026-01-01")).status).toBe(400);
  });

  it("the dashboard: live status, today vs last week, and (with Advanced analytics) trends that agree with the sales report", async () => {
    const o = (await call(ownerT, "GET", "/analytics/overview?days=7")).body;
    expect(o.live.stations).toBeGreaterThanOrEqual(o.live.playing);
    expect(o.advanced.series).toHaveLength(7);
    expect(o.advanced.series.at(-1).day).toBe(today());
    const s = (await call(ownerT, "GET", `/reports/sales?${range()}`)).body;
    expect(o.todayVsLastWeek.revenue).toBe(s.summary.revenue);
    expect(o.advanced.series.at(-1).revenue).toBe(s.summary.revenue);
    expect(o.advanced.customers.walletFloat).not.toBeNull(); // org-wide reader
    const m = (await call(managerT, "GET", "/analytics/overview?days=7")).body;
    expect(m.advanced.customers.walletFloat).toBeNull(); // wallets aren't a branch's figure
    expect((await call(ownerT, "GET", "/analytics/overview?days=5")).status).toBe(400);
    expect((await call(cashierT, "GET", "/analytics/overview")).status).toBe(403);
    // Starter plan: the basics, no Advanced analytics.
    const rival = (await call(rivalT, "GET", "/analytics/overview")).body;
    expect(rival.live).toBeTruthy();
    expect(rival.advanced).toBeNull();
  });

  it("exports CSV for readers with reports.export", async () => {
    const r = await call(accountantT, "GET", `/reports/sales/daily?${range()}&format=csv`);
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/text\/csv/);
    expect(String(r.body).startsWith("day,bills,total,vat,net\r\n")).toBe(true);
  });
});
