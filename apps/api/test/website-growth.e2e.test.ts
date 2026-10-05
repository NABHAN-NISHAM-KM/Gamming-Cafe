// Website growth, end to end: partner applications, venue referrals (a free
// month once the referred venue pays), anonymous site stats, the venue finder,
// and booking from a venue's public page — against real Postgres and both services.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { createPlatformApp } from "../src/platform/server.js";
import { loadPlatformConfig } from "../src/platform/config.js";
import { hashSecret, totpAt } from "../src/auth/crypto.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["PLATFORM_DATABASE_URL"];

describe.skipIf(!HAS_DB)("Website growth (e2e)", () => {
  let app: INestApplication;
  let platform: INestApplication;
  let base: string;
  let pbase: string;
  let ownerT: string, platformT: string;
  let ip = 0;
  const from = () => `10.77.${Math.floor(++ip / 250)}.${ip % 250}`;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const run = randomUUID().slice(0, 8);

  const req = async (url: string, token: string | null, method: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const pub = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => req(`${pbase}/v1/public${path}`, null, method, body, { "x-forwarded-for": from(), ...headers });
  const staff = (token: string, method: string, path: string, body?: unknown) => req(`${base}/v1${path}`, token, method, body);
  const plat = (method: string, path: string, body?: unknown) => req(`${pbase}/v1/platform${path}`, platformT, method, body);

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    app.getHttpAdapter().getInstance().set("trust proxy", true);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    platform = await createPlatformApp(loadPlatformConfig({ NODE_ENV: "test", BILLING_SWEEP: "off" }));
    platform.getHttpAdapter().getInstance().set("trust proxy", true);
    await platform.listen(0);
    pbase = `http://127.0.0.1:${(platform.getHttpServer().address() as AddressInfo).port}`;
    ownerT = (await req(`${base}/v1/auth/login`, null, "POST", { email: "owner@demo.test", password: DEMO_PASSWORD })).body.accessToken;
    const email = `grow-${run}@platform.test`;
    const u = await owner.query(`INSERT INTO "User" (id, email, "displayName", "passwordHash", "emailVerified", "updatedAt") VALUES (gen_random_uuid(), $1, 'Growth', $2, true, now()) RETURNING id`, [email, await hashSecret("Platform!Test-2026")]);
    await owner.query(`INSERT INTO "PlatformRoleAssignment" (id, "userId", role) VALUES (gen_random_uuid(), $1, 'SUPER_ADMIN')`, [u.rows[0].id]);
    const first = (await req(`${pbase}/v1/platform/auth/login`, null, "POST", { email, password: "Platform!Test-2026" })).body;
    platformT = (await req(`${pbase}/v1/platform/auth/mfa/verify`, null, "POST", { mfaToken: first.mfaToken, code: totpAt(first.secret, Date.now()) })).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await platform?.close();
    await owner.end();
  });

  it("partners apply through the contact form and arrive as their own kind of lead", async () => {
    const email = `partner-${run}@installer.test`;
    expect((await pub("POST", "/leads", { name: "Ravi Installs", email, kind: "PARTNER", notes: "We fit out 20 cafés a year" })).status).toBe(201);
    expect(((await plat("GET", "/leads?kind=PARTNER")).body as any[]).find((l) => l.email === email)).toMatchObject({ kind: "PARTNER" });
  });

  it("a referred venue that pays earns the referrer a free month, once", async () => {
    const links = (await staff(ownerT, "GET", "/organization/links")).body;
    expect(links.referral).toMatch(/\/signup\.html\?ref=demo$/);
    const before = (await owner.query(`SELECT s."currentPeriodEnd" FROM "Subscription" s JOIN "Organization" o ON o.id = s."organizationId" WHERE o.slug = 'demo' ORDER BY s."createdAt" DESC LIMIT 1`)).rows[0].currentPeriodEnd as Date;
    const slug = `ref-${run}`;
    const t = await pub("POST", "/trial", { venueName: "Referred Arena", slug, countryCode: "AE", ownerName: "Rafi Owner", email: `ref-${run}@cafe.test`, password: "ReferPass!2026", ref: "demo" });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect((await staff(ownerT, "GET", "/organization/referrals")).body).toMatchObject({ signedUp: expect.any(Number), paying: expect.any(Number) });
    // The new venue pays its first invoice (billing staff mark it paid).
    const org = (await owner.query(`SELECT o.id, s.id AS sub FROM "Organization" o JOIN "Subscription" s ON s."organizationId" = o.id WHERE o.slug = $1`, [slug])).rows[0];
    const inv = (await owner.query(`INSERT INTO "SubscriptionInvoice" (id, "organizationId", "subscriptionId", number, amount, currency, status, "periodStart", "periodEnd", "dueAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, 599, 'USD', 'OPEN', now(), now() + interval '1 month', now() + interval '7 days', now()) RETURNING id`, [org.id, org.sub, `INV-T-${run}`])).rows[0].id;
    expect((await plat("PATCH", `/invoices/${inv}`, { status: "PAID" })).status).toBe(200);
    const after = (await owner.query(`SELECT s."currentPeriodEnd" FROM "Subscription" s JOIN "Organization" o ON o.id = s."organizationId" WHERE o.slug = 'demo' ORDER BY s."createdAt" DESC LIMIT 1`)).rows[0].currentPeriodEnd as Date;
    expect(after.getTime() - Math.max(before.getTime(), Date.now())).toBeGreaterThan(29 * 86_400_000);
    expect((await staff(ownerT, "GET", "/organization/referrals")).body.rewarded).toBeGreaterThanOrEqual(1);
    // Paying again doesn't pay the referrer again.
    const inv2 = (await owner.query(`INSERT INTO "SubscriptionInvoice" (id, "organizationId", "subscriptionId", number, amount, currency, status, "periodStart", "periodEnd", "dueAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, 599, 'USD', 'OPEN', now(), now() + interval '2 months', now() + interval '7 days', now()) RETURNING id`, [org.id, org.sub, `INV-T2-${run}`])).rows[0].id;
    await plat("PATCH", `/invoices/${inv2}`, { status: "PAID" });
    const again = (await owner.query(`SELECT s."currentPeriodEnd" FROM "Subscription" s JOIN "Organization" o ON o.id = s."organizationId" WHERE o.slug = 'demo' ORDER BY s."createdAt" DESC LIMIT 1`)).rows[0].currentPeriodEnd as Date;
    expect(again.getTime()).toBe(after.getTime());
  });

  it("site stats count views and funnel steps, without bots and without personal data", async () => {
    const path = `/test-${run}.html`;
    expect((await pub("POST", "/events", { path, referrer: "https://www.google.com/search?q=gaming+cafe+software" })).status).toBe(204);
    await pub("POST", "/events", { path, referrer: null });
    await pub("POST", "/events", { path, referrer: null }, { "user-agent": "Googlebot/2.1" });
    await pub("POST", "/events", { path: "/signup.html", event: "trial_done" });
    expect((await pub("POST", "/events", { path: "not-a-path" })).status).toBe(400);
    const rows = (await owner.query(`SELECT referrer, count FROM "SiteStat" WHERE path = $1 ORDER BY referrer`, [path])).rows;
    expect(rows).toEqual([{ referrer: "", count: 1 }, { referrer: "google.com", count: 1 }]);
    const cols = (await owner.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'SiteStat'`)).rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(["count", "day", "event", "path", "referrer"]);
    const s = (await plat("GET", "/site-stats?days=7")).body;
    expect(s.pages.find((p: any) => p.path === path).views).toBe(2);
    expect(s.funnel.trialDone).toBeGreaterThanOrEqual(1);
  });

  it("the venue finder lists published venues; their pages take bookings without the app", async () => {
    const org = (await staff(ownerT, "GET", "/organization")).body;
    try {
      expect(((await req(`${base}/v1/app/venues`, null, "GET")).body as any[]).some((v) => v.slug === "demo")).toBe(false);
      expect((await req(`${base}/v1/app/demo/book`, null, "POST", {})).status).toBe(400);
      await staff(ownerT, "PATCH", "/organization", { settings: { ...org.settings, publicPage: true } });
      const venues = (await req(`${base}/v1/app/venues`, null, "GET")).body as any[];
      const demo = venues.find((v) => v.slug === "demo");
      expect(demo.branches.length).toBeGreaterThan(0);
      expect(JSON.stringify(demo)).not.toMatch(/ahmed|customer|phone/i);
      const dxb1 = ((await staff(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
      const start = new Date(Date.now() + 26 * 3_600_000);
      start.setMinutes(0, 0, 0);
      const zones = (await req(`${base}/v1/app/demo/public-availability?branchId=${dxb1}&startsAt=${encodeURIComponent(start.toISOString())}&minutes=60`, null, "GET")).body as any[];
      const zone = zones.find((z) => z.free > 0);
      expect(zone).toBeTruthy();
      expect(zone.devices).toBeUndefined();
      const b = await req(`${base}/v1/app/demo/book`, null, "POST", { branchId: dxb1, zoneId: zone.zoneId, startsAt: start.toISOString(), minutes: 60, players: 1, name: "Walk-up Will", phone: "+971 50 123 4567" }, { "x-forwarded-for": from() });
      expect(b.status, JSON.stringify(b.body)).toBe(201);
      expect(b.body).toMatchObject({ reference: expect.any(String), status: "CONFIRMED" });
      const row = (await owner.query(`SELECT source, "contactName", "contactPhone", status FROM "Booking" WHERE reference = $1`, [b.body.reference])).rows[0];
      expect(row).toEqual({ source: "CUSTOMER_WEB", contactName: "Walk-up Will", contactPhone: "+971 50 123 4567", status: "CONFIRMED" });
      expect((await req(`${base}/v1/app/demo/book`, null, "POST", { branchId: dxb1, zoneId: zone.zoneId, startsAt: start.toISOString(), minutes: 60, players: 1, name: "Bot", phone: "+971501234567", website: "spam" })).status).toBe(400);
    } finally {
      await staff(ownerT, "PATCH", "/organization", { settings: org.settings });
    }
  });
});
