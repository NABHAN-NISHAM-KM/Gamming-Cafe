import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Tests create throwaway orgs/users: run them against the test database only.
if (process.env["TEST_DATABASE_URL"]) process.env["DATABASE_URL"] = process.env["TEST_DATABASE_URL"];
if (process.env["TEST_APP_DATABASE_URL"]) process.env["APP_DATABASE_URL"] = process.env["TEST_APP_DATABASE_URL"];

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
