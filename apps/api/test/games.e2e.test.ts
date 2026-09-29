// Phase 5 end-to-end: signed station config (game library), game detection,
// zone/age rules, custom games, update orchestration that never interrupts a
// customer, peripherals/network/help alerts and allow-listed repairs —
// against real Postgres, a listening API and simulated agents.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createServer, type Server } from "node:http";
import type { DetectedGame } from "@arena/contracts";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";
import { SimAgent } from "../scripts/sim-agent.js";
import { SteamBuildsService } from "../src/games/steam-builds.service.js";

process.env["UPDATE_SWEEP_MS"] = "300";
process.env["SESSION_SWEEP_MS"] = "300";
const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
};

const CS2: DetectedGame = { source: "STEAM", key: "730", name: "Counter-Strike 2", buildId: "100", installPath: "D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive", sizeBytes: 35_000_000_000, updateRequired: true };
const FORTNITE: DetectedGame = { source: "EPIC", key: "Fortnite", name: "Fortnite", buildId: "31.10", updateRequired: false };
const UNKNOWN: DetectedGame = { source: "STEAM", key: "4242424242", name: "Some indie game" };

describe.skipIf(!HAS_DB)("Games & station tools (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const agents: SimAgent[] = [];
  // Stand-in for Steam's app info (steamcmd PICS mirror): public build per appid.
  const steamPublic = new Map<string, string>();
  let steamInfo: Server;
  let ownerT: string, cashierT: string, techT: string, rivalT: string;
  let dxb1: string, regularZone: string, vipZone: string, regularPlan: string, cs2Id: string;

  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email: string) =>
    (await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).accessToken as string;

  const newStation = async (games?: DetectedGame[], zoneId = regularZone) => {
    const code = (await call(ownerT, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId, maxUses: 1 })).body.code;
    const a = new SimAgent(base, { heartbeatSeconds: 60, games });
    agents.push(a);
    await a.enroll(code);
    await a.connect();
    await until(() => a.config !== null);
    return a;
  };
  const alertsOf = async (a: SimAgent) => ((await call(ownerT, "GET", `/devices/${a.identity!.deviceId}`)).body.alerts as any[]).map((x) => x.type);

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    steamInfo = createServer((req, res) => {
      const id = req.url!.split("/").pop()!;
      const build = steamPublic.get(id);
      res.writeHead(build ? 200 : 404, { "content-type": "application/json" });
      res.end(build ? JSON.stringify({ status: "success", data: { [id]: { depots: { branches: { public: { buildid: build } } } } } }) : "{}");
    });
    await new Promise<void>((r) => steamInfo.listen(0, "127.0.0.1", r));
    app = await createApp(loadConfig({ NODE_ENV: "test", STEAM_BUILDS_URL: `http://127.0.0.1:${(steamInfo.address() as AddressInfo).port}/info/` }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT, techT, rivalT] = (await Promise.all(["owner@demo.test", "cashier@demo.test", "tech@demo.test", "owner@rival.test"].map(login))) as [string, string, string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    const zones = (await call(ownerT, "GET", `/branches/${dxb1}/zones`)).body as any[];
    regularZone = zones.find((z) => z.type === "PC_STANDARD").id;
    vipZone = zones.find((z) => z.type === "PC_VIP").id;
    regularPlan = ((await call(ownerT, "GET", "/pricing-plans")).body as any[]).find((p) => p.name === "Regular PC").id;
    cs2Id = ((await call(ownerT, "GET", "/games")).body.games as any[]).find((g) => g.slug === "counter-strike-2").id;
    // Tests below assume the catalog defaults; earlier runs may have left settings behind.
    await call(ownerT, "PUT", `/games/${cs2Id}/settings`, { isEnabled: true, allowedZoneIds: [] });
    await owner.query(`UPDATE "GameUpdateJob" SET status = 'CANCELLED' WHERE status IN ('SCHEDULED','RUNNING')`);
    // Simulated PCs from earlier runs are offline forever; retire them so update jobs only see this run's PCs.
    await owner.query(`UPDATE "Device" SET "isEnabled" = false WHERE "agentVersion" = '0.1.0-sim' AND "branchId" = $1`, [dxb1]);
  }, 90_000);

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
    steamInfo?.close();
    await owner.end();
  });

  describe("game library", () => {
    it("each PC receives a SIGNED library: enabled games, launch specs, apps, presets", async () => {
      const a = await newStation();
      const cfg = a.config!;
      const cs2 = cfg.games.find((g) => g.id === cs2Id)!;
      expect(cs2).toMatchObject({ title: "Counter-Strike 2", launch: { kind: "STEAM", appId: "730" }, minAge: 18, installed: false });
      expect(cfg.games.find((g) => g.title === "VALORANT")?.launch).toMatchObject({ kind: "PATH", executablePath: expect.stringMatching(/RiotClientServices\.exe$/) });
      expect(cfg.games.find((g) => g.title === "Fortnite")?.launch).toEqual({ kind: "EPIC", appName: "Fortnite" });
      expect(cfg.games.slice(0, 4).every((g) => g.featured)).toBe(true); // featured first
      expect(cfg.apps.map((x) => x.name)).toContain("Notepad");
      expect(cfg.connectivityTargets[0]).toEqual({ name: "Router", host: "gateway" });
      expect(cfg.peripheralPresets.map((p) => p.name)).toContain("FPS — low sensitivity, raw");
      // The sim only stores a config whose signature verified with the branch key it pinned at enrolment.
      expect(a.received.some((r) => !r.verified)).toBe(false);
    });

    it("detects installed games from Steam/Epic manifests and marks updates; unknown titles are ignored", async () => {
      const a = await newStation([CS2, FORTNITE, UNKNOWN]);
      await until(() => a.config!.games.find((g) => g.id === cs2Id)!.installed);
      const cfg = a.config!;
      expect(cfg.games.find((g) => g.id === cs2Id)).toMatchObject({ installed: true, updateRequired: true });
      expect(cfg.games.find((g) => g.title === "Fortnite")).toMatchObject({ installed: true, updateRequired: false });
      const tools = (await call(techT, "GET", `/devices/${a.identity!.deviceId}/tools`)).body;
      expect(tools.games.map((g: any) => [g.title, g.status, g.detectedBy]).sort()).toEqual([["Counter-Strike 2", "UPDATE_REQUIRED", "STEAM"], ["Fortnite", "INSTALLED", "EPIC"]]);
      const lib = (await call(ownerT, "GET", `/games?branchId=${dxb1}`)).body;
      expect(lib.games.find((g: any) => g.id === cs2Id).installs.updateRequired).toBeGreaterThanOrEqual(1);

      // Uninstalled since the last scan → no longer shown as installed.
      a.games = [FORTNITE];
      a.reportInventory();
      await until(() => !a.config!.games.find((g) => g.id === cs2Id)!.installed);
    });

    it("'Found on PCs' lists every detected game and app, and one click adds it to the library", async () => {
      const indieGame: DetectedGame = { source: "STEAM", key: String(Date.now()).slice(-9), name: "Some indie game" }; // fresh per run: the test DB persists
      const a = await newStation([CS2, indieGame]);
      a.apps = [{ key: "Discord", name: "Discord", version: "1.0.9", publisher: "Discord Inc.", executablePath: "C:\\Program Files\\Discord\\Discord.exe" }];
      a.reportInventory();
      const found = async () => (await call(ownerT, "GET", `/detected-titles?branchId=${dxb1}`)).body as any[];
      await until(async () => (await found()).some((d) => d.key === "Discord"));
      const list = await found();
      expect(list.find((d) => d.source === "STEAM" && d.key === "730")).toMatchObject({ kind: "GAME", catalogId: cs2Id });
      const indie = list.find((d) => d.key === indieGame.key);
      expect(indie).toMatchObject({ kind: "GAME", name: "Some indie game", catalogId: null });
      expect(indie.devices.length).toBeGreaterThanOrEqual(1);
      expect(list.find((d) => d.key === "Discord")).toMatchObject({ kind: "APP", source: "REGISTRY", catalogId: null });

      const added = await call(ownerT, "POST", "/games", { title: indie.name, launcherKey: "STEAM", launcherGameId: indie.key, slug: `indie-${randomUUID().slice(0, 8)}` });
      expect(added.status).toBe(201);
      expect((await found()).find((d) => d.key === indieGame.key).catalogId).toBe(added.body.id);
      await until(() => !!a.config!.games.find((g) => g.id === added.body.id)?.installed); // now matched as installed on that PC

      // Other organizations never see these PCs' scans.
      expect(((await call(rivalT, "GET", "/detected-titles")).body as any[]).some((d) => d.key === indieGame.key)).toBe(false);
      await call(ownerT, "PATCH", `/games/${added.body.id}`, { isActive: false }); // the test DB persists between runs
    });

    it("Epic: a PC on an older build than another PC is flagged for update, and clears once it catches up", async () => {
      const key = `EpicTest${Date.now()}`; // fresh per run: the test DB persists
      const game = (await call(ownerT, "POST", "/games", { title: "Epic test game", launcherKey: "EPIC", launcherGameId: key, slug: `epic-${randomUUID().slice(0, 8)}` })).body;
      const newer = await newStation([{ source: "EPIC", key, name: "Epic test game", buildId: "1.0.3900.0" }]);
      await until(() => !!newer.config!.games.find((g) => g.id === game.id)?.installed);
      const older = await newStation([{ source: "EPIC", key, name: "Epic test game", buildId: "1.0.3889.0" }]);
      await until(() => !!older.config!.games.find((g) => g.id === game.id)?.updateRequired);
      expect(newer.config!.games.find((g) => g.id === game.id)).toMatchObject({ installed: true, updateRequired: false });

      older.games = [{ source: "EPIC", key, name: "Epic test game", buildId: "1.0.3900.0" }];
      older.reportInventory();
      await until(() => older.config!.games.find((g) => g.id === game.id)?.updateRequired === false);
      await call(ownerT, "PATCH", `/games/${game.id}`, { isActive: false });
    });

    it("a launcher downloading an update shows as UPDATING with its real progress, then INSTALLED", async () => {
      const key = `EpicProg${Date.now()}`;
      const game = (await call(ownerT, "POST", "/games", { title: "Progress test game", launcherKey: "EPIC", launcherGameId: key, slug: `prog-${randomUUID().slice(0, 8)}` })).body;
      const pc = await newStation([{ source: "EPIC", key, name: "Progress test game", buildId: "1.0", updateRequired: true, updating: true, progressPct: 42.5 }]);
      const lib = async () => ((await call(ownerT, "GET", `/games?branchId=${dxb1}`)).body.games as any[]).find((g) => g.id === game.id).installs;
      await until(async () => (await lib()).updating === 1);
      expect(await lib()).toMatchObject({ updating: 1, progressPct: 42.5 });
      const found = ((await call(ownerT, "GET", `/detected-titles?branchId=${dxb1}`)).body as any[]).find((d) => d.key === key);
      expect(found).toMatchObject({ updating: 1, progressPct: 42.5, catalogId: game.id });

      pc.games = [{ source: "EPIC", key, name: "Progress test game", buildId: "1.1" }];
      pc.reportInventory();
      await until(async () => (await lib()).updating === 0);
      expect(await lib()).toMatchObject({ installed: 1, updateRequired: 0, progressPct: null });
      await call(ownerT, "PATCH", `/games/${game.id}`, { isActive: false });
    });

    it("Steam closed: a build older than Steam's public one is flagged — on report, and by the sweep for PCs that stay quiet", async () => {
      const appId = String(Date.now()).slice(-8); // fresh per run: the test DB persists
      const game = (await call(ownerT, "POST", "/games", { title: "Steam check game", launcherKey: "STEAM", launcherGameId: appId, slug: `steamchk-${randomUUID().slice(0, 8)}` })).body;
      const status = async (a: SimAgent) => ((await call(techT, "GET", `/devices/${a.identity!.deviceId}/tools`)).body.games as any[]).find((g) => g.gameId === game.id)?.status;

      // 1) The PC's own manifest says "up to date" (Steam isn't running to know better), but Steam has a newer public build.
      steamPublic.set(appId, "500");
      const behind = await newStation([{ source: "STEAM", key: appId, name: "Steam check game", buildId: "400" }]);
      await until(async () => (await status(behind)) === "UPDATE_REQUIRED");
      expect(behind.config!.games.find((g) => g.id === game.id)).toMatchObject({ installed: true, updateRequired: true });

      // 2) A PC on the public build is fine…
      const current = await newStation([{ source: "STEAM", key: appId, name: "Steam check game", buildId: "500" }]);
      await until(async () => (await status(current)) === "INSTALLED");
      // …until Steam publishes a new build: the periodic sweep flags it without the PC reporting anything.
      steamPublic.set(appId, "600");
      const svc = app.get(SteamBuildsService);
      (svc as unknown as { cache: Map<string, unknown> }).cache.delete(appId);
      await svc.sweep();
      expect(await status(current)).toBe("UPDATE_REQUIRED");
      await until(() => !!current.config!.games.find((g) => g.id === game.id)?.updateRequired); // PC's signed library updated too
      expect(((await call(ownerT, "GET", `/detected-titles?branchId=${dxb1}`)).body as any[]).find((d) => d.key === appId).updateRequired).toBe(2);

      // Steam unreachable / unknown app: trust the PC.
      steamPublic.delete(appId);
      (svc as unknown as { cache: Map<string, unknown> }).cache.delete(appId);
      expect(await svc.markBehind([{ source: "STEAM", key: appId, name: "x", buildId: "1" }])).toEqual([{ source: "STEAM", key: appId, name: "x", buildId: "1" }]);
      await call(ownerT, "PATCH", `/games/${game.id}`, { isActive: false });
    });

    it("zone rules: a game limited to VIP disappears from regular PCs at once", async () => {
      const regular = await newStation();
      const vip = await newStation(undefined, vipZone);
      expect(regular.config!.games.some((g) => g.id === cs2Id)).toBe(true);
      expect((await call(ownerT, "PUT", `/games/${cs2Id}/settings`, { allowedZoneIds: [vipZone] })).status).toBe(200);
      await until(() => !regular.config!.games.some((g) => g.id === cs2Id));
      expect(vip.config!.games.some((g) => g.id === cs2Id)).toBe(true);
      await call(ownerT, "PUT", `/games/${cs2Id}/settings`, { allowedZoneIds: [] });
      await until(() => regular.config!.games.some((g) => g.id === cs2Id));
      expect((await call(cashierT, "PUT", `/games/${cs2Id}/settings`, { isEnabled: false })).status).toBe(403);
    });

    it("custom games: validated, pushed to PCs, invisible to other organizations", async () => {
      const a = await newStation();
      const title = `Arcade ${randomUUID().slice(0, 6)}`;
      const bad = await call(ownerT, "POST", "/games", { title, executablePath: "C:\\Windows\\System32\\cmd.exe" });
      expect(bad.status).toBe(400);
      expect((await call(ownerT, "POST", "/games", { title })).body.error).toBe("not_launchable");
      const created = await call(ownerT, "POST", "/games", { title, executablePath: "C:\\Games\\Arcade\\arcade.exe", categories: ["CASUAL"], processNames: ["arcade.exe"], minAge: 7 });
      expect(created.status).toBe(201);
      await until(() => a.config!.games.some((g) => g.title === title));
      expect(a.config!.games.find((g) => g.title === title)!.launch).toEqual({ kind: "PATH", executablePath: "C:\\Games\\Arcade\\arcade.exe", arguments: null, workingDirectory: null });

      const rival = (await call(rivalT, "GET", "/games")).body.games as any[];
      expect(rival.some((g) => g.title === title)).toBe(false);
      expect(rival.some((g) => g.slug === "counter-strike-2")).toBe(true); // platform catalog is shared
      expect((await call(rivalT, "PATCH", `/games/${created.body.id}`, { title: "hijack" })).status).toBe(404);
      expect((await call(ownerT, "PATCH", `/games/${cs2Id}`, { title: "hijack" })).status).toBe(404); // catalog is read-only
    });

    it("the PC is told the customer's age so it can enforce ratings", async () => {
      const a = await newStation();
      const sara = ((await call(ownerT, "GET", "/customers?q=sara")).body as any[])[0];
      const r = await call(cashierT, "POST", `/devices/${a.identity!.deviceId}/sessions`, { planId: regularPlan, customerId: sara.id, request: { kind: "minutes", minutes: 30 }, payment: { method: "CASH" }, idempotencyKey: randomUUID() });
      expect(r.status).toBe(201);
      await until(() => a.received.some((x) => x.type === "START_SESSION"));
      const start = a.received.find((x) => x.type === "START_SESSION")!.payload as any;
      expect(start.customer.age).toBe(13);
      await call(cashierT, "POST", `/sessions/${r.body.id}/end`, { reason: "test" });
    });

    it("reports what is being played to the Live Floor", async () => {
      const a = await newStation([FORTNITE]);
      const fortnite = a.config!.games.find((g) => g.title === "Fortnite")!;
      a.send({ type: "game_event", event: "started", gameId: fortnite.id });
      await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}/tools`)).body.currentGame?.title === "Fortnite");
      a.send({ type: "game_event", event: "exited", gameId: fortnite.id });
      await until(async () => (await call(ownerT, "GET", `/devices/${a.identity!.deviceId}/tools`)).body.currentGame === null);
    });
  });

  describe("game updates", () => {
    it("updates idle PCs a few at a time and never interrupts a customer", async () => {
      const idle = await newStation([{ ...CS2 }]);
      const busy = await newStation([{ ...CS2 }]);
      await until(async () => (await call(ownerT, "GET", `/games/${cs2Id}/installations?branchId=${dxb1}`)).body.filter((i: any) => [idle, busy].some((a) => a.identity!.deviceId === i.device.id) && i.status === "UPDATE_REQUIRED").length === 2);
      const s = await call(cashierT, "POST", `/devices/${busy.identity!.deviceId}/sessions`, { planId: regularPlan, request: { kind: "minutes", minutes: 60 }, payment: { method: "CASH" }, idempotencyKey: randomUUID() });
      expect(s.status).toBe(201);

      expect((await call(cashierT, "POST", `/branches/${dxb1}/game-updates`, { gameId: cs2Id })).status).toBe(403);
      const fortniteId = idle.config!.games.find((g) => g.title === "VALORANT")!.id;
      expect((await call(techT, "POST", `/branches/${dxb1}/game-updates`, { gameId: fortniteId })).body.error).toBe("not_launcher_managed");
      const job = await call(techT, "POST", `/branches/${dxb1}/game-updates`, { gameId: cs2Id, maxConcurrent: 2 });
      expect(job.status).toBe(201);
      expect((await call(techT, "POST", `/branches/${dxb1}/game-updates`, { gameId: cs2Id })).body.error).toBe("already_scheduled");

      // The idle PC gets the signed UPDATE_GAME and reports the game up to date.
      await until(() => idle.received.some((r) => r.type === "UPDATE_GAME"));
      expect(idle.received.find((r) => r.type === "UPDATE_GAME")!.payload).toMatchObject({ gameId: cs2Id, launch: { kind: "STEAM", appId: "730" } });
      await until(async () => (await call(ownerT, "GET", `/games/${cs2Id}/installations?branchId=${dxb1}`)).body.find((i: any) => i.device.id === idle.identity!.deviceId).status === "INSTALLED");

      // The PC with a customer on it is left alone...
      await new Promise((r) => setTimeout(r, 1000));
      expect(busy.received.some((r) => r.type === "UPDATE_GAME")).toBe(false);
      const running = ((await call(ownerT, "GET", `/branches/${dxb1}/game-updates`)).body as any[]).find((j) => j.id === job.body.id);
      expect(running.status).toBe("RUNNING");

      // ...until the session ends; then it is updated and the job completes.
      await call(cashierT, "POST", `/sessions/${s.body.id}/end`, { reason: "done" });
      await until(() => busy.received.some((r) => r.type === "UPDATE_GAME"));
      await until(async () => {
        const jobs = (await call(ownerT, "GET", `/branches/${dxb1}/game-updates`)).body as any[];
        const j = jobs.find((x) => x.id === job.body.id);
        // Other test PCs from earlier cases may still report CS2 outdated; they are idle and get updated too.
        return j.status === "COMPLETED";
      }, 15_000);
    });

    it("a scan request makes online PCs report their games again", async () => {
      const a = await newStation([FORTNITE]);
      expect((await call(cashierT, "POST", `/branches/${dxb1}/game-scan`)).status).toBe(403);
      const r = await call(techT, "POST", `/branches/${dxb1}/game-scan`);
      expect(r.body.requested).toBeGreaterThanOrEqual(1);
      await until(() => a.received.some((x) => x.type === "SCAN_GAMES"));
    });
  });

  describe("station health & support", () => {
    it("a missing mouse raises an alert that clears when it is plugged back in", async () => {
      const a = await newStation();
      const mouse = { hardwareId: "HID\\VID_1532&PID_0098\\7&1", type: "MOUSE", name: "Razer DeathAdder V3", vendor: "Razer" };
      const keyboard = { hardwareId: "HID\\VID_046D&PID_C33F\\7&2", type: "KEYBOARD", name: "Logitech G915", vendor: "Logitech" };
      a.send({ type: "peripherals", items: [mouse, keyboard] });
      await until(async () => (await call(techT, "GET", `/devices/${a.identity!.deviceId}/tools`)).body.peripherals.length === 2);
      a.send({ type: "peripherals", items: [keyboard] });
      await until(async () => (await alertsOf(a)).includes("PERIPHERAL_MISSING"));
      const tools = (await call(techT, "GET", `/devices/${a.identity!.deviceId}/tools`)).body;
      expect(tools.peripherals.find((p: any) => p.type === "MOUSE")).toMatchObject({ connected: false, vendor: "Razer" });
      a.send({ type: "peripherals", items: [mouse, keyboard] });
      await until(async () => !(await alertsOf(a)).includes("PERIPHERAL_MISSING"));
    });

    it("internet loss is flagged, and cleared when the link recovers", async () => {
      const a = await newStation();
      const probe = (ping: number | null, loss: number) => ({ targets: [{ name: "Router", host: "gateway", pingMs: 1, lossPct: 0 }, { name: "Cloudflare", host: "1.1.1.1", pingMs: ping, lossPct: loss }], linkType: "ETHERNET", linkSpeedMbps: 1000 });
      a.send({ type: "network", probe: probe(null, 100) });
      await until(async () => (await alertsOf(a)).includes("NETWORK_DEGRADED"));
      a.send({ type: "network", probe: probe(4, 0) });
      await until(async () => !(await alertsOf(a)).includes("NETWORK_DEGRADED"));
      expect((await call(techT, "GET", `/devices/${a.identity!.deviceId}/tools`)).body.network.targets[1]).toMatchObject({ host: "1.1.1.1", pingMs: 4 });
    });

    it("'Call staff' on the Shell raises a help alert (once, not a flood)", async () => {
      const a = await newStation();
      expect(await a.help("peripheral", "headset crackles")).toMatchObject({ ok: true });
      expect(await a.help("peripheral")).toMatchObject({ ok: true, duplicate: true });
      const alerts = ((await call(cashierT, "GET", `/devices/${a.identity!.deviceId}`)).body.alerts as any[]).filter((x) => x.type === "HELP_REQUESTED");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].detail).toMatchObject({ topic: "peripheral", note: "headset crackles" });
    });

    it("repairs are allow-listed actions only, and need maintenance rights", async () => {
      const a = await newStation();
      const id = a.identity!.deviceId;
      expect((await call(cashierT, "POST", `/devices/${id}/commands`, { type: "RUN_REPAIR", payload: { action: "FLUSH_DNS" } })).status).toBe(403);
      expect((await call(techT, "POST", `/devices/${id}/commands`, { type: "RUN_REPAIR", payload: { action: "format c:" } })).body.error).toBe("invalid_payload");
      expect((await call(techT, "POST", `/devices/${id}/commands`, { type: "RUN_REPAIR", payload: {} })).body.error).toBe("invalid_payload");
      const ok = await call(techT, "POST", `/devices/${id}/commands`, { type: "RUN_REPAIR", payload: { action: "FLUSH_DNS" } });
      expect(ok.status).toBe(201);
      await until(() => a.received.some((r) => r.type === "RUN_REPAIR"));
      expect(a.received.find((r) => r.type === "RUN_REPAIR")!.payload).toEqual({ action: "FLUSH_DNS" });
    });

    it("connectivity targets are per branch and reach the PCs", async () => {
      const a = await newStation();
      const targets = [{ name: "Router", host: "gateway" }, { name: "Valve (EU)", host: "155.133.248.34" }];
      expect((await call(cashierT, "PUT", `/branches/${dxb1}/connectivity-targets`, { targets })).status).toBe(403);
      expect((await call(ownerT, "PUT", `/branches/${dxb1}/connectivity-targets`, { targets: [{ name: "x", host: "http://evil" }] })).status).toBe(400);
      expect((await call(ownerT, "PUT", `/branches/${dxb1}/connectivity-targets`, { targets })).status).toBe(200);
      await until(() => a.config!.connectivityTargets.length === 2 && a.config!.connectivityTargets[1]!.host === "155.133.248.34");
      await call(ownerT, "PUT", `/branches/${dxb1}/connectivity-targets`, { targets: [] });
    });
  });
});
