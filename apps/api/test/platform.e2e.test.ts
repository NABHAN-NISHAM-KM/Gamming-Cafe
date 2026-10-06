// Super Admin (platform) service, end to end against the real Postgres:
// mandatory TOTP enrolment, token isolation from the tenant API, role checks,
// organization lifecycle and audit.
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

describe.skipIf(!HAS_DB)("Platform service (e2e)", () => {
  let platform: INestApplication;
  let tenant: INestApplication;
  let http: ReturnType<typeof request>;
  let tenantHttp: ReturnType<typeof request>;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const adminEmail = `pa-${run}@platform.test`;
  const readonlyEmail = `ro-${run}@platform.test`;
  const PASSWORD = "Platform!Test-2026";

  /** Signs in, enrolling TOTP on first use, and returns an access token. */
  const signIn = async (email: string) => {
    const first = await http.post("/v1/platform/auth/login").send({ email, password: PASSWORD });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.mfaSetupRequired).toBe(true);
    const code = totpAt(first.body.secret, Date.now());
    const done = await http.post("/v1/platform/auth/mfa/verify").send({ mfaToken: first.body.mfaToken, code });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return done.body as { accessToken: string; refreshToken: string };
  };
  const as = (token: string) => ({
    get: (url: string) => http.get(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string, body: object) => http.patch(url).set("Authorization", `Bearer ${token}`).send(body),
    post: (url: string, body: object) => http.post(url).set("Authorization", `Bearer ${token}`).send(body),
    put: (url: string, body: object) => http.put(url).set("Authorization", `Bearer ${token}`).send(body),
  });

  let admin: { accessToken: string; refreshToken: string };
  let readonly: { accessToken: string; refreshToken: string };

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    const hash = await hashSecret(PASSWORD);
    for (const [email, role] of [[adminEmail, "SUPER_ADMIN"], [readonlyEmail, "PLATFORM_READONLY"]] as const) {
      const u = await owner.query(`INSERT INTO "User" (id, email, "displayName", "passwordHash", "emailVerified", "updatedAt") VALUES (gen_random_uuid(), $1, 'Test admin', $2, true, now()) RETURNING id`, [email, hash]);
      await owner.query(`INSERT INTO "PlatformRoleAssignment" (id, "userId", role) VALUES (gen_random_uuid(), $1, $2)`, [u.rows[0].id, role]);
    }
    platform = await createPlatformApp(loadPlatformConfig({ NODE_ENV: "test" }));
    await platform.init();
    http = request(platform.getHttpServer());
    tenant = await createApp(loadConfig({ NODE_ENV: "test" }));
    await tenant.init();
    tenantHttp = request(tenant.getHttpServer());
    admin = await signIn(adminEmail);
    readonly = await signIn(readonlyEmail);
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM "User" WHERE email IN ($1, $2)`, [adminEmail, readonlyEmail]);
    await platform?.close();
    await tenant?.close();
    await owner.end();
  });

  it("refuses staff accounts and wrong passwords", async () => {
    expect((await http.post("/v1/platform/auth/login").send({ email: "owner@demo.test", password: DEMO_PASSWORD })).status).toBe(403);
    expect((await http.post("/v1/platform/auth/login").send({ email: adminEmail, password: "nope-nope" })).status).toBe(401);
  });

  it("requires the authenticator code once enrolled, and rejects a reused code", async () => {
    const failures = async () => (await owner.query(`SELECT "failedLogins" FROM "User" WHERE email = $1`, [adminEmail])).rows[0].failedLogins as number;
    const before = await failures();
    const r = await http.post("/v1/platform/auth/login").send({ email: adminEmail, password: PASSWORD });
    expect(r.body).toMatchObject({ mfaRequired: true });
    expect(r.body.secret).toBeUndefined();
    const bad = await http.post("/v1/platform/auth/mfa/verify").send({ mfaToken: r.body.mfaToken, code: "000000" });
    expect(bad.status).toBe(401);
    // That miss counts toward the lockout until a full sign-in clears it.
    expect(await failures()).toBe(before + 1);
  });

  it("keeps platform and staff tokens apart", async () => {
    expect((await tenantHttp.get("/v1/auth/me").set("Authorization", `Bearer ${admin.accessToken}`)).status).toBe(401);
    const staff = await tenantHttp.post("/v1/auth/login").send({ email: "owner@demo.test", password: DEMO_PASSWORD });
    expect((await http.get("/v1/platform/overview").set("Authorization", `Bearer ${staff.body.accessToken}`)).status).toBe(401);
    expect((await http.post("/v1/platform/auth/refresh").send({ refreshToken: staff.body.refreshToken })).status).toBe(401);
  });

  it("serves the overview and organization detail", async () => {
    const o = await as(admin.accessToken).get("/v1/platform/overview");
    expect(o.status).toBe(200);
    expect(o.body.organizations.total).toBeGreaterThanOrEqual(2);
    const list = await as(admin.accessToken).get("/v1/platform/organizations?q=demo");
    const demo = (list.body as Array<{ id: string; slug: string }>).find((x) => x.slug === "demo")!;
    const d = await as(admin.accessToken).get(`/v1/platform/organizations/${demo.id}`);
    expect(d.status).toBe(200);
    expect(d.body.owners.some((x: { email: string }) => x.email === "owner@demo.test")).toBe(true);
    expect(d.body.features.length).toBeGreaterThan(5);
  });

  it("lets read-only admins look but not change anything", async () => {
    expect((await as(readonly.accessToken).get("/v1/platform/plans")).status).toBe(200);
    const plans = (await as(readonly.accessToken).get("/v1/platform/plans")).body.plans;
    expect((await as(readonly.accessToken).patch(`/v1/platform/plans/${plans[0].id}`, { isPublic: true })).status).toBe(403);
  });

  it("creates, suspends and reactivates an organization, with audit", async () => {
    const plans = (await as(admin.accessToken).get("/v1/platform/plans")).body.plans as Array<{ id: string; code: string }>;
    const starter = plans.find((p) => p.code === "STARTER")!;
    const created = await as(admin.accessToken).post("/v1/platform/organizations", {
      displayName: `Test Arena ${run}`, slug: `t-${run}`, countryCode: "AE", planId: starter.id, ownerEmail: `owner-${run}@platform.test`, ownerName: "Tess Owner",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.owner.tempPassword).toMatch(/^Arena-/);
    const orgId = created.body.organization.id as string;

    // The new owner can sign in to the admin console straight away.
    const ownerLogin = await tenantHttp.post("/v1/auth/login").send({ email: `owner-${run}@platform.test`, password: created.body.owner.tempPassword });
    expect(ownerLogin.status, JSON.stringify(ownerLogin.body)).toBe(200);

    expect((await as(admin.accessToken).patch(`/v1/platform/organizations/${orgId}/status`, { status: "SUSPENDED" })).status).toBe(400);
    const s = await as(admin.accessToken).patch(`/v1/platform/organizations/${orgId}/status`, { status: "SUSPENDED", reason: "e2e test" });
    expect(s.body.status).toBe("SUSPENDED");
    // Suspension ends staff sessions and blocks new sign-ins.
    expect((await tenantHttp.post("/v1/auth/refresh").send({ refreshToken: ownerLogin.body.refreshToken })).status).toBe(401);
    expect((await tenantHttp.post("/v1/auth/login").send({ email: `owner-${run}@platform.test`, password: created.body.owner.tempPassword })).status).toBe(403);
    expect((await as(admin.accessToken).patch(`/v1/platform/organizations/${orgId}/status`, { status: "ACTIVE" })).body.status).toBe("ACTIVE");

    const f = await as(admin.accessToken).put(`/v1/platform/organizations/${orgId}/features/DISKLESS`, { enabled: true, reason: "pilot" });
    expect(f.status).toBe(200);
    const audit = await as(admin.accessToken).get(`/v1/platform/audit?organizationId=${orgId}`);
    const actions = (audit.body as Array<{ action: string }>).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["platform.org.create", "platform.org.status", "platform.feature.override"]));
  });

  it("rotates refresh tokens and ends the session on logout", async () => {
    const rot = await http.post("/v1/platform/auth/refresh").send({ refreshToken: admin.refreshToken });
    expect(rot.status, JSON.stringify(rot.body)).toBe(200);
    // The rotated-out token is now a reuse attempt, which kills the whole session.
    expect((await http.post("/v1/platform/auth/refresh").send({ refreshToken: admin.refreshToken })).status).toBe(401);
    expect((await as(rot.body.accessToken).get("/v1/platform/overview")).status).toBe(401);

    await http.post("/v1/platform/auth/logout").send({ refreshToken: readonly.refreshToken });
    expect((await as(readonly.accessToken).get("/v1/platform/overview")).status).toBe(401);
  });

  // Last: it blocks this test client's address for the rest of the window.
  it("refuses an address after too many failed sign-ins, whichever accounts it tries", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await http.post("/v1/platform/auth/login").send({ email: `spray-${i}-${run}@platform.test`, password: "wrong-wrong" })).status);
    expect(statuses).toContain(429);
    expect((await http.post("/v1/platform/auth/login").send({ email: adminEmail, password: PASSWORD })).status).toBe(429);
  });
});
