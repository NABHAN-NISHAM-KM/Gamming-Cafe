// Operator settings from the Super Admin console: saved sealed, applied live to
// both services, mail actually sent over SMTP (to a stand-in server), and the
// venue's own Stripe keys typed in Settings instead of named in the environment.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { createPlatformApp } from "../src/platform/server.js";
import { loadPlatformConfig } from "../src/platform/config.js";
import { hashSecret, totpAt } from "../src/auth/crypto.js";
import { SETTINGS } from "../src/common/managed-settings.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["PLATFORM_DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
};

describe("the settings list", () => {
  it("never offers what must stay on the server", () => {
    const keys = SETTINGS.map((s) => s.key);
    for (const forbidden of ["DATABASE_URL", "APP_DATABASE_URL", "PLATFORM_DATABASE_URL", "JWT_PRIVATE_KEY_B64", "MFA_ENCRYPTION_KEY_B64", "COMMAND_KEK_B64", "CORS_ORIGINS", "PORT"]) expect(keys).not.toContain(forbidden);
  });
  it("secrets are marked and have strict shapes", () => {
    const stripe = SETTINGS.find((s) => s.key === "BILLING_STRIPE_SECRET_KEY")!;
    expect(stripe.secret).toBe(true);
    expect(stripe.check.safeParse("sk_live_abcdefgh12345").success).toBe(true);
    expect(stripe.check.safeParse("pk_live_abcdefgh12345").success).toBe(false);
  });
});

/** A very small SMTP server: accepts anything and remembers the messages. */
function smtpSink() {
  const inbox: string[] = [];
  const server: Server = createServer((sock: Socket) => {
    let data = false;
    let buf = "";
    let msg = "";
    sock.write("220 sink ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (data) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) {
            msg += buf;
            buf = "";
            return;
          }
          inbox.push(msg + buf.slice(0, end));
          msg = "";
          buf = buf.slice(end + 5);
          data = false;
          sock.write("250 queued\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl).toUpperCase();
        buf = buf.slice(nl + 2);
        if (line.startsWith("EHLO")) sock.write("250-sink\r\n250 8BITMIME\r\n");
        else if (line.startsWith("DATA")) {
          data = true;
          sock.write("354 go\r\n");
        } else if (line.startsWith("QUIT")) sock.end("221 bye\r\n");
        else sock.write("250 ok\r\n");
      }
    });
  });
  return { inbox, server };
}

