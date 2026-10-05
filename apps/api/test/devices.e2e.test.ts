// Phase 3 end-to-end: real API on a real port, real WebSockets, simulated
// agents that verify every command exactly as the Windows agent does.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";
import { SimAgent, randomMac } from "../scripts/sim-agent.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const until = async (fn: () => Promise<boolean> | boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not met in time");
};

describe.skipIf(!HAS_DB)("Devices, commands & Live Floor (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const agents: SimAgent[] = [];
  let owner: string, cashier: string, tech: string, rival: string;
  let dxb1: string, vipZone: string;

  const call = async (token: string, method: string, path: string, body?: unknown, reason?: string) => {
    const res = await fetch(`${base}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email: string) => {
    const res = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
    return (await res.json()).accessToken as string;
  };
  const newCode = async (maxUses = 5, zoneId = vipZone) => {
    const r = await call(owner, "POST", `/branches/${dxb1}/enrollment-tokens`, { zoneId, maxUses, expiresInHours: 1, label: "e2e" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.code as string;
  };
  const sim = (opts?: ConstructorParameters<typeof SimAgent>[1]) => {
    const a = new SimAgent(base, { heartbeatSeconds: 60, ...opts });
    agents.push(a);
    return a;
  };
  const device = async (id: string) => (await call(owner, "GET", `/devices/${id}`)).body;

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [owner, cashier, tech, rival] = (await Promise.all(["owner@demo.test", "cashier@demo.test", "tech@demo.test", "owner@rival.test"].map(login))) as [string, string, string, string];
    const branches = (await call(owner, "GET", "/branches")).body as Array<{ id: string; code: string }>;
    dxb1 = branches.find((b) => b.code === "DXB1")!.id;
    const zones = (await call(owner, "GET", `/branches/${dxb1}/zones`)).body as Array<{ id: string; type: string }>;
    vipZone = zones.find((z) => z.type === "PC_VIP")!.id;
  }, 60_000);

  afterAll(async () => {
    await Promise.all(agents.map((a) => a.disconnect()));
    await app?.close();
  });

  describe("enrolment", () => {
    it("a batch code enrols several PCs, auto-named by zone, then runs out", async () => {
      const code = await newCode(2);
      const a = await sim().enroll(code);
      const b = await sim().enroll(code);
      expect(a.name).toMatch(/^VIP-\d{2,}$/); // zero-padded to 2 digits; grows past 99
      expect(b.name).not.toBe(a.name);
      expect(Object.keys(a.signingKeys)).toHaveLength(1);
      await expect(sim().enroll(code)).rejects.toMatchObject({ status: 401 });
    });

    it("rejects wrong codes and non-P-256 keys", async () => {
      await expect(sim().enroll("ARENA-AAAAA-BBBBB-CCCCC-DDDDD")).rejects.toMatchObject({ status: 401 });
      const { generateKeyPairSync } = await import("node:crypto");
      const rsa = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
      await expect(sim().enroll(await newCode(1), { publicKeyPem: rsa.publicKey })).rejects.toMatchObject({ status: 400 });
    });

    it("re-installing Windows on the same PC (same MAC) re-enrols the same station", async () => {
      const mac = randomMac();
      const first = await sim().enroll(await newCode(1), { macAddress: mac });
      const second = await sim().enroll(await newCode(1), { macAddress: mac });
      expect(second.deviceId).toBe(first.deviceId);
    });
  });

  describe("agent authentication", () => {
    it("connects with a proof-of-possession assertion and shows online on the floor", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      await a.connect();
      await until(async () => (await device(a.identity!.deviceId)).isOnline === true);
      const floor = (await call(owner, "GET", `/branches/${dxb1}/floor`)).body;
      const d = floor.devices.find((x: any) => x.id === a.identity!.deviceId);
      expect(d).toMatchObject({ isOnline: true, displayStatus: "AVAILABLE" });
      expect(d.metrics?.cpuPct).toBeTypeOf("number");
    });

    it("rejects a replayed assertion and a key the device never enrolled", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      const assertion = await a.assertion();
      await a.connect(assertion);
      await a.disconnect();
      await expect(a.connect(assertion)).rejects.toMatchObject({ status: 401 });

      const imposter = sim();
      imposter.identity = { ...a.identity!, privateKeyPem: SimAgent.generateKey().privateKey };
      (imposter as any).key = (await import("node:crypto")).createPrivateKey(imposter.identity.privateKeyPem);
      await expect(imposter.connect()).rejects.toMatchObject({ status: 401 });
    });
  });

  describe("signed remote commands", () => {
    it("delivers a signed message; the agent verifies it and acks → SUCCEEDED", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      await a.connect();
      const r = await call(owner, "POST", `/devices/${a.identity!.deviceId}/commands`, { type: "SEND_MESSAGE", payload: { message: "Your food is ready!" } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      await until(async () => (await call(owner, "GET", `/devices/${a.identity!.deviceId}/commands`)).body[0]?.status === "SUCCEEDED");
      expect(a.received.at(-1)).toMatchObject({ type: "SEND_MESSAGE", verified: true, payload: { message: "Your food is ready!" } });
      const listed = (await call(owner, "GET", `/devices/${a.identity!.deviceId}/commands`)).body[0];
      expect(listed.payload._signed).toBeUndefined(); // signing material never shown in the UI
    });

    it("queues commands for an offline PC and delivers them on reconnect", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      await a.connect();
      await a.disconnect();
      await until(async () => (await device(a.identity!.deviceId)).isOnline === false);
      const r = await call(owner, "POST", `/devices/${a.identity!.deviceId}/commands`, { type: "LOCK" });
      expect(r.body).toMatchObject({ status: "PENDING", online: false });
      await a.connect();
      await until(async () => (await call(owner, "GET", `/devices/${a.identity!.deviceId}/commands`)).body[0]?.status === "SUCCEEDED");
    });

    it("permissions are per command type and branch; other tenants get 404", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      const id = a.identity!.deviceId;
      expect((await call(cashier, "POST", `/devices/${id}/commands`, { type: "RESTART" })).status).toBe(403);
      expect((await call(cashier, "POST", `/devices/${id}/commands`, { type: "LOCK" })).status).toBe(201);
      expect((await call(tech, "POST", `/devices/${id}/commands`, { type: "RESTART" })).status).toBe(201);
      expect((await call(rival, "POST", `/devices/${id}/commands`, { type: "LOCK" })).status).toBe(404);
      expect((await call(owner, "POST", `/devices/${id}/commands`, { type: "START_SESSION" })).status).toBe(400); // sessions API only
    });

    it("Wake-on-LAN is relayed by another online PC on the same LAN", async () => {
      const sleeper = sim();
      await sleeper.enroll(await newCode(1), { macAddress: "AA:BB:CC:00:11:22" });
      const relay = sim();
      await relay.enroll(await newCode(1));
      await relay.connect();
      const r = await call(owner, "POST", `/devices/${sleeper.identity!.deviceId}/commands`, { type: "WAKE_ON_LAN" }, "open for the day");
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.relayedBy).toBeTruthy();
      await until(() => agents.some((x) => x.received.some((c) => c.type === "WAKE_ON_LAN" && (c.payload as any).macAddress === "AA:BB:CC:00:11:22")));
    });

    it("zone mass action reaches every connected PC in the zone", async () => {
      const r = await call(owner, "POST", `/zones/${vipZone}/commands`, { type: "SEND_MESSAGE", payload: { message: "Closing in 15 minutes" } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.count).toBeGreaterThan(0);
      const online = agents.filter((a) => a.ws && a.identity?.zoneId === vipZone);
      await until(() => online.every((a) => a.received.some((c) => (c.payload as any)?.message === "Closing in 15 minutes")));
    });
  });

  describe("monitoring", () => {
    it("raises a critical alert for an overheating CPU and a warning for a hardware swap", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      await a.connect();
      a.heartbeat({ cpuPct: 90, cpuTempC: 98, gpuTempC: 70, diskPct: 50 });
      await until(async () => (await device(a.identity!.deviceId)).alerts.some((x: any) => x.type === "HIGH_CPU_TEMP" && x.severity === "CRITICAL"));
      a.send({ type: "hardware", snapshot: { cpu: "Intel Core i5-12400F", cpuCores: 6, gpu: "NVIDIA GeForce GTX 1650", ramMb: 16384 } });
      await until(async () => (await device(a.identity!.deviceId)).alerts.some((x: any) => x.type === "HARDWARE_CHANGED"));
    });

    it("a temperature alert stays open while hovering near the limit, then resolves; a tethered phone is not a hardware change", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      await a.connect();
      const temp = async () => (await device(a.identity!.deviceId)).alerts.find((x: any) => x.type === "HIGH_CPU_TEMP");
      a.heartbeat({ cpuTempC: 98 });
      await until(async () => (await temp())?.severity === "CRITICAL");
      a.heartbeat({ cpuTempC: 85 });
      await until(async () => (await temp())?.severity === "WARNING");
      a.heartbeat({ cpuTempC: 75 });
      await until(async () => !(await temp()));

      const snap = { cpu: "Intel Core i5-12400F", cpuCores: 6, gpu: "NVIDIA GeForce GTX 1650", ramMb: 16384 };
      a.send({ type: "hardware", snapshot: { ...snap, nics: [{ name: "Ethernet", mac: "00:1A:2B:3C:4D:5E" }] } });
      await new Promise((r) => setTimeout(r, 300));
      const before = (await device(a.identity!.deviceId)).alerts.filter((x: any) => x.type === "HARDWARE_CHANGED").length;
      a.send({ type: "hardware", snapshot: { ...snap, nics: [{ name: "Ethernet", mac: "00:1A:2B:3C:4D:5E" }, { name: "Ethernet 3", mac: "F6:C7:A7:0C:74:48" }] } });
      await new Promise((r) => setTimeout(r, 300));
      expect((await device(a.identity!.deviceId)).alerts.filter((x: any) => x.type === "HARDWARE_CHANGED").length).toBe(before);
    });

    it("streams live floor events over SSE", async () => {
      const ctrl = new AbortController();
      const res = await fetch(`${base}/v1/branches/${dxb1}/floor/events`, { headers: { authorization: `Bearer ${owner}` }, signal: ctrl.signal });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const seen: string[] = [];
      const pump = (async () => {
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          seen.push(dec.decode(value));
        }
      })().catch(() => undefined);
      const a = sim();
      await a.enroll(await newCode(1));
      await a.connect();
      await until(() => seen.join("").includes(a.identity!.deviceId) && seen.join("").includes("event: metrics"));
      ctrl.abort();
      await pump;
    });

    it("the floor stream is tenant-isolated", async () => {
      const res = await fetch(`${base}/v1/branches/${dxb1}/floor/events`, { headers: { authorization: `Bearer ${rival}` } });
      expect(res.status).toBe(404);
    });
  });

  describe("retirement", () => {
    it("retiring a station disconnects it and blocks reconnection", async () => {
      const a = sim();
      await a.enroll(await newCode(1));
      await a.connect();
      expect((await call(owner, "DELETE", `/devices/${a.identity!.deviceId}`)).status).toBe(204);
      await until(() => !a.ws || a.ws.readyState === a.ws.CLOSED);
      await expect(a.connect()).rejects.toMatchObject({ status: 401 });
    });
  });
});
