import { defineConfig } from "prisma/config";
import { existsSync } from "node:fs";

if (!process.env["DATABASE_URL"] && existsSync("../../.env")) process.loadEnvFile("../../.env");

// DATABASE_URL must point at the migration role (table owner). The runtime API
// connects with a separate, non-owner role so Row-Level Security is enforced.
// A placeholder is used so `prisma validate` / `prisma generate` work without a DB.
export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "postgresql://placeholder:placeholder@localhost:5432/arena",
  },
});
