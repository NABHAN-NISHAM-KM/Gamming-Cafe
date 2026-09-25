import { describe, expect, it } from "vitest";
import { scopeArgs } from "../src/tenant-scope.js";
import { TenantViolationError, runWithTenant, requireTenant, TenantContextMissingError } from "../src/tenant-context.js";

const ORG_A = "0190a1b2-0000-7000-8000-00000000000a";
const ORG_B = "0190a1b2-0000-7000-8000-00000000000b";

describe("scopeArgs — reads", () => {
  it("injects organizationId into findMany", () => {
    expect(scopeArgs("Device", "findMany", { where: { status: "AVAILABLE" } }, ORG_A)).toEqual({
      where: { status: "AVAILABLE", organizationId: ORG_A },
    });
  });

  it("injects organizationId when no args are given", () => {
    expect(scopeArgs("Customer", "count", undefined, ORG_A)).toEqual({ where: { organizationId: ORG_A } });
  });

  it("keeps unique selectors on findUnique (extended where-unique)", () => {
    expect(scopeArgs("Customer", "findUnique", { where: { id: "c1" } }, ORG_A)).toEqual({
      where: { id: "c1", organizationId: ORG_A },
    });
  });

  it("blocks explicitly querying another org", () => {
    expect(() => scopeArgs("Customer", "findMany", { where: { organizationId: ORG_B } }, ORG_A)).toThrow(
      TenantViolationError,
    );
  });

  it("blocks filter objects on organizationId (e.g. `in`) that could widen scope", () => {
    expect(() =>
      scopeArgs("Customer", "findMany", { where: { organizationId: { in: [ORG_A, ORG_B] } } }, ORG_A),
    ).toThrow(TenantViolationError);
  });

  it("allows an explicit equals filter for the same org", () => {
    expect(scopeArgs("Customer", "findFirst", { where: { organizationId: { equals: ORG_A } } }, ORG_A)).toEqual({
      where: { organizationId: ORG_A },
    });
  });

  it("lets shared-catalog models read platform rows (organizationId IS NULL)", () => {
    const out = scopeArgs("Game", "findMany", { where: { isActive: true } }, ORG_A);
    expect(out).toEqual({
      where: { isActive: true, AND: [{ OR: [{ organizationId: ORG_A }, { organizationId: null }] }] },
    });
  });

  it("does NOT let shared-catalog models update platform rows", () => {
    expect(scopeArgs("Game", "updateMany", { where: { slug: "cs2" }, data: { isActive: false } }, ORG_A)).toEqual({
      where: { slug: "cs2", organizationId: ORG_A },
      data: { isActive: false },
    });
  });

  it("scopes the Organization root by its id", () => {
    expect(scopeArgs("Organization", "findFirst", {}, ORG_A)).toEqual({ where: { id: ORG_A } });
    expect(() => scopeArgs("Organization", "findUnique", { where: { id: ORG_B } }, ORG_A)).toThrow(
      TenantViolationError,
    );
  });

  it("leaves non-tenant models untouched", () => {
    const args = { where: { code: "AE" } };
    expect(scopeArgs("Country", "findMany", args, ORG_A)).toBe(args);
  });
});

describe("scopeArgs — writes", () => {
  it("stamps organizationId on create", () => {
    expect(scopeArgs("Customer", "create", { data: { username: "ahmed" } }, ORG_A)).toEqual({
      data: { username: "ahmed", organizationId: ORG_A },
    });
  });

  it("stamps every row on createMany", () => {
    const out = scopeArgs("Product", "createMany", { data: [{ sku: "a" }, { sku: "b" }] }, ORG_A);
    expect(out!.data).toEqual([
      { sku: "a", organizationId: ORG_A },
      { sku: "b", organizationId: ORG_A },
    ]);
  });

  it("rejects creating rows for another org", () => {
    expect(() => scopeArgs("Customer", "create", { data: { organizationId: ORG_B } }, ORG_A)).toThrow(
      TenantViolationError,
    );
    expect(() =>
      scopeArgs("Customer", "create", { data: { organization: { connect: { id: ORG_B } } } }, ORG_A),
    ).toThrow(TenantViolationError);
  });

  it("rejects moving a row to another org on update", () => {
    expect(() =>
      scopeArgs("Device", "update", { where: { id: "d1" }, data: { organizationId: ORG_B } }, ORG_A),
    ).toThrow(TenantViolationError);
  });

  it("scopes upsert where + create", () => {
    const out = scopeArgs(
      "Wallet",
      "upsert",
      { where: { id: "w1" }, create: { customerId: "c1" }, update: { isFrozen: true } },
      ORG_A,
    );
    expect(out).toEqual({
      where: { id: "w1", organizationId: ORG_A },
      create: { customerId: "c1", organizationId: ORG_A },
      update: { isFrozen: true },
    });
  });

  it("scopes deleteMany so it can never wipe another tenant", () => {
    expect(scopeArgs("Booking", "deleteMany", {}, ORG_A)).toEqual({ where: { organizationId: ORG_A } });
  });

  it("forbids tenants creating or deleting organizations", () => {
    expect(() => scopeArgs("Organization", "create", { data: {} }, ORG_A)).toThrow(TenantViolationError);
    expect(() => scopeArgs("Organization", "delete", { where: { id: ORG_A } }, ORG_A)).toThrow(
      TenantViolationError,
    );
  });
});

describe("tenant context", () => {
  it("fails closed when no tenant is bound", () => {
    expect(() => requireTenant("Device")).toThrow(TenantContextMissingError);
  });

  it("isolates concurrent async contexts", async () => {
    const seen = await Promise.all(
      [ORG_A, ORG_B].map((org) =>
        runWithTenant({ organizationId: org, actorType: "SYSTEM", actorId: null }, async () => {
          await new Promise((r) => setTimeout(r, org === ORG_A ? 20 : 1));
          return requireTenant().organizationId;
        }),
      ),
    );
    expect(seen).toEqual([ORG_A, ORG_B]);
  });
});
