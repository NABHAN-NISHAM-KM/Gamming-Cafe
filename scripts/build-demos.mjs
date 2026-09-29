// Builds the live demos into apps/website/live/ (served by the marketing site):
//   live/admin/   admin console + Super Admin (Next.js static export)
//   live/app/     customer app
//   live/shell/   Gaming Shell
// Each runs on the in-browser demo venue (@arena/demo) — no server needed.
//   npm run build:demos            (all)
//   npm run build:demos -- shell   (one)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const live = resolve(root, "apps/website/live");
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

function run(cmd, args, cwd, env) {
  console.log(`\n▶ ${cmd} ${args.join(" ")}  (${cwd.replace(root, ".")})`);
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`✖ failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

mkdirSync(live, { recursive: true });

if (want("admin")) {
  const app = resolve(root, "apps/admin");
  run("npx", ["next", "build"], app, { ARENA_DEMO: "1", DEMO_BASE_PATH: "/live/admin", DEMO_DIST_DIR: ".next-demo" });
  rmSync(resolve(live, "admin"), { recursive: true, force: true });
  cpSync(resolve(app, ".next-demo"), resolve(live, "admin"), { recursive: true, filter: (src) => !/[\\/](cache|server|types|diagnostics)([\\/]|$)/.test(src.replace(resolve(app, ".next-demo"), "")) });
}

if (want("app")) {
  const app = resolve(root, "apps/customer");
  run("npx", ["vite", "build", "--base", "/live/app/", "--outDir", resolve(live, "app"), "--emptyOutDir"], app, { VITE_ARENA_DEMO: "1" });
}

if (want("shell")) {
  const app = resolve(root, "apps/shell");
  run("npx", ["vite", "build", "--base", "./", "--outDir", resolve(live, "shell"), "--emptyOutDir"], app, { VITE_ARENA_DEMO: "1" });
}

for (const d of ["admin", "app", "shell"]) if (existsSync(resolve(live, d))) console.log(`✔ live/${d}`);
