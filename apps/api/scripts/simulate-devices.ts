// Puts virtual stations on the Live Floor.
//   npm run sim -w @arena/api -- --code ARENA-XXXXX-XXXXX-XXXXX-XXXXX --count 12
// Create the code in Admin → Computers → "Add stations" (set "PCs this code can add" ≥ count).
// Identities are saved to .sim-devices.json so re-running reconnects the same PCs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SimAgent, type Identity } from "./sim-agent.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<Array<[string, string]>>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []),
);
const api = args["api"] ?? "http://localhost:4000";
const count = Number(args["count"] ?? 8);
const file = resolve(import.meta.dirname, "..", args["file"] ?? ".sim-devices.json");
const saved: Identity[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];

const agents: SimAgent[] = [];
for (const id of saved.slice(0, count)) {
  const a = new SimAgent(api, { log: (m) => console.log(m) });
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
  const a = new SimAgent(api, { log: (m) => console.log(m) });
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
