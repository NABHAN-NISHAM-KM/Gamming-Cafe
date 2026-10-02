// Customer app self-service end-to-end: profile and sign-in details, staff
// reset codes, signing in at a PC by QR, adding time and ordering food from
// the phone, live status, games, help, gifts, online top-up, leaderboard,
// challenges, splitting a booking, push subscriptions and deleting the
// account — against real Postgres, a listening API and a simulated agent.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
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

describe.skipIf(!HAS_DB)("Customer app self-service (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const agents: SimAgent[] = [];
  let ownerT: string, cashierT: string;
  let dxb1: string, regularZone: string;

  const req = async (path: string, token: string | null, method: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const staff = (token: string, method: string, path: string, body?: unknown, reason?: string) => req(path, token, method, body, reason);
  const app_ = (token: string | null, method: string, path: string, body?: unknown) => req(`/app${path}`, token, method, body);
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;
  /** A fresh customer (created at the counter: app sign-ups are throttled per IP) signed in to the app. */
  const player = async (o: { minutes?: number; money?: string } = {}) => {
    const username = `p${randomUUID().slice(0, 8)}`;
    const made = await staff(cashierT, "POST", "/customers", { username, displayName: `Pat ${username}`, password: "longpassword1" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.id as string;
    const token = (await app_(null, "POST", "/demo/login", { username, password: "longpassword1" })).body.accessToken as string;
    if (o.minutes) await staff(ownerT, "POST", `/customers/${id}/wallet/adjust`, { branchId: dxb1, bucket: "TIME", amount: o.minutes, reason: "test time", idempotencyKey: key() }, "test");
    if (o.money) await staff(cashierT, "POST", `/customers/${id}/wallet/topup`, { branchId: dxb1, amount: o.money, payment: { method: "CASH" }, idempotencyKey: key() });
    return { id, username, token };
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
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT] = (await Promise.all(["owner@demo.test", "cashier@demo.test"].map(login))) as [string, string];
    dxb1 = ((await staff(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await staff(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;
  });

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
  });

  it("profile, password, PIN and a staff reset code", async () => {
    const p = await player();
    const up = await app_(p.token, "PATCH", "/me", { displayName: "Pat Smith", dateOfBirth: "2004-02-03", locale: "ar", showOnLeaderboard: true });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect((await app_(p.token, "GET", "/me")).body).toMatchObject({ displayName: "Pat Smith", dateOfBirth: "2004-02-03", locale: "ar", showOnLeaderboard: true, hasPin: false });
    expect((await app_(p.token, "PATCH", "/me", { dateOfBirth: "1990-01-01" })).body.error).toBe("dob_locked");

    const other = await player();
    await app_(other.token, "PATCH", "/me", { phone: "+971500000123" });
    expect((await app_(p.token, "PATCH", "/me", { phone: "+971500000123" })).body.error).toBe("contact_taken");

    const second = (await app_(null, "POST", "/demo/login", { username: p.username, password: "longpassword1" })).body.accessToken;
    expect((await app_(p.token, "POST", "/me/password", { current: "wrong", next: "newpassword2" })).body.error).toBe("wrong_password");
    expect((await app_(p.token, "POST", "/me/password", { current: "longpassword1", next: "newpassword2" })).status).toBe(204);
    expect((await app_(second, "GET", "/me")).status).toBe(401); // other phones signed out
    expect((await app_(p.token, "GET", "/me")).status).toBe(200); // this one stays
    expect((await app_(p.token, "POST", "/me/pin", { password: "newpassword2", pin: "4321" })).status).toBe(204);
    expect((await app_(p.token, "GET", "/me")).body.hasPin).toBe(true);

    expect((await staff(cashierT, "POST", `/customers/${p.id}/reset-code`)).status).toBe(201);
    const { code } = (await staff(ownerT, "POST", `/customers/${p.id}/reset-code`)).body;
    expect(code).toMatch(/^\d{6}$/);
    expect((await app_(null, "POST", "/demo/reset", { username: p.username, code: code === "000000" ? "111111" : "000000", password: "resetpass3" })).status).toBe(401);
    expect((await app_(null, "POST", "/demo/reset", { username: p.username, code, password: "resetpass3" })).status).toBe(204);
    expect((await app_(null, "POST", "/demo/reset", { username: p.username, code, password: "resetpass4" })).status).toBe(401); // one use
    expect((await app_(p.token, "GET", "/me")).status).toBe(401);
    expect((await app_(null, "POST", "/demo/login", { username: p.username, password: "resetpass3" })).status).toBe(200);
  });

  it("signs in at a PC by QR, then adds time and orders food from the phone", async () => {
    const a = await station();
    const p = await player({ minutes: 90, money: "100" });
    const qr = await a.qrCode();
    expect(qr).toMatchObject({ ok: true });
    expect(qr.url).toMatch(new RegExp(`/demo\\?pc=${qr.code}$`));
    expect((await app_(p.token, "GET", `/pc-login/${qr.code}`)).body).toMatchObject({ station: expect.any(String) });
    const signed = await app_(p.token, "POST", "/pc-login", { code: qr.code });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    await until(() => a.received.some((r) => r.type === "START_SESSION"));
    expect((await app_(p.token, "POST", "/pc-login", { code: qr.code })).body.error).toBe("pc_code_expired"); // single use
    const playing = (await app_(p.token, "GET", "/me")).body.playingNow;
    expect(playing).toBeTruthy();

    // A saved-time session has no packages to buy (as on the Shell): continue on a paid hourly session.
    await staff(cashierT, "POST", `/sessions/${playing.sessionId}/end`, { reason: "test" });
    const regular = ((await staff(ownerT, "GET", "/pricing-plans")).body as any[]).find((x) => x.name === "Regular PC").id;
    await until(async () => (await staff(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.status === "AVAILABLE");
    const paid = await staff(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regular, customerId: p.id, request: { kind: "minutes", minutes: 60 }, payment: { method: "CASH" }, idempotencyKey: key() });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    const offers = (await app_(p.token, "GET", "/session/offers")).body;
    expect(offers.ok).toBe(true);
    expect(offers.packages.length, JSON.stringify(offers)).toBeGreaterThan(0);
    const before = (await app_(p.token, "GET", "/me")).body.playingNow.expiresAt;
    // Saved time went into the session at sign-in, so add a paid package.
    const pkg = offers.packages[0];
    const ext = await app_(p.token, "POST", "/session/extend", { packageId: pkg.id, idempotencyKey: key() });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    expect(new Date(ext.body.expiresAt).getTime()).toBeGreaterThan(new Date(before).getTime());

    const menu = (await app_(p.token, "GET", "/menu")).body;
    expect(menu.station).toBeTruthy();
    const product = menu.menu.categories.flatMap((c: any) => c.products).find((x: any) => x.available && !x.modifierGroups.some((g: any) => g.minSelect > 0));
    const o = await app_(p.token, "POST", "/orders", { lines: [{ productId: product.id, quantity: 1 }], payWith: "BILL", idempotencyKey: key() });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect((await app_(p.token, "GET", "/orders")).body[0].number).toBe(o.body.number);

    const idle = await player();
    expect((await app_(idle.token, "POST", "/orders", { lines: [{ productId: product.id, quantity: 1 }], payWith: "BILL", idempotencyKey: key() })).body.error).toBe("not_playing");
    expect((await app_(idle.token, "GET", "/menu")).body.menu).toBeNull();
  });

  it("live status, games, help, stats and friends", async () => {
    await station();
    const p = await player();
    const live = (await app_(p.token, "GET", "/live")).body;
    const zone = live.flatMap((b: any) => b.zones).find((z: any) => z.id === regularZone);
    expect(zone.total).toBeGreaterThanOrEqual(1);
    expect(zone.free).toBeLessThanOrEqual(zone.total);

    const g = ((await staff(ownerT, "GET", "/games")).body.games as any[])[0];
    await staff(ownerT, "PUT", `/games/${g.id}/settings`, { isEnabled: true, allowedZoneIds: [] });
    expect((await app_(p.token, "POST", `/games/${g.id}/favorite`)).status).toBe(204);
    expect((await app_(p.token, "GET", "/games")).body[0]).toMatchObject({ id: g.id, favorite: true });
    expect((await app_(p.token, "DELETE", `/games/${g.id}/favorite`)).status).toBe(204);

    const t = await app_(p.token, "POST", "/tickets", { category: "PAYMENT", subject: "Charged twice" });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect((await staff(ownerT, "GET", `/customers/${p.id}/tickets`)).body[0].subject).toBe("Charged twice");

    expect((await app_(p.token, "GET", "/me/stats")).body).toMatchObject({ minutes: 0, visits: 0, months: [] });

    const code = (await app_(p.token, "GET", "/referrals")).body.code;
    const friend = await app_(null, "POST", "/demo/register", { username: `f${randomUUID().slice(0, 8)}`, displayName: "Fay Friend", password: "longpassword1", referralCode: code });
    expect(friend.status).toBe(201);
    expect((await app_(p.token, "GET", "/referrals")).body.friends).toEqual([expect.objectContaining({ name: "Fay", played: false })]);
  });

  it("gifts, online top-up, challenges and the leaderboard", async () => {
    const a = await player({ money: "60", minutes: 120 });
    const b = await player();
    expect((await app_(a.token, "POST", "/gift", { to: a.username, bucket: "CASH", amount: "5", idempotencyKey: key() })).body.error).toBe("gift_to_self");
    expect((await app_(a.token, "POST", "/gift", { to: b.username, bucket: "CASH", amount: "1000", idempotencyKey: key() })).body.error).toBe("bad_amount");
    const k = key();
    expect((await app_(a.token, "POST", "/gift", { to: b.username, bucket: "CASH", amount: "15", idempotencyKey: k })).status).toBe(201);
    await app_(a.token, "POST", "/gift", { to: b.username, bucket: "CASH", amount: "15", idempotencyKey: k }); // retried: once
    expect((await app_(a.token, "POST", "/gift", { to: b.username, bucket: "TIME", amount: 30, idempotencyKey: key() })).status).toBe(201);
    expect((await app_(b.token, "GET", "/me")).body.wallet).toMatchObject({ cash: "15.00", timeMinutes: 30 });
    expect((await app_(a.token, "GET", "/me")).body.wallet).toMatchObject({ cash: "45.00", timeMinutes: 90 });
    expect((await app_(b.token, "GET", "/inbox")).body[0].title).toMatch(/sent you a gift/);

    expect((await app_(b.token, "POST", "/wallet/topup", { amount: "2", idempotencyKey: key() })).status).toBe(400);
    expect((await app_(b.token, "POST", "/wallet/topup", { amount: "50", idempotencyKey: key() })).status).toBe(201);
    expect((await app_(b.token, "GET", "/me")).body.wallet.cash).toBe("65.00");

    const ch = await staff(ownerT, "POST", "/loyalty/challenges", { name: `First visit ${randomUUID().slice(0, 4)}`, criteria: { type: "VISITS", target: 1 }, rewardPoints: 25 });
    expect(ch.status, JSON.stringify(ch.body)).toBe(201);
    const s = await station();
    const started = await staff(cashierT, "POST", `/devices/${s.identity!.deviceId}/sessions`, { customerId: a.id, request: { kind: "minutes", minutes: 30 }, payment: { method: "TIME_BALANCE" }, idempotencyKey: key() });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    await staff(cashierT, "POST", `/sessions/${started.body.id}/end`, { reason: "test" });
    const mine = ((await app_(a.token, "GET", "/challenges")).body as any[]).find((c) => c.id === ch.body.id);
    expect(mine).toMatchObject({ progress: 1, target: 1, earnedAt: expect.any(String) });
    expect((await app_(a.token, "GET", "/loyalty")).body.points).toBeGreaterThanOrEqual(25);
    await staff(ownerT, "PATCH", `/loyalty/challenges/${ch.body.id}`, { isActive: false });

    const board = (await app_(a.token, "GET", "/leaderboard")).body;
    expect(board.me).toMatchObject({ shown: false });
    expect(board.top.some((r: any) => r.me)).toBe(false); // not opted in: not listed
  });

  it("splits a booking with a friend, who pays their share into the host's wallet", async () => {
    await station();
    const host = await player();
    const friend = await player({ money: "100" });
    const bk = await app_(host.token, "POST", "/bookings", { branchId: dxb1, zoneId: regularZone, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), minutes: 120, idempotencyKey: key() });
    expect(bk.status, JSON.stringify(bk.body)).toBe(201);
    const inv = await app_(host.token, "POST", `/bookings/${bk.body.id}/invite`, { usernames: [friend.username] });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const msg = ((await app_(friend.token, "GET", "/inbox")).body as any[]).find((m) => m.data?.bookingId === bk.body.id);
    expect(msg.data).toMatchObject({ paid: false, share: inv.body.share });
    expect((await app_(friend.token, "POST", `/inbox/${msg.id}/pay-share`)).status).toBe(200);
    expect((await app_(friend.token, "POST", `/inbox/${msg.id}/pay-share`)).body).toEqual({ paid: true }); // once
    expect(Number((await app_(host.token, "GET", "/me")).body.wallet.cash)).toBe(Number(inv.body.share));
    expect((await app_(host.token, "GET", `/bookings/${bk.body.id}/shares`)).body).toEqual([expect.objectContaining({ paid: true })]);
    expect((await app_(friend.token, "GET", `/bookings/${bk.body.id}/shares`)).status).toBe(404); // not their booking
  });

  it("push subscriptions, and deleting the account", async () => {
    const p = await player();
    expect((await app_(p.token, "GET", "/push/key")).body.publicKey).toBeTruthy();
    const sub = { endpoint: "https://push.invalid/sub/abc", keys: { p256dh: "BNcR", auth: "tBHI" } };
    expect((await app_(p.token, "POST", "/push/subscribe", { subscription: sub })).status).toBe(204);
    expect((await staff(ownerT, "GET", `/customers/${p.id}/insights`)).status).toBe(200);
    expect((await app_(p.token, "POST", "/push/unsubscribe", { endpoint: sub.endpoint })).status).toBe(204);

    const rich = await player({ money: "10" });
    expect((await app_(rich.token, "POST", "/me/delete", { password: "longpassword1" })).body.error).toBe("wallet_not_empty");
    expect((await app_(p.token, "POST", "/me/delete", { password: "nope" })).body.error).toBe("wrong_password");
    expect((await app_(p.token, "POST", "/me/delete", { password: "longpassword1" })).body).toEqual({ deleted: true });
    expect((await app_(null, "POST", "/demo/login", { username: p.username, password: "longpassword1" })).status).toBe(401);
    expect((await staff(ownerT, "GET", `/customers/${p.id}`)).body.status).toBe("DELETED");
  });
});
