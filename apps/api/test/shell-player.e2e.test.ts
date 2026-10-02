// The Gaming Shell's player channel end-to-end: the home widget overview,
// rewards and inbox, settings that follow the player, favourites and recently
// played, the away lock, the session summary, guest → member, asking staff
// for a game, friends here and invites, and save folders that follow the
// player — against real Postgres, a listening API and simulated agents.
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
// A minimal empty zip: just the end-of-central-directory record.
const EMPTY_ZIP = Buffer.from("504b0506000000000000000000000000000000000000", "hex");

describe.skipIf(!HAS_DB)("Shell player channel (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const agents: SimAgent[] = [];
  let ownerT: string, cashierT: string;
  let dxb1: string, regularZone: string, regularPlan: string, gameId: string;

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
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;
  const player = async (o: { minutes?: number; pin?: string } = {}) => {
    const username = `s${randomUUID().slice(0, 8)}`;
    const made = await staff(cashierT, "POST", "/customers", { username, displayName: `Sam ${username}`, password: "longpassword1", ...(o.pin ? { pin: o.pin } : {}) });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    if (o.minutes) await staff(ownerT, "POST", `/customers/${made.body.id}/wallet/adjust`, { branchId: dxb1, bucket: "TIME", amount: o.minutes, reason: "test", idempotencyKey: key() }, "test");
    const token = (await req("/app/demo/login", null, "POST", { username, password: "longpassword1" })).body.accessToken as string;
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
  const play = async (a: SimAgent, customerId: string | null) => {
    const s = await staff(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, ...(customerId ? { customerId } : {}), request: { kind: "minutes", minutes: 60 }, payment: { method: "CASH" }, idempotencyKey: key() });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    return s.body.id as string;
  };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT] = (await Promise.all(["owner@demo.test", "cashier@demo.test"].map(login))) as [string, string];
    dxb1 = ((await staff(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    regularZone = ((await staff(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[]).find((z) => z.type === "PC_STANDARD").id;
    regularPlan = ((await staff(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.name === "Regular PC").id;
    gameId = ((await staff(ownerT, "GET", "/games")).body.games as any[]).find((g) => g.slug === "counter-strike-2").id;
    const set = await staff(ownerT, "PUT", `/games/${gameId}/settings`, { isEnabled: true, allowedZoneIds: [], savePaths: ["%APPDATA%\\CS2\\cfg"] });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((await staff(ownerT, "PUT", `/games/${gameId}/settings`, { savePaths: ["C:\\Windows"] })).status).toBe(400);
    expect((await staff(ownerT, "PUT", `/games/${gameId}/settings`, { savePaths: ["%APPDATA%\\..\\x"] })).status).toBe(400);
  });

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
  });

  it("overview, settings, favourites, recently played, rewards, inbox and the away lock", async () => {
    const a = await station();
    const p = await player({ pin: "2468" });
    expect((await a.player("overview")).data).toMatchObject({ customer: null }); // nobody signed in
    expect((await a.player("rewards")).error).toBe("sign_in_first");
    await play(a, p.id);

    const o = (await a.player("overview")).data;
    expect(o.customer).toMatchObject({ name: expect.stringContaining("Sam"), wallet: { currency: "AED" }, points: 0, favorites: [], recent: [] });
    expect((await a.player("prefs_set", { mouseSpeed: 14, volume: 35, lang: "ar" })).data).toMatchObject({ mouseSpeed: 14, volume: 35, lang: "ar" });
    expect((await a.player("prefs_set", { volume: 500 })).error).toBe("bad_request");
    expect((await a.player("favorite", { gameId, on: true })).ok).toBe(true);
    a.send({ type: "game_event", event: "started", gameId });
    await until(async () => (await a.player("overview")).data.customer.recent.includes(gameId));
    const o2 = (await a.player("overview")).data.customer;
    expect(o2.favorites).toEqual([gameId]);
    expect(o2.prefs).toMatchObject({ mouseSpeed: 14, lang: "ar" });

    expect((await a.player("rewards")).data.rewards.length).toBeGreaterThan(0);
    expect(Array.isArray((await a.player("inbox")).data)).toBe(true);
    expect((await a.player("leaderboard")).data.me).toBeTruthy();

    expect((await a.player("verify", { secret: "nope" })).data).toEqual({ ok: false });
    expect((await a.player("verify", { secret: "2468" })).data).toEqual({ ok: true });
    expect((await a.player("verify", { secret: "longpassword1" })).data).toEqual({ ok: true });
  });

  it("the same settings come back on another PC; the summary after log-out", async () => {
    const p = await player();
    const a = await station();
    const sid = await play(a, p.id);
    await a.player("prefs_set", { mouseSpeed: 7 });
    await staff(cashierT, "POST", `/sessions/${sid}/end`, { reason: "t" });
    const sum = await a.player("summary", { sessionId: sid });
    expect(sum.data).toMatchObject({ currency: "AED", spent: "15.00" });
    expect((await (await station()).player("summary", { sessionId: sid })).error).toBe("not_found"); // another PC can't read it

    const b = await station();
    await play(b, p.id);
    expect((await b.player("overview")).data.customer.prefs).toMatchObject({ mouseSpeed: 7 });
  });

  it("a guest becomes a member from their phone, and can ask staff for a game", async () => {
    const a = await station();
    const sid = await play(a, null);
    const claim = await a.player("claim_code");
    expect(claim.data.url).toMatch(new RegExp(`\\?claim=${claim.data.code}$`));
    const p = await player();
    const ok = await req("/app/claim", p.token, "POST", { code: claim.data.code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await staff(ownerT, "GET", `/sessions/${sid}`)).body.customer.id).toBe(p.id);
    await until(() => a.received.filter((r) => r.type === "START_SESSION").length >= 2); // the PC now shows their name
    expect((await req("/app/claim", p.token, "POST", { code: claim.data.code })).body.error).toBe("pc_code_expired");
    expect((await a.player("claim_code")).error).toBe("already_member");

    expect((await a.player("request_game", { title: "Hollow Knight" })).data).toEqual({ sent: true });
    const alerts = (await staff(ownerT, "GET", `/branches/${dxb1}/floor`)).body.alerts as any[];
    expect(alerts.some((x) => x.type === "GAME_REQUESTED" && x.title.includes("Hollow Knight"))).toBe(true);
  });

  it("friends here, invites, and save folders that follow the player", async () => {
    const [a, b] = [await station(), await station()];
    const [p, q] = [await player(), await player()];
    await req("/app/me", q.token, "PATCH", { showOnLeaderboard: true });
    await play(a, p.id);
    await play(b, q.id);
    const here = (await a.player("players")).data as any[];
    expect(here.some((x) => x.username === q.username)).toBe(true);
    expect(here.some((x) => x.username === p.username)).toBe(false);
    expect((await a.player("invite", { username: q.username })).data).toEqual({ sent: true });
    expect(((await req("/app/inbox", q.token, "GET")).body as any[])[0].title).toMatch(/invites you to play/);

    expect((await a.player("save_get", { gameId, offset: 0 })).data).toEqual({ exists: false });
    const begin = (await a.player("save_put_begin", { gameId, size: EMPTY_ZIP.length })).data;
    await a.player("save_put_chunk", { uploadId: begin.uploadId, data: EMPTY_ZIP.toString("base64") });
    expect((await a.player("save_put_end", { uploadId: begin.uploadId })).data).toMatchObject({ saved: true, size: EMPTY_ZIP.length });
    const bad = (await a.player("save_put_begin", { gameId, size: 4 })).data;
    await a.player("save_put_chunk", { uploadId: bad.uploadId, data: Buffer.from("nope").toString("base64") });
    expect((await a.player("save_put_end", { uploadId: bad.uploadId })).error).toBe("not_a_zip");
    const other = ((await staff(ownerT, "GET", "/games")).body.games as any[]).find((g) => g.id !== gameId);
    expect((await a.player("save_put_begin", { gameId: other.id, size: 22 })).error).toBe("saves_off");

    // On another PC, the same player gets their save back.
    const live = (await staff(ownerT, "GET", `/devices/${a.identity!.deviceId}/session`)).body;
    await staff(cashierT, "POST", `/sessions/${live.id}/end`, { reason: "t" });
    const c = await station();
    await play(c, p.id);
    const got = (await c.player("save_get", { gameId, offset: 0 })).data;
    expect(Buffer.from(got.data, "base64").equals(EMPTY_ZIP)).toBe(true);
    expect((await b.player("save_get", { gameId, offset: 0 })).data).toEqual({ exists: false }); // q has none
  });
});
