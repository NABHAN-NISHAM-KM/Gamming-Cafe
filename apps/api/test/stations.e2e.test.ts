// Phase 9 end-to-end: agentless stations (consoles, VR, sim rigs) with no
// agent online, per-player console pricing, the smart-plug bridge, minimum
// age, VR cleaning, accessory checks, TV station displays, and
// internet-café printing (quote → confirm → signed release → done; wallet;
// staff approval; cancel; timeout; no session) — against real Postgres, a
// listening API and simulated PCs.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { PrintService } from "../src/printing/print.service.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";
import { SimAgent } from "../scripts/sim-agent.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const key = () => randomUUID();
const tag = () => randomUUID().slice(0, 4).toUpperCase();
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
};

describe.skipIf(!HAS_DB)("Consoles, VR, simulators, station displays & printing (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const agents: SimAgent[] = [];
  let ownerT: string, managerT: string, cashierT: string, rivalT: string;
  let dxb1: string, psZone: string, vrZone: string, regularZone: string, consolePlan: string, regularPlan: string;
  let bridge: SimAgent;
  let ahmedId: string, saraId: string;

  const call = async (token: string, method: string, path: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const raw = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/v1${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;
  const newAgent = async () => {
    const code = (await call(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId: regularZone, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60 });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.isOnline === true);
    return a;
  };
  const station = async (body: Record<string, unknown>) => {
    const r = await call(ownerT, "POST", `/branches/${dxb1}/stations`, { name: `T-${tag()}`, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const started: string[] = [];
  const start = async (deviceId: string, body: Record<string, unknown>) => {
    const r = await call(cashierT, "POST", `/devices/${deviceId}/sessions`, { request: { kind: "minutes", minutes: 60 }, payment: { method: "CARD" }, idempotencyKey: key(), ...body });
    if (r.status === 201) started.push(r.body.id);
    return r;
  };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, managerT, cashierT, rivalT] = (await Promise.all(["owner@demo.test", "manager@demo.test", "cashier@demo.test", "owner@rival.test"].map(login))) as [string, string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    const zones = (await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[];
    psZone = zones.find((z) => z.type === "CONSOLE").id;
    vrZone = zones.find((z) => z.type === "VR").id;
    regularZone = zones.find((z) => z.type === "PC_STANDARD").id;
    const plans = (await call(ownerT, "GET", "/pricing-plans")).body as any[];
    consolePlan = plans.find((p) => p.name === "PS5 / Xbox").id;
    regularPlan = plans.find((p) => p.name === "Regular PC").id;
    ahmedId = ((await call(ownerT, "GET", "/customers?q=ahmed")).body as any[]).find((c) => c.username === "ahmed").id;
    saraId = ((await call(ownerT, "GET", "/customers?q=sara")).body as any[]).find((c) => c.username === "sara").id;
    bridge = await newAgent();
    expect((await call(managerT, "POST", `/devices/${bridge.identity!.deviceId}/bridge`, { enabled: true })).status).toBe(200);
  });

  afterAll(async () => {
    // Leave no one "already playing" for the suites that run after this one.
    for (const id of started) await call(cashierT, "POST", `/sessions/${id}/end`, { reason: "test cleanup" });
    for (const a of agents) a.disconnect();
    await app?.close();
    await owner.end();
  });

  describe("agentless stations", () => {
    it("the seeded consoles, VR headsets, sim rig and TVs are listed as ready, with their controllers", async () => {
      const r = (await call(managerT, "GET", `/branches/${dxb1}/stations`)).body;
      const names = r.stations.map((s: any) => s.name);
      expect(names).toEqual(expect.arrayContaining(["PS5-01", "PS5-02", "PS5-03", "VR-01", "VR-02", "SIM-01", "TV-01", "TV-VR"]));
      const ps5 = r.stations.find((s: any) => s.name === "PS5-01");
      expect(ps5).toMatchObject({ agentless: true, isOnline: true, controllerCount: 4 });
      expect(ps5.deviceAccessories.filter((a: any) => a.type === "CONTROLLER")).toHaveLength(4);
      expect(r.bridgeCandidates.find((b: any) => b.id === bridge.identity!.deviceId).isBridge).toBe(true);
    });

    it("only station managers add stations", async () => {
      expect((await call(cashierT, "POST", `/branches/${dxb1}/stations`, { name: "NOPE-1", zoneId: psZone, kind: "CONSOLE" })).status).toBe(403);
    });

    it("a console session starts with no agent online, charges extra players, and the bridge switches the plug on then off", async () => {
      const ps = await station({ zoneId: psZone, kind: "CONSOLE", platform: "PS5", controllerCount: 4, powerPlug: { kind: "SHELLY", host: "192.168.1.99", channel: 0, offDelaySeconds: 45 } });
      expect((await start(ps.id, { planId: consolePlan, players: 5 })).body.error).toBe("too_many_players");
      const q = (await call(cashierT, "POST", `/devices/${ps.id}/sessions/quote`, { planId: consolePlan, request: { kind: "minutes", minutes: 60 }, players: 4 })).body;
      expect(q.quote.totalMinor).toBe(3000); // AED 20 for 2 players + 2 × AED 5
      const s = await start(ps.id, { planId: consolePlan, players: 4 });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      expect(s.body.amountDue).toBe("30.00");
      await until(() => bridge.received.some((c) => c.type === "POWER" && (c.payload as any).targetDeviceId === ps.id && (c.payload as any).on === true));
      const on = bridge.received.find((c) => c.type === "POWER" && (c.payload as any).targetDeviceId === ps.id)!.payload as any;
      expect(on.plug).toEqual({ kind: "SHELLY", host: "192.168.1.99", channel: 0 });
      expect((await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "done" })).status).toBe(200);
      await until(() => bridge.received.some((c) => c.type === "POWER" && (c.payload as any).targetDeviceId === ps.id && (c.payload as any).on === false));
      const off = bridge.received.filter((c) => c.type === "POWER" && (c.payload as any).targetDeviceId === ps.id).at(-1)!.payload as any;
      expect(off).toMatchObject({ on: false, delaySeconds: 45 });
      expect((await call(ownerT, "GET", `/devices/${ps.id}`)).body.status).toBe("AVAILABLE");
    });

    it("smart plugs must be on the LAN — the bridge can't be pointed at the internet", async () => {
      const r = await call(ownerT, "POST", `/branches/${dxb1}/stations`, { name: `T-${tag()}`, zoneId: psZone, kind: "CONSOLE", powerPlug: { kind: "TASMOTA", host: "8.8.8.8" } });
      expect(r.status).toBe(400);
    });

    it("VR: minimum age for known customers, age confirmation for guests, then cleaning before the next player", async () => {
      const vr = await station({ zoneId: vrZone, kind: "VR_HEADSET", platform: "META_QUEST", minAge: 16, cleaningRequired: true });
      const acc = (await call(ownerT, "POST", `/devices/${vr.id}/accessories`, { type: "VR_CONTROLLER", label: "Left", status: "OK" })).body;
      const tooYoung = await start(vr.id, { customerId: saraId }); // Sara is 13
      expect(tooYoung.status).toBe(403);
      expect(tooYoung.body).toMatchObject({ error: "age_restricted", minAge: 16 });
      expect((await start(vr.id, {})).body.error).toBe("age_confirmation_required");
      const s = await start(vr.id, { ageConfirmed: true });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      await call(ownerT, "PATCH", `/devices/${vr.id}/accessories/${acc.id}`, { status: "NEEDS_CLEANING" });
      await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "done" });
      expect((await call(ownerT, "GET", `/devices/${vr.id}`)).body.status).toBe("CLEANING");
      expect((await start(vr.id, { customerId: ahmedId })).body.error).toBe("device_not_available");
      const cleaned = await call(cashierT, "POST", `/devices/${vr.id}/cleaned`);
      expect(cleaned.body.status).toBe("AVAILABLE");
      expect((await call(ownerT, "GET", `/devices/${vr.id}/accessories`)).body[0].status).toBe("OK");
      expect((await start(vr.id, { customerId: ahmedId, planId: undefined })).status).toBe(201);
    });

    it("accessory check: a missing controller raises an alert until it's back", async () => {
      const ps = await station({ zoneId: psZone, kind: "CONSOLE", controllerCount: 2 });
      const [c1, c2] = await Promise.all([1, 2].map(async (i) => (await call(ownerT, "POST", `/devices/${ps.id}/accessories`, { type: "CONTROLLER", label: `Pad ${i}` })).body));
      const bad = await call(cashierT, "POST", `/devices/${ps.id}/accessory-check`, { items: [{ accessoryId: c1.id, status: "OK" }, { accessoryId: c2.id, status: "MISSING" }] });
      expect(bad.body.problems).toEqual([{ accessoryId: c2.id, name: "Pad 2", status: "MISSING" }]);
      let d = (await call(ownerT, "GET", `/devices/${ps.id}`)).body;
      expect(d.alerts.find((a: any) => a.type === "ACCESSORY_ISSUE")).toMatchObject({ severity: "CRITICAL" });
      await call(cashierT, "POST", `/devices/${ps.id}/accessory-check`, { items: [{ accessoryId: c2.id, status: "OK" }] });
      d = (await call(ownerT, "GET", `/devices/${ps.id}`)).body;
      expect(d.alerts.find((a: any) => a.type === "ACCESSORY_ISSUE")).toBeUndefined();
    });
  });

  describe("TV station displays", () => {
    it("pair once with a code, then see only its own stations — first names and countdowns", async () => {
      const tv = await station({ zoneId: psZone, kind: "SMART_TV" });
      const ps = await station({ zoneId: psZone, kind: "CONSOLE", controllerCount: 2, linkedDisplayId: tv.id });
      expect((await raw("GET", "/display/state")).status).toBe(401);
      const { code } = (await call(ownerT, "POST", `/devices/${tv.id}/display-pairing`)).body;
      expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
      expect((await raw("POST", "/display/pair", { code: "ZZZZ-ZZZZ" })).status).toBe(401);
      const paired = await raw("POST", "/display/pair", { code });
      expect(paired.status).toBe(200);
      expect((await raw("POST", "/display/pair", { code })).status).toBe(401); // single use
      const auth = { authorization: `Bearer ${paired.body.token}` };
      await start(ps.id, { planId: consolePlan, customerId: ahmedId });
      const st = (await raw("GET", "/display/state", undefined, auth)).body;
      expect(st.stations).toHaveLength(1);
      expect(st.stations[0]).toMatchObject({ name: ps.name, session: { player: "Ahmed", players: 1 } });
      expect(new Date(st.stations[0].session.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(JSON.stringify(st)).not.toMatch(/customerId|phone|email|amount/);
      // Unpaired from the admin → the TV's token stops working.
      expect((await call(ownerT, "DELETE", `/devices/${tv.id}/display-pairing`)).status).toBe(204);
      expect((await raw("GET", "/display/state", undefined, auth)).status).toBe(401);
    });

    it("pairing codes only work for TVs", async () => {
      const ps = await station({ zoneId: psZone, kind: "CONSOLE" });
      expect((await call(ownerT, "POST", `/devices/${ps.id}/display-pairing`)).body.error).toBe("not_a_display");
    });
  });

  describe("printing", () => {
    let pc: SimAgent;
    let sessionId: string;

    beforeAll(async () => {
      pc = await newAgent();
      const s = await call(cashierT, "POST", `/devices/${pc.identity!.deviceId}/sessions`, { planId: regularPlan, customerId: ahmedId, request: { kind: "minutes", minutes: 60 }, payment: { method: "CARD" }, idempotencyKey: key() });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      sessionId = s.body.id;
      started.push(sessionId);
      await call(ownerT, "PUT", `/branches/${dxb1}/print-settings`, { requireApproval: false, maxPages: 100 });
    });

    const quoteFor = async (jobKey: string) => {
      await until(() => pc.printQuotes.some((q) => q.jobKey === jobKey) || pc.printStatuses.some((s) => s.jobKey === jobKey));
      return pc.printQuotes.filter((q) => q.jobKey === jobKey).at(-1);
    };
    const statusFor = async (jobKey: string, status: string) => {
      await until(() => pc.printStatuses.some((s) => s.jobKey === jobKey && s.status === status));
      return pc.printStatuses.filter((s) => s.jobKey === jobKey && s.status === status).at(-1)!;
    };

    it("a job is priced per page, confirmed on the Shell, added to the bill, released by signed command, then completed", async () => {
      const jobKey = pc.print({ pages: 4, document: "boarding-pass.pdf" });
      const q = (await quoteFor(jobKey))!;
      expect(q).toMatchObject({ pages: 4, copies: 1, color: false, unitPrice: "0.50", total: "2.00", currency: "AED", canPayWithWallet: true, needsStaff: false });
      pc.confirmPrint(jobKey, "BILL");
      await until(() => pc.received.some((c) => c.type === "PRINT_RELEASE" && (c.payload as any).jobKey === jobKey));
      await statusFor(jobKey, "PRINTING");
      const bill = (await call(cashierT, "GET", `/bills/${(await call(cashierT, "GET", `/sessions/${sessionId}`)).body.bill.id}`)).body;
      expect(bill.orders.flatMap((o: any) => o.orderItems).some((i: any) => i.nameSnapshot.startsWith("Printing") && i.quantity === 4 && i.lineTotal === "2.00")).toBe(true);
      pc.printDone(jobKey, true);
      await statusFor(jobKey, "COMPLETED");
      const jobs = (await call(cashierT, "GET", `/branches/${dxb1}/print-jobs`)).body as any[];
      expect(jobs.find((j) => j.document === "boarding-pass.pdf")).toMatchObject({ status: "COMPLETED", total: "2.00", payWith: "BILL" });
    });

    it("the same job reported twice (after a reconnect) is not charged twice", async () => {
      const jobKey = pc.print({ pages: 1 });
      await quoteFor(jobKey);
      pc.print({ jobKey, pages: 1 });
      await new Promise((r) => setTimeout(r, 300));
      const rows = await owner.query(`SELECT count(*)::int AS n FROM "PrintJob" WHERE "jobKey" = $1`, [jobKey]);
      expect(rows.rows[0].n).toBe(1);
      pc.cancelPrint(jobKey);
      await statusFor(jobKey, "CANCELLED");
      await until(() => pc.received.some((c) => c.type === "PRINT_CANCEL" && (c.payload as any).jobKey === jobKey));
    });

    it("colour from the wallet: charged to the wallet, not the bill", async () => {
      const before = (await call(ownerT, "GET", `/customers/${ahmedId}/wallet`)).body;
      const jobKey = pc.print({ pages: 2, color: true });
      expect((await quoteFor(jobKey))!.total).toBe("4.00");
      pc.confirmPrint(jobKey, "WALLET");
      await statusFor(jobKey, "PRINTING");
      const after = (await call(ownerT, "GET", `/customers/${ahmedId}/wallet`)).body;
      const total = (w: any) => Number(w.balances?.cash ?? w.cash ?? 0) + Number(w.balances?.bonus ?? w.bonus ?? 0);
      expect(total(before) - total(after)).toBeCloseTo(4, 2);
    });

    it("with staff approval on, a confirmed job waits at the front desk until released", async () => {
      await call(ownerT, "PUT", `/branches/${dxb1}/print-settings`, { requireApproval: true });
      const jobKey = pc.print({ pages: 3 });
      expect((await quoteFor(jobKey))!.needsStaff).toBe(true);
      pc.confirmPrint(jobKey, "BILL");
      await statusFor(jobKey, "WAITING_STAFF");
      const job = ((await call(cashierT, "GET", `/branches/${dxb1}/print-jobs?open=1`)).body as any[]).find((j) => j.status === "HELD" && j.waitingFor === "STAFF" && j.pages === 3);
      expect(job).toBeTruthy();
      expect((await call(cashierT, "POST", `/print-jobs/${job.id}/release`, {})).body.result).toBe("released");
      await until(() => pc.received.some((c) => c.type === "PRINT_RELEASE" && (c.payload as any).jobKey === jobKey));
      await call(ownerT, "PUT", `/branches/${dxb1}/print-settings`, { requireApproval: false });
    });

    it("a job nobody confirms is cancelled by the sweep", async () => {
      const jobKey = pc.print({ pages: 1 });
      await quoteFor(jobKey);
      await owner.query(`UPDATE "PrintJob" SET "expiresAt" = now() - interval '1 minute' WHERE "jobKey" = $1`, [jobKey]);
      await app.get(PrintService).sweep();
      await statusFor(jobKey, "CANCELLED");
      await until(() => pc.received.some((c) => c.type === "PRINT_CANCEL" && (c.payload as any).jobKey === jobKey));
    });

    it("no session, no printing", async () => {
      const idle = await newAgent();
      const jobKey = idle.print({ pages: 1 });
      await until(() => idle.printStatuses.some((s) => s.jobKey === jobKey && s.status === "CANCELLED"));
      await until(() => idle.received.some((c) => c.type === "PRINT_CANCEL"));
    });

    it("other organizations can't see the print queue or the stations", async () => {
      // Another tenant's branch doesn't exist for them at all.
      expect([403, 404]).toContain((await call(rivalT, "GET", `/branches/${dxb1}/print-jobs`)).status);
      expect([403, 404]).toContain((await call(rivalT, "GET", `/branches/${dxb1}/stations`)).status);
    });
  });
});
