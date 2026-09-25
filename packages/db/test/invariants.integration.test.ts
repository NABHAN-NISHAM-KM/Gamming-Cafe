// Database-enforced business invariants (migrations 0003/0004), exercised as
// the real runtime role (arena_app, RLS on) wherever possible.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID as id } from "node:crypto";

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!OWNER_URL || !APP_URL)("database invariants (Postgres)", () => {
  const owner = new pg.Pool({ connectionString: OWNER_URL });
  const app = new pg.Pool({ connectionString: APP_URL });

  const A = { org: id(), brand: id(), branch: id(), zone: id(), pc1: id(), pc2: id(), customer: id(), wallet: id() };
  const B = { org: id(), brand: id(), branch: id(), zone: id() };

  async function run<T>(pool: pg.Pool, org: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (org) await c.query("SELECT set_config('app.current_org', $1, true)", [org]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  const asA = <T>(fn: (c: pg.PoolClient) => Promise<T>) => run(app, A.org, fn);

  async function seedOrg(c: pg.PoolClient, o: { org: string; brand: string; branch: string; zone: string }, code: string) {
    await c.query(
      `INSERT INTO "Organization"(id, slug, "legalName", "displayName", "countryCode", "defaultCurrency", "defaultTimezone", "billingEmail", "updatedAt")
       VALUES ($1, $2, 'T', 'T', 'AE', 'AED', 'Asia/Dubai', 't@example.com', now())`,
      [o.org, `org-${o.org}`],
    );
    await c.query(`INSERT INTO "Brand"(id, "organizationId", name, "updatedAt") VALUES ($1, $2, 'Brand', now())`, [o.brand, o.org]);
    await c.query(
      `INSERT INTO "Branch"(id, "organizationId", "brandId", code, name, "countryCode", currency, timezone, "updatedAt")
       VALUES ($1, $2, $3, $4, 'Branch', 'AE', 'AED', 'Asia/Dubai', now())`,
      [o.branch, o.org, o.brand, code],
    );
    await c.query(
      `INSERT INTO "Zone"(id, "organizationId", "branchId", name, type, "updatedAt") VALUES ($1, $2, $3, 'Regular', 'PC_STANDARD', now())`,
      [o.zone, o.org, o.branch],
    );
  }

  const insertDevice = (c: pg.PoolClient, deviceId: string, org: string, branch: string, zone: string, name: string) =>
    c.query(
      `INSERT INTO "Device"(id, "organizationId", "branchId", "zoneId", name, kind, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'GAMING_PC', now())`,
      [deviceId, org, branch, zone, name],
    );

  const insertBooking = async (c: pg.PoolClient, device: string, from: string, to: string, status = "CONFIRMED") => {
    const booking = id();
    await c.query(
      `INSERT INTO "Booking"(id, "organizationId", "branchId", reference, "resourceType", "startsAt", "endsAt", status, currency, "updatedAt")
       VALUES ($1, $2, $3, $4, 'PC', $5, $6, $7, 'AED', now())`,
      [booking, A.org, A.branch, `BK-${booking.slice(0, 8)}`, from, to, status],
    );
    await c.query(
      `INSERT INTO "BookingResource"(id, "organizationId", "bookingId", "deviceId", "startsAt", "endsAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id(), A.org, booking, device, from, to],
    );
    return booking;
  };

  const insertSession = (c: pg.PoolClient, device: string, status: string) =>
    c.query(
      `INSERT INTO "GamingSession"(id, "organizationId", "branchId", "zoneId", "deviceId", "stationClass", status,
         "billingMode", "paymentTiming", "rateSnapshot", "allocatedMinutes", currency, "postSessionAction", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'PC', $6, 'PER_HOUR', 'PREPAID', '{}', 120, 'AED', 'LOCK', now())`,
      [id(), A.org, A.branch, A.zone, device, status],
    );

  beforeAll(async () => {
    await run(owner, null, async (c) => {
      await seedOrg(c, A, "DXB1");
      await seedOrg(c, B, "AUH1");
      await insertDevice(c, A.pc1, A.org, A.branch, A.zone, "PC-01");
      await insertDevice(c, A.pc2, A.org, A.branch, A.zone, "PC-02");
      await c.query(`INSERT INTO "Customer"(id, "organizationId", username, "displayName", "updatedAt") VALUES ($1, $2, 'ahmed', 'Ahmed', now())`, [A.customer, A.org]);
      await c.query(`INSERT INTO "Wallet"(id, "organizationId", "customerId", currency, "updatedAt") VALUES ($1, $2, $3, 'AED', now())`, [A.wallet, A.org, A.customer]);
    });
  });

  afterAll(async () => {
    await owner.end();
    await app.end();
  });

  describe("cross-tenant references (composite FKs)", () => {
    it("a device in org A cannot be attached to a branch of org B — even bypassing RLS", async () => {
      await expect(run(owner, null, (c) => insertDevice(c, id(), A.org, B.branch, B.zone, "EVIL"))).rejects.toThrow(/foreign key/);
    });
  });

  describe("shared-catalog references", () => {
    it("org A cannot assign a custom role that belongs to org B", async () => {
      const user = id();
      const emp = id();
      const roleB = id();
      const template = id();
      await run(owner, null, async (c) => {
        await c.query(`INSERT INTO "User"(id, email, "displayName", "updatedAt") VALUES ($1, $2, 'U', now())`, [user, `u-${user}@example.com`]);
        await c.query(`INSERT INTO "Employee"(id, "organizationId", "userId", "employeeCode", "displayName", "updatedAt") VALUES ($1, $2, $3, 'E1', 'E', now())`, [emp, A.org, user]);
        await c.query(`INSERT INTO "Role"(id, "organizationId", key, name, "updatedAt") VALUES ($1, $2, 'b_custom', 'B custom', now())`, [roleB, B.org]);
        await c.query(`INSERT INTO "Role"(id, "organizationId", key, name, "updatedAt") VALUES ($1, NULL, $2, 'Template', now())`, [template, `tpl_${template.slice(0, 8)}`]);
      });
      const assign = (roleId: string) => (c: pg.PoolClient) =>
        c.query(`INSERT INTO "EmployeeRoleAssignment"(id, "organizationId", "employeeId", "roleId", scope) VALUES ($1, $2, $3, $4, 'ORGANIZATION')`, [id(), A.org, emp, roleId]);
      await expect(asA(assign(roleB))).rejects.toThrow(/owned by another organization/);
      await asA(assign(template)); // platform templates are fine
    });
  });

  describe("bookings", () => {
    it("rejects an overlapping booking for the same PC", async () => {
      await asA((c) => insertBooking(c, A.pc1, "2030-01-01T10:00Z", "2030-01-01T12:00Z"));
      await expect(asA((c) => insertBooking(c, A.pc1, "2030-01-01T11:00Z", "2030-01-01T13:00Z"))).rejects.toThrow(/booking_device_no_overlap/);
    });

    it("allows back-to-back bookings and the same slot on another PC", async () => {
      await asA((c) => insertBooking(c, A.pc1, "2030-01-01T12:00Z", "2030-01-01T13:00Z"));
      await asA((c) => insertBooking(c, A.pc2, "2030-01-01T10:00Z", "2030-01-01T12:00Z"));
    });

    it("cancelling a booking frees the slot", async () => {
      const b = await asA((c) => insertBooking(c, A.pc1, "2030-02-01T10:00Z", "2030-02-01T12:00Z"));
      await asA((c) => c.query(`UPDATE "Booking" SET status = 'CANCELLED' WHERE id = $1`, [b]));
      await asA((c) => insertBooking(c, A.pc1, "2030-02-01T10:00Z", "2030-02-01T12:00Z"));
    });

    it("moving a booking onto an occupied slot is rejected", async () => {
      await asA((c) => insertBooking(c, A.pc2, "2030-03-01T10:00Z", "2030-03-01T11:00Z"));
      const b = await asA((c) => insertBooking(c, A.pc2, "2030-03-01T14:00Z", "2030-03-01T15:00Z"));
      await expect(
        asA((c) => c.query(`UPDATE "Booking" SET "startsAt" = '2030-03-01T10:30Z', "endsAt" = '2030-03-01T11:30Z' WHERE id = $1`, [b])),
      ).rejects.toThrow(/booking_device_no_overlap/);
    });
  });

  describe("gaming sessions", () => {
    it("allows only one live session per station", async () => {
      await asA((c) => insertSession(c, A.pc2, "ACTIVE"));
      await expect(asA((c) => insertSession(c, A.pc2, "PENDING"))).rejects.toThrow(/session_one_live_per_device/);
    });

    it("ended sessions do not block a new one", async () => {
      await asA((c) => insertSession(c, A.pc1, "ENDED"));
      await asA((c) => insertSession(c, A.pc1, "ACTIVE"));
    });
  });

  describe("wallet ledger", () => {
    const tx = (c: pg.PoolClient, key: string, amount: number, balanceAfter: number) =>
      c.query(
        `INSERT INTO "WalletTransaction"(id, "organizationId", "walletId", type, bucket, amount, "balanceAfter", currency, "idempotencyKey")
         VALUES ($1, $2, $3, 'TOPUP', 'CASH', $4, $5, 'AED', $6)`,
        [id(), A.org, A.wallet, amount, balanceAfter, key],
      );

    it("retrying the same top-up (same idempotency key) cannot credit twice", async () => {
      await asA((c) => tx(c, "topup-001", 100, 100));
      await expect(asA((c) => tx(c, "topup-001", 100, 200))).rejects.toThrow(/unique/i);
    });

    it("ledger rows cannot be edited or deleted — not even by the table owner", async () => {
      await expect(asA((c) => c.query(`UPDATE "WalletTransaction" SET amount = 1000000`))).rejects.toThrow();
      await expect(run(owner, null, (c) => c.query(`DELETE FROM "WalletTransaction"`))).rejects.toThrow(/append-only/);
    });

    it("balances can never go negative", async () => {
      await expect(asA((c) => c.query(`UPDATE "Wallet" SET "cashBalance" = -1 WHERE id = $1`, [A.wallet]))).rejects.toThrow(/wallet_balances_non_negative/);
    });
  });

  describe("accounting", () => {
    it("rejects an unbalanced journal entry at commit, accepts a balanced one", async () => {
      const cash = id();
      const revenue = id();
      await asA(async (c) => {
        await c.query(`INSERT INTO "LedgerAccount"(id, "organizationId", code, name, type, "updatedAt") VALUES ($1, $2, '1000', 'Cash', 'ASSET', now())`, [cash, A.org]);
        await c.query(`INSERT INTO "LedgerAccount"(id, "organizationId", code, name, type, "updatedAt") VALUES ($1, $2, '4100', 'Gaming revenue', 'REVENUE', now())`, [revenue, A.org]);
      });
      const entry = (c: pg.PoolClient, debit: number, credit: number) => {
        const e = id();
        return c
          .query(`INSERT INTO "JournalEntry"(id, "organizationId", "entryDate", description, "sourceType", "sourceId", currency) VALUES ($1, $2, CURRENT_DATE, 'Sale', 'TEST', $1, 'AED')`, [e, A.org])
          .then(() => c.query(`INSERT INTO "JournalLine"(id, "organizationId", "entryId", "accountId", debit) VALUES ($1, $2, $3, $4, $5)`, [id(), A.org, e, cash, debit]))
          .then(() => c.query(`INSERT INTO "JournalLine"(id, "organizationId", "entryId", "accountId", credit) VALUES ($1, $2, $3, $4, $5)`, [id(), A.org, e, revenue, credit]));
      };
      await expect(asA((c) => entry(c, 30, 25))).rejects.toThrow(/unbalanced/);
      await asA((c) => entry(c, 30, 30));
    });
  });

  describe("audit log", () => {
    const audit = (c: pg.PoolClient, action: string) =>
      c.query(
        `INSERT INTO "AuditLog"(id, "organizationId", "actorType", action, "entityType", hash) VALUES ($1, $2, 'EMPLOYEE', $3, 'GamingSession', '')`,
        [id(), A.org, action],
      );

    it("hash-chains entries and verifies clean", async () => {
      await asA(async (c) => {
        await audit(c, "session.start");
        await audit(c, "session.extend");
        await audit(c, "pos.refund");
      });
      const rows = await run(owner, null, (c) => c.query(`SELECT "chainSeq", "prevHash", hash FROM "AuditLog" WHERE "organizationId" = $1 ORDER BY "chainSeq"`, [A.org]));
      expect(rows.rows.map((r) => Number(r.chainSeq))).toEqual([1, 2, 3]);
      expect(rows.rows[1].prevHash).toBe(rows.rows[0].hash);
      const broken = await run(owner, null, (c) => c.query(`SELECT * FROM app.verify_audit_chain($1)`, [A.org]));
      expect(broken.rowCount).toBe(0);
    });

    it("detects tampering even by a superuser who disables the guard trigger", async () => {
      const c = await owner.connect();
      try {
        await c.query("BEGIN");
        await c.query(`ALTER TABLE "AuditLog" DISABLE TRIGGER append_only_row`);
        await c.query(`UPDATE "AuditLog" SET reason = 'nothing to see here' WHERE "organizationId" = $1 AND action = 'pos.refund'`, [A.org]);
        const broken = await c.query(`SELECT broken_id FROM app.verify_audit_chain($1)`, [A.org]);
        expect(broken.rowCount).toBe(1);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  });

  describe("payments", () => {
    it("a retried payment with the same idempotency key cannot create a second charge", async () => {
      const booking = await asA((c) => insertBooking(c, A.pc1, "2030-04-01T10:00Z", "2030-04-01T11:00Z"));
      const pay = (c: pg.PoolClient) =>
        c.query(
          `INSERT INTO "Payment"(id, "organizationId", "branchId", "bookingId", method, amount, currency, "idempotencyKey", "updatedAt")
           VALUES ($1, $2, $3, $4, 'CARD', 30, 'AED', 'pay-booking-001', now())`,
          [id(), A.org, A.branch, booking],
        );
      await asA(pay);
      await expect(asA(pay)).rejects.toThrow(/unique/i);
    });
  });
});
