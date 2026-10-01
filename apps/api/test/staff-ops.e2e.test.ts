// Staff day-to-day: clocking in/out and attendance, handover notes, switching
// the counter PC to a colleague by PIN, marking a station out of order, the
// cash-difference alert, player feedback from the Shell, the owner's day
// summary and phone search — against real Postgres, a listening API and a sim PC.
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
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe.skipIf(!HAS_DB)("Staff operations (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const agents: SimAgent[] = [];
  let ownerT: string, managerT: string, cashierT: string, waiterT: string, rivalT: string;
  let dxb1: string, regularZone: string, psZone: string, regularPlan: string;

  const call = async (token: string, method: string, path: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const signIn = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()) as { accessToken: string; refreshToken: string };
  const login = async (email: string) => (await signIn(email)).accessToken;

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    // Leftovers from earlier runs.
    await owner.query(`UPDATE "TimeClockEntry" SET "clockOutAt" = now() WHERE "clockOutAt" IS NULL`);
    await owner.query(`UPDATE "Shift" SET status = 'CLOSED', "closedAt" = now() WHERE status = 'OPEN'`);
    await owner.query(`UPDATE "User" SET "failedLogins" = 0, "lockedUntil" = NULL`);
    [ownerT, managerT, cashierT, waiterT, rivalT] = (await Promise.all(["owner@demo.test", "manager@demo.test", "cashier@demo.test", "waiter@demo.test", "owner@rival.test"].map(login))) as [string, string, string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    const zones = (await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[];
    regularZone = zones.find((z) => z.type === "PC_STANDARD").id;
    psZone = zones.find((z) => z.type === "CONSOLE").id;
    regularPlan = ((await call(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.name === "Regular PC").id;
    await owner.query(`UPDATE "Device" SET "isEnabled" = false WHERE "agentVersion" = '0.1.0-sim' AND "branchId" = $1`, [dxb1]);
  }, 90_000);

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
    await owner.end();
  });

  it("clock in once, clock out, and the manager sees the hours; a waiter can't see the sheet", async () => {
    expect((await call(cashierT, "GET", "/clock")).body.open).toBeNull();
    const inn = await call(cashierT, "POST", `/branches/${dxb1}/clock-in`);
    expect(inn.status, JSON.stringify(inn.body)).toBe(200);
    expect(inn.body.open.branch.code).toBe("DXB1");
    expect((await call(cashierT, "POST", `/branches/${dxb1}/clock-in`)).body.error).toBe("already_clocked_in");
    const out = await call(cashierT, "POST", "/clock-out");
    expect(out.status).toBe(200);
    expect(typeof out.body.worked).toBe("number");
    expect((await call(cashierT, "POST", "/clock-out")).body.error).toBe("not_clocked_in");

    const sheet = await call(managerT, "GET", `/branches/${dxb1}/attendance?from=${today()}&to=${today()}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.people.some((p: any) => p.employee.displayName === "Cara Cashier" && p.shifts >= 1)).toBe(true);
    expect((await call(waiterT, "GET", `/branches/${dxb1}/attendance?from=${today()}&to=${today()}`)).status).toBe(403);
    expect((await call(rivalT, "POST", `/branches/${dxb1}/clock-in`)).status).toBe(404);
  });

  it("handover notes: left by one shift, ticked off by the next, invisible to other orgs", async () => {
    const body = `Mouse on PC-07 is broken ${randomUUID().slice(0, 4)}`;
    const n = await call(cashierT, "POST", `/branches/${dxb1}/handover-notes`, { body });
    expect(n.status).toBe(201);
    const list = (await call(waiterT, "GET", `/branches/${dxb1}/handover-notes`)).body as any[];
    expect(list.find((x) => x.id === n.body.id)).toMatchObject({ body, author: "Cara Cashier", resolvedAt: null });
    expect((await call(waiterT, "POST", `/handover-notes/${n.body.id}/resolve`)).status).toBe(200);
    const after = ((await call(cashierT, "GET", `/branches/${dxb1}/handover-notes`)).body as any[]).find((x) => x.id === n.body.id);
    expect(after.resolvedBy).toBe("Wafa Waiter");
    expect((await call(rivalT, "GET", `/branches/${dxb1}/handover-notes`)).status).toBe(404);
    expect((await call(rivalT, "POST", `/handover-notes/${n.body.id}/resolve`)).status).toBe(404);
  });

  it("switch staff by PIN: own PIN needs the password; a wrong PIN fails; the previous person is signed out", async () => {
    expect((await call(cashierT, "POST", "/auth/pin", { password: "wrong-password", pin: "4321" })).status).toBe(422);
    expect((await call(cashierT, "POST", "/auth/pin", { password: DEMO_PASSWORD, pin: "4321" })).status).toBe(204);
    const cashierId = ((await call(ownerT, "GET", "/employees")).body as any[]).find((e) => e.displayName === "Cara Cashier").id;

    const waiter = await signIn("waiter@demo.test");
    const staff = (await call(waiter.accessToken, "GET", "/auth/pin-staff")).body as any[];
    expect(staff.map((s) => s.displayName)).toContain("Cara Cashier");
    expect(Object.keys(staff[0]).sort()).toEqual(["displayName", "id"]);

    expect((await call(waiter.accessToken, "POST", "/auth/pin-switch", { employeeId: cashierId, pin: "0000" })).status).toBe(401);
    expect((await call(waiter.accessToken, "POST", "/auth/pin-switch", { employeeId: randomUUID(), pin: "4321" })).status).toBe(401);
    const sw = await call(waiter.accessToken, "POST", "/auth/pin-switch", { employeeId: cashierId, pin: "4321" });
    expect(sw.status, JSON.stringify(sw.body)).toBe(200);
    const me = (await call(sw.body.accessToken, "GET", "/auth/me")).body;
    expect(me.employee.displayName).toBe("Cara Cashier");
    // The waiter's session on this PC is over.
    const refresh = await fetch(`${base}/v1/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: waiter.refreshToken }) });
    expect(refresh.status).toBe(401);
    // Another org's employee is just a wrong PIN.
    expect((await call(rivalT, "POST", "/auth/pin-switch", { employeeId: cashierId, pin: "4321" })).status).toBe(401);
  });

  it("PIN switch never bypasses 2-step sign-in", async () => {
    await owner.query(`UPDATE "User" SET "mfaRequired" = true WHERE email = 'cashier@demo.test'`);
    try {
      const cashierId = ((await call(ownerT, "GET", "/employees")).body as any[]).find((e) => e.displayName === "Cara Cashier").id;
      const r = await call(await login("waiter@demo.test"), "POST", "/auth/pin-switch", { employeeId: cashierId, pin: "4321" });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("full_sign_in_required");
    } finally {
      await owner.query(`UPDATE "User" SET "mfaRequired" = false WHERE email = 'cashier@demo.test'`);
    }
  });

  it("out of order: no session can start, the reason shows on the floor and on the handover, then back in service", async () => {
    const st = (await call(ownerT, "POST", `/branches/${dxb1}/stations`, { name: `OOO-${randomUUID().slice(0, 4)}`, zoneId: psZone, kind: "CONSOLE", platform: "PS5" })).body;
    expect((await call(cashierT, "POST", `/devices/${st.id}/out-of-order`, { reason: "" })).status).toBe(400);
    const r = await call(cashierT, "POST", `/devices/${st.id}/out-of-order`, { reason: "Controller stick drift" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: "MAINTENANCE", outOfOrder: { reason: "Controller stick drift", by: "Cara Cashier" } });
    expect(r.body.metadata).toBeUndefined();
    const start = await call(cashierT, "POST", `/devices/${st.id}/sessions`, { request: { kind: "minutes", minutes: 60 }, payment: { method: "CASH" }, idempotencyKey: randomUUID() });
    expect(start.body.error).toBe("device_not_available");
    const notes = (await call(cashierT, "GET", `/branches/${dxb1}/handover-notes`)).body as any[];
    expect(notes.some((n) => n.body === `${st.name} is out of order: Controller stick drift`)).toBe(true);
    const back = await call(cashierT, "POST", `/devices/${st.id}/back-in-service`);
    expect(back.body).toMatchObject({ status: "AVAILABLE", outOfOrder: null });
    expect((await call(cashierT, "POST", `/devices/${st.id}/back-in-service`)).body.error).toBe("not_out_of_order");
    const after = (await call(cashierT, "GET", `/branches/${dxb1}/handover-notes`)).body as any[];
    expect(after.find((n) => n.body === `${st.name} is out of order: Controller stick drift`).resolvedBy).toBe("Cara Cashier");
  });

  it("closing a shift far off raises a live cash alert; approving it clears the alert", async () => {
    const drawer = (await call(ownerT, "POST", `/branches/${dxb1}/cash-drawers`, { name: `Till ${randomUUID().slice(0, 4)}` })).body;
    const shift = (await call(cashierT, "POST", `/branches/${dxb1}/shifts`, { cashDrawerId: drawer.id, openingCash: "100" })).body;
    const closed = await call(cashierT, "POST", `/shifts/${shift.id}/close`, { countedCash: "60" });
    expect(closed.body.status).toBe("PENDING_APPROVAL");
    const floor = (await call(managerT, "GET", `/branches/${dxb1}/floor`)).body;
    const alert = floor.alerts.find((a: any) => a.type === "CASH_VARIANCE" && a.detail.shiftId === shift.id);
    expect(alert).toMatchObject({ status: "OPEN", title: expect.stringContaining("short by AED 40.00") });
    const ok = await call(managerT, "POST", `/shifts/${shift.id}/approve`, { note: "counted again" }, "Counted again with the cashier");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const later = (await call(managerT, "GET", `/branches/${dxb1}/floor`)).body;
    expect(later.alerts.some((a: any) => a.id === alert.id)).toBe(false);
  });

  it("a player rates the session from the Shell; the branch sees it and the day summary counts it", async () => {
    const code = (await call(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId: regularZone, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60 });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.isOnline === true);
    const s = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 60 }, payment: { method: "CARD" }, idempotencyKey: randomUUID() });
    expect(s.status, JSON.stringify(s.body)).toBe(201);

    const before = (await call(managerT, "GET", `/branches/${dxb1}/feedback?days=1`)).body.count as number;
    a.send({ type: "session_feedback", rating: 4, comment: "Great PC, a bit loud" });
    await until(async () => (await call(managerT, "GET", `/branches/${dxb1}/feedback?days=1`)).body.count === before + 1);
    a.send({ type: "session_feedback", rating: 5, comment: null }); // changed their mind: still one rating for the session
    await until(async () => (await call(managerT, "GET", `/branches/${dxb1}/feedback?days=1`)).body.recent[0].rating === 5);
    const fb = (await call(managerT, "GET", `/branches/${dxb1}/feedback?days=1`)).body;
    expect(fb.count).toBe(before + 1);
    expect(fb.recent[0]).toMatchObject({ rating: 5, station: expect.any(String), customer: "Guest" });
    expect((await call(waiterT, "GET", `/branches/${dxb1}/feedback`)).status).toBe(403);

    const day = await call(managerT, "GET", `/branches/${dxb1}/day-summary?date=${today()}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect(day.body).toMatchObject({ date: today(), branch: { code: "DXB1" }, currency: "AED" });
    expect(day.body.sessions).toBeGreaterThanOrEqual(1);
    expect(day.body.feedback.count).toBeGreaterThanOrEqual(1);
    expect(Number(day.body.revenue)).toBeGreaterThan(0);
    expect(day.body.topProducts.some((p: any) => p.name.startsWith("Gaming"))).toBe(false);
    expect((await call(cashierT, "GET", `/branches/${dxb1}/day-summary?date=${today()}`)).status).toBe(403);
    expect((await call(cashierT, "POST", `/sessions/${s.body.id}/end`, {})).status).toBe(200);
  });

  it("customer search finds a phone however it was typed", async () => {
    const tail = String(Math.floor(1000 + Math.random() * 8999));
    const c = (await call(cashierT, "POST", "/customers", { username: `p${randomUUID().slice(0, 8)}`, displayName: "Phone Test", password: "secret123", phone: `+971 50 777 ${tail}` })).body;
    for (const q of [`050777${tail}`, `777 ${tail}`, `+97150777${tail}`]) {
      const found = (await call(cashierT, "GET", `/customers?q=${encodeURIComponent(q)}`)).body as any[];
      expect(found.map((x) => x.id), q).toContain(c.id);
    }
  });
});
