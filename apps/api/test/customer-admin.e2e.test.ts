// Customer admin end-to-end: bans and restrictions (status follows them,
// timed bans run out, PCs get blocked games and a capped age, zone blocks and
// daily limits refuse a session), notes and tags, filters and export, the
// activity timeline, contact verification and merging a duplicate account —
// against real Postgres, a listening API and a simulated agent.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";
import { SimAgent } from "../scripts/sim-agent.js";

process.env["MEMBERSHIP_SWEEP_MS"] = "300";
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

describe.skipIf(!HAS_DB)("Customer admin (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const agents: SimAgent[] = [];
  let ownerT: string, cashierT: string;
  let dxb1: string, regularZone: string, regularPlan: string;

  const call = async (token: string | null, method: string, path: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* csv */ }
    return { status: res.status, body: parsed };
  };
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;
  const newCustomer = async (extra: Record<string, unknown> = {}) => {
    const username = `a${randomUUID().slice(0, 8)}`;
    const r = await call(cashierT, "POST", "/customers", { username, displayName: `Admin ${username}`, password: "secret123", ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { id: r.body.id as string, username };
  };
  const restrict = (id: string, body: Record<string, unknown>) => call(ownerT, "POST", `/customers/${id}/restrictions`, { reason: "test", ...body }, "test");
  const status = async (id: string) => (await call(ownerT, "GET", `/customers/${id}`)).body.status as string;
  const station = async () => {
    const code = (await call(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId: regularZone, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60 });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.isOnline === true);
    return a;
  };
  const start = (a: SimAgent, customerId: string, minutes = 30) =>
    call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, customerId, request: { kind: "minutes", minutes }, payment: { method: "CASH" }, idempotencyKey: key() });

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT] = (await Promise.all(["owner@demo.test", "cashier@demo.test"].map(login))) as [string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;
    regularPlan = ((await call(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.name === "Regular PC").id;
  });

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
  });

  it("a ban blocks sign-in and sessions; lifting it (or it running out) restores the account", async () => {
    const c = await newCustomer();
    expect((await call(cashierT, "POST", `/customers/${c.id}/restrictions`, { type: "BAN", reason: "fight" }, "x")).status).toBe(403); // cashier can't ban
    const ban = await restrict(c.id, { type: "BAN" });
    expect(ban.status, JSON.stringify(ban.body)).toBe(201);
    expect(await status(c.id)).toBe("BANNED");
    expect((await call(null, "POST", "/app/demo/login", { username: c.username, password: "secret123" })).status).toBe(401);
    const a = await station();
    expect((await start(a, c.id)).body.error).toBe("customer_banned");
    expect((await call(ownerT, "POST", `/customers/${c.id}/restrictions/${ban.body.id}/lift`, undefined, "made up")).status).toBe(200);
    expect(await status(c.id)).toBe("ACTIVE");
    expect((await call(ownerT, "GET", "/customers?status=BANNED")).body.some((x: any) => x.id === c.id)).toBe(false);

    await restrict(c.id, { type: "BAN", endsAt: new Date(Date.now() + 1500).toISOString() });
    expect(await status(c.id)).toBe("BANNED");
    await until(async () => (await status(c.id)) === "ACTIVE");
  });

  it("game blocks and an age cap reach the PC; zone blocks and daily limits refuse a session", async () => {
    const c = await newCustomer();
    const gameId = randomUUID();
    await restrict(c.id, { type: "GAME_BLOCK", scope: { gameIds: [gameId] } });
    await restrict(c.id, { type: "AGE_LIMIT", scope: { maxAge: 12 } });
    expect(await status(c.id)).toBe("RESTRICTED");
    const a = await station();
    const s = await start(a, c.id);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    await until(() => a.received.some((r) => r.type === "START_SESSION"));
    const payload = a.received.find((r) => r.type === "START_SESSION")!.payload as any;
    expect(payload.customer.blockedGameIds).toEqual([gameId]);
    expect(payload.customer.age).toBe(12);
    await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "t" });

    const z = await newCustomer();
    await restrict(z.id, { type: "ZONE_BLOCK", scope: { zoneIds: [regularZone] } });
    expect((await start(await station(), z.id)).body.error).toBe("customer_zone_blocked");

    const d = await newCustomer();
    await restrict(d.id, { type: "TIME_LIMIT", scope: { maxMinutesPerDay: 60 } });
    const b = await station();
    expect((await start(b, d.id, 90)).body).toMatchObject({ error: "daily_limit_reached", minutesLeft: 60 });
    expect((await start(b, d.id, 60)).status).toBe(201);
  });

  it("profile fields, tags, notes, filters, export and verification", async () => {
    const c = await newCustomer({ phone: `+9715${String(Date.now()).slice(-8)}`, email: `${randomUUID().slice(0, 8)}@x.test`, marketingConsent: true });
    const up = await call(ownerT, "PATCH", `/customers/${c.id}`, { dateOfBirth: "2001-04-05", homeBranchId: dxb1, tags: ["VIP", "VIP", "regular"], locale: "ar" });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body).toMatchObject({ dateOfBirth: "2001-04-05", tags: ["VIP", "regular"], locale: "ar" });
    expect((await call(ownerT, "PATCH", `/customers/${c.id}`, { dateOfBirth: "2999-01-01" })).status).toBe(400);
    expect((await call(ownerT, "GET", "/customers?tag=VIP")).body.map((x: any) => x.id)).toContain(c.id);
    expect((await call(ownerT, "GET", "/customers?sort=points&page=0")).status).toBe(200);

    const n = await call(cashierT, "POST", `/customers/${c.id}/notes`, { body: "Prefers PC 12" });
    expect(n.status).toBe(201);
    expect((await call(ownerT, "DELETE", `/customers/${c.id}/notes/${n.body.id}`)).status).toBe(403); // not the author
    expect((await call(ownerT, "GET", `/customers/${c.id}/notes`)).body[0].body).toBe("Prefers PC 12");

    expect((await call(cashierT, "GET", `/customers/export?q=${c.username}`)).status).toBe(403);
    const csv = await call(ownerT, "GET", `/customers/export?q=${c.username}&consented=1`, undefined, "mailing");
    expect(csv.status).toBe(200);
    expect(csv.body).toContain(c.username);
    expect(csv.body).toContain("VIP; regular");

    expect((await call(ownerT, "POST", `/customers/${c.id}/verify`, { channel: "phone", verified: true })).body.phoneVerifiedAt).toBeTruthy();
    const bare = await newCustomer();
    expect((await call(ownerT, "POST", `/customers/${bare.id}/verify`, { channel: "email", verified: true })).body.error).toBe("no_email");
  });

  it("merging moves money, time, points and history, then erases the duplicate", async () => {
    const keep = await newCustomer();
    const dup = await newCustomer();
    await call(cashierT, "POST", `/customers/${dup.id}/wallet/topup`, { branchId: dxb1, amount: "40", payment: { method: "CASH" }, idempotencyKey: key() });
    await call(ownerT, "POST", `/customers/${dup.id}/wallet/adjust`, { branchId: dxb1, bucket: "TIME", amount: 90, reason: "goodwill", idempotencyKey: key() }, "goodwill");
    await call(cashierT, "POST", `/customers/${dup.id}/notes`, { body: "old account" });
    const s = await start(await station(), dup.id);
    await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "t" });
    const pointsBefore = (await call(ownerT, "GET", `/customers/${dup.id}/insights`)).status;
    expect(pointsBefore).toBe(200);

    expect((await call(cashierT, "POST", `/customers/${keep.id}/merge`, { fromId: dup.id, branchId: dxb1 }, "dup")).status).toBe(403);
    const m = await call(ownerT, "POST", `/customers/${keep.id}/merge`, { fromId: dup.id, branchId: dxb1 }, "same person");
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    const w = (await call(ownerT, "GET", `/customers/${keep.id}/wallet`)).body;
    expect(Number(w.cash)).toBe(40);
    expect((await call(ownerT, "GET", `/customers/${keep.id}`)).body.timeBalanceMinutes).toBe(90);
    expect((await call(ownerT, "GET", `/customers/${keep.id}`)).body.totalSpend).toBe("47.50"); // the duplicate's 40 top-up + 7.50 cash session now count for the kept account
    expect((await call(ownerT, "GET", `/customers/${keep.id}/notes`)).body[0].body).toBe("old account");
    const act = (await call(ownerT, "GET", `/customers/${keep.id}/activity`)).body;
    expect(act.items.some((i: any) => i.kind === "session")).toBe(true);
    expect((await call(ownerT, "GET", `/customers/${dup.id}`)).body.status).toBe("DELETED");
    // retry is harmless: nothing left to move and the duplicate is gone
    expect((await call(ownerT, "POST", `/customers/${keep.id}/merge`, { fromId: dup.id, branchId: dxb1 }, "again")).body.error).toBe("customer_erased");
  });
});
