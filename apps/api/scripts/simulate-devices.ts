// Puts virtual stations on the Live Floor.
//   npm run sim -w @arena/api -- --code ARENA-XXXXX-XXXXX-XXXXX-XXXXX --count 12
// Create the code in Admin → Computers → "Add stations" (set "PCs this code can add" ≥ count).
// Identities are saved to .sim-devices.json so re-running reconnects the same PCs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DetectedGame } from "@arena/contracts";
import { SimAgent, type Identity } from "./sim-agent.js";

// A believable café: each PC has most of the popular games, a few need updates.
const LIBRARY: DetectedGame[] = [
  { source: "STEAM", key: "730", name: "Counter-Strike 2", buildId: "18650091" },
  { source: "STEAM", key: "570", name: "Dota 2", buildId: "18501177" },
  { source: "STEAM", key: "1172470", name: "Apex Legends", buildId: "18433020" },
  { source: "STEAM", key: "578080", name: "PUBG: BATTLEGROUNDS", buildId: "18510021" },
  { source: "STEAM", key: "2767030", name: "Marvel Rivals", buildId: "18600009" },
  { source: "STEAM", key: "2669320", name: "EA SPORTS FC 25", buildId: "18340002" },
  { source: "STEAM", key: "271590", name: "Grand Theft Auto V", buildId: "17900001" },
  { source: "EPIC", key: "Fortnite", name: "Fortnite", buildId: "++Fortnite+Release-31.10" },
  { source: "EPIC", key: "Sugar", name: "Rocket League", buildId: "2.47" },
];
const PERIPHERALS = [
  { type: "MOUSE", name: "Razer DeathAdder V3", vendor: "Razer", hw: "HID\\VID_1532&PID_00B2" },
  { type: "KEYBOARD", name: "Logitech G915 TKL", vendor: "Logitech", hw: "HID\\VID_046D&PID_C343" },
  { type: "HEADSET", name: "HyperX Cloud II", vendor: "HyperX", hw: "USB\\VID_0951&PID_16A4" },
];
const simOptions = (i: number) => ({
  log: (m: string) => console.log(m),
  // Deterministic per PC: skip one title, and CS2 needs an update on every third PC.
  games: LIBRARY.filter((_, k) => k !== i % LIBRARY.length).map((g) => ({ ...g, updateRequired: g.key === "730" && i % 3 === 0 })),
});
const reportStation = (a: SimAgent, i: number) => {
  a.send({ type: "peripherals", items: PERIPHERALS.map((p) => ({ hardwareId: `${p.hw}\\SIM${i}`, type: p.type, name: p.name, vendor: p.vendor })) });
  const j = (b: number) => Math.round((b + Math.random() * b * 0.4) * 10) / 10;
  a.send({ type: "network", probe: { targets: [{ name: "Router", host: "gateway", pingMs: j(0.6), lossPct: 0 }, { name: "Cloudflare", host: "1.1.1.1", pingMs: j(4), lossPct: 0 }, { name: "Google DNS", host: "8.8.8.8", pingMs: j(6), lossPct: 0 }], linkType: "ETHERNET", linkSpeedMbps: 2500 } });
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce<Array<[string, string]>>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []),
);
const api = args["api"] ?? "http://localhost:4000";
const count = Number(args["count"] ?? 8);
const file = resolve(import.meta.dirname, "..", args["file"] ?? ".sim-devices.json");
const saved: Identity[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];

const agents: SimAgent[] = [];
for (const [i, id] of saved.slice(0, count).entries()) {
  const a = new SimAgent(api, simOptions(i));
  a.identity = id;
  (a as any).key = (await import("node:crypto")).createPrivateKey(id.privateKeyPem);
  agents.push(a);
}
const code = args["code"]?.trim().toUpperCase();
if (agents.length < count && code && !/^ARENA-[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(code)) {
  console.error(
    `"${args["code"]}" is not an enrolment code. Create one in Admin → Computers → Add stations;\n` +
      `it looks like ARENA-7TGZU-KGGF2-TZX7K-4W9CY (shown once).`,
  );
  process.exit(1);
}
while (agents.length < count) {
  if (!code) {
    console.error(`${agents.length} saved simulated PC(s) in ${args["file"] ?? ".sim-devices.json"}. To add more, pass --code <enrolment code> (Admin → Computers → Add stations).`);
    break;
  }
  const a = new SimAgent(api, simOptions(agents.length));
  try {
    const id = await a.enroll(code);
    console.log(`enrolled ${id.name}`);
    saved.push(id);
    agents.push(a);
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error(
      status === 401
        ? `Enrolment code rejected: it is wrong, expired, revoked or used up. Create a new one and set "PCs this code can add" to at least ${count - agents.length}.`
        : status === 402
          ? "Your plan's station limit is reached."
          : `Enrolment failed: ${(e as Error).message}`,
    );
    break;
  }
}
if (agents.length === 0) process.exit(1);
writeFileSync(file, JSON.stringify(saved, null, 2));

// Like the real agent: if the server goes away (restart, network), keep retrying.
const keepAlive = (a: SimAgent) => {
  let delay = 1000;
  const attempt = async () => {
    try {
      await a.connect();
      reportStation(a, agents.indexOf(a));
      delay = 1000;
      console.log(`online: ${a.identity!.name}`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) return console.error(`${a.identity!.name}: rejected by the server (retired?) — not retrying`);
      delay = Math.min(30_000, delay * 2);
      setTimeout(attempt, delay);
    }
  };
  a.onClosed = () => {
    console.log(`${a.identity!.name}: connection lost, reconnecting…`);
    setTimeout(attempt, delay);
  };
  return attempt();
};
for (const a of agents) await keepAlive(a);
console.log(`\n${agents.length} simulated station(s) running. Ctrl+C to stop (they will show as offline).`);
process.on("SIGINT", async () => {
  await Promise.all(agents.map((a) => a.disconnect()));
  process.exit(0);
});
