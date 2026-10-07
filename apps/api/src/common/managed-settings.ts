import { Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { seal, unseal } from "../auth/crypto.js";

export type SettingGroup = "mail" | "payments" | "links" | "push" | "growth";

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  /** Sealed at rest, never shown again after saving. */
  secret?: boolean;
  /** true: takes effect within seconds; false: read once when the service starts. */
  live: boolean;
  type: "text" | "number" | "url" | "email" | "choice";
  choices?: string[];
  placeholder?: string;
  check: z.ZodType<string>;
}

const url = z.url().max(300);
const text = (max = 200) => z.string().trim().min(1).max(max);

/**
 * The settings an operator can change from the Super Admin console instead of
 * editing a server file. Anything that decides who may sign in or where data
 * lives (database logins, signing and encryption keys, ports, CORS) is NOT
 * here: it must exist before the service can even start, so it stays in the
 * server's environment.
 */
export const SETTINGS: SettingDef[] = [
  { key: "SMTP_HOST", group: "mail", label: "Mail server", help: "The SMTP host your provider gives you, e.g. smtp.postmarkapp.com.", live: true, type: "text", placeholder: "smtp.example.com", check: text(200) },
  { key: "SMTP_PORT", group: "mail", label: "Port", help: "587 (STARTTLS) or 465 (secure) is typical.", live: true, type: "number", placeholder: "587", check: z.string().regex(/^\d{1,5}$/).refine((v) => Number(v) >= 1 && Number(v) <= 65535, "1–65535") },
  { key: "SMTP_SECURE", group: "mail", label: "Secure connection from the start", help: "On for port 465. Leave off for 587, which upgrades the connection itself.", live: true, type: "choice", choices: ["off", "on"], check: z.enum(["on", "off"]) },
  { key: "SMTP_USER", group: "mail", label: "User name", help: "Leave empty for a server that needs no sign-in.", live: true, type: "text", check: text(200) },
  { key: "SMTP_PASSWORD", group: "mail", label: "Password", help: "Stored encrypted. Shown only as set / not set.", secret: true, live: true, type: "text", check: text(300) },
  { key: "MAIL_FROM", group: "mail", label: "Sender address", help: "Who the mail is from, e.g. ArenaOS <no-reply@yourdomain.com>.", live: true, type: "text", placeholder: "ArenaOS <no-reply@example.com>", check: text(200) },
  { key: "LEADS_NOTIFY_EMAIL", group: "mail", label: "Tell me about new leads", help: "Each website enquiry, trial and partner request is e-mailed here.", live: true, type: "email", check: z.email().max(200) },

  { key: "BILLING_STRIPE_SECRET_KEY", group: "payments", label: "Stripe secret key (plan payments)", help: "Lets venues pay their ArenaOS plan by card. Starts with sk_. Without it, invoices are paid offline.", secret: true, live: true, type: "text", check: z.string().trim().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/, "Should look like sk_live_… or sk_test_…") },
  { key: "BILLING_STRIPE_WEBHOOK_SECRET", group: "payments", label: "Stripe webhook signing secret", help: "From Stripe → Developers → Webhooks. Starts with whsec_. Point the webhook at /v1/public/billing/stripe-webhook.", secret: true, live: true, type: "text", check: z.string().trim().regex(/^whsec_[A-Za-z0-9]{8,}$/, "Should look like whsec_…") },
  { key: "DEMO_PAYMENTS", group: "payments", label: "Pretend card payments in the customer app", help: "For demos and testing only. Never turn on for a real venue: no card is charged.", live: true, type: "choice", choices: ["off", "on"], check: z.enum(["on", "off"]) },

  { key: "ADMIN_URL", group: "links", label: "Admin console address", help: "Where people land after paying online.", live: true, type: "url", placeholder: "https://admin.example.com", check: url },
  { key: "CUSTOMER_APP_URL", group: "links", label: "Customer app address", help: "Used in QR codes, receipts and venue links.", live: true, type: "url", placeholder: "https://app.example.com", check: url },
  { key: "WEBSITE_URL", group: "links", label: "Public website address", help: "Used for venue pages, posters and referral links.", live: true, type: "url", placeholder: "https://example.com", check: url },

  { key: "VAPID_PUBLIC_KEY", group: "push", label: "Push public key", help: "From `npm run keys`. Phones use it to subscribe. Changing it signs every phone out of notifications.", live: false, type: "text", check: text(200) },
  { key: "VAPID_PRIVATE_KEY", group: "push", label: "Push private key", help: "The matching private key.", secret: true, live: false, type: "text", check: text(200) },
  { key: "VAPID_SUBJECT", group: "push", label: "Push contact", help: "A mailto: or https: address push services can reach you on.", live: false, type: "text", placeholder: "mailto:support@example.com", check: z.string().trim().regex(/^(mailto:|https:\/\/).{3,}$/, "mailto:… or https://…") },

  { key: "LEADS_WEBHOOK_URL", group: "growth", label: "Send new leads to", help: "A Slack, CRM or relay address that receives each lead as JSON.", live: true, type: "url", check: url },
  { key: "SALES_TIMEZONE", group: "growth", label: "Sales time zone", help: "Demo-call slots on the website are offered in this zone, e.g. Asia/Dubai.", live: true, type: "text", check: z.string().trim().refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Not a known time zone") },
  { key: "TRIAL_PLAN_CODE", group: "growth", label: "Plan a free trial starts on", help: "The plan code, e.g. PRO.", live: true, type: "text", check: z.string().trim().regex(/^[A-Z0-9_]{2,20}$/, "Capital letters, digits and _") },
];

