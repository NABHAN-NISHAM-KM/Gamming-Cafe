// Phase 6 end-to-end: money wallet (top-up, bonus, spend order, overdraft
// refusal), memberships (sale, renewal, discount, expiry), bookings (no double
// booking even under a race, sessions can't run into a booking, check-in,
// no-shows) and the customer app (its own tokens, isolation, buying with the
// wallet) — against real Postgres, a listening API and simulated agents.
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

process.env["BOOKING_SWEEP_MS"] = "300";
process.env["MEMBERSHIP_SWEEP_MS"] = "300";
process.env["SESSION_SWEEP_MS"] = "500";
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
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe.skipIf(!HAS_DB)("Customers, wallet, memberships & bookings (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const agents: SimAgent[] = [];
  let ownerT: string, cashierT: string, rivalT: string;
  let dxb1: string, regularZone: string, regularPlan: string, pkg3h: string, goldTier: string;

  const call = async (token: string | null, method: string, path: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;
  const newCustomer = async (o: { password?: string } = {}) => {
    const username = `c${randomUUID().slice(0, 8)}`;
    const r = await call(cashierT, "POST", "/customers", { username, displayName: `Test ${username}`, password: o.password ?? "secret123" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { id: r.body.id as string, username };
  };
  const topUp = (token: string, customerId: string, amount: string, bonus?: string, reason?: string) =>
    call(token, "POST", `/customers/${customerId}/wallet/topup`, { branchId: dxb1, amount, ...(bonus ? { bonus } : {}), payment: { method: "CASH" }, idempotencyKey: key() }, reason);
  const wallet = async (customerId: string) => (await call(ownerT, "GET", `/customers/${customerId}/wallet`)).body;
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
    [ownerT, cashierT, rivalT] = (await Promise.all(["owner@demo.test", "cashier@demo.test", "owner@rival.test"].map(login))) as [string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;
    const reg = ((await call(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.name === "Regular PC");
    regularPlan = reg.id;
    pkg3h = reg.pricingPackages.find((k: any) => k.name === "3 hours").id;
    goldTier = ((await call(ownerT, "GET", "/membership-tiers")).body as any[]).find((t) => t.code === "GOLD").id;
    // Earlier runs' simulated PCs are offline forever; retire them so bookings only see this run's stations.
    await owner.query(`UPDATE "Device" SET "isEnabled" = false WHERE "agentVersion" = '0.1.0-sim' AND "branchId" = $1`, [dxb1]);
  }, 90_000);

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
    await owner.end();
  });

  describe("wallet", () => {
    it("top-up at the counter credits cash once, even if the request is retried", async () => {
      const c = await newCustomer();
      const k = key();
      const body = { branchId: dxb1, amount: "100", payment: { method: "CASH" }, idempotencyKey: k };
      expect((await call(cashierT, "POST", `/customers/${c.id}/wallet/topup`, body)).status).toBe(201);
      expect((await call(cashierT, "POST", `/customers/${c.id}/wallet/topup`, body)).body.duplicate).toBe(true);
      const w = await wallet(c.id);
      expect(w).toMatchObject({ currency: "AED", cash: "100.00", bonus: "0.00", total: "100.00" });
      expect(w.ledger.filter((l: any) => l.type === "TOPUP" && l.bucket === "CASH")).toHaveLength(1);
    });

    it("bonus credit needs the sensitive adjust right (with a reason); cashiers can't hand it out", async () => {
      const c = await newCustomer();
      expect((await topUp(cashierT, c.id, "100", "10")).status).toBe(403);
      expect((await topUp(ownerT, c.id, "100", "10")).status).toBe(403); // no reason given
      expect((await topUp(ownerT, c.id, "100", "10", "Opening promo")).status).toBe(201);
      const w = await wallet(c.id);
      expect(w).toMatchObject({ cash: "100.00", bonus: "10.00", total: "110.00" });
      expect(w.ledger.find((l: any) => l.bucket === "BONUS").expiresAt).toBeTruthy();
    });

    it("pays a session from the wallet: bonus first, then cash; refuses an overdraft without touching anything", async () => {
      const a = await newStation();
      const c = await newCustomer();
      await topUp(ownerT, c.id, "20", "10", "promo");
      const start = (minutes: number) =>
        call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, customerId: c.id, request: { kind: "minutes", minutes }, payment: { method: "WALLET" }, idempotencyKey: key() });
      const tooMuch = await start(180); // AED 45 > 30 available
      expect(tooMuch.status).toBe(409);
      expect(tooMuch.body).toMatchObject({ error: "insufficient_funds" });
      expect(await wallet(c.id)).toMatchObject({ cash: "20.00", bonus: "10.00" });
      const ok = await start(60); // AED 15: 10 bonus + 5 cash
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const w = await wallet(c.id);
      expect(w).toMatchObject({ cash: "15.00", bonus: "0.00" });
      expect(w.ledger.filter((l: any) => l.type === "SPEND").map((l: any) => [l.bucket, l.amount]).sort()).toEqual([["BONUS", "-10.00"], ["CASH", "-5.00"]]);
      await call(cashierT, "POST", `/sessions/${ok.body.id}/end`, { reason: "test" });
      // A guest session can't be paid from a wallet.
      const guest = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 60 }, payment: { method: "WALLET" }, idempotencyKey: key() });
      expect(guest.body.error).toBe("wallet_needs_customer");
    });

    it("manual adjustment needs a reason and is audited; a frozen wallet can't be spent", async () => {
      const c = await newCustomer();
      const adj = (reason?: string) => call(ownerT, "POST", `/customers/${c.id}/wallet/adjust`, { branchId: dxb1, bucket: "CASH", amount: "25", reason: "Goodwill — slow PC", idempotencyKey: key() }, reason);
      expect((await adj()).status).toBe(403);
      expect((await adj("goodwill")).status).toBe(201);
      expect((await call(cashierT, "POST", `/customers/${c.id}/wallet/adjust`, { branchId: dxb1, bucket: "CASH", amount: "25", reason: "x-x-x", idempotencyKey: key() }, "hi")).status).toBe(403);
      expect((await call(ownerT, "POST", `/customers/${c.id}/wallet/freeze`, { frozen: true }, "chargeback")).status).toBe(200);
      const buy = await call(cashierT, "POST", `/customers/${c.id}/time`, { branchId: dxb1, planId: regularPlan, packageId: pkg3h, payment: { method: "WALLET" }, idempotencyKey: key() });
      expect(buy.body.error).toBe("wallet_frozen");
      const audit = await owner.query(`SELECT action FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "chainSeq"`, [c.id]);
      expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["wallet.adjust", "wallet.freeze"]));
    });
  });

  describe("memberships", () => {
    it("selling Gold from the wallet sets the tier, grants bonus minutes and discounts the next session", async () => {
      const a = await newStation();
      const c = await newCustomer();
      await topUp(ownerT, c.id, "250");
      const sold = await call(cashierT, "POST", `/customers/${c.id}/memberships`, { branchId: dxb1, tierId: goldTier, payment: { method: "WALLET" }, idempotencyKey: key() });
      expect(sold.status, JSON.stringify(sold.body)).toBe(201);
      expect(sold.body).toMatchObject({ amount: "199.00" });
      expect((await call(ownerT, "GET", `/customers/${c.id}`)).body).toMatchObject({ membershipTier: { code: "GOLD" }, timeBalanceMinutes: 180 });
      expect(await wallet(c.id)).toMatchObject({ cash: "51.00" });
      const q = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions/quote`, { planId: regularPlan, customerId: c.id, request: { kind: "minutes", minutes: 60 } });
      expect(q.body.quote.membershipDiscountMinor).toBe(q.body.quote.grossMinor * 0.2); // Gold: −20 %
    });

    it("renewal adds a period on top; expiry drops the tier automatically", async () => {
      const c = await newCustomer();
      const sell = () => call(ownerT, "POST", `/customers/${c.id}/memberships`, { branchId: dxb1, tierId: goldTier, payment: { method: "CARD" }, idempotencyKey: key() });
      const first = (await sell()).body.membership;
      const second = (await sell()).body.membership;
      expect(second.id).toBe(first.id);
      expect(new Date(second.expiresAt).getTime() - new Date(first.expiresAt).getTime()).toBeGreaterThan(29 * 86_400_000);
      await owner.query(`UPDATE "Membership" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [first.id]);
      await until(async () => (await call(ownerT, "GET", `/customers/${c.id}`)).body.membershipTier === null);
      expect((await call(ownerT, "GET", `/customers/${c.id}/memberships`)).body[0].status).toBe("EXPIRED");
    });

    it("tiers are managed by owners only; a sold tier must have a duration", async () => {
      expect((await call(cashierT, "POST", "/membership-tiers", { code: "BRONZE", name: "Bronze", rank: 5 })).status).toBe(403);
      expect((await call(ownerT, "POST", "/membership-tiers", { code: `T${randomUUID().slice(0, 6).toUpperCase()}`, name: "Promo", rank: 1, price: 10 })).body.error).toBe("sold_tier_needs_duration");
    });
  });

  describe("bookings", () => {
    it("books free stations by zone; the database refuses a double booking, even when two requests race", async () => {
      const [a, b] = [await newStation(), await newStation()];
      const startsAt = inMin(24 * 60 + Math.floor(Math.random() * 600));
      const avail = (await call(cashierT, "GET", `/branches/${dxb1}/availability?zoneId=${regularZone}&startsAt=${encodeURIComponent(startsAt)}&minutes=120`)).body[0];
      expect(avail.free).toBeGreaterThanOrEqual(2);
      const target = [a.identity!.deviceId];
      const race = await Promise.all([1, 2, 3].map(() => call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: target, startsAt, minutes: 120, contactName: "Walk-in", idempotencyKey: key() })));
      expect(race.filter((r) => r.status === 201)).toHaveLength(1);
      expect(race.filter((r) => r.status === 409).every((r) => r.body.error === "slot_taken")).toBe(true);
      const ok = race.find((r) => r.status === 201)!.body;
      expect(ok).toMatchObject({ status: "CONFIRMED", minutes: 120, devices: [{ id: a.identity!.deviceId }] });
      expect(ok.reference).toMatch(/^BK-/);
      expect(Number(ok.estimatedTotal)).toBeGreaterThan(0); // priced from the rate card that applies at the start time
      // Overlapping by 30 min on the same PC is also refused; the other PC is fine.
      const later = new Date(new Date(startsAt).getTime() + 90 * 60_000).toISOString();
      expect((await call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: target, startsAt: later, minutes: 60, contactName: "x", idempotencyKey: key() })).body.error).toBe("slot_taken");
      expect((await call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: [b.identity!.deviceId], startsAt: later, minutes: 60, contactName: "x", idempotencyKey: key() })).status).toBe(201);
      // Cancelling frees the slot.
      await call(cashierT, "POST", `/bookings/${ok.id}/cancel`, { reason: "changed plans" });
      expect((await call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: target, startsAt, minutes: 120, contactName: "x", idempotencyKey: key() })).status).toBe(201);
    });

    it("a walk-in session can't be sold into a booking; a shorter one can", async () => {
      const a = await newStation();
      const id = a.identity!.deviceId;
      await call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: [id], startsAt: inMin(60), minutes: 60, contactName: "Team", idempotencyKey: key() });
      const long = await call(cashierT, "POST", `/devices/${id}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 120 }, payment: { method: "CASH" }, idempotencyKey: key() });
      expect(long.status).toBe(409);
      expect(long.body).toMatchObject({ error: "device_booked" });
      expect(long.body.freeMinutes).toBeGreaterThanOrEqual(58);
      const short = await call(cashierT, "POST", `/devices/${id}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 45 }, payment: { method: "CASH" }, idempotencyKey: key() });
      expect(short.status, JSON.stringify(short.body)).toBe(201);
      await call(cashierT, "POST", `/sessions/${short.body.id}/end`, { reason: "t" });
    });

    it("check-in starts a session on every booked PC until the booking ends", async () => {
      const [a, b] = [await newStation(), await newStation()];
      const c = await newCustomer();
      await topUp(ownerT, c.id, "100");
      const bk = (await call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: [a.identity!.deviceId, b.identity!.deviceId], startsAt: inMin(5), minutes: 60, customerId: c.id, idempotencyKey: key() })).body;
      const ci = await call(cashierT, "POST", `/bookings/${bk.id}/check-in`, { payment: { method: "WALLET" } });
      expect(ci.status, JSON.stringify(ci.body)).toBe(200);
      expect(ci.body).toMatchObject({ status: "CHECKED_IN" });
      expect(ci.body.sessionIds).toHaveLength(2);
      await until(() => a.activeSession !== null && b.activeSession !== null);
      const s = (await call(ownerT, "GET", `/sessions/${ci.body.sessionIds[0]}`)).body;
      expect(new Date(s.expiresAt).getTime()).toBeLessThanOrEqual(new Date(bk.endsAt).getTime() + 1000);
      const paid = (await Promise.all(ci.body.sessionIds.map((id: string) => call(ownerT, "GET", `/sessions/${id}`)))).reduce((a, r) => a + Number(r.body.amountDue), 0);
      expect(paid).toBeGreaterThan(0);
      expect(Number((await wallet(c.id)).cash)).toBeCloseTo(100 - paid, 2); // both stations paid from the wallet
      for (const id of ci.body.sessionIds) await call(cashierT, "POST", `/sessions/${id}/end`, { reason: "t" });
    });

    it("a booking nobody shows up for becomes a no-show by itself", async () => {
      const a = await newStation();
      const bk = (await call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: [a.identity!.deviceId], startsAt: inMin(1), minutes: 60, contactName: "Ghost", idempotencyKey: key() })).body;
      await owner.query(`UPDATE "Booking" SET "startsAt" = now() - interval '20 minutes', "endsAt" = now() + interval '40 minutes' WHERE id = $1`, [bk.id]);
      await until(async () => (await call(cashierT, "GET", `/bookings/${bk.id}`)).body.status === "NO_SHOW");
      // …and the PC is free again straight away.
      const s = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 30 }, payment: { method: "CASH" }, idempotencyKey: key() });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "t" });
    });

    it("another organization can't see or touch the bookings", async () => {
      const list = await call(ownerT, "GET", `/branches/${dxb1}/bookings?upcoming=1`);
      const any = (list.body as any[])[0];
      expect(any).toBeTruthy();
      expect((await call(rivalT, "GET", `/bookings/${any.id}`)).status).toBe(404);
      expect((await call(rivalT, "POST", `/bookings/${any.id}/cancel`, { reason: "evil" })).status).toBe(404);
      expect((await call(rivalT, "GET", `/branches/${dxb1}/bookings`)).status).toBe(404);
    });
  });

  describe("customer app", () => {
    const app_ = (token: string | null, method: string, path: string, body?: unknown) => call(token, method, `/app${path}`, body);

    it("sign-up, sign-in, profile with wallet; wrong password and duplicate names are refused", async () => {
      const venue = (await app_(null, "GET", "/demo/venue")).body;
      expect(venue.name).toBe("Demo Arena");
      expect(venue.branches.map((b: any) => b.code)).toContain("DXB1");
      const username = `app${randomUUID().slice(0, 8)}`;
      const reg = await app_(null, "POST", "/demo/register", { username, displayName: "App User", password: "longenough1", dateOfBirth: "2000-01-01" });
      expect(reg.status, JSON.stringify(reg.body)).toBe(201);
      expect((await app_(null, "POST", "/demo/register", { username, displayName: "Again", password: "longenough1" })).body.error).toBe("username_taken");
      expect((await app_(null, "POST", "/demo/login", { username, password: "wrong-one" })).status).toBe(401);
      const tok = (await app_(null, "POST", "/demo/login", { username, password: "longenough1" })).body.accessToken;
      const me = (await app_(tok, "GET", "/me")).body;
      expect(me).toMatchObject({ username, wallet: { currency: "AED", total: "0.00", timeMinutes: 0 }, membershipTier: null });
      expect(me.passwordHash).toBeUndefined();
    });

    it("customer and staff tokens are not interchangeable; logout ends the token; venues are separate", async () => {
      const c = await newCustomer({ password: "custpass1" });
      const tok = (await app_(null, "POST", "/demo/login", { username: c.username, password: "custpass1" })).body.accessToken;
      expect((await call(tok, "GET", "/customers")).status).toBe(401); // customer token on a staff route
      expect((await app_(ownerT, "GET", "/me")).status).toBe(401); // staff token on a customer route
      expect((await app_(null, "POST", "/rival/login", { username: c.username, password: "custpass1" })).status).toBe(401); // other venue
      expect((await app_(tok, "POST", "/logout")).status).toBe(204);
      expect((await app_(tok, "GET", "/me")).status).toBe(401);
    });

    it("buys a time package and a membership with wallet credit", async () => {
      const c = await newCustomer({ password: "custpass1" });
      await topUp(ownerT, c.id, "300");
      const tok = (await app_(null, "POST", "/demo/login", { username: c.username, password: "custpass1" })).body.accessToken;
      const shop = (await app_(tok, "GET", `/shop?branchId=${dxb1}`)).body;
      const plan = shop.plans.find((p: any) => p.name === "Regular PC");
      const pkg = plan.pricingPackages.find((p: any) => p.name === "3 hours");
      const bought = await app_(tok, "POST", "/time", { branchId: dxb1, planId: plan.id, packageId: pkg.id, idempotencyKey: key() });
      expect(bought.status, JSON.stringify(bought.body)).toBe(201);
      expect(bought.body).toMatchObject({ minutesAdded: 180, amount: "40.00" });
      const gold = shop.tiers.find((t: any) => t.code === "GOLD");
      expect((await app_(tok, "POST", "/memberships", { branchId: dxb1, tierId: gold.id, idempotencyKey: key() })).status).toBe(201);
      const me = (await app_(tok, "GET", "/me")).body;
      expect(me).toMatchObject({ membershipTier: { code: "GOLD" }, wallet: { total: "61.00", timeMinutes: 360 } });
      const tooMuch = await app_(tok, "POST", "/memberships", { branchId: dxb1, tierId: gold.id, idempotencyKey: key() });
      expect(tooMuch.body.error).toBe("insufficient_funds");
    });

    it("books in the app within the tier's window; sees counts not stations; can't cancel others' bookings", async () => {
      await newStation();
      const c = await newCustomer({ password: "custpass1" });
      const tok = (await app_(null, "POST", "/demo/login", { username: c.username, password: "custpass1" })).body.accessToken;
      const startsAt = inMin(3 * 24 * 60);
      const avail = (await app_(tok, "GET", `/availability?branchId=${dxb1}&zoneId=${regularZone}&startsAt=${encodeURIComponent(startsAt)}&minutes=60`)).body;
      expect(avail[0].free).toBeGreaterThanOrEqual(1);
      expect(avail[0].devices).toBeUndefined();
      expect((await app_(tok, "POST", "/bookings", { branchId: dxb1, zoneId: regularZone, startsAt: inMin(9 * 24 * 60), minutes: 60, idempotencyKey: key() })).body).toMatchObject({ error: "too_far_ahead", maxDays: 7 });
      const bk = await app_(tok, "POST", "/bookings", { branchId: dxb1, zoneId: regularZone, startsAt, minutes: 60, idempotencyKey: key() });
      expect(bk.status, JSON.stringify(bk.body)).toBe(201);
      expect(bk.body).toMatchObject({ source: "CUSTOMER_WEB", customer: { id: c.id } });
      expect((await app_(tok, "GET", "/bookings")).body.map((b: any) => b.id)).toContain(bk.body.id);

      const other = await newCustomer({ password: "custpass1" });
      const otherTok = (await app_(null, "POST", "/demo/login", { username: other.username, password: "custpass1" })).body.accessToken;
      expect((await app_(otherTok, "POST", `/bookings/${bk.body.id}/cancel`)).status).toBe(404);
      expect((await app_(otherTok, "GET", "/bookings")).body).toEqual([]);
      expect((await app_(tok, "POST", `/bookings/${bk.body.id}/cancel`)).body.status).toBe("CANCELLED");
    });

    it("picks stations by name with their taken times (never who), prices them, and 'Pay now' prepays into the wallet", async () => {
      const [a, b] = [await newStation(), await newStation()];
      const c = await newCustomer({ password: "custpass1" });
      const tok = (await app_(null, "POST", "/demo/login", { username: c.username, password: "custpass1" })).body.accessToken;
      const venue = (await app_(null, "GET", "/demo/venue")).body;
      expect(venue.demoPayments).toBe(true); // test/dev installs only
      expect(venue.branches[0].code).toBe("DXB1"); // the branch with stations comes first
      expect(venue.branches[0].zones.find((z: any) => z.id === regularZone).stations).toBeGreaterThanOrEqual(2);

      // Someone else holds PC "a" tomorrow evening.
      const start = new Date(Date.now() + 26 * 3_600_000);
      await call(cashierT, "POST", `/branches/${dxb1}/bookings`, { deviceIds: [a.identity!.deviceId], startsAt: start.toISOString(), minutes: 60, contactName: "Private person", idempotencyKey: key() });
      const from = new Date(start.getTime() - 3 * 3_600_000).toISOString();
      const to = new Date(start.getTime() + 3 * 3_600_000).toISOString();
      const stations = (await app_(tok, "GET", `/stations?branchId=${dxb1}&zoneId=${regularZone}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).body as any[];
      const sa = stations.find((s) => s.id === a.identity!.deviceId);
      expect(sa.busy).toEqual([{ from: start.toISOString(), to: new Date(start.getTime() + 3_600_000).toISOString() }]);
      expect(JSON.stringify(stations)).not.toContain("Private person");
      expect(stations.find((s) => s.id === b.identity!.deviceId).busy).toEqual([]);

      const est = (await app_(tok, "GET", `/estimate?branchId=${dxb1}&zoneId=${regularZone}&startsAt=${encodeURIComponent(start.toISOString())}&minutes=120`)).body;
      expect(Number(est.perStation)).toBeGreaterThan(0);

      // Asking for the taken PC fails; the free one works, paid now with the demo card.
      expect((await app_(tok, "POST", "/bookings", { branchId: dxb1, zoneId: regularZone, deviceIds: [a.identity!.deviceId], startsAt: start.toISOString(), minutes: 120, payment: { method: "DEMO_CARD" }, idempotencyKey: key() })).body.error).toBe("slot_taken");
      expect(await wallet(c.id)).toMatchObject({ total: "0.00" }); // the failed attempt charged nothing
      const bk = await app_(tok, "POST", "/bookings", { branchId: dxb1, zoneId: regularZone, deviceIds: [b.identity!.deviceId], startsAt: start.toISOString(), minutes: 120, payment: { method: "DEMO_CARD" }, idempotencyKey: key() });
      expect(bk.status, JSON.stringify(bk.body)).toBe(201);
      expect(bk.body).toMatchObject({ devices: [{ id: b.identity!.deviceId }], depositAmount: est.perStation, estimatedTotal: est.perStation });
      const w = await wallet(c.id);
      expect(w.cash).toBe(est.perStation); // the prepayment waits in the wallet…
      expect(w.ledger[0]).toMatchObject({ type: "TOPUP", referenceType: "BOOKING" });
      const pay = await owner.query(`SELECT method, status, "bookingId" FROM "Payment" WHERE "bookingId" = $1`, [bk.body.id]);
      expect(pay.rows).toEqual([{ method: "ONLINE", status: "CAPTURED", bookingId: bk.body.id }]);
      // …and check-in pays from it.
      await owner.query(`UPDATE "Booking" SET "startsAt" = now() + interval '5 minutes', "endsAt" = now() + interval '125 minutes' WHERE id = $1`, [bk.body.id]);
      const ci = await call(cashierT, "POST", `/bookings/${bk.body.id}/check-in`, { payment: { method: "WALLET" } });
      expect(ci.status, JSON.stringify(ci.body)).toBe(200);
      expect(Number((await wallet(c.id)).cash)).toBeLessThan(Number(est.perStation) + 0.001);
      for (const id of ci.body.sessionIds) await call(cashierT, "POST", `/sessions/${id}/end`, { reason: "t" });
    });

    it("blocks password guessing", async () => {
      const c = await newCustomer({ password: "custpass1" });
      const tries = await Promise.all(Array.from({ length: 10 }, () => app_(null, "POST", "/demo/login", { username: c.username, password: "nope-nope" })));
      expect(tries.some((r) => r.status === 429)).toBe(true);
    });
  });
});
