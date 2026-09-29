import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Tests create throwaway orgs/users: run them against the test database only.
if (process.env["TEST_DATABASE_URL"]) process.env["DATABASE_URL"] = process.env["TEST_DATABASE_URL"];
if (process.env["TEST_APP_DATABASE_URL"]) process.env["APP_DATABASE_URL"] = process.env["TEST_APP_DATABASE_URL"];
// Platform (Super Admin) service: same test database, platform login. Derived when not set explicitly.
const testDbName = process.env["TEST_DATABASE_URL"] && new URL(process.env["TEST_DATABASE_URL"]).pathname;
if (process.env["TEST_PLATFORM_DATABASE_URL"]) process.env["PLATFORM_DATABASE_URL"] = process.env["TEST_PLATFORM_DATABASE_URL"];
else if (testDbName && process.env["PLATFORM_DATABASE_URL"]) {
  const u = new URL(process.env["PLATFORM_DATABASE_URL"]);
  u.pathname = testDbName;
  process.env["PLATFORM_DATABASE_URL"] = u.toString();
}

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
