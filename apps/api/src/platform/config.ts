import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// Repo-root .env: four levels up from src/platform (tsx), three from the bundled apps/api/dist.
const rootEnv = ["../../../../.env", "../../../.env"].map((p) => resolve(import.meta.dirname, p)).find(existsSync);
if (rootEnv) process.loadEnvFile(rootEnv);

const pem = (name: string) =>
  z
    .string({ error: `${name} is required — run \`npm run keys -w @arena/api\`` })
    .transform((b64) => Buffer.from(b64, "base64").toString("utf8"))
    .refine((v) => v.includes("-----BEGIN"), `${name} must be a base64-encoded PEM`);

/**
 * The Super Admin (platform) service runs as its own process with its own
 * database login (arena_platform_svc, BYPASSRLS). The tenant API never holds
 * this credential, and this service never serves tenant routes.
 */
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PLATFORM_PORT: z.coerce.number().int().default(4100),
  PLATFORM_DATABASE_URL: z.string().min(1),
  JWT_PRIVATE_KEY_B64: pem("JWT_PRIVATE_KEY_B64"),
  JWT_PUBLIC_KEY_B64: pem("JWT_PUBLIC_KEY_B64"),
  JWT_ISSUER: z.string().default("arenaos"),
  /** Shorter than staff sessions: platform access is the most powerful credential there is. */
  PLATFORM_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(600),
  PLATFORM_REFRESH_TTL_HOURS: z.coerce.number().int().positive().default(12),
  MFA_ENCRYPTION_KEY_B64: z
    .string({ error: "MFA_ENCRYPTION_KEY_B64 is required — run `npm run keys -w @arena/api`" })
    .refine((v) => Buffer.from(v, "base64").length === 32, "MFA_ENCRYPTION_KEY_B64 must decode to 32 bytes"),
  PLATFORM_CORS_ORIGINS: z.string().default("http://localhost:3000"),
  /** Website leads are also POSTed here (Slack, an e-mail relay, a CRM). Optional. */
  LEADS_WEBHOOK_URL: z.url().optional(),
  /** Demo-call slots on the website are offered in this time zone. */
  SALES_TIMEZONE: z.string().default("Asia/Dubai"),
  /** The plan a self-serve trial starts on (all its features for 14 days). */
  TRIAL_PLAN_CODE: z.string().default("PRO"),
  /** Signs the "invoice paid" webhooks from the platform's Stripe account (venues paying their plan by card). */
  BILLING_STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Hourly renewal invoices and overdue checks; "off" in tests, which run the sweep themselves. */
  BILLING_SWEEP: z.enum(["on", "off"]).default("on"),
  /** Outgoing mail (Settings → Mail). Without a server, mail simply isn't sent. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z.enum(["on", "off"]).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  LEADS_NOTIFY_EMAIL: z.string().optional(),
  /** The same addresses and keys the tenant API reads, so the Settings page shows what is really in force. */
  ADMIN_URL: z.url().default("http://localhost:3000"),
  CUSTOMER_APP_URL: z.url().default("http://localhost:5175"),
  WEBSITE_URL: z.url().default("http://localhost:5180"),
  BILLING_STRIPE_SECRET_KEY: z.string().optional(),
  DEMO_PAYMENTS: z.enum(["on", "off"]).optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@arenaos.app"),
  LOGIN_MAX_FAILURES: z.coerce.number().int().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().default(15),
});

export type PlatformConfig = z.infer<typeof Env>;

export function loadPlatformConfig(overrides: Record<string, string | undefined> = {}): PlatformConfig {
  const parsed = Env.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid platform configuration:\n${msg}`);
  }
  return parsed.data;
}

export const PLATFORM_CONFIG = Symbol("PLATFORM_CONFIG");
export const PDB = Symbol("PLATFORM_DB");
