// Phase 7 end-to-end: menu & modifiers, counter sales with cash/change and
// shifts, tables with split payment, the kitchen display, in-seat ordering
// from a gaming PC, voids/cancels/refunds, shift close with variance approval,
// and tenant isolation — against real Postgres, a listening API and sim PCs.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";
import { SimAgent } from "../scripts/sim-agent.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
};
const key = () => randomUUID();

describe.skipIf(!HAS_DB)("POS, kitchen, tables, in-seat ordering & shifts (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const agents: SimAgent[] = [];
  let ownerT: string, cashierT: string, managerT: string, waiterT: string, kitchenT: string, rivalT: string;
  let dxb1: string, regularZone: string, regularPlan: string, drawer: string;
  const P: Record<string, any> = {}; // products by sku
  let tables: any[] = [];

  const call = async (token: string, method: string, path: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;
  const mod = (sku: string, group: string, name: string) => P[sku].modifierGroups.find((g: any) => g.name === group).modifiers.find((m: any) => m.name === name).id;
  const order = (token: string, body: Record<string, unknown>) => call(token, "POST", `/branches/${dxb1}/orders`, { idempotencyKey: key(), ...body });
  const ensureShift = async (token: string, float = "200") => {
    const mine = (await call(token, "GET", `/branches/${dxb1}/shifts/me`)).body;
    if (mine) return mine;
    const drawers = (await call(ownerT, "GET", `/branches/${dxb1}/cash-drawers`)).body as any[];
    let d = drawers.find((x) => x.shifts.length === 0);
    if (!d) d = (await call(ownerT, "POST", `/branches/${dxb1}/cash-drawers`, { name: `Till ${randomUUID().slice(0, 4)}` })).body;
    const r = await call(token, "POST", `/branches/${dxb1}/shifts`, { cashDrawerId: d.id, openingCash: float });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const newStation = async () => {
    const code = (await call(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId: regularZone, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60 });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.isOnline === true);
    return a;
  };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT, managerT, waiterT, kitchenT, rivalT] = (await Promise.all(["owner@demo.test", "cashier@demo.test", "manager@demo.test", "waiter@demo.test", "kitchen@demo.test", "owner@rival.test"].map(login))) as string[] as [string, string, string, string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;
    regularPlan = ((await call(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.name === "Regular PC").id;
    // Canned drinks are stock-tracked since Phase 8: count the bar back up so repeated runs never sell out.
    const bar = ((await call(ownerT, "GET", `/warehouses?branchId=${dxb1}`)).body as any[]).find((w) => w.name === "Bar store");
    if (bar) {
      const items = (await call(ownerT, "GET", "/inventory/items")).body as any[];
      const lines = ["INV-COLA", "INV-ENERGY", "INV-WATER"].map((sku) => items.find((i) => i.sku === sku)).filter(Boolean).map((i) => ({ itemId: i.id, counted: "500" }));
      if (lines.length) await call(ownerT, "POST", `/warehouses/${bar.id}/counts`, { lines, note: "test restock", idempotencyKey: key() });
    }
    const menu = (await call(cashierT, "GET", `/branches/${dxb1}/menu`)).body;
    for (const c of menu.categories) for (const p of c.products) P[p.sku] = p;
    tables = (await call(waiterT, "GET", `/branches/${dxb1}/tables`)).body;
    // Leftovers from earlier runs: close open shifts and bills so each test starts clean.
    await owner.query(`UPDATE "Shift" SET status = 'CLOSED', "closedAt" = now() WHERE status = 'OPEN'`);
    await owner.query(`UPDATE "ProductBranchPrice" SET "isAvailable" = true`);
    await owner.query(`UPDATE "RestaurantTable" SET status = 'AVAILABLE'`);
    await owner.query(`UPDATE "Bill" SET status = 'VOID' WHERE "tableId" IS NOT NULL AND status IN ('OPEN','PARTIALLY_PAID')`);
    await owner.query(`UPDATE "Device" SET "isEnabled" = false WHERE "agentVersion" = '0.1.0-sim' AND "branchId" = $1`, [dxb1]);
  }, 90_000);

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
    await owner.end();
  });

  describe("menu & counter sales", () => {
    it("the menu has prices, stations and modifier groups", async () => {
      expect(P["BRG-CLASSIC"]).toMatchObject({ price: "32.00", station: "Kitchen", available: true });
      expect(P["COF-LATTE"].modifierGroups.map((g: any) => g.name)).toEqual(["Milk", "Size"]);
      expect(P["DRK-COLA"]).toMatchObject({ price: "8.00", station: "Bar", type: "STOCK_ITEM" });
    });

    it("cash needs an open shift; then: VAT-inclusive total, change, drawer ledger, one sale even if retried", async () => {
      const lines = [{ productId: P["DRK-COLA"].id, quantity: 2 }, { productId: P["SNK-FRIES"].id, quantity: 1, modifierIds: [mod("SNK-FRIES", "Size", "Large"), mod("SNK-FRIES", "Dip", "Ketchup")] }];
      const noShift = await order(cashierT, { type: "COUNTER", lines, payments: [{ method: "CASH", tendered: "50" }] });
      expect(noShift.body.error).toBe("no_open_shift");
      const shift = await ensureShift(cashierT, "200");

      const k = key();
      const body = { type: "COUNTER", lines, payments: [{ method: "CASH", tendered: "50" }], idempotencyKey: k };
      const r = await call(cashierT, "POST", `/branches/${dxb1}/orders`, body);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ total: "33.00", subtotal: "33.00", taxTotal: "1.57", paymentState: "PAID" }); // 2×8 + (12+5); VAT 5 % inside, rounded per line (0.76 + 0.81)
      expect(r.body.bill).toMatchObject({ status: "SETTLED", due: "0.00" });
      // The cans are handed over at the counter; only the fries go to the kitchen.
      expect(r.body.kitchenTickets.map((t: any) => t.station.name)).toEqual(["Kitchen"]);
      const again = await call(cashierT, "POST", `/branches/${dxb1}/orders`, body);
      expect(again.body.id).toBe(r.body.id);
      const pays = await owner.query(`SELECT "cashTendered", "changeGiven" FROM "Payment" WHERE "billId" = $1`, [r.body.bill.id]);
      expect(pays.rows).toHaveLength(1);
      expect(Number(pays.rows[0].changeGiven)).toBe(17);
      const x = (await call(cashierT, "GET", `/shifts/${shift.id}`)).body;
      expect(Number(x.expectedCash)).toBe(Number(shift.expectedCash) + 33);
    });

    it("modifiers are validated; sold-out items can't be ordered; the kitchen can 86 but not reprice", async () => {
      const latte = await order(cashierT, { type: "COUNTER", lines: [{ productId: P["COF-LATTE"].id, quantity: 1 }], payments: [{ method: "CARD" }] });
      expect(latte.body).toMatchObject({ error: "modifier_required" });
      expect(latte.body.message).toMatch(/Milk/);
      expect((await call(kitchenT, "PUT", `/products/${P["PZA-PEPP"].id}/branches/${dxb1}`, { isAvailable: false })).status).toBe(200);
      expect((await call(kitchenT, "PUT", `/products/${P["PZA-PEPP"].id}/branches/${dxb1}`, { price: "1" })).status).toBe(403);
      const sold = await order(cashierT, { type: "COUNTER", lines: [{ productId: P["PZA-PEPP"].id, quantity: 1, modifierIds: [mod("PZA-PEPP", "Size", "Regular")] }], payments: [{ method: "CARD" }] });
      expect(sold.body).toMatchObject({ error: "sold_out", product: "Pepperoni" });
      await call(kitchenT, "PUT", `/products/${P["PZA-PEPP"].id}/branches/${dxb1}`, { isAvailable: true });
    });
  });

  describe("tables & kitchen", () => {
    it("a table keeps one bill across rounds; split payment settles it and the table goes to cleaning", async () => {
      const t3 = tables.find((t) => t.name === "T3");
      const r1 = await order(waiterT, { type: "DINE_IN", tableId: t3.id, lines: [{ productId: P["BRG-CLASSIC"].id, quantity: 2, modifierIds: [mod("BRG-CLASSIC", "Extras", "Cheese")] }] });
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      expect(r1.body).toMatchObject({ total: "70.00", paymentState: "ON_BILL", deliverTo: "Table T3" });
      const r2 = await order(waiterT, { type: "DINE_IN", tableId: t3.id, lines: [{ productId: P["DRK-COLA"].id, quantity: 2 }] });
      expect(r2.body.bill.id).toBe(r1.body.bill.id);
      expect((await call(waiterT, "GET", `/branches/${dxb1}/tables`)).body.find((t: any) => t.id === t3.id)).toMatchObject({ status: "OCCUPIED", bill: { due: "86.00" } });

      const pay = await call(waiterT, "POST", `/bills/${r1.body.bill.id}/pay`, { payments: [{ method: "CARD", amount: "50", reference: "AUTH123" }, { method: "CARD", reference: "AUTH124" }], idempotencyKey: key() });
      expect(pay.status, JSON.stringify(pay.body)).toBe(200);
      expect(pay.body).toMatchObject({ status: "SETTLED", due: "0.00" });
      expect(pay.body.payments.map((p: any) => p.amount)).toEqual(["50.00", "36.00"]);
      expect((await call(waiterT, "GET", `/branches/${dxb1}/tables`)).body.find((t: any) => t.id === t3.id).status).toBe("CLEANING");
      expect((await call(waiterT, "POST", `/tables/${t3.id}/status`, { status: "AVAILABLE" })).status).toBe(200);
    });

    it("tickets per station; the kitchen bumps them; the order follows; cashiers can view but not bump", async () => {
      const t4 = tables.find((t) => t.name === "T4");
      const o = (await order(waiterT, { type: "DINE_IN", tableId: t4.id, lines: [{ productId: P["BRG-CHICKEN"].id, quantity: 1 }, { productId: P["DRK-MILKSHAKE"].id, quantity: 1, modifierIds: [mod("DRK-MILKSHAKE", "Size", "Regular")] }], notes: "no onions" })).body;
      const board = (await call(kitchenT, "GET", `/branches/${dxb1}/kitchen`)).body;
      const mine = board.tickets.filter((t: any) => t.order.id === o.id);
      expect(mine.map((t: any) => t.station.name).sort()).toEqual(["Bar", "Kitchen"]);
      expect(mine.find((t: any) => t.station.name === "Kitchen")).toMatchObject({ status: "NEW", deliverTo: "Table T4", items: [{ nameSnapshot: "Crispy chicken burger", quantity: 1 }] });
      const kitchenTk = mine.find((t: any) => t.station.name === "Kitchen");
      const barTk = mine.find((t: any) => t.station.name === "Bar");
      expect((await call(cashierT, "POST", `/kitchen-tickets/${kitchenTk.id}/bump`, { to: "PREPARING" })).status).toBe(403);
      expect((await call(kitchenT, "POST", `/kitchen-tickets/${kitchenTk.id}/bump`, { to: "SERVED" })).body.error).toBe("bad_transition");
      const b1 = await call(kitchenT, "POST", `/kitchen-tickets/${kitchenTk.id}/bump`, { to: "PREPARING" });
      expect(b1.body.orderStatus).toBe("IN_PROGRESS");
      await call(kitchenT, "POST", `/kitchen-tickets/${kitchenTk.id}/bump`, { to: "READY" });
      expect((await call(waiterT, "GET", `/orders/${o.id}`)).body.status).toBe("IN_PROGRESS"); // the shake isn't ready yet
      await call(kitchenT, "POST", `/kitchen-tickets/${barTk.id}/bump`, { to: "PREPARING" });
      expect((await call(kitchenT, "POST", `/kitchen-tickets/${barTk.id}/bump`, { to: "READY" })).body.orderStatus).toBe("READY");
      for (const t of [kitchenTk, barTk]) await call(waiterT === "" ? kitchenT : kitchenT, "POST", `/kitchen-tickets/${t.id}/bump`, { to: "SERVED" });
      expect((await call(waiterT, "GET", `/orders/${o.id}`)).body.status).toBe("SERVED");
    });
  });

  describe("in-seat ordering from the Shell", () => {
    it("orders to the seat go on the session bill; the PC hears when food is ready; wallet payment works; guests can't use a wallet", async () => {
      const a = await newStation();
      const cust = (await call(cashierT, "POST", "/customers", { username: `s${randomUUID().slice(0, 8)}`, displayName: "Seat Eater", password: "secret123" })).body;
      await call(ownerT, "POST", `/customers/${cust.id}/wallet/topup`, { branchId: dxb1, amount: "100", payment: { method: "CARD" }, idempotencyKey: key() });
      expect((await a.order([{ productId: P["DRK-COLA"].id, quantity: 1 }])).error).toBe("no_session");
      const s = (await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, customerId: cust.id, request: { kind: "minutes", minutes: 60 }, payment: { method: "CARD" }, idempotencyKey: key() })).body;

      const menu = (await a.menu()).menu;
      expect(menu).toMatchObject({ currency: "AED", canPayWithWallet: true });
      expect(menu.categories.flatMap((c: any) => c.products).find((p: any) => p.id === P["BRG-CLASSIC"].id)).toMatchObject({ price: "32.00" });
      // The PC can't make things cheaper: prices come from the server.
      const onBill = await a.order([{ productId: P["BRG-CLASSIC"].id, quantity: 1, modifierIds: [mod("BRG-CLASSIC", "Extras", "Bacon")] }], "BILL", "extra napkins");
      expect(onBill).toMatchObject({ ok: true, total: "37.00" });
      const sess = (await call(cashierT, "GET", `/sessions/${s.id}`)).body;
      const bill = (await call(cashierT, "GET", `/bills/${sess.bill.id}`)).body;
      expect(bill.orders.find((o: any) => o.id === onBill.orderId)).toMatchObject({ type: "GAMING_SEAT", deliverTo: expect.stringMatching(/Regular PCs/) });
      expect(Number(bill.due)).toBe(37);

      const tk = (await call(kitchenT, "GET", `/branches/${dxb1}/kitchen`)).body.tickets.find((t: any) => t.order.id === onBill.orderId);
      await call(kitchenT, "POST", `/kitchen-tickets/${tk.id}/bump`, { to: "PREPARING" });
      await call(kitchenT, "POST", `/kitchen-tickets/${tk.id}/bump`, { to: "READY" });
      await until(() => a.orderUpdates.some((u) => u.orderId === onBill.orderId && u.status === "READY"));
      expect(a.orderUpdates.find((u) => u.status === "READY")!.message).toMatch(/on its way/);

      const paid = await a.order([{ productId: P["DRK-ENERGY"].id, quantity: 2 }], "WALLET");
      expect(paid).toMatchObject({ ok: true, total: "28.00" });
      expect((await call(ownerT, "GET", `/customers/${cust.id}/wallet`)).body.cash).toBe("72.00");
      await call(cashierT, "POST", `/sessions/${s.id}/end`, { reason: "t" });

      const guest = await newStation();
      await call(cashierT, "POST", `/devices/${guest.identity!.deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 30 }, payment: { method: "CARD" }, idempotencyKey: key() });
      expect((await guest.menu()).menu.canPayWithWallet).toBe(false);
      expect((await guest.order([{ productId: P["DRK-COLA"].id, quantity: 1 }], "WALLET")).error).toBe("wallet_needs_customer");
    });
  });

  it("an unpaid counter order moves onto a playing PC's bill; a paid one can't", async () => {
    const a = await newStation();
    const s = (await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 30 }, payment: { method: "CARD" }, idempotencyKey: key() })).body;
    // Gaming time carries VAT like everything else: 7.50 incl. 5 % → 0.36.
    expect((await call(cashierT, "GET", `/bills/${s.bill.id}`)).body).toMatchObject({ total: "7.50", taxTotal: "0.36" });
    const o = (await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "TAKEAWAY", lines: [{ productId: P["BRG-CLASSIC"].id, quantity: 1 }], idempotencyKey: key() })).body;
    const moved = await call(cashierT, "POST", `/orders/${o.id}/move-to-seat`, { deviceId: a.identity!.deviceId });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const bill = (await call(cashierT, "GET", `/bills/${(await call(cashierT, "GET", `/sessions/${s.id}`)).body.bill.id}`)).body;
    expect(bill.orders.some((x: any) => x.id === o.id)).toBe(true);
    expect((await call(cashierT, "GET", `/bills/${o.bill.id}`)).body.total).toBe("0.00");
    expect((await call(cashierT, "POST", `/orders/${o.id}/move-to-seat`, { deviceId: a.identity!.deviceId })).body.error).toBe("already_on_bill");
    await call(cashierT, "POST", `/sessions/${s.id}/end`, { reason: "t" });
  });

  describe("voids, cancels, refunds", () => {
    it("void before the kitchen starts is fine; after, only a manager (with a reason) can", async () => {
      const t5 = tables.find((t) => t.name === "T5");
      const o = (await order(waiterT, { type: "DINE_IN", tableId: t5.id, lines: [{ productId: P["SNK-WINGS"].id, quantity: 1 }, { productId: P["SNK-NACHOS"].id, quantity: 1 }] })).body;
      const [wings, nachos] = o.items;
      const v = await call(cashierT, "POST", `/order-items/${wings.id}/void`, { reason: "changed mind" });
      expect(v.status, JSON.stringify(v.body)).toBe(200);
      expect(v.body.total).toBe("24.00");
      const tk = (await call(kitchenT, "GET", `/branches/${dxb1}/kitchen`)).body.tickets.find((t: any) => t.order.id === o.id);
      await call(kitchenT, "POST", `/kitchen-tickets/${tk.id}/bump`, { to: "PREPARING" });
      expect((await call(cashierT, "POST", `/order-items/${nachos.id}/void`, { reason: "too slow" })).body.error).toBe("already_prepared");
      expect((await call(managerT, "POST", `/order-items/${nachos.id}/void`, { reason: "burnt" })).status).toBe(403); // sensitive: no reason header
      expect((await call(managerT, "POST", `/order-items/${nachos.id}/void`, { reason: "burnt" }, "burnt in the oven")).status).toBe(200);
      expect((await call(waiterT, "GET", `/orders/${o.id}`)).body.status).toBe("CANCELLED"); // nothing left on it
    });

    it("refunds: to the wallet for a customer, cash out of the refunder's shift; never more than was paid", async () => {
      const cust = (await call(cashierT, "POST", "/customers", { username: `r${randomUUID().slice(0, 8)}`, displayName: "Refund Me", password: "secret123" })).body;
      await ensureShift(cashierT);
      const o = (await order(cashierT, { type: "COUNTER", customerId: cust.id, lines: [{ productId: P["DRK-WATER"].id, quantity: 4 }], payments: [{ method: "CASH", tendered: "20" }] })).body;
      const payment = (await call(cashierT, "GET", `/bills/${o.bill.id}`)).body.payments[0];
      expect((await call(cashierT, "POST", `/payments/${payment.id}/refund`, { amount: "5", reason: "flat water", idempotencyKey: key() }, "x")).status).toBe(403); // cashier can't refund
      expect((await call(managerT, "POST", `/payments/${payment.id}/refund`, { amount: "50", destination: "WALLET", reason: "too much", idempotencyKey: key() }, "test")).body.error).toBe("bad_amount");
      const toWallet = await call(managerT, "POST", `/payments/${payment.id}/refund`, { amount: "5", destination: "WALLET", reason: "one was flat", idempotencyKey: key() }, "flat");
      expect(toWallet.status, JSON.stringify(toWallet.body)).toBe(201);
      expect((await call(ownerT, "GET", `/customers/${cust.id}/wallet`)).body.cash).toBe("5.00");
      expect((await call(managerT, "POST", `/payments/${payment.id}/refund`, { amount: "5", destination: "CASH", reason: "another", idempotencyKey: key() }, "another flat bottle")).body.error).toBe("no_open_shift");
      const mshift = await ensureShift(managerT, "100");
      expect((await call(managerT, "POST", `/payments/${payment.id}/refund`, { amount: "5", destination: "CASH", reason: "another flat", idempotencyKey: key() }, "flat")).status).toBe(201);
      expect(Number((await call(managerT, "GET", `/shifts/${mshift.id}`)).body.expectedCash)).toBe(95);
      // A refund after settling is a return: the bill stays settled, nothing is owed again, the refund is reported as such.
      expect((await call(cashierT, "GET", `/bills/${o.bill.id}`)).body).toMatchObject({ paidTotal: "20.00", status: "SETTLED", due: "0.00" });
    });

    it("two tills paying the same bill at once: one payment, the other is told it's paid", async () => {
      const o = (await order(cashierT, { type: "COUNTER", lines: [{ productId: P["DRK-COLA"].id, quantity: 1 }] })).body;
      const pay = () => call(cashierT, "POST", `/bills/${o.bill.id}/pay`, { payments: [{ method: "CARD" }], idempotencyKey: key() });
      const results = await Promise.all([pay(), pay(), pay()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      const pays = await owner.query(`SELECT amount FROM "Payment" WHERE "billId" = $1`, [o.bill.id]);
      expect(pays.rows).toHaveLength(1);
      expect((await call(cashierT, "GET", `/bills/${o.bill.id}`)).body).toMatchObject({ paidTotal: "8.00", status: "SETTLED" });
    });
  });

  describe("shifts", () => {
    it("closing with a big variance waits for a manager; a small one closes; nobody approves their own", async () => {
      const shift = await ensureShift(cashierT, "300");
      await call(cashierT, "POST", `/shifts/${shift.id}/movements`, { type: "PAY_OUT", amount: "20", reason: "ice delivery" });
      const x = (await call(cashierT, "GET", `/shifts/${shift.id}`)).body;
      const expected = Number(x.expectedCash);
      const closed = (await call(cashierT, "POST", `/shifts/${shift.id}/close`, { countedCash: String(expected - 12), denominations: { "100": 2, "50": 1 } })).body;
      expect(closed).toMatchObject({ status: "PENDING_APPROVAL", variance: "-12.00" });
      expect((await call(cashierT, "POST", `/shifts/${shift.id}/approve`, { note: "ok" }, "mine")).status).toBe(403);
      const ok = await call(managerT, "POST", `/shifts/${shift.id}/approve`, { note: "counted twice" }, "short change");
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ status: "APPROVED", approvedBy: "Mo Manager" });

      const again = await ensureShift(cashierT, "100");
      const small = (await call(cashierT, "POST", `/shifts/${again.id}/close`, { countedCash: String(Number(again.expectedCash) + 2) })).body;
      expect(small).toMatchObject({ status: "CLOSED", variance: "2.00" });
    });
  });

  describe("isolation", () => {
    it("another organization can't see or touch bills, orders, tickets or shifts", async () => {
      const t6 = tables.find((t) => t.name === "T6");
      const o = (await order(waiterT, { type: "DINE_IN", tableId: t6.id, lines: [{ productId: P["DRK-COLA"].id, quantity: 1 }] })).body;
      expect((await call(rivalT, "GET", `/bills/${o.bill.id}`)).status).toBe(404);
      expect((await call(rivalT, "GET", `/orders/${o.id}`)).status).toBe(404);
      for (const path of ["/bills/abc", "/orders/abc", "/customers/abc", "/shifts/not-a-uuid"]) expect((await call(ownerT, "GET", path)).status, path).toBe(404);
      expect((await call(rivalT, "POST", `/bills/${o.bill.id}/pay`, { payments: [{ method: "CARD" }], idempotencyKey: key() })).status).toBe(404);
      expect((await call(rivalT, "GET", `/branches/${dxb1}/kitchen`)).status).toBe(404);
      expect((await call(rivalT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", lines: [{ productId: P["DRK-COLA"].id, quantity: 1 }], idempotencyKey: key() })).status).toBe(404);
    });
  });
});
