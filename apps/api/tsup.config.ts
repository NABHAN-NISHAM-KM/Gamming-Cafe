import { defineConfig } from "tsup";

// Production build: `npm run build -w @arena/api` -> dist/main.js (API) and dist/platform-server.js
// (Super Admin service). The @arena/* workspace packages ship TypeScript source, so they're bundled
// in; everything from npm stays in node_modules. Services inject with explicit @Inject(), so
// esbuild needs no decorator metadata.
export default defineConfig({
  entry: { main: "src/main.ts", "platform-server": "src/platform/server.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@arena\//],
  external: [/^(?!@arena\/)[^./]/],
});
