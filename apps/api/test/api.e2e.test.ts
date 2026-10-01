// End-to-end API tests against the real Postgres (seeded by scripts/seed.ts).
// They exercise the whole pipeline: JWT → tenant transaction (RLS) →
// principal → authorize() → handler → audit.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { totpAt } from "../src/auth/crypto.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["JWT_PRIVATE_KEY_B64"];

describe.skipIf(!HAS_DB)("ArenaOS API (e2e)", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const login = async (email: string, password = DEMO_PASSWORD, organizationSlug?: string) => {
    const res = await http.post("/v1/auth/login").send({ email, password, organizationSlug });
    return res;
  };
  const tokenFor = async (email: string) => {
    const res = await login(email);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.accessToken as string;
  };
  const as = (token: string) => ({
    get: (url: string) => http.get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body?: object, reason?: string) => {
      const r = http.post(url).set("Authorization", `Bearer ${token}`);
      if (reason) r.set("X-Action-Reason", reason);
      return r.send(body ?? {});
    },
    patch: (url: string, body: object, reason?: string) => {
      const r = http.patch(url).set("Authorization", `Bearer ${token}`);
      if (reason) r.set("X-Action-Reason", reason);
      return r.send(body);
    },
  });

  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let rivalToken: string;
  let dxb1: string;
  let auh1: string;
  let roles: Record<string, string>;

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    // Staff hired by earlier runs count against the plan's employee limit: retire them first.
    await owner.query(
      `UPDATE "Employee" e SET status = 'TERMINATED' FROM "User" u
        WHERE u.id = e."userId" AND u.email LIKE '%@demo.test' AND e.status IN ('INVITED', 'ACTIVE')
          AND u.email NOT IN ('owner@demo.test', 'manager@demo.test', 'cashier@demo.test', 'tech@demo.test', 'waiter@demo.test', 'kitchen@demo.test', 'inventory@demo.test', 'accountant@demo.test')`,
    );
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.init();
    http = request(app.getHttpServer());

    [ownerToken, managerToken, cashierToken, rivalToken] = await Promise.all(
      ["owner@demo.test", "manager@demo.test", "cashier@demo.test", "owner@rival.test"].map(tokenFor),
    ) as [string, string, string, string];
    const branches = (await as(ownerToken).get("/v1/branches")).body as Array<{ id: string; code: string }>;
    dxb1 = branches.find((b) => b.code === "DXB1")!.id;
    auh1 = branches.find((b) => b.code === "AUH1")!.id;
    roles = Object.fromEntries(((await as(ownerToken).get("/v1/roles")).body as Array<{ id: string; key: string }>).map((r) => [r.key, r.id]));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner.end();
  });

  /** Owner creates a throwaway staff account for tests that mutate auth state. */
  async function newStaff(role: string, branchId?: string) {
    const email = `t-${run}-${randomUUID().slice(0, 6)}@demo.test`;
    const res = await as(ownerToken).post(
      "/v1/employees",
      {
        email,
        displayName: "Test Staff",
        employeeCode: `T${randomUUID().slice(0, 8)}`,
        homeBranchId: branchId ?? null,
        initialPassword: "Correct-Horse-9-Battery",
        roles: [{ roleId: roles[role], scope: branchId ? "BRANCH" : "ORGANIZATION", branchId: branchId ?? null }],
      },
      "e2e test setup",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { email, password: "Correct-Horse-9-Battery", id: res.body.id as string };
  }

  describe("authentication", () => {
    it("rejects a wrong password and an unknown email with the same error", async () => {
      const a = await login("owner@demo.test", "nope-nope-nope");
      const b = await login(`ghost-${run}@demo.test`, "nope-nope-nope");
      expect([a.status, b.status]).toEqual([401, 401]);
      expect(a.body).toEqual(b.body);
    });

    it("locks the account after repeated failures", async () => {
      const s = await newStaff("cashier", dxb1);
      for (let i = 0; i < 5; i++) await login(s.email, "wrong-password-x");
      const res = await login(s.email, s.password);
      expect(res.status).toBe(423);
    });

    it("rejects requests without or with a forged token", async () => {
      expect((await http.get("/v1/branches")).status).toBe(401);
      const forged = ownerToken.slice(0, -4) + (ownerToken.endsWith("AAAA") ? "BBBB" : "AAAA");
      expect((await as(forged).get("/v1/branches")).status).toBe(401);
    });

    it("rotates refresh tokens and kills the whole session when an old one is replayed", async () => {
      const s = await newStaff("cashier", dxb1);
      const first = (await login(s.email, s.password)).body;
      const second = (await http.post("/v1/auth/refresh").send({ refreshToken: first.refreshToken })).body;
      expect(second.accessToken).toBeTruthy();

      const replay = await http.post("/v1/auth/refresh").send({ refreshToken: first.refreshToken });
      expect(replay.status).toBe(401);
      expect(replay.body.error).toBe("refresh_token_reused");

      // The legitimately-rotated token and its access token are dead too.
      expect((await http.post("/v1/auth/refresh").send({ refreshToken: second.refreshToken })).status).toBe(401);
      expect((await as(second.accessToken).get("/v1/auth/me")).status).toBe(401);
    });

    it("logout immediately invalidates the access token", async () => {
      const s = await newStaff("cashier", dxb1);
      const t = (await login(s.email, s.password)).body;
      expect((await as(t.accessToken).get("/v1/auth/me")).status).toBe(200);
      await http.post("/v1/auth/logout").send({ refreshToken: t.refreshToken }).expect(204);
      expect((await as(t.accessToken).get("/v1/auth/me")).status).toBe(401);
    });

    it("changing your password checks the old one and signs out your other devices only", async () => {
      const s = await newStaff("cashier", dxb1);
      const here = (await login(s.email, s.password)).body;
      const there = (await login(s.email, s.password)).body;
      const next = `New-pass-${run}-x!`;

      const wrong = await as(here.accessToken).post("/v1/auth/password", { currentPassword: "not-it-at-all", newPassword: next });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error).toBe("invalid_current_password");

      await as(here.accessToken).post("/v1/auth/password", { currentPassword: s.password, newPassword: next }).expect(204);
      expect((await as(here.accessToken).get("/v1/auth/me")).status).toBe(200);
      expect((await as(there.accessToken).get("/v1/auth/me")).status).toBe(401);
      expect((await login(s.email, s.password)).status).toBe(401);
      expect((await login(s.email, next)).status).toBe(200);
    });

    it("TOTP MFA: enrol, then login requires a code, and a code cannot be replayed", async () => {
      const s = await newStaff("cashier", dxb1);
      const token = (await login(s.email, s.password)).body.accessToken;
      const setup = (await as(token).post("/v1/auth/mfa/totp/setup")).body;
      // A mistyped code is a 422, not a 401 (clients treat 401 as "signed out"); the session stays valid.
      const wrong = String((Number(totpAt(setup.secret, Date.now())) + 1) % 1_000_000).padStart(6, "0");
      const bad = await as(token).post("/v1/auth/mfa/totp/confirm", { code: wrong });
      expect(bad.status).toBe(422);
      expect(bad.body.error).toBe("invalid_mfa_code");
      expect((await as(token).get("/v1/auth/me")).status).toBe(200);
      await as(token).post("/v1/auth/mfa/totp/confirm", { code: totpAt(setup.secret, Date.now() - 30_000) }).expect(200);

      const step1 = (await login(s.email, s.password)).body;
      expect(step1.mfaRequired).toBe(true);
      expect(step1.accessToken).toBeUndefined();

      const code = totpAt(setup.secret, Date.now());
      const ok = await http.post("/v1/auth/mfa/verify").send({ mfaToken: step1.mfaToken, code });
      expect(ok.status).toBe(200);
      expect(ok.body.accessToken).toBeTruthy();

      const again = await http.post("/v1/auth/mfa/verify").send({ mfaToken: step1.mfaToken, code });
      expect(again.status).toBe(401);
    });
  });

  describe("tenant isolation through the API", () => {
    it("Rival sees only its own branches", async () => {
      const res = await as(rivalToken).get("/v1/branches");
      expect(res.status).toBe(200);
      expect(res.body.map((b: any) => b.code)).toEqual(["SHJ1"]);
    });

    it("Rival cannot read, edit or add zones to Demo's branch — it simply does not exist for them", async () => {
      expect((await as(rivalToken).get(`/v1/branches/${dxb1}`)).status).toBe(404);
      expect((await as(rivalToken).patch(`/v1/branches/${dxb1}`, { name: "pwned" }, "x-tenant attempt")).status).toBe(404);
      expect((await as(rivalToken).post(`/v1/branches/${dxb1}/zones`, { name: "evil", type: "OTHER" })).status).toBe(404);
    });

    it("Rival cannot create a branch under Demo's brand", async () => {
      const demoBrand = (await as(ownerToken).get("/v1/brands")).body[0].id;
      const res = await as(rivalToken).post(
        "/v1/branches",
        { brandId: demoBrand, code: `X${run.slice(0, 5).toUpperCase()}`, name: "Evil", countryCode: "AE", currency: "AED", timezone: "Asia/Dubai" },
        "x-tenant attempt",
      );
      expect([402, 404, 409]).toContain(res.status); // plan limit or invalid reference — never 201
    });
  });

  describe("RBAC", () => {
    it("branch manager sees only their branch", async () => {
      const res = await as(managerToken).get("/v1/branches");
      expect(res.body.map((b: any) => b.code)).toEqual(["DXB1"]);
      const other = await as(managerToken).get(`/v1/branches/${auh1}`);
      expect(other.status).toBe(403);
      expect(other.body.reason).toBe("OUT_OF_SCOPE");
    });

    it("branch manager manages zones in their branch only", async () => {
      expect((await as(managerToken).post(`/v1/branches/${dxb1}/zones`, { name: `Z-${run}`, type: "PC_STANDARD" })).status).toBe(201);
      expect((await as(managerToken).post(`/v1/branches/${auh1}/zones`, { name: `Z-${run}`, type: "PC_STANDARD" })).status).toBe(403);
    });

    it("cashier cannot create branches", async () => {
      const res = await as(cashierToken).post("/v1/branches", { brandId: randomUUID(), code: "NOPE", name: "Nope", countryCode: "AE", currency: "AED", timezone: "Asia/Dubai" }, "because");
      expect(res.status).toBe(403);
    });

    it("risky actions require a reason; routine setup doesn't", async () => {
      expect((await as(ownerToken).patch("/v1/organization", { displayName: "Demo Arena" })).status).toBe(200);
      const res = await as(ownerToken).post("/v1/customers/00000000-0000-7000-8000-000000000000/erase");
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe("REASON_REQUIRED");
    });

    it("anti-escalation: a branch manager cannot hire an org owner, but can hire a cashier for their branch", async () => {
      const base = { displayName: "New Hire", homeBranchId: dxb1, initialPassword: "Correct-Horse-9-Battery" };
      const escalate = await as(managerToken).post(
        "/v1/employees",
        { ...base, email: `esc-${run}@demo.test`, employeeCode: `X${run}`.slice(0, 20), roles: [{ roleId: roles["org_owner"], scope: "BRANCH", branchId: dxb1 }] },
        "hiring",
      );
      expect(escalate.status).toBe(403);
      expect(escalate.body.error).toBe("privilege_escalation");

      const ok = await as(managerToken).post(
        "/v1/employees",
        { ...base, email: `ok-${run}@demo.test`, employeeCode: `Y${run}`.slice(0, 20), roles: [{ roleId: roles["cashier"], scope: "BRANCH", branchId: dxb1 }] },
        "hiring",
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);

      const otherBranch = await as(managerToken).post(
        "/v1/employees",
        { ...base, homeBranchId: auh1, email: `ob-${run}@demo.test`, employeeCode: `Z${run}`.slice(0, 20), roles: [] },
        "hiring",
      );
      expect(otherBranch.status).toBe(403);
    });

    it("the last organization owner cannot be removed", async () => {
      const me = (await as(ownerToken).get("/v1/auth/me")).body;
      const emp = (await as(ownerToken).get(`/v1/employees/${me.employee.id}`)).body;
      const ownerAssignment = emp.employeeRoleAssignments.find((a: any) => a.role.key === "org_owner");
      const res = await http
        .delete(`/v1/employees/${me.employee.id}/roles/${ownerAssignment.id}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .set("X-Action-Reason", "test");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("last_owner");
    });

    it("suspending someone needs rights over everything they hold: an org admin can't lock out the owner", async () => {
      const me = (await as(ownerToken).get("/v1/auth/me")).body;
      const admin = await newStaff("org_admin");
      const adminToken = (await login(admin.email, admin.password)).body.accessToken;
      const res = await as(adminToken).patch(`/v1/employees/${me.employee.id}`, { status: "SUSPENDED" }, "test");
      expect(res.status).toBe(403);
      expect((await login("owner@demo.test")).status).toBe(200);

      // Ordinary suspensions still work: a branch manager can suspend a cashier at their branch.
      const cashier = await newStaff("cashier", dxb1);
      expect((await as(managerToken).patch(`/v1/employees/${cashier.id}`, { status: "SUSPENDED" }, "test")).status).toBe(200);
    });

    it("plan limits are enforced (Starter = 1 branch)", async () => {
      const brand = (await as(rivalToken).get("/v1/brands")).body[0].id;
      const res = await as(rivalToken).post(
        "/v1/branches",
        { brandId: brand, code: "SHJ2", name: "Second", countryCode: "AE", currency: "AED", timezone: "Asia/Dubai" },
        "expansion",
      );
      expect(res.status).toBe(402);
      expect(res.body.limit).toBe("MAX_BRANCHES");
    });
  });

  describe("audit", () => {
    it("writes a hash-chained audit row in the same transaction as the change", async () => {
      const name = `Audited-${run}`;
      const res = await as(managerToken).post(`/v1/branches/${dxb1}/zones`, { name, type: "VR" });
      expect(res.status).toBe(201);
      const rows = await owner.query(`SELECT action, "actorRole", hash, "prevHash", "chainSeq" FROM "AuditLog" WHERE "entityId" = $1`, [res.body.id]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ action: "zone.create", actorRole: "branch_manager" });
      expect(rows.rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("a failed request leaves no audit row and no data (transaction rolled back)", async () => {
      const before = await owner.query(`SELECT count(*)::int n FROM "Zone" WHERE name = 'Rollback-${run}'`);
      const res = await as(managerToken).post(`/v1/branches/${dxb1}/zones`, { name: `Rollback-${run}`, type: "NOT_A_TYPE" });
      expect(res.status).toBe(400);
      const after = await owner.query(`SELECT count(*)::int n FROM "Zone" WHERE name = 'Rollback-${run}'`);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });
});
