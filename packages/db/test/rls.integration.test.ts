// Real-Postgres tenant-isolation tests (layer 3). Requires a disposable
// database with migrations applied by the OWNER role, plus a runtime login
// role that is a member of arena_app. CI provides both (see .github/workflows).
//
//   TEST_DATABASE_URL      owner connection (seeding)
//   TEST_APP_DATABASE_URL  runtime connection (member of arena_app, NOBYPASSRLS)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!OWNER_URL || !APP_URL)("RLS tenant isolation (Postgres)", () => {
  const owner = new pg.Pool({ connectionString: OWNER_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const orgA = randomUUID();
  const orgB = randomUUID();
  const custB = randomUUID();

  /** Runs statements as the runtime role with a tenant bound, like db.withTenant(). */
  async function asTenant<T>(org: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      if (org) await c.query("SELECT set_config('app.current_org', $1, true)", [org]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    // The owner role is subject to FORCE RLS too, so seed with row_security off
    // (only possible for owners/superusers — never for arena_app).
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL row_security = off");
      for (const [id, slug] of [[orgA, `a-${orgA}`], [orgB, `b-${orgB}`]]) {
        await c.query(
          `INSERT INTO "Organization"(id, slug, "legalName", "displayName", "countryCode", "defaultCurrency", "defaultTimezone", "billingEmail", "updatedAt")
           VALUES ($1, $2, 'Test', 'Test', 'AE', 'AED', 'Asia/Dubai', 'x@example.com', now())`,
          [id, slug],
        );
      }
      await c.query(
        `INSERT INTO "Customer"(id, "organizationId", username, "displayName", "updatedAt")
         VALUES ($1, $2, 'ahmed', 'Ahmed', now())`,
        [custB, orgB],
      );
      await c.query("COMMIT");
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    await owner.end();
    await app.end();
  });

  it("Organization A cannot read Organization B's customers", async () => {
    const rows = await asTenant(orgA, (c) => c.query(`SELECT id FROM "Customer"`));
    expect(rows.rows.map((r) => r.id)).not.toContain(custB);
  });

  it("Organization B can read its own customers", async () => {
    const rows = await asTenant(orgB, (c) => c.query(`SELECT id FROM "Customer" WHERE id = $1`, [custB]));
    expect(rows.rowCount).toBe(1);
  });

  it("no tenant bound → zero rows (fails closed)", async () => {
    const rows = await asTenant(null, (c) => c.query(`SELECT id FROM "Customer"`));
    expect(rows.rowCount).toBe(0);
  });

  it("Organization A cannot update or delete B's rows", async () => {
    const upd = await asTenant(orgA, (c) => c.query(`UPDATE "Customer" SET "displayName" = 'pwned' WHERE id = $1`, [custB]));
    const del = await asTenant(orgA, (c) => c.query(`DELETE FROM "Customer" WHERE id = $1`, [custB]));
    expect(upd.rowCount).toBe(0);
    expect(del.rowCount).toBe(0);
  });

  it("Organization A cannot insert rows into B", async () => {
    await expect(
      asTenant(orgA, (c) =>
        c.query(
          `INSERT INTO "Customer"(id, "organizationId", username, "displayName", "updatedAt") VALUES ($1, $2, 'x', 'x', now())`,
          [randomUUID(), orgB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("the tenant setting does not leak to the next transaction on a pooled connection", async () => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_org', $1, true)", [orgB]);
      await c.query("COMMIT");
      const after = await c.query(`SELECT count(*)::int AS n FROM "Customer"`);
      expect(after.rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it("ledgers are append-only for the runtime role", async () => {
    await expect(asTenant(orgA, (c) => c.query(`DELETE FROM "AuditLog"`))).rejects.toThrow();
  });
});
