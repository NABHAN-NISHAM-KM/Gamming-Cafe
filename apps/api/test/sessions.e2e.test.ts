// Phase 4 end-to-end: sessions, pricing, prepaid time, shell login and the
// MANDATORY server-authoritative expiry flow — against real Postgres, a real
// listening API and simulated agents that verify every signed command.
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

process.env["SESSION_SWEEP_MS"] = "300"; // fast clock for tests
const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
};

describe.skipIf(!HAS_DB)("Sessions, pricing & expiry (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const agents: SimAgent[] = [];
  let ownerT: string, cashierT: string, techT: string, rivalT: string, managerT: string;
  let dxb1: string, regularZone: string, regularPlan: string, payg: string, pkg3h: string;

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

  const newStation = async () => {
    const code = (await call(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId: regularZone, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60 });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.isOnline === true);
    return a;
  };
  const startCash = (token: string, deviceId: string, minutes = 120, key = randomUUID()) =>
    call(token, "POST", `/devices/${deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes }, payment: { method: "CASH" }, idempotencyKey: key });
  const session = async (id: string) => (await call(ownerT, "GET", `/sessions/${id}`)).body;
  const forceExpiry = (sessionId: string, inMs: number) => owner.query(`UPDATE "GamingSession" SET "expiresAt" = now() + ($2 || ' milliseconds')::interval WHERE id = $1`, [sessionId, String(inMs)]);

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT, techT, rivalT, managerT] = (await Promise.all(["owner@demo.test", "cashier@demo.test", "tech@demo.test", "owner@rival.test", "manager@demo.test"].map(login))) as [string, string, string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;
    const plans = (await call(ownerT, "GET", "/pricing-plans")).body as any[];
    const reg = plans.find((p) => p.name === "Regular PC");
    regularPlan = reg.id;
    pkg3h = reg.pricingPackages.find((k: any) => k.name === "3 hours").id;
    payg = plans.find((p) => p.name === "Pay as you go").id;
  }, 90_000);

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
    await owner.end();
  });

  describe("starting a session", () => {
    it("quotes the brief's prices: Regular PC 2 hours = AED 30, 3-hour package = AED 40", async () => {
      const a = await newStation();
      const q = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions/quote`, { planId: regularPlan, request: { kind: "minutes", minutes: 120 } });
      expect(q.status).toBe(200);
      expect(q.body.quote).toMatchObject({ totalMinor: 3000, minutes: 120 });
      const p = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions/quote`, { planId: regularPlan, request: { kind: "package", packageId: pkg3h } });
      expect(p.body.quote).toMatchObject({ totalMinor: 4000, minutes: 180 });
    });

    it("cashier starts PC → signed START_SESSION unlocks the PC with a server-set expiry; station goes 'in use'", async () => {
      const a = await newStation();
      const r = await startCash(cashierT, a.identity!.deviceId);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ status: "ACTIVE", amountDue: "30.00", currency: "AED", fundedBy: "CASH" });
      const minutesLeft = (new Date(r.body.expiresAt).getTime() - Date.now()) / 60_000;
      expect(minutesLeft).toBeGreaterThan(119);
      await until(() => a.activeSession?.id === r.body.id);
      const start = a.received.find((c) => c.type === "START_SESSION")!;
      expect(start.verified).toBe(true);
      expect((start.payload as any).warningMinutes).toEqual([30, 15, 10, 5, 1]);
      const d = (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body;
      expect(d.status).toBe("OCCUPIED");
      expect(d.session.id).toBe(r.body.id);
      expect(r.body.bill).toMatchObject({ status: "OPEN", total: "30.00", paidTotal: "30.00" });
    });

    it("retrying the same start (network glitch) returns the same session and charges once", async () => {
      const a = await newStation();
      const key = randomUUID();
      const [x, y] = [await startCash(cashierT, a.identity!.deviceId, 60, key), await startCash(cashierT, a.identity!.deviceId, 60, key)];
      expect(y.body.id).toBe(x.body.id);
      const pays = await owner.query(`SELECT count(*)::int n FROM "Payment" WHERE "billId" = $1`, [x.body.bill.id]);
      expect(pays.rows[0].n).toBe(1);
    });

    it("refuses a second session on a busy PC and any session on an offline PC", async () => {
      const a = await newStation();
      await startCash(cashierT, a.identity!.deviceId);
      expect((await startCash(cashierT, a.identity!.deviceId)).body.error).toBe("device_not_available");
      const b = await newStation();
      await b.disconnect();
      await until(async () => (await call(ownerT, "GET", `/devices/${b.identity!.deviceId}`)).body.isOnline === false);
      expect((await startCash(cashierT, b.identity!.deviceId)).body.error).toBe("device_offline");
    });

    it("permissions: technician can't start sessions; another organization can't see the PC", async () => {
      const a = await newStation();
      expect((await startCash(techT, a.identity!.deviceId)).status).toBe(403);
      expect((await startCash(rivalT, a.identity!.deviceId)).status).toBe(404);
    });
  });

  describe("extend, move and end", () => {
    it("extend +60 min: pushes the expiry and sends a signed EXTEND_SESSION", async () => {
      const a = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 60)).body;
      const r = await call(cashierT, "POST", `/sessions/${s.id}/extend`, { minutes: 60, payment: { method: "CASH" }, idempotencyKey: randomUUID() });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(new Date(r.body.expiresAt).getTime() - new Date(s.expiresAt).getTime()).toBeGreaterThanOrEqual(59 * 60_000);
      expect(r.body.amountDue).toBe("30.00");
      await until(() => a.received.some((c) => c.type === "EXTEND_SESSION"));
    });

    it("move to another PC: old PC locks, new PC unlocks with the same end time", async () => {
      const a = await newStation();
      const b = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 90)).body;
      const r = await call(cashierT, "POST", `/sessions/${s.id}/move`, { toDeviceId: b.identity!.deviceId, reason: "headset broken" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      await until(() => a.activeSession === null && b.activeSession?.id === s.id);
      expect(b.activeSession!.expiresAt).toBe(new Date(s.expiresAt).toISOString());
    });

    it("staff end: station freed, PC told to lock, bill settled", async () => {
      const a = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 60)).body;
      const r = await call(cashierT, "POST", `/sessions/${s.id}/end`, {});
      expect(r.body).toMatchObject({ status: "ENDED", endReason: "STAFF_ENDED" });
      expect(r.body.bill.status).toBe("SETTLED");
      await until(() => a.activeSession === null);
      expect((await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.status).toBe("AVAILABLE");
    });

    it("pay-later open session: nothing charged up front, billed for time used", async () => {
      const a = await newStation();
      const r = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: payg, request: { kind: "open" }, payment: { method: "PAY_LATER" }, idempotencyKey: randomUUID() });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ expiresAt: null, paymentTiming: "POSTPAID", amountDue: "0.00" });
      await owner.query(`UPDATE "GamingSession" SET "startedAt" = now() - interval '61 minutes' WHERE id = $1`, [r.body.id]);
      const e = (await call(cashierT, "POST", `/sessions/${r.body.id}/end`, {})).body;
      expect(e.amountDue).toBe("22.50"); // 61 min → 75 (15-min blocks) @ AED 18/h
      expect(e.bill).toMatchObject({ total: "22.50", paidTotal: "0.00", status: "OPEN" });
    });
  });

  describe("MANDATORY: server-authoritative expiry", () => {
    it("at 00:00 the session ends by itself: billing final, station AVAILABLE, PC locked", async () => {
      const a = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 60)).body;
      await until(() => a.activeSession?.id === s.id);
      await forceExpiry(s.id, 1200);
      await until(async () => (await session(s.id)).status === "ENDED");
      expect(await session(s.id)).toMatchObject({ endReason: "EXPIRED" });
      await until(() => a.activeSession === null); // signed END_SESSION verified & applied
      const d = (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body;
      expect(d.status).toBe("AVAILABLE");
      expect(d.session).toBeNull();
    });

    it("turns the station 'Ending soon' in the last 5 minutes and records warnings", async () => {
      const a = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 60)).body;
      await forceExpiry(s.id, 4 * 60_000);
      await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.status === "SESSION_ENDING");
      const row = await owner.query(`SELECT "warningsSent" FROM "GamingSession" WHERE id = $1`, [s.id]);
      expect(row.rows[0].warningsSent).toEqual(expect.arrayContaining([30, 15, 10, 5]));
    });

    it("expires even if the PC is disconnected; the PC locks as soon as it reconnects", async () => {
      const a = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 60)).body;
      await until(() => a.activeSession?.id === s.id);
      await a.disconnect();
      await forceExpiry(s.id, 500);
      await until(async () => (await session(s.id)).status === "ENDED");
      expect(a.activeSession?.id).toBe(s.id); // PC still thinks it's running…
      await a.connect();
      await until(() => a.activeSession === null); // …until it reconnects and is told to lock
    });

    it("a restarted client that forgot its session is re-synced (no free play, no lost time)", async () => {
      const a = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 60)).body;
      await until(() => a.activeSession?.id === s.id);
      await a.disconnect();
      a.activeSession = null; // agent/shell restarted and lost its state
      await a.connect(undefined, { reportSession: false });
      await until(() => a.activeSession?.id === s.id);
      expect(a.activeSession!.expiresAt).toBe(new Date(s.expiresAt).toISOString()); // same end time
    });
  });

  describe("prepaid time & Gaming Shell login", () => {
    it("customer logs in at the PC with prepaid time; unused time returns on logout", async () => {
      const a = await newStation();
      const loginId = randomUUID();
      const r = await a.shell({ type: "shell_login", username: "ahmed", secret: "ahmed123" }, loginId);
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true, displayName: "Ahmed" });
      await until(() => a.activeSession !== null);
      const s = await session(a.activeSession!.id);
      expect(s).toMatchObject({ fundedBy: "TIME_BALANCE", customer: { displayName: "Ahmed" } });
      const before = (await call(cashierT, "GET", `/customers/${s.customer.id}`)).body.timeBalanceMinutes;
      expect(before).toBe(0); // whole balance reserved for the session
      const out = await a.shell({ type: "shell_logout", sessionId: s.id });
      expect(out.ok).toBe(true);
      expect(out.timeBalanceMinutes).toBeGreaterThanOrEqual(119); // unused minutes refunded
      await until(() => a.activeSession === null);
      // A replayed login (same requestId) must not claim success for the finished session.
      expect(await a.shell({ type: "shell_login", username: "ahmed", secret: "ahmed123" }, loginId)).toMatchObject({ ok: false, error: "duplicate_request" });
    });

    it("wrong password, no time, and brute force are refused", async () => {
      const a = await newStation();
      expect(await a.shell({ type: "shell_login", username: "ahmed", secret: "nope" })).toMatchObject({ ok: false, error: "invalid_credentials" });
      const broke = `broke${Date.now()}`;
      await call(cashierT, "POST", "/customers", { username: broke, displayName: "No Time", password: "broke1234" });
      expect(await a.shell({ type: "shell_login", username: broke, secret: "broke1234" })).toMatchObject({ ok: false, error: "no_time" });
      for (let i = 0; i < 8; i++) await a.shell({ type: "shell_login", username: `ghost${i}`, secret: "x" });
      expect(await a.shell({ type: "shell_login", username: "ahmed", secret: "ahmed123" })).toMatchObject({ ok: false, error: "too_many_attempts" });
    });

    it("selling prepaid time: package on the account, one charge even when retried", async () => {
      const custs = (await call(cashierT, "GET", "/customers?q=sara")).body as any[];
      const sara = custs.find((c) => c.username === "sara");
      const key = randomUUID();
      const body = { branchId: dxb1, planId: regularPlan, packageId: pkg3h, payment: { method: "CARD" }, idempotencyKey: key };
      const first = await call(cashierT, "POST", `/customers/${sara.id}/time`, body);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body).toMatchObject({ minutesAdded: 180, amount: "40.00" });
      const again = await call(cashierT, "POST", `/customers/${sara.id}/time`, body);
      expect(again.body.duplicate).toBe(true);
      expect(again.body.timeBalanceMinutes).toBe(first.body.timeBalanceMinutes);
    });

    it("customer personal data is masked for staff without customer.view_pii", async () => {
      const n = Date.now();
      const r = await call(cashierT, "POST", "/customers", { username: `pii${n}`, displayName: "Pii Test", phone: `+97150${String(n).slice(-7)}`, email: `pii.${n}@example.com`, password: "secret123" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.phone).toMatch(new RegExp(`^•+${String(n).slice(-3)}$`));
      expect(r.body.email).toBe("p•••@example.com");
      const full = (await call(ownerT, "GET", `/customers/${r.body.id}`)).body;
      expect(full.phone).toBe(`+97150${String(n).slice(-7)}`);
    });
  });

  describe("rate cards", () => {
    it("branch manager manages rates for their branch only; other tenants can't see them", async () => {
      const mine = await call(managerT, "POST", "/pricing-plans", { name: `Test ${Date.now()}`, stationClass: "PC", billingMode: "PER_HOUR", rate: 12, branchId: dxb1 }, "new rate");
      expect(mine.status, JSON.stringify(mine.body)).toBe(201);
      const orgWide = await call(managerT, "POST", "/pricing-plans", { name: "Org wide", stationClass: "PC", billingMode: "PER_HOUR", rate: 12 }, "new rate");
      expect(orgWide.status).toBe(403);
      const rival = (await call(rivalT, "GET", "/pricing-plans")).body as any[];
      expect(rival.some((p) => p.id === mine.body.id)).toBe(false);
    });

    it("the clock survives an API restart: an expired session is closed on boot", async () => {
      const a = await newStation();
      const s = (await startCash(cashierT, a.identity!.deviceId, 60)).body;
      await a.disconnect();
      await app.close();
      await owner.query(`UPDATE "GamingSession" SET "startedAt" = now() - interval '61 minutes', "expiresAt" = now() - interval '5 seconds' WHERE id = $1`, [s.id]);
      app = await createApp(loadConfig({ NODE_ENV: "test" }));
      await app.listen(0);
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
      await until(async () => (await owner.query(`SELECT status FROM "GamingSession" WHERE id = $1`, [s.id])).rows[0].status === "ENDED");
    });
  });
});