describe.skipIf(!HAS_DB)("Settings, mail and payment keys (e2e)", () => {
  let tenant: INestApplication;
  let platform: INestApplication;
  let base: string;
  let pbase: string;
  const sink = smtpSink();
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  let platformT: string, ownerT: string, cashierT: string, supportT: string;

  const req = async (url: string, token: string | null, method: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const plat = (method: string, path: string, body?: unknown, token = platformT) => req(`${pbase}/v1/platform${path}`, token, method, body);
  const staff = (token: string, method: string, path: string, body?: unknown, reason = "testing") => req(`${base}/v1${path}`, token, method, body, reason ? { "x-action-reason": reason } : {});
  const login = async (email: string) => (await req(`${base}/v1/auth/login`, null, "POST", { email, password: DEMO_PASSWORD })).body.accessToken as string;
  const settingOf = async (key: string) => ((await plat("GET", "/settings")).body.settings as Array<{ key: string; source: string; set: boolean; value: string | null }>).find((s) => s.key === key)!;
  const platformAdmin = async (role: string) => {
    const email = `st-${randomUUID().slice(0, 8)}@platform.test`;
    const u = await owner.query(`INSERT INTO "User" (id, email, "displayName", "passwordHash", "emailVerified", "updatedAt") VALUES (gen_random_uuid(), $1, 'Ops', $2, true, now()) RETURNING id`, [email, await hashSecret("Platform!Test-2026")]);
    await owner.query(`INSERT INTO "PlatformRoleAssignment" (id, "userId", role) VALUES (gen_random_uuid(), $1, $2::"PlatformRole")`, [u.rows[0].id, role]);
    const first = (await req(`${pbase}/v1/platform/auth/login`, null, "POST", { email, password: "Platform!Test-2026" })).body;
    return (await req(`${pbase}/v1/platform/auth/mfa/verify`, null, "POST", { mfaToken: first.mfaToken, code: totpAt(first.secret, Date.now()) })).body.accessToken as string;
  };
  const mailSettings = (port: number) => ({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_SECURE: "off", MAIL_FROM: "ArenaOS <no-reply@arena.test>", SMTP_PASSWORD: "smtp-secret-pass" });

  beforeAll(async () => {
    process.env["SETTINGS_REFRESH_MS"] = "200"; // the tenant API notices a change within a fraction of a second
    await seed(process.env["DATABASE_URL"]);
    await owner.query(`DELETE FROM "PlatformSetting"`);
    await new Promise<void>((r) => sink.server.listen(0, "127.0.0.1", r));
    tenant = await createApp(loadConfig({ NODE_ENV: "test" }));
    await tenant.listen(0);
    base = `http://127.0.0.1:${(tenant.getHttpServer().address() as AddressInfo).port}`;
    platform = await createPlatformApp(loadPlatformConfig({ NODE_ENV: "test", BILLING_SWEEP: "off" }));
    await platform.listen(0);
    pbase = `http://127.0.0.1:${(platform.getHttpServer().address() as AddressInfo).port}`;
    [platformT, supportT] = [await platformAdmin("SUPER_ADMIN"), await platformAdmin("PLATFORM_SUPPORT")];
    [ownerT, cashierT] = (await Promise.all(["owner@demo.test", "cashier@demo.test"].map(login))) as [string, string];
  });
  afterAll(async () => {
    await owner.query(`DELETE FROM "PlatformSetting"`);
    await tenant?.close();
    await platform?.close();
    sink.server.close();
    await owner.end();
  });

  it("only a Super Admin can read or change settings", async () => {
    expect((await plat("GET", "/settings", undefined, supportT)).status).toBe(403);
    expect((await plat("PUT", "/settings", { values: { ADMIN_URL: "https://x.test" } }, supportT)).status).toBe(403);
    expect((await req(`${pbase}/v1/platform/settings`, null, "GET")).status).toBe(401);
  });

  it("saves values, seals secrets, never returns them, and audits names only", async () => {
    const port = (sink.server.address() as AddressInfo).port;
    const r = await plat("PUT", "/settings", { values: mailSettings(port) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await settingOf("SMTP_HOST")).toMatchObject({ source: "saved", value: "127.0.0.1" });
    expect(await settingOf("SMTP_PASSWORD")).toMatchObject({ source: "saved", set: true, value: null });
    expect(JSON.stringify(r.body)).not.toContain("smtp-secret-pass");

    const row = (await owner.query(`SELECT value, "isSecret" FROM "PlatformSetting" WHERE key = 'SMTP_PASSWORD'`)).rows[0];
    expect(row.isSecret).toBe(true);
    expect(row.value).toMatch(/^v1\./);
    expect(row.value).not.toContain("smtp-secret-pass");

    const audit = (await owner.query(`SELECT after::text AS a FROM "AuditLog" WHERE action = 'platform.settings.change' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0].a;
    expect(audit).toContain("SMTP_PASSWORD");
    expect(audit).not.toContain("smtp-secret-pass");
  });

  it("refuses wrong shapes and unknown keys, changing nothing", async () => {
    const bad = await plat("PUT", "/settings", { values: { ADMIN_URL: "not a url", BILLING_STRIPE_SECRET_KEY: "pk_live_nope", SALES_TIMEZONE: "Mars/Olympus" } });
    expect(bad.status).toBe(409);
    expect(Object.keys(bad.body.problems).sort()).toEqual(["ADMIN_URL", "BILLING_STRIPE_SECRET_KEY", "SALES_TIMEZONE"]);
    expect((await plat("PUT", "/settings", { values: { DATABASE_URL: "postgres://evil" } })).body.error).toBe("unknown_setting");
    expect((await settingOf("ADMIN_URL")).source).not.toBe("saved");
  });

  it("checks the mail connection and sends a test message", async () => {
    expect((await plat("POST", "/settings/test-mail", {})).body).toEqual({ ok: true });
    sink.inbox.length = 0;
    expect((await plat("POST", "/settings/test-mail", { to: "ops@example.com" })).body).toEqual({ ok: true });
    expect(sink.inbox).toHaveLength(1);
    expect(sink.inbox[0]).toMatch(/Subject: ArenaOS test message/i);
    expect(sink.inbox[0]).toMatch(/From: ArenaOS <no-reply@arena\.test>/i);
    // Pointing at nothing is reported, not thrown.
    await plat("PUT", "/settings", { values: { SMTP_PORT: "1" } });
    const down = (await plat("POST", "/settings/test-mail", {})).body;
    expect(down.ok).toBe(false);
    expect(down.error).toBeTruthy();
    await plat("PUT", "/settings", { values: { SMTP_PORT: String((sink.server.address() as AddressInfo).port) } });
  });

  it("e-mails a password-reset code, which works once; unknown accounts get the same answer and no mail", async () => {
    // The tenant API is a separate process: it picks the saved mail settings up on its own.
    const username = `m${randomUUID().slice(0, 8)}`;
    const email = `${username}@player.test`;
    const made = await staff(cashierT, "POST", "/customers", { username, displayName: `Mia ${username}`, password: "longpassword1", email }, "");
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    sink.inbox.length = 0;

    await new Promise((r) => setTimeout(r, 800)); // the tenant API re-reads settings every 200 ms in this test
    expect((await req(`${base}/v1/app/demo/forgot`, null, "POST", { username })).status).toBe(204);
    await until(() => sink.inbox.length > 0);
    const code = /code is (\d{6})/.exec(sink.inbox.at(-1)!)![1]!;
    expect(sink.inbox.at(-1)).toMatch(new RegExp(`To: .*${email}`, "i"));

    expect((await req(`${base}/v1/app/demo/reset`, null, "POST", { username, code: "000000", password: "brandnewpass1" })).status).toBe(401);
    expect((await req(`${base}/v1/app/demo/reset`, null, "POST", { username, code, password: "brandnewpass1" })).status).toBe(204);
    expect((await req(`${base}/v1/app/demo/reset`, null, "POST", { username, code, password: "anotherpass12" })).status).toBe(401);
    expect((await req(`${base}/v1/app/demo/login`, null, "POST", { username, password: "brandnewpass1" })).status).toBe(200);

    const before = sink.inbox.length;
    expect((await req(`${base}/v1/app/demo/forgot`, null, "POST", { username: `nobody-${randomUUID()}` })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 400));
    expect(sink.inbox.length).toBe(before);
  });

  it("limits how many codes one account can be sent", async () => {
    const username = `l${randomUUID().slice(0, 8)}`;
    await staff(cashierT, "POST", "/customers", { username, displayName: `Lim ${username}`, password: "longpassword1", email: `${username}@player.test` }, "");
    sink.inbox.length = 0;
    for (let i = 0; i < 6; i++) await req(`${base}/v1/app/demo/forgot`, null, "POST", { username });
    await new Promise((r) => setTimeout(r, 600));
    expect(sink.inbox.length).toBe(3);
  });

  it("a saved value changes behaviour live, and removing it brings the server's value back", async () => {
    const before = await staff(ownerT, "GET", "/billing");
    expect(before.status).toBe(200);
    await plat("PUT", "/settings", { values: { BILLING_STRIPE_SECRET_KEY: "sk_test_abcdefghijkl", ADMIN_URL: "https://admin.live-test.example" } });
    await until(async () => (await staff(ownerT, "GET", "/billing")).body.cardPayments === true);
    expect(await settingOf("ADMIN_URL")).toMatchObject({ source: "saved", value: "https://admin.live-test.example" });
    await plat("PUT", "/settings", { values: { BILLING_STRIPE_SECRET_KEY: null, ADMIN_URL: "" } });
    expect((await settingOf("ADMIN_URL")).source).toBe("server");
    await until(async () => (await staff(ownerT, "GET", "/billing")).body.cardPayments === false);
  });

  it("the venue types its own Stripe keys: sealed, never shown, and used for card top-ups", async () => {
    const put = (body: unknown) => staff(ownerT, "PUT", "/payments/gateway", body);
    expect((await put({ provider: "STRIPE", mode: "TEST", isActive: true, secretKey: "sk_test_venuekey1234", webhookSecret: "whsec_venuehook1234" })).status).toBe(200);
    const g = (await staff(ownerT, "GET", "/payments/gateway", undefined, "")).body;
    expect(g.gateway).toMatchObject({ keySource: "saved", webhookSource: "saved", secretFound: true, webhookSecretFound: true });
    expect(JSON.stringify(g)).not.toMatch(/sk_test_venuekey|whsec_venuehook/);
    const stored = (await owner.query(`SELECT "credentialsRef" AS c, "webhookSecretRef" AS w FROM "PaymentGatewayConfig" WHERE "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'demo') AND "branchId" IS NULL`)).rows[0];
    expect(stored.c).toMatch(/^v1\./);
    expect(stored.c + stored.w).not.toMatch(/venuekey|venuehook/);

    // A live key with test mode on is the classic mistake: refused.
    expect((await put({ provider: "STRIPE", mode: "TEST", isActive: true, secretKey: "sk_live_venuekey1234" })).body.error).toBe("gateway_mode_mismatch");
    // Leaving the key fields out keeps what is saved.
    expect((await put({ provider: "STRIPE", mode: "TEST", isActive: false })).status).toBe(200);
    expect((await staff(ownerT, "GET", "/payments/gateway", undefined, "")).body.gateway).toMatchObject({ isActive: false, secretFound: true });

    // The customer app sees card top-ups as available once it is on.
    await put({ provider: "STRIPE", mode: "TEST", isActive: true });
    const username = `c${randomUUID().slice(0, 8)}`;
    await staff(cashierT, "POST", "/customers", { username, displayName: `Cy ${username}`, password: "longpassword1" }, "");
    const token = (await req(`${base}/v1/app/demo/login`, null, "POST", { username, password: "longpassword1" })).body.accessToken as string;
    expect((await req(`${base}/v1/app/wallet/card`, token, "GET")).body.available).toBe(true);
  });
});