export const SETTING_KEYS = new Map(SETTINGS.map((s) => [s.key, s]));

/** What stays in the server environment, and why. Shown on the settings page so nobody hunts for it. */
export const ENV_ONLY = [
  { keys: "DATABASE_URL, APP_DATABASE_URL, PLATFORM_DATABASE_URL, REDIS_URL", why: "The services need the database before they can read any setting." },
  { keys: "JWT_PRIVATE_KEY_B64, JWT_PUBLIC_KEY_B64, MFA_ENCRYPTION_KEY_B64, COMMAND_KEK_B64", why: "Signing and encryption keys: whoever can change them can sign in as anyone. Rotate them on the server." },
  { keys: "PORT, PLATFORM_PORT, CORS_ORIGINS, NODE_ENV", why: "Decide how the service starts and who may call it from a browser." },
];

type Row = { key: string; value: string; isSecret: boolean };

/**
 * Keeps a service's config object in step with the settings saved in the
 * database. A saved value wins over the server's environment; removing it
 * brings the environment's value back. Because the config object is updated in
 * place, everything that reads `cfg.X` sees the change without a restart.
 */
export class SettingsOverlay implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Settings");
  private timer?: NodeJS.Timeout;
  private readonly baseline = new Map<string, unknown>();

  constructor(
    private readonly cfg: Record<string, unknown>,
    private readonly load: () => Promise<Row[]>,
    private readonly keyB64: string,
    private readonly everyMs = Number(process.env["SETTINGS_REFRESH_MS"] ?? 30_000),
  ) {
    for (const s of SETTINGS) this.baseline.set(s.key, cfg[s.key]);
  }

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.everyMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async refresh() {
    let rows: Row[];
    try {
      rows = await this.load();
    } catch (e) {
      // The table may not exist yet (migration pending): keep what we have.
      this.log.warn(`settings not read: ${e instanceof Error ? e.message : e}`);
      return;
    }
    const saved = new Map(rows.map((r) => [r.key, r]));
    for (const def of SETTINGS) {
      const row = saved.get(def.key);
      let value: unknown = this.baseline.get(def.key);
      if (row) {
        try {
          value = row.isSecret ? unseal(row.value, this.keyB64) : row.value;
        } catch {
          this.log.error(`${def.key}: could not be decrypted; using the environment's value`);
        }
      }
      this.cfg[def.key] = def.type === "number" && value !== undefined ? Number(value) : value;
    }
    // Derived from DEMO_PAYMENTS: never on in production.
    if ("demoPayments" in this.cfg) this.cfg["demoPayments"] = this.cfg["NODE_ENV"] !== "production" && this.cfg["DEMO_PAYMENTS"] !== "off";
  }
}

export const sealSetting = (value: string, keyB64: string) => seal(value, keyB64);
