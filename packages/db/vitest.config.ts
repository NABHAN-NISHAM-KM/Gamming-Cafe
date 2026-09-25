import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load the repo-root .env (if present) so the Postgres integration tests run
// locally with `npm test`. CI sets the variables directly.
const envFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    // Integration suites share one database; run files sequentially.
    fileParallelism: false,
  },
});
