// Runs the API (4010) or the platform service (4110) against the arena_demo database,
// for enrich.mjs and capture.ts:  node packages/demo/scripts/stack.mjs api|platform
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const which = process.argv[2];
if (!["api", "platform"].includes(which)) throw new Error("usage: stack.mjs api|platform");
const env = { ...process.env };
for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+_DATABASE_URL|DATABASE_URL)=(.*)$/.exec(line);
  if (m && !m[1].startsWith("TEST_")) env[m[1]] = m[2].replace(/\/arena(\?|$)/, "/arena_demo$1");
}
Object.assign(env, { PORT: "4010", PLATFORM_PORT: "4110" });
const entry = which === "api" ? "src/main.ts" : "src/platform/server.ts";
spawn("npx", ["tsx", entry], { cwd: resolve(root, "apps/api"), env, stdio: "inherit", shell: true }).on("exit", (c) => process.exit(c ?? 0));
