// Waitlist, rota, insights, the venue's account (usage, upgrade, billing by
// card), announcements, support sign-in, release rollout, season passes,
// "find a team", spending limits and guardians, card top-ups, receipts,
// table ordering, running late and the minors' curfew — against real
// Postgres, both services, a simulated agent and a local stand-in for Stripe.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { createPlatformApp } from "../src/platform/server.js";
import { loadPlatformConfig } from "../src/platform/config.js";
import { bucket, newer } from "../src/platform/ops.controller.js";
import { minutesToCurfew } from "../src/customers/restrictions.js";
import { signWebhook } from "../src/payments/stripe.js";
import { hashSecret, totpAt } from "../src/auth/crypto.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";
import { SimAgent } from "../scripts/sim-agent.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["PLATFORM_DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
};
const key = () => randomUUID();
const BILLING_HOOK = "whsec_platform_test";
const VENUE_HOOK = "whsec_venue_test";

describe("pure helpers", () => {
  it("curfew: inside, before, wrapping midnight, adults and unknown ages", () => {
    const c = { from: "22:00", to: "07:00", underAge: 18 };
    const at = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00Z`);
    expect(minutesToCurfew(c, 15, "UTC", at("23:30"))).toBe(0);
    expect(minutesToCurfew(c, 15, "UTC", at("06:59"))).toBe(0);
    expect(minutesToCurfew(c, 15, "UTC", at("21:00"))).toBe(60);
    expect(minutesToCurfew(c, 18, "UTC", at("23:30"))).toBeNull();
    expect(minutesToCurfew(c, null, "UTC", at("23:30"))).toBeNull();
    expect(minutesToCurfew(null, 12, "UTC", at("23:30"))).toBeNull();
  });
  it("release versions and rollout buckets", () => {
    expect(newer("1.10.0", "1.9.3")).toBe(true);
    expect(newer("1.2.0", "1.2.0")).toBe(false);
    expect(newer("2.0.0-beta", "1.9.9")).toBe(true);
    const b = bucket("device-1234", "release-1");
    expect(b).toBe(bucket("device-1234", "release-1"));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });
});

describe.skipIf(!HAS_DB)("Ops & growth (e2e)", () => {
  let app: INestApplication;
  let platform: INestApplication;
  let base: string;
  let pbase: string;
  let stripe: Server;
  const checkouts: Array<Record<string, string>> = [];
  const agents: SimAgent[] = [];
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  let ownerT: string, cashierT: string, platformT: string;
  let dxb1: string, regularZone: string;

  const req = async (url: string, token: string | null, method: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const staff = (token: string, method: string, path: string, body?: unknown, reason?: string) => req(`${base}/v1${path}`, token, method, body, reason ? { "x-action-reason": reason } : {});
  const app_ = (token: string | null, method: string, path: string, body?: unknown) => req(`${base}/v1/app${path}`, token, method, body);
  const plat = (method: string, path: string, body?: unknown) => req(`${pbase}/v1/platform${path}`, platformT, method, body);
  const login = async (email: string) => (await req(`${base}/v1/auth/login`, null, "POST", { email, password: DEMO_PASSWORD })).body.accessToken as string;
  const player = async (o: { money?: string; dob?: string } = {}) => {
    const username = `g${randomUUID().slice(0, 8)}`;
    const made = await staff(cashierT, "POST", "/customers", { username, displayName: `Gus ${username}`, password: "longpassword1" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    if (o.dob) await owner.query(`UPDATE "Customer" SET "dateOfBirth" = $2 WHERE id = $1`, [made.body.id, o.dob]);
    const token = (await app_(null, "POST", "/demo/login", { username, password: "longpassword1" })).body.accessToken as string;
    if (o.money) await staff(cashierT, "POST", `/customers/${made.body.id}/wallet/topup`, { branchId: dxb1, amount: o.money, payment: { method: "CASH" }, idempotencyKey: key() });
    return { id: made.body.id as string, username, token };
  };
  const station = async () => {
    const code = (await staff(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId: regularZone, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60 });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(async () => (await staff(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.isOnline === true);
    return a;
  };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    // A stand-in for Stripe's Checkout API: records what was asked, answers with a session.
    stripe = createServer((rq, rs) => {
      let raw = "";
      rq.on("data", (c) => (raw += c));
      rq.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        const id = `cs_test_${randomUUID().slice(0, 8)}`;
        checkouts.push({ ...form, id, auth: String(rq.headers.authorization) });
        rs.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id, url: `https://checkout.test/${id}` }));
      });
    });
    await new Promise<void>((r) => stripe.listen(0, "127.0.0.1", r));
    process.env["STRIPE_API_BASE"] = `http://127.0.0.1:${(stripe.address() as AddressInfo).port}`;
    process.env["VENUE_STRIPE_KEY_TEST"] = "sk_test_venue";
    process.env["VENUE_STRIPE_HOOK_TEST"] = VENUE_HOOK;

    app = await createApp(loadConfig({ NODE_ENV: "test", BILLING_STRIPE_SECRET_KEY: "sk_test_platform" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    platform = await createPlatformApp(loadPlatformConfig({ NODE_ENV: "test", BILLING_STRIPE_WEBHOOK_SECRET: BILLING_HOOK, BILLING_SWEEP: "off" }));
    await platform.listen(0);
    pbase = `http://127.0.0.1:${(platform.getHttpServer().address() as AddressInfo).port}`;

    [ownerT, cashierT] = (await Promise.all(["owner@demo.test", "cashier@demo.test"].map(login))) as [string, string];
    dxb1 = ((await staff(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await staff(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;

    const email = `ops-${randomUUID().slice(0, 8)}@platform.test`;
    const u = await owner.query(`INSERT INTO "User" (id, email, "displayName", "passwordHash", "emailVerified", "updatedAt") VALUES (gen_random_uuid(), $1, 'Ops', $2, true, now()) RETURNING id`, [email, await hashSecret("Platform!Test-2026")]);
    await owner.query(`INSERT INTO "PlatformRoleAssignment" (id, "userId", role) VALUES (gen_random_uuid(), $1, 'SUPER_ADMIN')`, [u.rows[0].id]);
    const first = (await req(`${pbase}/v1/platform/auth/login`, null, "POST", { email, password: "Platform!Test-2026" })).body;
    platformT = (await req(`${pbase}/v1/platform/auth/mfa/verify`, null, "POST", { mfaToken: first.mfaToken, code: totpAt(first.secret, Date.now()) })).body.accessToken;
  });

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
    await platform?.close();
    stripe?.close();
    await owner.end();
  });

  it("waitlist: a free station is offered to the first in line, and a lapsed offer expires", async () => {
    // Fill the zone so nothing is free, then free one station: it goes to the first in line.
    await owner.query(`UPDATE "Device" SET status = 'OCCUPIED' WHERE "zoneId" = $1`, [regularZone]);
    const a = await station();
    await owner.query(`UPDATE "Device" SET status = 'OCCUPIED' WHERE id = $1`, [a.identity!.deviceId]);
    const add = await staff(cashierT, "POST", `/branches/${dxb1}/waitlist`, { name: "Walk-in Wally", partySize: 1, zoneId: regularZone });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const mine = add.body.entries.find((e: any) => e.name === "Walk-in Wally");
    expect(mine.status).toBe("WAITING");
    const p = await player();
    expect((await app_(p.token, "POST", "/waitlist", { branchId: dxb1, zoneId: regularZone })).body).toMatchObject({ status: "WAITING", position: expect.any(Number) });
    expect((await app_(p.token, "POST", "/waitlist", { branchId: dxb1 })).body.error).toBe("already_waiting");

    await owner.query(`UPDATE "Device" SET status = 'AVAILABLE' WHERE id = $1`, [a.identity!.deviceId]);
    const board = (await staff(cashierT, "POST", `/branches/${dxb1}/waitlist/${mine.id}/noop`)).status; // unknown action
    expect(board).toBe(404);
    const after = (await staff(cashierT, "GET", `/branches/${dxb1}/waitlist`)).body;
    // The add above already ran a pass; run one more through a harmless action.
    await staff(cashierT, "POST", `/branches/${dxb1}/waitlist`, { name: "Second", partySize: 1 });
    const now = (await staff(cashierT, "GET", `/branches/${dxb1}/waitlist`)).body;
    const wally = now.entries.find((e: any) => e.id === mine.id);
    expect(wally.status).toBe("NOTIFIED");
    expect(wally.offeredDevice).toBeTruthy();
    expect((await app_(p.token, "GET", "/waitlist")).body.mine.status).toBe("WAITING"); // one free station, Wally was first
    expect(after.zones.length).toBeGreaterThan(0);

    await owner.query(`UPDATE "WaitlistEntry" SET "claimUntil" = now() - interval '1 minute' WHERE id = $1`, [mine.id]);
    await staff(cashierT, "POST", `/branches/${dxb1}/waitlist/${now.entries.find((e: any) => e.name === "Second").id}/cancel`);
    expect((await app_(p.token, "GET", "/waitlist")).body.mine.status).toBe("NOTIFIED"); // Wally's offer lapsed → next
    expect((await app_(p.token, "DELETE", "/waitlist")).status).toBe(204);
    await owner.query(`UPDATE "Device" SET status = 'AVAILABLE' WHERE "zoneId" = $1 AND "isOnline"`, [regularZone]);
  });

  it("rota: plan shifts, refuse overlaps, see who was late or missed", async () => {
    const emps = (await staff(ownerT, "GET", "/employees")).body as any[];
    const cashier = emps.find((e) => e.user?.email === "cashier@demo.test" || /cashier/i.test(e.displayName));
    await owner.query(`DELETE FROM "ShiftPlan" WHERE "employeeId" = $1`, [cashier.id]);
    const start = new Date(Date.now() - 3 * 3_600_000);
    const shift = { employeeId: cashier.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * 3_600_000).toISOString() };
    expect((await staff(ownerT, "POST", `/branches/${dxb1}/rota`, shift)).status).toBe(201);
    expect((await staff(ownerT, "POST", `/branches/${dxb1}/rota`, { ...shift, startsAt: new Date(start.getTime() + 3_600_000).toISOString(), endsAt: new Date(start.getTime() + 4 * 3_600_000).toISOString() })).body.error).toBe("shift_overlaps");
    const r = (await staff(ownerT, "GET", `/branches/${dxb1}/rota?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`)).body;
    const mine = r.shifts.find((s: any) => s.employee.id === cashier.id && s.startsAt === start.toISOString());
    expect(["MISSED", "LATE", "ON_TIME"]).toContain(mine.status);
    expect((await staff(cashierT, "POST", `/branches/${dxb1}/rota`, shift)).status).toBe(403); // a cashier can't plan the rota
  });

  it("insights: forecast, anomalies, station health and a price preview", async () => {
    const f = (await staff(ownerT, "GET", `/branches/${dxb1}/forecast`)).body;
    expect(f.hours).toHaveLength(7 * 24);
    expect(f.days.length).toBeGreaterThanOrEqual(7);
    const an = await staff(ownerT, "GET", `/branches/${dxb1}/anomalies?days=30`);
    expect(an.status, JSON.stringify(an.body)).toBe(200);
    expect(Array.isArray(an.body.findings)).toBe(true);
    const h = (await staff(ownerT, "GET", `/branches/${dxb1}/station-health`)).body;
    expect(h.stations.length).toBeGreaterThan(0);
    const plan = ((await staff(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.billingMode === "PER_HOUR");
    const pv = await staff(ownerT, "POST", `/pricing/plans/${plan.id}/preview`, { rate: Number(plan.rate) * 2 });
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    expect(Number(pv.body.wouldHaveBeen)).toBeCloseTo(Number(pv.body.actual) * 2, 1);
    expect((await staff(cashierT, "GET", `/branches/${dxb1}/anomalies`)).status).toBe(403);
  });

  it("account: usage, an upgrade request becomes a lead, announcements come and go", async () => {
    const u = (await staff(ownerT, "GET", "/organization/usage")).body;
    expect(u.stations).toMatchObject({ used: expect.any(Number) });
    expect((await staff(ownerT, "POST", "/organization/upgrade-request", { plan: "ENTERPRISE", note: "Opening a second floor" })).status).toBe(200);
    const leads = (await plat("GET", "/leads?kind=UPGRADE")).body as any[];
    expect(leads.find((l) => l.notes === "Opening a second floor")).toMatchObject({ kind: "UPGRADE", plan: "ENTERPRISE", venue: expect.any(String) });

    const a = (await plat("POST", "/announcements", { title: `Maintenance ${key().slice(0, 4)}`, body: "Sunday 3am, 10 minutes." })).body;
    expect((await staff(cashierT, "GET", "/announcements")).body.some((x: any) => x.id === a.id)).toBe(true);
    expect((await staff(cashierT, "POST", `/announcements/${a.id}/read`)).status).toBe(204);
    expect((await staff(cashierT, "GET", "/announcements")).body.some((x: any) => x.id === a.id)).toBe(false);
    expect((await plat("GET", "/announcements")).body.find((x: any) => x.id === a.id).reads).toBe(1);
    await plat("POST", `/announcements/${a.id}/end`);
    expect((await staff(ownerT, "GET", "/announcements")).body.some((x: any) => x.id === a.id)).toBe(false);
  });

  it("billing: choosing a plan pays by card, and the platform's webhook activates it", async () => {
    const b = (await staff(ownerT, "GET", "/billing")).body;
    expect(b.cardPayments).toBe(true);
    const plan = b.plans.find((p: any) => p.code === "PRO");
    const c = await staff(ownerT, "POST", "/billing/plan", { planId: plan.id });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.url).toMatch(/^https:\/\/checkout\.test\//);
    const session = checkouts.at(-1)!;
    expect(session.auth).toBe("Bearer sk_test_platform");
    const inv = (await staff(ownerT, "GET", "/billing")).body.invoices.find((i: any) => i.status === "OPEN");
    expect(session["metadata[invoiceId]"]).toBe(inv.id);
    const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: session.id, payment_status: "paid", amount_total: Number(session["line_items[0][price_data][unit_amount]"]), currency: session["line_items[0][price_data][currency]"], metadata: { kind: "subscription_invoice", invoiceId: inv.id, planId: plan.id } } } });
    expect((await req(`${pbase}/v1/public/billing/stripe-webhook`, null, "POST", event, { "stripe-signature": "t=1,v1=00" })).status).toBe(403);
    expect((await req(`${pbase}/v1/public/billing/stripe-webhook`, null, "POST", event, { "stripe-signature": signWebhook(BILLING_HOOK, event) })).status).toBe(200);
    const after = (await staff(ownerT, "GET", "/billing")).body;
    expect(after.invoices.find((i: any) => i.id === inv.id).status).toBe("PAID");
    expect(after.subscription).toMatchObject({ status: "ACTIVE", plan: { code: "PRO" } });
    expect((await staff(cashierT, "GET", "/billing")).status).toBe(403);
  });

  it("support sign-in: read-only, audited, and over when ended", async () => {
    const list = await plat("GET", "/organizations?q=demo");
    const org = (list.body as any[]).find?.((o: any) => o.slug === "demo");
    expect(org, JSON.stringify(list).slice(0, 300)).toBeTruthy();
    const s = await plat("POST", `/organizations/${org.id}/impersonate`, { reason: "Customer asked for help with rates", minutes: 10 });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const t = s.body.accessToken as string;
    expect((await staff(t, "GET", "/organization")).status).toBe(200);
    expect((await staff(t, "GET", "/auth/me")).body.impersonatedBy).toBeTruthy();
    expect((await staff(t, "PATCH", "/organization", { displayName: "Hacked" })).status).toBe(403);
    expect((await plat("POST", `/impersonation/${s.body.sessionId}/end`)).status).toBe(200);
    expect((await staff(t, "GET", "/organization")).status).toBe(401);
  });

  it("releases: published builds reach the rollout share; paused ones don't", async () => {
    const v = `9.${Math.floor(Math.random() * 900)}.0`;
    const r = (await plat("POST", "/releases", { component: "WINDOWS_AGENT", version: v, artifactUrl: "https://downloads.test/agent.msi", sha256: "a".repeat(64), signature: "sig-sig-sig-sig-sig", rolloutPercent: 100 })).body;
    const check = (d: string) => req(`${pbase}/v1/public/releases/check?component=WINDOWS_AGENT&version=1.0.0&deviceId=${d}`, null, "GET");
    expect((await check("device-aaaaaaaa")).body.update).toBeNull(); // not published yet
    await plat("PATCH", `/releases/${r.id}`, { publish: true });
    expect((await check("device-aaaaaaaa")).body.update.version).toBe(v);
    await plat("PATCH", `/releases/${r.id}`, { paused: true });
    expect((await check("device-aaaaaaaa")).body.update).toBeNull();
    await plat("PATCH", `/releases/${r.id}`, { paused: false, rolloutPercent: 0 });
    expect((await check("device-aaaaaaaa")).body.update).toBeNull();
  });

  it("season pass, find a team, spending limits and guardians", async () => {
    const s = await staff(ownerT, "POST", "/seasons", { name: "October Season", startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), price: "10", tiers: [{ xp: 60, reward: { type: "POINTS", amount: 50 } }, { xp: 600, reward: { type: "BONUS", amount: 5 } }] });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const kid = await player({ money: "100", dob: "2014-03-01" });
    const parent = await player();
    // The kid caps their own spending; the season pass costs 10.
    expect((await app_(kid.token, "PUT", "/me/spending", { cap: "5" })).body.cap).toBe("5.00");
    expect((await app_(kid.token, "POST", `/seasons/${s.body.id}/join`)).body.error).toBe("spend_limit_reached");
    expect((await app_(kid.token, "PUT", "/me/spending", { cap: null })).body.cap).toBeNull();
    expect((await app_(kid.token, "POST", `/seasons/${s.body.id}/join`)).body).toEqual({ joined: true });
    const season = ((await app_(kid.token, "GET", "/seasons")).body as any[]).find((x) => x.id === s.body.id);
    expect(season).toMatchObject({ joined: true, xp: 0 });
    expect((await app_(kid.token, "POST", `/seasons/${s.body.id}/claim/0`)).body.error).toBe("not_reached");

    // Guardian: the kid shows a code, the parent links and sets a limit the kid can't lift.
    const code = (await app_(kid.token, "POST", "/me/guardian-code")).body.code;
    expect((await app_(parent.token, "POST", "/me/wards", { username: kid.username, code: "000000" === code ? "111111" : "000000" })).status).toBe(403);
    expect((await app_(parent.token, "POST", "/me/wards", { username: kid.username, code })).body).toEqual({ linked: true });
    const ward = (await app_(parent.token, "GET", "/me/spending")).body.wards[0];
    expect((await app_(parent.token, "PUT", `/me/wards/${ward.id}/spending`, { cap: "20" })).body).toMatchObject({ cap: "20.00", setByGuardian: true });
    expect((await app_(kid.token, "PUT", "/me/spending", { cap: null })).body.error).toBe("set_by_guardian");

    // Find a team.
    const post = (await app_(kid.token, "POST", "/lfg", { branchId: dxb1, game: "Valorant", playersNeeded: 1, startsAt: new Date(Date.now() + 3_600_000).toISOString() })).body;
    expect((await app_(parent.token, "POST", `/lfg/${post.id}/join`)).body).toEqual({ joined: true, full: true });
    expect((await app_(kid.token, "GET", "/lfg")).body.find((x: any) => x.id === post.id)).toMatchObject({ status: "FULL", mine: true, members: [expect.any(String)] });
    expect((await app_(parent.token, "POST", `/lfg/${post.id}/close`)).status).toBe(403);
  });

  it("card top-up through the venue's gateway, receipts, and table ordering", async () => {
    const gw = await staff(ownerT, "PUT", "/payments/gateway", { provider: "STRIPE", mode: "TEST", credentialsRef: "env:VENUE_STRIPE_KEY_TEST", webhookSecretRef: "env:VENUE_STRIPE_HOOK_TEST", isActive: true }, "Card top-ups for the app");
    expect(gw.body.gateway, JSON.stringify(gw)).toMatchObject({ secretFound: true, webhookSecretFound: true });
    const p = await player();
    expect((await app_(p.token, "GET", "/wallet/card")).body).toEqual({ available: true });
    const c = await app_(p.token, "POST", "/wallet/checkout", { amount: "25" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const s = checkouts.at(-1)!;
    expect(s.auth).toBe("Bearer sk_test_venue");
    const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: s.id, payment_status: "paid", amount_total: Number(s["line_items[0][price_data][unit_amount]"]), currency: "aed", metadata: { kind: "wallet_topup", topUpId: c.body.topUpId } } } });
    expect((await req(`${base}/v1/app/demo/stripe-webhook`, null, "POST", event, { "stripe-signature": signWebhook("wrong", event) })).status).toBe(403);
    expect((await req(`${base}/v1/app/demo/stripe-webhook`, null, "POST", event, { "stripe-signature": signWebhook(VENUE_HOOK, event) })).status).toBe(200);
    expect((await req(`${base}/v1/app/demo/stripe-webhook`, null, "POST", event, { "stripe-signature": signWebhook(VENUE_HOOK, event) })).status).toBe(200); // replayed: credited once
    const w = (await staff(ownerT, "GET", `/customers/${p.id}/wallet`)).body;
    expect(Number(w.cash ?? w.cashBalance ?? w.total)).toBe(25);

    const bills = (await app_(p.token, "GET", "/me/bills")).body as any[];
    expect(bills.length).toBe(1);
    const r = (await app_(p.token, "GET", `/me/bills/${bills[0].id}`)).body;
    expect(r).toMatchObject({ venue: { name: expect.any(String) }, totals: { total: "25.00" }, payments: [{ method: "CARD" }] });
    expect((await staff(ownerT, "GET", `/bills/${bills[0].id}/receipt`)).body.bill.id).toBe(bills[0].id);
    const other = await player();
    expect((await app_(other.token, "GET", `/me/bills/${bills[0].id}`)).status).toBe(404);

    const qr = await staff(ownerT, "GET", `/branches/${dxb1}/table-qr`);
    expect(qr.status).toBe(200);
    if (qr.body.tables.length) {
      expect(qr.body.tables[0].url).toMatch(/\/demo\?table=/);
      const menu = (await app_(p.token, "GET", `/tables/${qr.body.tables[0].id}`)).body;
      expect(menu.table.name).toBe(qr.body.tables[0].name);
    }
  });

  it("running late holds a booking past the usual grace", async () => {
    const p = await player({ money: "200" });
    const startsAt = new Date(Date.now() + 30 * 60_000);
    const b = await staff(cashierT, "POST", `/branches/${dxb1}/bookings`, { zoneId: regularZone, customerId: p.id, startsAt: startsAt.toISOString(), minutes: 60, players: 1, idempotencyKey: key() });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const id = b.body.id;
    if (b.body.status !== "CONFIRMED") await staff(cashierT, "POST", `/bookings/${id}/confirm`, {});
    const late = await app_(p.token, "POST", `/bookings/${id}/late`);
    expect(late.status, JSON.stringify(late.body)).toBe(200);
    expect(new Date(late.body.holdUntil).getTime()).toBe(startsAt.getTime() + 30 * 60_000);
    expect((await app_(p.token, "POST", `/bookings/${id}/late`)).body.error).toBe("already_late");
    expect((await app_(p.token, "GET", `/bookings/${id}/directions`)).body.mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps/);
  });

  it("venue health: a trial about to end and a venue playing far less than usual are flagged, and sign-ups are counted by month", async () => {
    const run = randomUUID().slice(0, 8);
    const plans = (await plat("GET", "/plans")).body.plans as Array<{ id: string; code: string }>;
    const made = await plat("POST", "/organizations", { displayName: `Health ${run}`, slug: `h-${run}`, countryCode: "AE", planId: plans[0]!.id, ownerEmail: `h-${run}@platform.test`, ownerName: "Hana Health" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.organization.id as string;
    await owner.query(`UPDATE "Organization" SET status = 'TRIAL' WHERE id = $1`, [id]);
    await owner.query(`UPDATE "Subscription" SET "currentPeriodEnd" = now() + interval '2 days' WHERE "organizationId" = $1`, [id]);
    const row = async () => ((await plat("GET", "/health")).body.venues as Array<{ id: string; flags: string[] }>).find((v) => v.id === id)!;
    expect((await row()).flags).toContain("Trial ends in 2 days");
    await owner.query(`UPDATE "Subscription" SET "currentPeriodEnd" = now() - interval '1 day' WHERE "organizationId" = $1`, [id]);
    expect((await row()).flags).toContain("Trial has ended");
    await owner.query(`UPDATE "Subscription" SET "currentPeriodEnd" = now() + interval '20 days' WHERE "organizationId" = $1`, [id]);
    expect((await row()).flags.filter((f) => /^Trial (ends|has)/.test(f))).toEqual([]);

    const month = new Date().toISOString().slice(0, 7);
    const c = (await plat("GET", "/health")).body.cohorts as Array<{ month: string; signedUp: number; trial: number }>;
    expect(c.find((x) => x.month === month)).toMatchObject({ signedUp: expect.any(Number), trial: expect.any(Number) });
    expect(c.find((x) => x.month === month)!.signedUp).toBeGreaterThanOrEqual(1);
  });

  it("platform search finds venues and their people, and treats % and _ as plain characters", async () => {
    const run = randomUUID().slice(0, 8);
    const plans = (await plat("GET", "/plans")).body.plans as Array<{ id: string }>;
    const made = await plat("POST", "/organizations", { displayName: `Findme ${run}`, slug: `f-${run}`, countryCode: "AE", planId: plans[0]!.id, ownerEmail: `owner-${run}@find.test`, ownerName: "Fiona Finder" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.organization.id as string;
    const byName = (await plat("GET", `/search?q=Findme%20${run}`)).body.results as Array<{ kind: string; href: string }>;
    expect(byName.find((r) => r.kind === "Venue")?.href).toBe(`/platform/organizations/${id}`);
    const byOwner = (await plat("GET", `/search?q=owner-${run}%40find.test`)).body.results as Array<{ kind: string; href: string }>;
    expect(byOwner.find((r) => r.kind === "Person")?.href).toBe(`/platform/organizations/${id}`);
    expect((await plat("GET", "/search?q=a")).body.results).toEqual([]);
    expect((await plat("GET", "/search?q=%25%25")).body.results).toEqual([]); // "%%" is not a wildcard
    expect((await req(`${pbase}/v1/platform/search?q=demo`, null, "GET")).status).toBe(401);
  });

  it("curfew: an under-age player can't start a session during it", async () => {
    const org = await staff(ownerT, "GET", "/organization");
    await staff(ownerT, "PATCH", "/organization", { settings: { ...org.body.settings, minorCurfew: { from: "00:00", to: "23:59", underAge: 18 } } });
    try {
      const kid = await player({ dob: "2013-01-01" });
      const a = await station();
      const r = await staff(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { customerId: kid.id, request: { kind: "minutes", minutes: 30 }, payment: { method: "CASH" }, idempotencyKey: key() });
      expect(r.body.error).toBe("curfew");
    } finally {
      await staff(ownerT, "PATCH", "/organization", { settings: org.body.settings });
    }
  });
});
