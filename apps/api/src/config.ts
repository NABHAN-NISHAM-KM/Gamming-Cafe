import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const pem = (name: string) =>
  z
    .string({ error: `${name} is required — run \`npm run keys -w @arena/api\`` })
    .transform((b64) => Buffer.from(b64, "base64").toString("utf8"))
    .refine((v) => v.includes("-----BEGIN"), `${name} must be a base64-encoded PEM`);

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  APP_DATABASE_URL: z.string().min(1),
  JWT_PRIVATE_KEY_B64: pem("JWT_PRIVATE_KEY_B64"),
  JWT_PUBLIC_KEY_B64: pem("JWT_PUBLIC_KEY_B64"),
  JWT_ISSUER: z.string().default("arenaos"),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MFA_ENCRYPTION_KEY_B64: z
    .string({ error: "MFA_ENCRYPTION_KEY_B64 is required — run `npm run keys -w @arena/api`" })
    .refine((v) => Buffer.from(v, "base64").length === 32, "MFA_ENCRYPTION_KEY_B64 must decode to 32 bytes"),
  COMMAND_KEK_B64: z
    .string({ error: "COMMAND_KEK_B64 is required — run `npm run keys -w @arena/api`" })
    .refine((v) => Buffer.from(v, "base64").length === 32, "COMMAND_KEK_B64 must decode to 32 bytes"),
  DEVICE_HEARTBEAT_SECONDS: z.coerce.number().int().min(3).max(120).default(10),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  LOGIN_MAX_FAILURES: z.coerce.number().int().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().default(15),
});

export type AppConfig = z.infer<typeof Env>;

export function loadConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  const parsed = Env.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol("CONFIG");
