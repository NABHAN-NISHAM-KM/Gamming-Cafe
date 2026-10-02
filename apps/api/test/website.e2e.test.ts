// The marketing website's server side, end to end: leads, demo-call slots and
// booking (one call per slot), the self-serve trial (a working venue the owner
// can sign in to), releases, the Super Admin's lead list, and a venue's opt-in
// public page — against real Postgres.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { createPlatformApp } from "../src/platform/server.js";
import { loadPlatformConfig } from "../src/platform/config.js";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { hashSecret, totpAt } from "../src/auth/crypto.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

const HAS_DB = !!process.env["PLATFORM_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["APP_DATABASE_URL"] && !!process.env["JWT_PRIVATE_KEY_B64"];

describe.skipIf(!HAS_DB)("Website (e2e)", () => {
  let platform: INestApplication;
  let tenant: INestApplication;
  let http: ReturnType<typeof request>;
  let api: ReturnType<typeof request>;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const PASSWORD = "Platform!Test-2026";
  // Each test pretends to come from its own address, so the per-IP limits don't bleed between them.
  let ip = 0;
  const from = () => `10.9.${Math.floor(++ip / 250)}.${ip % 250}`;

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    platform = await createPlatformApp(loadPlatformConfig({ NODE_ENV: "test" }));
    platform.getHttpAdapter().getInstance().set("trust proxy", true);
    await platform.init();
    http = request(platform.getHttpServer());
    tenant = await createApp(loadConfig({ NODE_ENV: "test" }));
    await tenant.init();
    api = request(tenant.getHttpServer());
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await owner.end();
  });

  it("a walkthrough request is stored; bots that fill the hidden field are not", async () => {
    const email = `lead-${run}@cafe.test`;
    const r = await http.post("/v1/public/leads").set("x-forwarded-for", from()).send({ name: "Lina Café", email, venue: "Pixel Lounge", stations: "40", plan: "pro", notes: "Moving from paper" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await owner.query(`SELECT kind, stations FROM "Lead" WHERE email = $1`, [email])).rows[0]).toEqual({ kind: "CONTACT", stations: 40 });
    expect((await http.post("/v1/public/leads").set("x-forwarded-for", from()).send({ name: "Bot", email: `bot-${run}@x.test`, website: "http://spam" })).status).toBe(400);
    expect((await http.post("/v1/public/leads").set("x-forwarded-for", from()).send({ name: "N", email: "not-an-email" })).status).toBe(400);
    const addr = from();
    for (let i = 0; i < 5; i++) await http.post("/v1/public/leads").set("x-forwarded-for", addr).send({ name: "Same person", email: `r${i}-${run}@x.test` });
    expect((await http.post("/v1/public/leads").set("x-forwarded-for", addr).send({ name: "Same person", email: `r9-${run}@x.test` })).status).toBe(429);
  });

  it("demo calls: only offered slots, and one booking per slot", async () => {
    const { slots, timeZone } = (await http.get("/v1/public/demo-slots")).body;
    expect(timeZone).toBe("Asia/Dubai");
    expect(slots.length).toBeGreaterThan(10);
    for (const s of slots.slice(0, 20)) {
      const local = new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      expect(local).not.toMatch(/^(Fri|Sat)/);
      const [h, m] = local.split(" ")[1]!.split(":").map(Number) as [number, number];
      expect(h * 60 + m).toBeGreaterThanOrEqual(600);
      expect(h * 60 + m).toBeLessThanOrEqual(17 * 60 + 30);
    }
    const slot = slots.at(-1);
    const book = await http.post("/v1/public/demo").set("x-forwarded-for", from()).send({ name: "Omar", email: `demo-${run}@cafe.test`, demoAt: slot });
    expect(book.status, JSON.stringify(book.body)).toBe(201);
    expect((await http.post("/v1/public/demo").set("x-forwarded-for", from()).send({ name: "Other", email: `demo2-${run}@cafe.test`, demoAt: slot })).body.error).toBe("slot_taken");
    expect((await http.get("/v1/public/demo-slots")).body.slots).not.toContain(slot);
    expect((await http.post("/v1/public/demo").set("x-forwarded-for", from()).send({ name: "Night owl", email: `n-${run}@cafe.test`, demoAt: "2030-01-01T23:00:00.000Z" })).body.error).toBe("slot_taken");
  });

  it("a free trial opens a working venue the owner can sign in to; Super Admin sees the leads", async () => {
    const email = `trial-${run}@cafe.test`;
    const slug = `trial-${run}`;
    const t = await http.post("/v1/public/trial").set("x-forwarded-for", from()).send({ venueName: "Trial Arena", slug, countryCode: "AE", ownerName: "Tariq Owner", email, password: "TrialPass!2026", venueType: "Gaming café" });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body).toMatchObject({ organization: { slug }, trialDays: 14 });
    const org = (await owner.query(`SELECT o.status, (SELECT count(*)::int FROM "Branch" b WHERE b."organizationId" = o.id) AS branches, (SELECT count(*)::int FROM "PricingPlan" p WHERE p."organizationId" = o.id) AS plans FROM "Organization" o WHERE o.slug = $1`, [slug])).rows[0];
    expect(org).toEqual({ status: "TRIAL", branches: 1, plans: 1 });
    const login = await api.post("/v1/auth/login").send({ email, password: "TrialPass!2026" });
    expect(login.status, JSON.stringify(login.body)).toBe(200); // signs in (and is asked to set up 2-step)
    expect((await http.post("/v1/public/trial").set("x-forwarded-for", from()).send({ venueName: "Again", slug: `again-${run}`, countryCode: "AE", ownerName: "Tariq", email, password: "TrialPass!2026" })).body.error).toBe("email_taken");
    expect((await http.post("/v1/public/trial").set("x-forwarded-for", from()).send({ venueName: "Clash", slug, countryCode: "AE", ownerName: "Xavier", email: `x-${run}@cafe.test`, password: "TrialPass!2026" })).body.error).toBe("slug_taken");

    // Super Admin: the trial is in the lead list with its venue, and can be marked won.
    const adminEmail = `sales-${run}@platform.test`;
    const u = await owner.query(`INSERT INTO "User" (id, email, "displayName", "passwordHash", "emailVerified", "updatedAt") VALUES (gen_random_uuid(), $1, 'Sales', $2, true, now()) RETURNING id`, [adminEmail, await hashSecret(PASSWORD)]);
    await owner.query(`INSERT INTO "PlatformRoleAssignment" (id, "userId", role) VALUES (gen_random_uuid(), $1, 'SUPER_ADMIN')`, [u.rows[0].id]);
    const first = await http.post("/v1/platform/auth/login").send({ email: adminEmail, password: PASSWORD });
    const done = await http.post("/v1/platform/auth/mfa/verify").send({ mfaToken: first.body.mfaToken, code: totpAt(first.body.secret, Date.now()) });
    const token = done.body.accessToken as string;
    const leads = (await http.get("/v1/platform/leads?kind=TRIAL").set("Authorization", `Bearer ${token}`)).body as any[];
    const lead = leads.find((l) => l.email === email);
    expect(lead).toMatchObject({ kind: "TRIAL", status: "NEW", venue: "Trial Arena" });
    expect(lead.trialOrgId).toBeTruthy();
    expect((await http.patch(`/v1/platform/leads/${lead.id}`).set("Authorization", `Bearer ${token}`).send({ status: "WON" })).body.status).toBe("WON");
    expect((await http.get("/v1/platform/leads").set("x-forwarded-for", from())).status).toBe(401); // not public
  });

  it("releases are public; a venue page shows only when the venue switches it on", async () => {
    expect(Array.isArray((await http.get("/v1/public/releases")).body)).toBe(true);
    expect((await api.get("/v1/app/demo/public")).status).toBe(404);
    const ownerT = (await api.post("/v1/auth/login").send({ email: "owner@demo.test", password: DEMO_PASSWORD })).body.accessToken as string;
    const org = (await api.get("/v1/organization").set("Authorization", `Bearer ${ownerT}`)).body;
    expect((await api.patch("/v1/organization").set("Authorization", `Bearer ${ownerT}`).send({ settings: { ...org.settings, publicPage: true } })).status).toBe(200);
    const page = await api.get("/v1/app/demo/public");
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body).toMatchObject({ name: expect.any(String), appUrl: expect.stringMatching(/\/demo$/) });
    expect(page.body.prices.some((p: any) => p.name === "Regular PC")).toBe(true);
    expect(JSON.stringify(page.body)).not.toMatch(/ahmed|customer/i); // no players, ever
    await api.patch("/v1/organization").set("Authorization", `Bearer ${ownerT}`).send({ settings: { ...org.settings, publicPage: false } });
  });
});
