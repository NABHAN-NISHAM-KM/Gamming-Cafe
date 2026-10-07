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
  /** Simulated card payments in the customer app ("Pay now" with no real card). Never on in production. */
  DEMO_PAYMENTS: z.enum(["on", "off"]).optional(),
  /** Web push for the customer app (`npm run keys` makes a pair). Without them, push is simply off. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@arenaos.app"),
  /** The customer app's address, for the "sign in with your phone" QR code on the PCs. */
  CUSTOMER_APP_URL: z.url().default("http://localhost:5175"),
  /** The admin console's address, for "back to ArenaOS" links after paying online. */
  ADMIN_URL: z.url().default("http://localhost:3000"),
  /** The public website, for venue pages, posters and referral links. */
  WEBSITE_URL: z.url().default("http://localhost:5180"),
  /** The platform's own Stripe account, for venues paying their ArenaOS plan by card. Without it, invoices are paid offline. */
  BILLING_STRIPE_SECRET_KEY: z.string().optional(),
  /** Outgoing mail (Settings → Mail). Without a server, mail simply isn't sent. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z.enum(["on", "off"]).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  LEADS_NOTIFY_EMAIL: z.string().optional(),
  /** Where to read Steam's latest public build per appid ("off" to disable; default api.steamcmd.net, off in tests). */
  STEAM_BUILDS_URL: z.union([z.literal("off"), z.url()]).optional(),
}).transform((c) => ({ ...c, demoPayments: c.NODE_ENV !== "production" && c.DEMO_PAYMENTS !== "off" }));

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
