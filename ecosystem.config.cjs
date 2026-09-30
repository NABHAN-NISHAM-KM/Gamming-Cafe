// pm2 processes for the API server. Deploy:
//   git pull && npm ci && npm run build -w @arena/api && pm2 reload ecosystem.config.cjs
// The API runs from its tsup build (apps/api/dist), so a restart is back in about a second
// instead of recompiling TypeScript on every start. The admin console is started separately.
const path = require("node:path");
const api = path.join(__dirname, "apps/api");

module.exports = {
  apps: [
    { name: "api", cwd: api, script: "dist/main.js", node_args: "--enable-source-maps", kill_timeout: 10000 },
    { name: "platform", cwd: api, script: "dist/platform-server.js", node_args: "--enable-source-maps", kill_timeout: 10000 },
  ],
};
