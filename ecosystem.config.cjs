// pm2 processes for the API server. Deploy:
//   git pull && npm ci && npm run build -w @arena/api && pm2 reload ecosystem.config.cjs
// The API runs from its tsup build (apps/api/dist), so a restart is back in about a second
// instead of recompiling TypeScript on every start. The admin console is started separately.
// node is spawned directly (interpreter "none"): main.ts and server.ts only listen when they are
// process.argv[1], which isn't true when pm2 loads the file through its own wrapper.
const path = require("node:path");
const api = path.join(__dirname, "apps/api");
const run = (name, file) => ({
  name,
  cwd: api,
  script: process.execPath,
  args: ["--enable-source-maps", file],
  interpreter: "none",
  kill_timeout: 10000,
});

module.exports = { apps: [run("api", "dist/main.js"), run("platform", "dist/platform-server.js")] };
