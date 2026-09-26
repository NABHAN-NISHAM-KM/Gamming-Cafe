// Phase 10 end-to-end: loyalty (earning on settled bills, rewards, codes,
// adjustments, refunds, expiry, referrals), promotions (automatic, codes,
// bonus minutes, limits under concurrency), tournaments (fees, registration,
// brackets, results, prizes, refunds, the customer app) and CRM (segments,
// campaigns, the app inbox, Shell delivery) — against real Postgres, a
// listening API and simulated PCs. Promotions made here are paused at the end
// so other suites see normal prices.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { LoyaltyService } from "../src/loyalty/loyalty.service.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";
import { SimAgent } from "../scripts/sim-agent.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const key = () => randomUUID();
const tag = () => randomUUID().slice(0, 6).toLowerCase().replace(/-/g, "");
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
};

describe.skipIf(!HAS_DB)("Loyalty, promotions, tournaments & CRM (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const agents: SimAgent[] = [];
  const madePromotions: string[] = [];
  const started: string[] = [];
  let ownerT: string, cashierT: string, rivalT: string;
  let dxb1: string, regularZone: string, regularPlan: string, colaId: string, burgerId: string;

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
  const appLogin = async (username: string, password: string) => (await (await fetch(`${base}/v1/app/demo/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).json()).accessToken as string;
  const customer = async (over: Record<string, unknown> = {}) => {
    const u = `c${tag()}`;
    const r = await call(ownerT, "POST", "/customers", { username: u, displayName: `Test ${u}`, password: "testpass123", marketingConsent: true, ...over });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; username: string };
  };
  const points = async (id: string) => (await call(ownerT, "GET", `/customers/${id}/loyalty`)).body.points as number;
  const newAgent = async () => {
    const code = (await call(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId: regularZone, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60 });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.isOnline === true);
    return a;
  };
  const startSession = async (deviceId: string, body: Record<string, unknown>) => {
    const r = await call(cashierT, "POST", `/devices/${deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 60 }, payment: { method: "CARD" }, idempotencyKey: key(), ...body });
    if (r.status === 201) started.push(r.body.id);
    return r;
  };
  const promotion = async (body: Record<string, unknown>) => {
    const p = await call(ownerT, "POST", "/promotions", { type: "AUTOMATIC_DISCOUNT", ...body }, "e2e test promotion");
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    madePromotions.push(p.body.id);
    expect((await call(ownerT, "POST", `/promotions/${p.body.id}/status`, { status: "ACTIVE" }, "e2e test promotion")).status).toBe(200);
    return p.body.id as string;
  };
  const staticSegment = async (members: string[]) => {
    const s = await call(ownerT, "POST", "/segments", { name: `Test ${tag()}`, kind: "STATIC" }, "e2e segment");
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    await call(ownerT, "POST", `/segments/${s.body.id}/members`, { add: members }, "e2e segment");
    return s.body.id as string;
  };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT, rivalT] = (await Promise.all(["owner@demo.test", "cashier@demo.test", "owner@rival.test"].map(login))) as [string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;
    regularPlan = ((await call(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.name === "Regular PC").id;
    const menu = (await call(cashierT, "GET", `/branches/${dxb1}/menu`)).body;
    const products = menu.categories.flatMap((c: any) => c.products);
    colaId = products.find((p: any) => p.sku === "DRK-COLA").id;
    burgerId = products.find((p: any) => p.sku === "BRG-CLASSIC").id;
  });

  afterAll(async () => {
    for (const id of madePromotions) await call(ownerT, "POST", `/promotions/${id}/status`, { status: "PAUSED" }, "e2e cleanup");
    for (const id of started) await call(cashierT, "POST", `/sessions/${id}/end`, { reason: "test cleanup" });
    for (const a of agents) a.disconnect();
    await app?.close();
    await owner.end();
  });

  describe("loyalty", () => {
    it("a settled bill earns a point per AED on gaming and on food", async () => {
      const c = await customer();
      const pc = await newAgent();
      const s = await startSession(pc.identity!.deviceId, { customerId: c.id });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      expect(await points(c.id)).toBe(0); // the bill stays open while the session runs
      await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "done" });
      expect(await points(c.id)).toBe(15); // AED 15 of gaming
      const o = await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: c.id, lines: [{ productId: burgerId, quantity: 1 }], payments: [{ method: "CARD" }], idempotencyKey: key() });
      expect(o.status, JSON.stringify(o.body)).toBe(201);
      expect(await points(c.id)).toBe(15 + 32);
      const history = (await call(ownerT, "GET", `/customers/${c.id}/loyalty`)).body.history;
      expect(history.map((h: any) => h.source).sort()).toEqual(["GAMING", "RESTAURANT"]);
    });

    it("a refund takes back the points it earned", async () => {
      const c = await customer();
      const o = await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: c.id, lines: [{ productId: burgerId, quantity: 2 }], payments: [{ method: "CARD" }], idempotencyKey: key() });
      expect(await points(c.id)).toBe(64);
      const bill = (await call(cashierT, "GET", `/bills/${o.body.bill.id}`)).body;
      const r = await call(ownerT, "POST", `/payments/${bill.payments[0].id}/refund`, { amount: "32", destination: "ORIGINAL_METHOD", reason: "one burger returned", idempotencyKey: key() }, "one burger returned");
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(await points(c.id)).toBe(32);
    });

    it("rewards: free minutes at once, a personal code for a discount; not enough points is refused", async () => {
      const c = await customer();
      expect((await call(ownerT, "POST", `/customers/${c.id}/loyalty/adjust`, { points: 400, idempotencyKey: key() })).body.reason).toBe("REASON_REQUIRED");
      expect((await call(ownerT, "POST", `/customers/${c.id}/loyalty/adjust`, { points: 400, reason: "competition prize", idempotencyKey: key() }, "competition prize")).status).toBe(200);
      const rewards = (await call(ownerT, "GET", "/loyalty/rewards")).body as any[];
      const hour = rewards.find((r) => r.rewardType === "FREE_MINUTES");
      const food = rewards.find((r) => r.rewardType === "DISCOUNT_PERCENT");
      const r1 = await call(cashierT, "POST", `/customers/${c.id}/loyalty/redeem`, { rewardId: hour.id, idempotencyKey: key() });
      expect(r1.body).toMatchObject({ minutes: 60, balance: 400 - hour.costPoints });
      expect((await call(ownerT, "GET", `/customers/${c.id}/wallet`)).body.timeMinutes).toBe(60);
      const r2 = await call(cashierT, "POST", `/customers/${c.id}/loyalty/redeem`, { rewardId: food.id, idempotencyKey: key() });
      expect(r2.body.code).toMatch(/^RW[2-9A-Z]{8}$/);
      // The code is theirs only, and works once.
      const other = await customer();
      expect((await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: other.id, lines: [{ productId: burgerId, quantity: 1 }], promoCode: r2.body.code, payments: [{ method: "CARD" }], idempotencyKey: key() })).body.error).toBe("promo_code_not_yours");
      const o = await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: c.id, lines: [{ productId: burgerId, quantity: 1 }], promoCode: r2.body.code, payments: [{ method: "CARD" }], idempotencyKey: key() });
      expect(o.status, JSON.stringify(o.body)).toBe(201);
      expect(o.body.total).toBe("25.60"); // 32 − 20 %
      expect((await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: c.id, lines: [{ productId: burgerId, quantity: 1 }], promoCode: r2.body.code, idempotencyKey: key() })).body.error).toBe("promo_code_used_up");
      const broke = await customer();
      expect((await call(cashierT, "POST", `/customers/${broke.id}/loyalty/redeem`, { rewardId: hour.id, idempotencyKey: key() })).body.error).toBe("not_enough_points");
    });

    it("points expire oldest first: what was redeemed came out of the old points", async () => {
      const c = await customer();
      // 100 points earned long ago (now expired), 30 of them already spent.
      await owner.query(`UPDATE "Customer" SET "loyaltyPoints" = 100 WHERE id = $1`, [c.id]);
      const org = (await owner.query(`SELECT "organizationId" FROM "Customer" WHERE id = $1`, [c.id])).rows[0].organizationId;
      await owner.query(`INSERT INTO "LoyaltyTransaction" (id, "organizationId", "customerId", type, source, points, "balanceAfter", reason, "idempotencyKey", "expiresAt") VALUES (gen_random_uuid(), $1, $2, 'EARN', 'GAMING', 100, 100, 'old', $3, now() - interval '1 day')`, [org, c.id, `t:${key()}`]);
      await call(ownerT, "POST", `/customers/${c.id}/loyalty/adjust`, { points: -30, reason: "spent at the desk", idempotencyKey: key() }, "spent at the desk");
      await call(ownerT, "POST", `/customers/${c.id}/loyalty/adjust`, { points: 50, reason: "fresh points", idempotencyKey: key() }, "fresh points");
      await app.get(LoyaltyService).sweep();
      expect(await points(c.id)).toBe(50); // 70 old points expired; the fresh 50 stay
    });

    it("a friend's referral code earns them points when you first pay", async () => {
      const friend = await customer();
      const code = (await call(ownerT, "GET", `/customers/${friend.id}/loyalty`)).body.referralCode;
      const reg = await fetch(`${base}/v1/app/demo/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: `r${tag()}`, displayName: "Referred", password: "longpassword1", referralCode: code }) });
      expect(reg.status).toBe(201);
      const me = await (await fetch(`${base}/v1/app/me`, { headers: { authorization: `Bearer ${(await reg.json()).accessToken}` } })).json();
      await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: me.id, lines: [{ productId: colaId, quantity: 1 }], payments: [{ method: "CARD" }], idempotencyKey: key() });
      expect(await points(friend.id)).toBe(200);
      const bad = await fetch(`${base}/v1/app/demo/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: `r${tag()}`, displayName: "X", password: "longpassword1", referralCode: "NOPE1234" }) });
      expect((await bad.json()).error).toBe("referral_code_invalid");
    });
  });

  describe("promotions", () => {
    it("an automatic promotion for a segment discounts the session, once per customer", async () => {
      const c = await customer();
      const seg = await staticSegment([c.id]);
      await promotion({ name: `Seg deal ${tag()}`, conditions: { all: [{ segmentIn: [seg] }] }, effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 40 }], perCustomerLimit: 1 });
      const pc = await newAgent();
      const q = (await call(cashierT, "POST", `/devices/${pc.identity!.deviceId}/sessions/quote`, { planId: regularPlan, customerId: c.id, request: { kind: "minutes", minutes: 60 } })).body;
      expect(q.quote.totalMinor).toBe(900);
      expect(q.quote.lines.some((l: string) => l.includes("40% off"))).toBe(true);
      const s = await startSession(pc.identity!.deviceId, { customerId: c.id });
      expect(s.body.amountDue).toBe("9.00");
      await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "done" });
      const again = await startSession(pc.identity!.deviceId, { customerId: c.id });
      expect(again.body.amountDue).toBe("15.00"); // used already
      await call(cashierT, "POST", `/sessions/${again.body.id}/end`, { reason: "done" });
    });

    it("bonus minutes extend the session", async () => {
      const c = await customer();
      const seg = await staticSegment([c.id]);
      await promotion({ name: `Bonus ${tag()}`, conditions: { all: [{ segmentIn: [seg] }] }, effects: [{ type: "BONUS_MINUTES", minutes: 30 }], isStackable: true });
      const pc = await newAgent();
      const s = await startSession(pc.identity!.deviceId, { customerId: c.id });
      expect(s.body.amountDue).toBe("15.00");
      const minutes = Math.round((new Date(s.body.expiresAt).getTime() - new Date(s.body.startedAt).getTime()) / 60_000);
      expect(minutes).toBe(90);
      await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "done" });
    });

    it("promo codes: a fixed amount off an order, limited uses; bad codes are refused", async () => {
      const id = await promotion({ name: `Code ${tag()}`, type: "PROMO_CODE", requiresCode: true, effects: [{ type: "AMOUNT_OFF", target: "ORDER", value: 5 }] });
      const code = `T${tag()}`.toUpperCase();
      const made = await call(ownerT, "POST", `/promotions/${id}/codes`, { code, maxUses: 1 }, "e2e code");
      expect(made.body.codes).toEqual([code]);
      const o = await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", lines: [{ productId: burgerId, quantity: 1 }], promoCode: code.toLowerCase(), idempotencyKey: key() });
      expect(o.status, JSON.stringify(o.body)).toBe(201);
      expect(o.body.total).toBe("27.00");
      expect((await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", lines: [{ productId: burgerId, quantity: 1 }], promoCode: code, idempotencyKey: key() })).body.error).toBe("promo_code_used_up");
      expect((await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", lines: [{ productId: burgerId, quantity: 1 }], promoCode: "NOSUCHCODE", idempotencyKey: key() })).body.error).toBe("promo_code_invalid");
      const view = (await call(ownerT, "GET", `/promotions/${id}`)).body;
      expect(view).toMatchObject({ usageCount: 1, discountGiven: "5.00" });
    });

    it("a promotion's total limit holds even when two sales race for the last use", async () => {
      const [a, b] = [await customer(), await customer()];
      const seg = await staticSegment([a.id, b.id]);
      const id = await promotion({ name: `Race ${tag()}`, conditions: { all: [{ segmentIn: [seg] }] }, effects: [{ type: "AMOUNT_OFF", target: "ORDER", value: 10 }], totalUsageLimit: 1 });
      const tries = await Promise.all([a, b].map((c) => call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: c.id, lines: [{ productId: burgerId, quantity: 1 }], idempotencyKey: key() })));
      const discounted = tries.filter((t) => t.status === 201 && t.body.total === "22.00");
      expect(discounted).toHaveLength(1);
      expect((await call(ownerT, "GET", `/promotions/${id}`)).body.usageCount).toBe(1);
    });

    it("changing promotions is sensitive, and only for managers", async () => {
      expect((await call(ownerT, "POST", "/promotions", { name: "No reason", type: "AUTOMATIC_DISCOUNT", effects: [{ type: "PERCENT_OFF", target: "ORDER", value: 5 }] })).body.reason).toBe("REASON_REQUIRED");
      expect((await call(cashierT, "POST", "/promotions", { name: "Cashier", type: "AUTOMATIC_DISCOUNT", effects: [{ type: "PERCENT_OFF", target: "ORDER", value: 5 }] }, "trying")).status).toBe(403);
      expect((await call(ownerT, "POST", "/promotions", { name: "Bad", type: "AUTOMATIC_DISCOUNT", conditions: { all: [{ evil: true }] }, effects: [{ type: "PERCENT_OFF", target: "ORDER", value: 5 }] }, "x x")).status).toBe(400);
    });
  });

  describe("tournaments", () => {
    const create = async (over: Record<string, unknown> = {}) => {
      const r = await call(ownerT, "POST", "/tournaments", { branchId: dxb1, name: `Cup ${tag()}`, format: "SINGLE_ELIMINATION", maxTeams: 4, minTeams: 4, entryFee: 10, prizePool: 30, prizeDistribution: [{ place: 1, amount: 20 }, { place: 2, amount: 10 }], startsAt: new Date(Date.now() + 86_400_000).toISOString(), ...over });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      await call(ownerT, "POST", `/tournaments/${r.body.id}/status`, { status: "REGISTRATION_OPEN" });
      return r.body.id as string;
    };
    const enter = (id: string, c: { id: string; username: string }) => call(ownerT, "POST", `/tournaments/${id}/teams`, { teamName: c.username, captainId: c.id, payment: { method: "CARD" }, idempotencyKey: key() });

    it("paid registration → bracket → results → placements, prizes to the winner's wallet, points for everyone", async () => {
      const id = await create();
      const players = await Promise.all([1, 2, 3, 4].map(() => customer()));
      for (const p of players) expect((await enter(id, p)).status).toBe(201);
      expect((await call(ownerT, "POST", `/tournaments/${id}/teams`, { teamName: "again", captainId: players[0]!.id, payment: { method: "CARD" }, idempotencyKey: key() })).body.error).toBe("already_registered");
      expect((await enter(id, await customer())).body.error).toBe("tournament_full");
      const noFee = await call(ownerT, "POST", `/tournaments/${id}/teams`, { teamName: "x", captainId: (await customer()).id, idempotencyKey: key() });
      expect(["payment_required", "tournament_full"]).toContain(noFee.body.error);
      let t = (await call(ownerT, "POST", `/tournaments/${id}/start`)).body;
      expect(t.status).toBe("IN_PROGRESS");
      expect(t.matches).toHaveLength(3);
      // Knockouts can't be draws.
      const semi = t.matches.find((m: any) => m.round === 1);
      expect((await call(ownerT, "POST", `/matches/${semi.id}/result`, { scoreA: 1, scoreB: 1 })).body.error).toBe("winner_required");
      for (const m of t.matches.filter((x: any) => x.round === 1)) t = (await call(ownerT, "POST", `/matches/${m.id}/result`, { scoreA: 2, scoreB: 0 })).body;
      const final = t.matches.find((m: any) => m.round === 2);
      expect(final.status).toBe("READY");
      t = (await call(ownerT, "POST", `/matches/${final.id}/result`, { scoreA: 3, scoreB: 1 })).body;
      expect(t.status).toBe("COMPLETED");
      const champion = t.teams.find((x: any) => x.finalPlacement === 1);
      expect(champion.status).toBe("WINNER");
      const winnerWallet = (await call(ownerT, "GET", `/customers/${champion.captain.id}/wallet`)).body;
      expect(winnerWallet.cash).toBe("20.00");
      expect(await points(champion.captain.id)).toBe(50); // tournament points (an entry fee is a service: it earns no spend points)
    });

    it("cancelling refunds every paid entry to the wallet", async () => {
      const id = await create();
      const p = await customer();
      await enter(id, p);
      await call(ownerT, "POST", `/tournaments/${id}/status`, { status: "CANCELLED", reason: "venue closed" });
      expect((await call(ownerT, "GET", `/customers/${p.id}/wallet`)).body.cash).toBe("10.00");
    });

    it("double elimination runs to a grand final; round robin allows draws and ranks by points", async () => {
      const de = await create({ format: "DOUBLE_ELIMINATION", entryFee: 0, prizePool: 0, prizeDistribution: [] });
      for (const c of await Promise.all([1, 2, 3, 4].map(() => customer()))) await call(ownerT, "POST", `/tournaments/${de}/teams`, { teamName: c.username, captainId: c.id, idempotencyKey: key() });
      let t = (await call(ownerT, "POST", `/tournaments/${de}/start`)).body;
      for (let i = 0; i < 10 && t.status !== "COMPLETED"; i++) {
        const ready = t.matches.find((m: any) => m.status === "READY");
        if (!ready) break;
        t = (await call(ownerT, "POST", `/matches/${ready.id}/result`, { scoreA: 1, scoreB: 0 })).body;
      }
      expect(t.status).toBe("COMPLETED");
      expect(t.matches.find((m: any) => m.bracket === "GRAND_FINAL").status).toBe("COMPLETED");

      const rr = await create({ format: "ROUND_ROBIN", maxTeams: 3, minTeams: 3, entryFee: 0, prizePool: 0, prizeDistribution: [] });
      for (const c of await Promise.all([1, 2, 3].map(() => customer()))) await call(ownerT, "POST", `/tournaments/${rr}/teams`, { teamName: c.username, captainId: c.id, idempotencyKey: key() });
      t = (await call(ownerT, "POST", `/tournaments/${rr}/start`)).body;
      expect(t.matches).toHaveLength(3);
      const [m1, m2, m3] = t.matches;
      await call(ownerT, "POST", `/matches/${m1.id}/result`, { scoreA: 1, scoreB: 1 });
      await call(ownerT, "POST", `/matches/${m2.id}/result`, { scoreA: 2, scoreB: 0 });
      t = (await call(ownerT, "POST", `/matches/${m3.id}/result`, { scoreA: 0, scoreB: 3 })).body;
      expect(t.status).toBe("COMPLETED");
      expect(t.standings.reduce((a: number, s: any) => a + s.points, 0)).toBe(2 + 3 + 3);
    });

    it("customers enter from the app, paying from their wallet", async () => {
      const id = await create({ maxTeams: 8 });
      const token = await appLogin("ahmed", "ahmed123");
      const list = await (await fetch(`${base}/v1/app/tournaments`, { headers: { authorization: `Bearer ${token}` } })).json();
      expect(list.some((x: any) => x.id === id)).toBe(true);
      const before = (await call(ownerT, "GET", `/customers/${(await (await fetch(`${base}/v1/app/me`, { headers: { authorization: `Bearer ${token}` } })).json()).id}/wallet`)).body;
      const r = await fetch(`${base}/v1/app/tournaments/${id}/register`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ teamName: `Ahmed ${tag()}`, idempotencyKey: key() }) });
      expect(r.status).toBe(201);
      const detail = await (await fetch(`${base}/v1/app/tournaments/${id}`, { headers: { authorization: `Bearer ${token}` } })).json();
      expect(detail.myTeamId).toBeTruthy();
      expect(JSON.stringify(detail)).not.toMatch(/username|"id":"[0-9a-f-]{36}","displayName"/);
      const after = (await call(ownerT, "GET", `/customers/${detail.teams[0].captain ? (await (await fetch(`${base}/v1/app/me`, { headers: { authorization: `Bearer ${token}` } })).json()).id : ""}/wallet`)).body;
      expect(Number(before.total) - Number(after.total)).toBeCloseTo(10, 2);
      await call(ownerT, "POST", `/tournaments/${id}/status`, { status: "CANCELLED", reason: "test cleanup" }); // refunds Ahmed
    });
  });

  describe("CRM", () => {
    it("built-in segments exist and refresh from real activity", async () => {
      const segs = (await call(ownerT, "GET", "/segments")).body as any[];
      expect(segs.map((s) => s.key)).toEqual(expect.arrayContaining(["NEW", "REGULAR", "VIP", "INACTIVE", "HIGH_SPENDER", "COMPETITIVE", "RESTAURANT_HEAVY", "GAMING_HEAVY"]));
      const counts = (await call(ownerT, "POST", "/segments/refresh")).body;
      expect(counts.NEW).toBeGreaterThan(0);
    });

    it("a campaign reaches only consenting members, each with their own code, in the app inbox; it can't be sent twice", async () => {
      const yes = await customer({ marketingConsent: true });
      const no = await customer({ marketingConsent: false });
      const seg = await staticSegment([yes.id, no.id]);
      expect((await call(ownerT, "POST", "/campaigns/audience", { segmentId: seg })).body).toMatchObject({ total: 2, consenting: 1, withoutConsent: 1 });
      const promo = await promotion({ name: `Camp ${tag()}`, type: "PROMO_CODE", requiresCode: true, effects: [{ type: "PERCENT_OFF", target: "ORDER", value: 15 }] });
      const c = await call(ownerT, "POST", "/campaigns", { name: "Test", channel: "IN_APP", segmentId: seg, promotionId: promo, subject: "Hi {{firstName}}", body: "Your code: {{code}}" });
      expect(c.status).toBe(201);
      expect((await call(ownerT, "POST", `/campaigns/${c.body.id}/send`)).body.reason).toBe("REASON_REQUIRED");
      const sent = await call(ownerT, "POST", `/campaigns/${c.body.id}/send`, undefined, "weekly campaign");
      expect(sent.body).toMatchObject({ targeted: 1, sent: 1, withoutConsent: 1 });
      expect((await call(ownerT, "POST", `/campaigns/${c.body.id}/send`, undefined, "again")).body.error).toBe("campaign_not_sendable");
      const token = await appLogin(yes.username, "testpass123");
      const inbox = await (await fetch(`${base}/v1/app/inbox`, { headers: { authorization: `Bearer ${token}` } })).json();
      expect(inbox).toHaveLength(1);
      expect(inbox[0].body).toMatch(/^Your code: [2-9A-Z]{8}$/);
      const code = inbox[0].data.code;
      const o = await call(cashierT, "POST", `/branches/${dxb1}/orders`, { type: "COUNTER", customerId: yes.id, lines: [{ productId: burgerId, quantity: 1 }], promoCode: code, payments: [{ method: "CARD" }], idempotencyKey: key() });
      expect(o.body.total).toBe("27.20");
      expect((await call(ownerT, "GET", `/campaigns/${c.body.id}`)).body.converted).toBe(1);
      const noToken = await appLogin(no.username, "testpass123");
      expect(await (await fetch(`${base}/v1/app/inbox`, { headers: { authorization: `Bearer ${noToken}` } })).json()).toHaveLength(0);
    });

    it("Shell campaigns pop up on the customer's PC at their next session", async () => {
      const c = await customer({ marketingConsent: true });
      const seg = await staticSegment([c.id]);
      const camp = await call(ownerT, "POST", "/campaigns", { name: "Shell", channel: "SHELL", segmentId: seg, subject: "Tonight", body: "Happy hour at the bar, {{firstName}}!" });
      expect((await call(ownerT, "POST", `/campaigns/${camp.body.id}/send`, undefined, "shell promo")).body).toMatchObject({ queued: 1 });
      const pc = await newAgent();
      await startSession(pc.identity!.deviceId, { customerId: c.id });
      await until(() => pc.received.some((x) => x.type === "SEND_MESSAGE" && String((x.payload as any).message).startsWith("Happy hour at the bar")));
    });
  });

  it("other organizations see none of it", async () => {
    const rivalList = await call(rivalT, "GET", "/tournaments");
    expect(rivalList.status === 403 || (rivalList.body as any[]).length === 0).toBe(true); // Starter plan: no tournaments at all
    expect(((await call(rivalT, "GET", "/promotions")).body as any[]).some((p) => madePromotions.includes(p.id))).toBe(false);
    expect([403, 404]).toContain((await call(rivalT, "GET", `/promotions/${madePromotions[0]}`)).status);
  });
});
