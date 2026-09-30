// Phase 8 end-to-end: warehouses and visibility, sales consuming recipes and
// stock items, voids putting stock back, stock-based "sold out", waste /
// adjust / transfer / count, a concurrency race, the append-only ledger,
// purchase orders (approval, partial receipt, over-receipt, replay), supplier
// invoices, reorder suggestions, recipe costing and tenant isolation —
// against real Postgres and a listening API.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const key = () => randomUUID();
const tag = () => randomUUID().slice(0, 6).toUpperCase();

describe.skipIf(!HAS_DB)("Inventory, purchasing & suppliers (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  let ownerT: string, managerT: string, cashierT: string, kitchenT: string, invT: string, rivalT: string;
  let dxb1: string;
  const W: Record<string, string> = {}; // warehouses by name
  const I: Record<string, string> = {}; // items by sku
  const P: Record<string, any> = {}; // menu products by sku
  let freshSupplier: string, bevSupplier: string;

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
  const level = async (warehouse: string, itemId: string) => {
    const r = await call(ownerT, "GET", `/warehouses/${W[warehouse]}/stock`);
    return Number(r.body.rows.find((x: any) => x.itemId === itemId)?.quantity ?? 0);
  };
  const order = (lines: unknown[]) => call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", lines, idempotencyKey: key() });
  /** A fresh item with some stock in a warehouse (received through a PO like real stock). */
  const newItem = async (store: string, qty: number, extra: Record<string, unknown> = {}) => {
    const sku = `T-${tag()}`;
    const it = await call(invT, "POST", "/inventory/items", { sku, name: `Test ${sku}`, category: "DRINK", baseUnit: "pcs", purchaseUnit: "case", purchaseUnitQty: 6, minStock: 4, defaultSupplierId: bevSupplier, ...extra });
    expect(it.status, JSON.stringify(it.body)).toBe(201);
    if (qty > 0) {
      const po = await call(managerT, "POST", "/purchase-orders", { supplierId: bevSupplier, warehouseId: W[store], lines: [{ itemId: it.body.id, quantity: qty, unitCost: "2" }] });
      expect(po.status, JSON.stringify(po.body)).toBe(201);
      await call(managerT, "POST", `/purchase-orders/${po.body.id}/submit`);
      const r = await call(managerT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: qty }], idempotencyKey: key() });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    return it.body.id as string;
  };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, managerT, cashierT, kitchenT, invT, rivalT] = (await Promise.all(["owner@demo.test", "manager@demo.test", "cashier@demo.test", "kitchen@demo.test", "inventory@demo.test", "owner@rival.test"].map(login))) as [string, string, string, string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    for (const w of (await call(ownerT, "GET", "/warehouses")).body) W[w.name] = w.id;
    for (const i of (await call(ownerT, "GET", "/inventory/items")).body) I[i.sku] = i.id;
    const menu = (await call(cashierT, "GET", `/branches/${dxb1}/menu`)).body;
    for (const c of menu.categories) for (const p of c.products) P[p.sku] = p;
    const sups = (await call(ownerT, "GET", "/suppliers")).body as any[];
    freshSupplier = sups.find((s) => s.name === "Gulf Fresh Foods").id;
    bevSupplier = sups.find((s) => s.name === "Emirates Beverages").id;
  });

  afterAll(async () => {
    await app?.close();
    await owner.end();
  });

  describe("visibility", () => {
    it("the owner sees every store with its value; kitchen staff see only their branch; a cashier sees none", async () => {
      expect(Object.keys(W)).toEqual(expect.arrayContaining(["Central warehouse", "Kitchen store", "Bar store", "Tech store", "Main store"]));
      const k = await call(kitchenT, "GET", "/warehouses");
      expect(k.status).toBe(200);
      expect(k.body.map((w: any) => w.name)).not.toContain("Central warehouse");
      expect(k.body.map((w: any) => w.name)).toContain("Kitchen store");
      expect((await call(kitchenT, "GET", `/warehouses/${W["Central warehouse"]}/stock`)).status).toBe(403);
      expect((await call(cashierT, "GET", "/inventory/overview")).status).toBe(403);
    });

    it("the overview flags low stock and a batch close to expiry", async () => {
      // Own data: other suites sell and restock the seeded items.
      const low = await newItem("Bar store", 2); // min 4
      const perishable = await newItem("Bar store", 0, { trackExpiry: true });
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const r = await call(invT, "POST", `/warehouses/${W["Bar store"]}/adjust`, { itemId: perishable, type: "ADJUSTMENT", quantity: "5", unitCost: "1", lot: { lotCode: "B-1", expiresAt: tomorrow }, reason: "found a crate", idempotencyKey: key() }, "found a crate");
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const o = (await call(ownerT, "GET", "/inventory/overview")).body;
      expect(o.alerts.find((a: any) => a.itemId === low)).toMatchObject({ status: "LOW", quantity: "2" });
      expect(o.expiring.find((l: any) => l.itemId === perishable)).toMatchObject({ lotCode: "B-1", quantity: "5", expired: false });
    });
  });

  describe("sales take stock out", () => {
    it("a burger uses its recipe and chosen options from the kitchen store; a can comes out of the bar store", async () => {
      const cheese = P["BRG-CLASSIC"].modifierGroups.find((g: any) => g.name === "Extras").modifiers.find((m: any) => m.name === "Cheese").id;
      const before = { bun: await level("Kitchen store", I["INV-BUN"]!), patty: await level("Kitchen store", I["INV-PATTY"]!), cheddar: await level("Kitchen store", I["INV-CHEDDAR"]!), cola: await level("Bar store", I["INV-COLA"]!) };
      const r = await order([{ productId: P["BRG-CLASSIC"].id, quantity: 2, modifierIds: [cheese] }, { productId: P["DRK-COLA"].id, quantity: 3 }]);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(await level("Kitchen store", I["INV-BUN"]!)).toBe(before.bun - 2);
      expect(await level("Kitchen store", I["INV-PATTY"]!)).toBe(before.patty - 4);
      expect(await level("Kitchen store", I["INV-CHEDDAR"]!)).toBe(before.cheddar - 4); // 1 in the recipe + 1 extra, × 2
      expect(await level("Bar store", I["INV-COLA"]!)).toBe(before.cola - 3);
      const moves = (await call(ownerT, "GET", `/warehouses/${W["Bar store"]}/movements?itemId=${I["INV-COLA"]}`)).body;
      expect(moves[0]).toMatchObject({ type: "SALE", quantity: "-3", reference: { type: "ORDER_ITEM" } });
    });

    it("a retried order doesn't take stock twice", async () => {
      const before = await level("Bar store", I["INV-WATER"]!);
      const k = key();
      const body = { type: "COUNTER", lines: [{ productId: P["DRK-WATER"].id, quantity: 2 }], idempotencyKey: k };
      const a = await call(cashierT, "POST", `/branches/${dxb1}/orders`, body);
      const b = await call(cashierT, "POST", `/branches/${dxb1}/orders`, body);
      expect(b.body.id).toBe(a.body.id);
      expect(await level("Bar store", I["INV-WATER"]!)).toBe(before - 2);
    });

    it("voiding before the kitchen starts puts the ingredients back; once cooking, they stay used", async () => {
      const before = await level("Kitchen store", I["INV-DOUGH"]!);
      const o = await order([{ productId: P["PZA-MARG"].id, quantity: 1, modifierIds: [P["PZA-MARG"].modifierGroups[0].modifiers[0].id] }, { productId: P["PZA-PEPP"].id, quantity: 1, modifierIds: [P["PZA-PEPP"].modifierGroups[0].modifiers[0].id] }]);
      expect(o.status, JSON.stringify(o.body)).toBe(201);
      expect(await level("Kitchen store", I["INV-DOUGH"]!)).toBe(before - 2);
      const [marg, pepp] = o.body.items;
      expect((await call(cashierT, "POST", `/order-items/${marg.id}/void`, { reason: "changed mind" })).status).toBe(200);
      expect(await level("Kitchen store", I["INV-DOUGH"]!)).toBe(before - 1);
      // The kitchen starts the other one; voiding it now doesn't return the dough.
      expect((await call(kitchenT, "POST", `/kitchen-tickets/${pepp.kitchenTicketId}/bump`, { to: "PREPARING" })).status).toBe(200);
      expect((await call(managerT, "POST", `/order-items/${pepp.id}/void`, { reason: "customer left" }, "customer left")).status).toBe(200);
      expect(await level("Kitchen store", I["INV-DOUGH"]!)).toBe(before - 1);
    });

    it("a ready item runs out: the menu shows it sold out and the till refuses more than is left", async () => {
      const item = await newItem("Bar store", 2);
      const cat = (await call(ownerT, "GET", "/menu/manage")).body.categories.find((c: any) => c.name === "Drinks").id;
      const bar = (await call(ownerT, "GET", "/menu/manage")).body.stations.find((s: any) => s.name === "Bar" && s.branchId === dxb1).id;
      const prod = await call(ownerT, "POST", "/products", { categoryId: cat, name: `Test soda ${tag()}`, type: "STOCK_ITEM", price: "6", taxAppliesTo: "BEVERAGE", kitchenStationId: bar });
      expect(prod.status).toBe(201);
      expect((await call(ownerT, "PUT", `/products/${prod.body.id}/recipe`, { inventoryItemId: item, lines: [] })).status).toBe(200);
      const tooMany = await order([{ productId: prod.body.id, quantity: 3 }]);
      expect(tooMany.status).toBe(409);
      expect(tooMany.body).toMatchObject({ error: "sold_out", left: 2 });
      expect((await order([{ productId: prod.body.id, quantity: 2 }])).status).toBe(201);
      const menu = (await call(cashierT, "GET", `/branches/${dxb1}/menu`)).body;
      const p = menu.categories.flatMap((c: any) => c.products).find((x: any) => x.id === prod.body.id);
      expect(p.available).toBe(false);
    });
  });

  describe("stock operations", () => {
    it("waste needs a reason, can't exceed what's there, and is valued at average cost", async () => {
      const item = await newItem("Kitchen store", 10);
      const w = W["Kitchen store"];
      expect((await call(invT, "POST", `/warehouses/${w}/adjust`, { itemId: item, type: "WASTE", quantity: "3", reason: "dropped tray", idempotencyKey: key() })).body.reason).toBe("REASON_REQUIRED");
      const over = await call(invT, "POST", `/warehouses/${w}/adjust`, { itemId: item, type: "WASTE", quantity: "11", reason: "dropped tray", idempotencyKey: key() }, "dropped tray");
      expect(over.status).toBe(409);
      expect(over.body.error).toBe("insufficient_stock");
      const ok = await call(invT, "POST", `/warehouses/${w}/adjust`, { itemId: item, type: "WASTE", quantity: "3", reason: "dropped tray", idempotencyKey: key() }, "dropped tray");
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body).toMatchObject({ quantity: "-3", quantityAfter: "7", value: "-6.00" });
    });

    it("two people wasting at once can't take more than is there", async () => {
      const item = await newItem("Kitchen store", 10);
      const w = W["Kitchen store"];
      const tries = await Promise.all([1, 2, 3].map(() => call(invT, "POST", `/warehouses/${w}/adjust`, { itemId: item, type: "WASTE", quantity: "6", reason: "race test", idempotencyKey: key() }, "race test")));
      expect(tries.filter((t) => t.status === 201)).toHaveLength(1);
      expect(await level("Kitchen store", item)).toBe(4);
    });

    it("a transfer moves stock at its cost, all or nothing", async () => {
      const item = await newItem("Main store", 12);
      const t = await call(invT, "POST", "/inventory/transfers", { fromWarehouseId: W["Main store"], toWarehouseId: W["Bar store"], lines: [{ itemId: item, quantity: "5" }], note: "restock bar", idempotencyKey: key() });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      expect(t.body.lines[0]).toMatchObject({ quantity: "5", value: "10.00" });
      expect(await level("Main store", item)).toBe(7);
      expect(await level("Bar store", item)).toBe(5);
      // Second line can't be covered → the first line doesn't move either.
      const other = await newItem("Main store", 1);
      const bad = await call(invT, "POST", "/inventory/transfers", { fromWarehouseId: W["Main store"], toWarehouseId: W["Bar store"], lines: [{ itemId: item, quantity: "2" }, { itemId: other, quantity: "5" }], idempotencyKey: key() });
      expect(bad.status).toBe(409);
      expect(await level("Main store", item)).toBe(7);
    });

    it("a stock count sets the shelf quantity and records the difference", async () => {
      const item = await newItem("Bar store", 20);
      const c = await call(invT, "POST", `/warehouses/${W["Bar store"]}/counts`, { lines: [{ itemId: item, counted: "17" }], note: "Monday count", idempotencyKey: key() });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect(c.body.lines[0]).toMatchObject({ expected: "20", counted: "17", difference: "-3", value: "-6.00" });
      expect(c.body.itemsOff).toBe(1);
      expect(await level("Bar store", item)).toBe(17);
    });

    it("gear is issued to a PC by serial number (earliest received first)", async () => {
      const headsets = await newItem("Tech store", 0, { category: "HEADSET", trackSerial: true, purchaseUnitQty: 1 });
      const po = await call(managerT, "POST", "/purchase-orders", { supplierId: bevSupplier, warehouseId: W["Tech store"], lines: [{ itemId: headsets, quantity: "2", unitCost: "180" }] });
      await call(managerT, "POST", `/purchase-orders/${po.body.id}/submit`);
      const [first, second] = [`HS-${tag()}`, `HS-${tag()}`];
      await call(managerT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: "2", serialNumbers: [first, second] }], idempotencyKey: key() });
      const dev = (await call(ownerT, "GET", `/branches/${dxb1}/floor`)).body.devices[0].id;
      const r = await call(managerT, "POST", `/warehouses/${W["Tech store"]}/adjust`, { itemId: headsets, type: "ISSUE_TO_STATION", quantity: "1", deviceId: dev, reason: "replacement for broken one", idempotencyKey: key() }, "replacement for broken one");
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(await level("Tech store", headsets)).toBe(1);
      const left = (await call(ownerT, "GET", `/inventory/items/${headsets}`)).body.lots;
      expect(left.map((l: any) => l.serialNumber)).toEqual([second]);
      const moves = (await call(ownerT, "GET", `/warehouses/${W["Tech store"]}/movements?itemId=${headsets}&type=ISSUE_TO_STATION`)).body;
      expect(moves[0]).toMatchObject({ quantity: "-1", reference: { type: "DEVICE", id: dev } });
    });

    it("the stock ledger is append-only in the database", async () => {
      const id = (await owner.query(`SELECT id FROM "StockMovement" LIMIT 1`)).rows[0].id;
      await expect(owner.query(`UPDATE "StockMovement" SET reason = 'tamper' WHERE id = $1`, [id])).rejects.toThrow(/append-only/);
      await expect(owner.query(`DELETE FROM "StockMovement" WHERE id = $1`, [id])).rejects.toThrow(/append-only/);
    });
  });

  describe("purchasing", () => {
    it("draft → approved (small) → ordered → part received → over-receipt refused → replay ignored → received; average cost moves", async () => {
      const item = await newItem("Bar store", 10); // 10 at 2.00
      const po = await call(invT, "POST", "/purchase-orders", { supplierId: bevSupplier, warehouseId: W["Bar store"], expectedAt: "2030-01-10", lines: [{ itemId: item, quantity: "20", unitCost: "4", taxRatePercent: "5" }] });
      expect(po.status, JSON.stringify(po.body)).toBe(201);
      expect(po.body).toMatchObject({ status: "DRAFT", subtotal: "80.00", taxTotal: "4.00", total: "84.00" });
      expect(po.body.number).toMatch(/^PO-\d{4}-\d{4}$/);
      expect((await call(invT, "POST", `/purchase-orders/${po.body.id}/submit`)).body.status).toBe("APPROVED");
      expect((await call(invT, "POST", `/purchase-orders/${po.body.id}/ordered`)).body.status).toBe("ORDERED");
      const line = po.body.lines[0].id;
      const k = key();
      const part = await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: line, quantity: "10" }], idempotencyKey: k });
      expect(part.body.status).toBe("PARTIALLY_RECEIVED");
      expect((await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: line, quantity: "10" }], idempotencyKey: k })).body.lines[0].quantityReceived).toBe("10");
      const over = await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: line, quantity: "11" }], idempotencyKey: key() });
      expect(over.status).toBe(409);
      expect(over.body.error).toBe("over_receipt");
      const done = await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: line, quantity: "10" }], idempotencyKey: key() });
      expect(done.body.status).toBe("RECEIVED");
      expect(await level("Bar store", item)).toBe(30);
      const it = (await call(invT, "GET", `/inventory/items/${item}`)).body;
      expect(it.averageCost).toBe("3.3333"); // (10×2 + 20×4) / 30
      expect(it.lastPurchaseCost).toBe("4.0000");
    });

    it("a big order needs someone else's approval, with a reason", async () => {
      const item = await newItem("Bar store", 0);
      const po = await call(invT, "POST", "/purchase-orders", { supplierId: bevSupplier, warehouseId: W["Bar store"], lines: [{ itemId: item, quantity: "1000", unitCost: "5" }] });
      expect((await call(invT, "POST", `/purchase-orders/${po.body.id}/submit`)).body.status).toBe("PENDING_APPROVAL");
      expect((await call(invT, "POST", `/purchase-orders/${po.body.id}/approve`, { approve: true }, "within budget")).body.error).toBe("cannot_approve_own_po");
      expect((await call(managerT, "POST", `/purchase-orders/${po.body.id}/approve`, { approve: true })).body.reason).toBe("REASON_REQUIRED");
      const ok = await call(managerT, "POST", `/purchase-orders/${po.body.id}/approve`, { approve: true }, "weekend tournament stock");
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ status: "APPROVED", approvedBy: "Mo Manager" });
      // Nothing received yet → it can still be cancelled.
      expect((await call(invT, "POST", `/purchase-orders/${po.body.id}/cancel`, { reason: "supplier out of stock" })).body.status).toBe("CANCELLED");
    });

    it("serial-tracked gear is received one serial at a time", async () => {
      const item = await newItem("Tech store", 0, { category: "CONTROLLER", trackSerial: true, purchaseUnitQty: 1 });
      const po = await call(managerT, "POST", "/purchase-orders", { supplierId: bevSupplier, warehouseId: W["Tech store"], lines: [{ itemId: item, quantity: "2", unitCost: "150" }] });
      await call(managerT, "POST", `/purchase-orders/${po.body.id}/submit`);
      const bad = await call(managerT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: "2", serialNumbers: ["SN-1"] }], idempotencyKey: key() });
      expect(bad.status).toBe(400);
      const ok = await call(managerT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: "2", serialNumbers: [`SN-${tag()}`, `SN-${tag()}`] }], idempotencyKey: key() });
      expect(ok.body.status).toBe("RECEIVED");
      const it = (await call(ownerT, "GET", `/inventory/items/${item}`)).body;
      expect(it.lots).toHaveLength(2);
      expect(it.lots.every((l: any) => l.serialNumber && l.quantity === "1")).toBe(true);
    });

    it("supplier invoice: matched against what was received, paid in parts, never overpaid, never entered twice", async () => {
      const item = await newItem("Kitchen store", 0);
      const po = await call(invT, "POST", "/purchase-orders", { supplierId: freshSupplier, warehouseId: W["Kitchen store"], lines: [{ itemId: item, quantity: "10", unitCost: "10", taxRatePercent: "5" }] });
      await call(invT, "POST", `/purchase-orders/${po.body.id}/submit`);
      await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: "10" }], idempotencyKey: key() });
      const num = `INV-${tag()}`;
      const inv = await call(invT, "POST", "/supplier-invoices", { supplierId: freshSupplier, purchaseOrderId: po.body.id, invoiceNumber: num, invoiceDate: "2026-09-20", amount: "100", taxAmount: "5" });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      expect(inv.body).toMatchObject({ total: "105.00", status: "UNPAID", match: { status: "MATCHED" } });
      expect(inv.body.dueDate.slice(0, 10)).toBe("2026-10-20"); // 30-day terms
      expect((await call(invT, "POST", "/supplier-invoices", { supplierId: freshSupplier, invoiceNumber: num, invoiceDate: "2026-09-20", amount: "1" })).body.error).toBe("invoice_duplicate");
      expect((await call(invT, "POST", `/supplier-invoices/${inv.body.id}/pay`, { amount: "50", method: "BANK_TRANSFER", reference: "TT-1" })).body.status).toBe("PARTIALLY_PAID");
      expect((await call(invT, "POST", `/supplier-invoices/${inv.body.id}/pay`, { amount: "60", method: "BANK_TRANSFER" })).body.error).toBe("bad_amount");
      expect((await call(invT, "POST", `/supplier-invoices/${inv.body.id}/pay`, { amount: "55", method: "BANK_TRANSFER" })).body).toMatchObject({ status: "PAID", due: "0.00" });
      const over = await call(invT, "POST", "/supplier-invoices", { supplierId: freshSupplier, purchaseOrderId: po.body.id, invoiceNumber: `INV-${tag()}`, invoiceDate: "2026-09-20", amount: "120", taxAmount: "6" });
      expect(over.body.match.status).toBe("OVER");
    });

    it("receiving a delivery can bill it: one invoice per delivery, at the received cost, and they add up to a match", async () => {
      const item = await newItem("Kitchen store", 0);
      const po = await call(invT, "POST", "/purchase-orders", { supplierId: freshSupplier, warehouseId: W["Kitchen store"], lines: [{ itemId: item, quantity: "10", unitCost: "10", taxRatePercent: "5" }] });
      await call(invT, "POST", `/purchase-orders/${po.body.id}/submit`);
      const line = po.body.lines[0].id;
      const first = await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: line, quantity: "4" }], idempotencyKey: key(), invoice: {} });
      expect(first.body.invoices, JSON.stringify(first.body)).toMatchObject([{ invoiceNumber: po.body.number, amount: "40.00", taxAmount: "2.00" }]);
      const second = await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: line, quantity: "6" }], idempotencyKey: key(), invoice: {} });
      expect(second.body.invoices.map((i: any) => i.invoiceNumber).sort()).toEqual([po.body.number, `${po.body.number}-2`]);
      const invs = (await call(invT, "GET", `/supplier-invoices?supplierId=${freshSupplier}`)).body.filter((i: any) => i.purchaseOrder?.id === po.body.id);
      expect(invs.every((i: any) => i.match.status === "MATCHED")).toBe(true);
    });

    it("records: only owner/admin delete; unused rows go, used rows are archived", async () => {
      const unused = await call(ownerT, "POST", "/suppliers", { name: `Temp ${tag()}` });
      expect((await call(invT, "DELETE", `/records/supplier/${unused.body.id}`, undefined, "cleanup")).status).toBe(403);
      const noReason = await call(ownerT, "DELETE", `/records/supplier/${unused.body.id}`);
      expect(noReason.body.reason).toBe("REASON_REQUIRED");
      expect((await call(ownerT, "DELETE", `/records/supplier/${unused.body.id}`, undefined, "cleanup")).body).toEqual({ result: "deleted" });
      const used = await call(ownerT, "POST", "/suppliers", { name: `Used ${tag()}` });
      await call(invT, "POST", "/purchase-orders", { supplierId: used.body.id, warehouseId: W["Kitchen store"], lines: [{ itemId: await newItem("Kitchen store", 0), quantity: "1", unitCost: "1" }] });
      expect((await call(ownerT, "DELETE", `/records/supplier/${used.body.id}`, undefined, "cleanup")).body).toEqual({ result: "archived" });
      expect((await call(ownerT, "GET", "/suppliers")).body.find((s: any) => s.id === used.body.id).isActive).toBe(false);
      expect((await call(ownerT, "DELETE", `/records/nope/${used.body.id}`, undefined, "cleanup")).status).toBe(404);
    });

    it("mistakes: draft POs can be deleted; received goods can be returned to the supplier", async () => {
      const item = await newItem("Kitchen store", 0);
      const draft = await call(invT, "POST", "/purchase-orders", { supplierId: freshSupplier, warehouseId: W["Kitchen store"], lines: [{ itemId: item, quantity: "5", unitCost: "2" }] });
      expect((await call(ownerT, "DELETE", `/records/purchase-order/${draft.body.id}`, undefined, "typo")).body).toEqual({ result: "deleted" });

      const po = await call(invT, "POST", "/purchase-orders", { supplierId: freshSupplier, warehouseId: W["Kitchen store"], lines: [{ itemId: item, quantity: "10", unitCost: "2" }] });
      await call(invT, "POST", `/purchase-orders/${po.body.id}/submit`);
      expect((await call(ownerT, "DELETE", `/records/purchase-order/${po.body.id}`, undefined, "typo")).body.error).toBe("po_not_draft");
      const line = po.body.lines[0].id;
      await call(invT, "POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: line, quantity: "10" }], idempotencyKey: key() });
      expect((await call(invT, "POST", `/purchase-orders/${po.body.id}/return`, { lines: [{ lineId: line, quantity: "11" }], reason: "counted wrong", idempotencyKey: key() })).body.error).toBe("over_return");
      const k = key();
      const back = await call(invT, "POST", `/purchase-orders/${po.body.id}/return`, { lines: [{ lineId: line, quantity: "4" }], reason: "counted wrong", idempotencyKey: k });
      expect(back.body, JSON.stringify(back.body)).toMatchObject({ status: "PARTIALLY_RECEIVED", lines: [{ quantityReceived: "6", outstanding: "4" }] });
      await call(invT, "POST", `/purchase-orders/${po.body.id}/return`, { lines: [{ lineId: line, quantity: "4" }], reason: "counted wrong", idempotencyKey: k }); // replay: no-op
      const stock = (await call(ownerT, "GET", `/warehouses/${W["Kitchen store"]}/stock`)).body.rows.find((r: any) => r.itemId === item);
      expect(Number(stock.quantity)).toBe(6);
    });

    it("reorder suggestions become one draft PO per supplier", async () => {
      const item = await newItem("Bar store", 2); // min 4, case of 6 → suggest 6 (to reach 8)
      const s = (await call(invT, "GET", `/warehouses/${W["Bar store"]}/reorder`)).body;
      expect(s.find((x: any) => x.itemId === item)).toMatchObject({ onHand: "2", suggested: "6", supplier: { name: "Emirates Beverages" } });
      const d = await call(invT, "POST", "/purchasing/reorder", { warehouseId: W["Bar store"], itemIds: [item] });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      expect(d.body.created).toHaveLength(1);
      // Now it's on order → no longer suggested.
      expect((await call(invT, "GET", `/warehouses/${W["Bar store"]}/reorder`)).body.find((x: any) => x.itemId === item)).toBeUndefined();
    });
  });

  describe("recipes & costing", () => {
    it("a menu item's food cost comes from its recipe at average cost", async () => {
      const r = (await call(ownerT, "GET", `/products/${P["BRG-CLASSIC"].id}/recipe`)).body;
      expect(r.lines.map((l: any) => l.name)).toEqual(expect.arrayContaining(["Burger bun", "Beef patty 120 g", "Cheddar slice"]));
      expect(Number(r.cost)).toBeGreaterThan(9);
      const c = (await call(ownerT, "GET", `/menu/costing?branchId=${dxb1}`)).body as any[];
      const burger = c.find((x) => x.productId === P["BRG-CLASSIC"].id);
      expect(burger.costed).toBe(true);
      expect(Number(burger.foodCostPct)).toBeGreaterThan(20);
      expect(burger.netPrice).toBe("30.48"); // 32 incl. 5 % VAT
      expect(c.find((x) => x.productId === P["SNK-FRIES"].id).cost).toBe("2.52"); // 200 g + 5 % waste at 0.012
    });

    it("only a ready item can link 1:1 to a stock item", async () => {
      const r = await call(ownerT, "PUT", `/products/${P["BRG-CLASSIC"].id}/recipe`, { inventoryItemId: I["INV-COLA"], lines: [] });
      expect(r.body.error).toBe("stock_link_needs_stock_item");
    });
  });

  describe("isolation", () => {
    it("another organization can't see or touch this one's stock", async () => {
      expect((await call(rivalT, "GET", `/warehouses/${W["Bar store"]}/stock`)).status).toBe(404);
      expect((await call(rivalT, "GET", `/inventory/items/${I["INV-COLA"]}`)).status).toBe(404);
      expect(((await call(rivalT, "GET", "/inventory/items")).body as any[]).some((i) => i.sku === "INV-COLA")).toBe(false);
    });

    it("purchasing is a plan feature — the rival's Starter plan doesn't have it", async () => {
      const r = await call(rivalT, "POST", "/suppliers", { name: "Nope Ltd" });
      expect(r.status).toBe(403);
      expect(r.body.reason).toBe("FEATURE_DISABLED");
    });
  });
});
