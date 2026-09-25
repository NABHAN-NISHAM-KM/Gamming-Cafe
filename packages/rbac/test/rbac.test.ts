import { describe, expect, it } from "vitest";
import { resolveFeatures } from "@arena/contracts";
import { PERMISSIONS, ROLE_TEMPLATES, templatePermissions, expandGrants, authorize, branchesWith, missingForDelegation, type Grant, type Principal } from "../src/index.js";

const ORG_A = "org-a";
const ORG_B = "org-b";
const allFeatures = resolveFeatures(
  Object.keys((await import("@arena/contracts")).FEATURES).map((k) => ({ featureKey: k, enabled: true })),
  [],
).enabled;

const grant = (roleKey: string, scope: Grant["scope"], ids: Partial<Grant> = {}): Grant => ({
  roleKey,
  permissions: templatePermissions(roleKey),
  scope,
  ...ids,
});

const principal = (grants: Grant[], extra: Partial<Principal> = {}): Principal => ({
  organizationId: ORG_A,
  grants,
  features: allFeatures,
  ...extra,
});

const branch = (branchId: string, brandId = "brand-1") => ({ organizationId: ORG_A, brandId, branchId });

describe("catalog & templates", () => {
  it("permission keys are unique and well-formed", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it("covers the example permissions from the spec", () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    for (const k of [
      "station.start_session", "station.end_session", "station.remote_control", "station.maintenance",
      "station.shutdown", "customer.view", "customer.edit", "customer.adjust_wallet", "pos.sell",
      "pos.refund", "pos.discount", "restaurant.cancel_order", "inventory.adjust", "reports.financial",
      "shell.disable",
    ]) expect(keys.has(k as any), k).toBe(true);
  });

  it("every role template expands without typos", () => {
    for (const r of ROLE_TEMPLATES) expect(templatePermissions(r.key).size, r.key).toBeGreaterThan(0);
  });

  it("defines all 14 org roles from the spec (Super Admin is platform-level)", () => {
    expect(ROLE_TEMPLATES.map((r) => r.key).sort()).toEqual(
      ["accountant", "branch_manager", "cashier", "gaming_manager", "inventory_manager", "kitchen_staff", "org_admin", "org_owner", "receptionist", "restaurant_manager", "system_admin", "technician", "tournament_manager", "waiter"].sort(),
    );
  });

  it("rejects wildcard typos", () => {
    expect(() => expandGrants(["statoin.*"])).toThrow(/matches no permission/);
  });

  it("separation of duties: roles that must not touch money or wallets", () => {
    for (const role of ["technician", "system_admin", "kitchen_staff", "waiter"]) {
      const perms = templatePermissions(role);
      expect(perms.has("customer.adjust_wallet"), role).toBe(false);
      expect(perms.has("pos.refund"), role).toBe(false);
    }
    expect(templatePermissions("cashier").has("pos.refund")).toBe(false);
    expect(templatePermissions("org_admin").has("payment.gateway_manage")).toBe(false);
  });
});

describe("authorize", () => {
  it("cashier can start sessions in their own branch", () => {
    const p = principal([grant("cashier", "BRANCH", { branchId: "dxb1" })]);
    expect(authorize(p, "station.start_session", branch("dxb1"))).toMatchObject({ allowed: true, viaRole: "cashier" });
  });

  it("cashier of DXB1 cannot act in AUH1", () => {
    const p = principal([grant("cashier", "BRANCH", { branchId: "dxb1" })]);
    expect(authorize(p, "station.start_session", branch("auh1"))).toEqual({ allowed: false, reason: "OUT_OF_SCOPE" });
  });

  it("branch-scoped grants never cover org-level resources", () => {
    const p = principal([grant("branch_manager", "BRANCH", { branchId: "dxb1" })]);
    expect(authorize(p, "zone.manage", { organizationId: ORG_A })).toEqual({ allowed: false, reason: "OUT_OF_SCOPE" });
  });

  it("brand-scoped grants cover every branch of that brand only", () => {
    const p = principal([grant("gaming_manager", "BRAND", { brandId: "brand-1" })]);
    expect(authorize(p, "station.restart", branch("dxb1", "brand-1")).allowed).toBe(true);
    expect(authorize(p, "station.restart", branch("x9", "brand-2")).allowed).toBe(false);
  });

  it("Organization A can never act on Organization B, even as owner", () => {
    const p = principal([grant("org_owner", "ORGANIZATION")]);
    expect(authorize(p, "customer.view", { organizationId: ORG_B, branchId: "b1" })).toEqual({ allowed: false, reason: "WRONG_TENANT" });
  });

  it("technician cannot adjust wallets or refund", () => {
    const p = principal([grant("technician", "BRANCH", { branchId: "dxb1" })]);
    expect(authorize(p, "customer.adjust_wallet", branch("dxb1"), { reason: "x".repeat(10) })).toEqual({ allowed: false, reason: "NOT_GRANTED" });
    expect(authorize(p, "station.maintenance", branch("dxb1"), { reason: "GPU driver repair" }).allowed).toBe(true);
  });

  it("sensitive actions require a reason", () => {
    const p = principal([grant("branch_manager", "BRANCH", { branchId: "dxb1" })]);
    expect(authorize(p, "pos.refund", branch("dxb1"))).toEqual({ allowed: false, reason: "REASON_REQUIRED" });
    expect(authorize(p, "pos.refund", branch("dxb1"), { reason: "Burger was cold" })).toMatchObject({ allowed: true, sensitive: true });
  });

  it("disabled modules are denied regardless of role", () => {
    const noRestaurant = new Set([...allFeatures].filter((f) => f !== "RESTAURANT"));
    const p = principal([grant("org_owner", "ORGANIZATION")], { features: noRestaurant });
    expect(authorize(p, "restaurant.order", branch("dxb1"))).toEqual({ allowed: false, reason: "FEATURE_DISABLED" });
  });

  it("expired grants are ignored", () => {
    const p = principal([grant("cashier", "BRANCH", { branchId: "dxb1", expiresAt: new Date("2020-01-01") })]);
    expect(authorize(p, "pos.sell", branch("dxb1"))).toEqual({ allowed: false, reason: "NOT_GRANTED" });
  });

  it("impersonating Super Admin cannot move money", () => {
    const p = principal([grant("org_owner", "ORGANIZATION")], { impersonatorId: "platform-user-1" });
    expect(authorize(p, "customer.adjust_wallet", branch("dxb1"), { reason: "support ticket 42" })).toEqual({ allowed: false, reason: "IMPERSONATION_BLOCKED" });
    expect(authorize(p, "station.view", branch("dxb1")).allowed).toBe(true);
  });

  it("delegation: a branch manager cannot grant permissions they lack, or grant outside their branch", () => {
    const p = principal([grant("branch_manager", "BRANCH", { branchId: "dxb1" })]);
    expect(missingForDelegation(p, templatePermissions("cashier"), branch("dxb1"))).toEqual([]);
    expect(missingForDelegation(p, templatePermissions("cashier"), branch("auh1")).length).toBeGreaterThan(0);
    expect(missingForDelegation(p, templatePermissions("org_owner"), branch("dxb1"))).toContain("payment.gateway_manage");
  });

  it("branchesWith lists only permitted branches", () => {
    const p = principal([grant("cashier", "BRANCH", { branchId: "dxb1" }), grant("gaming_manager", "BRAND", { brandId: "brand-2" })]);
    const brandOf = (b: string) => ({ dxb1: "brand-1", auh1: "brand-1", shj1: "brand-2" })[b];
    expect(branchesWith(p, "station.start_session", brandOf, ["dxb1", "auh1", "shj1"])).toEqual(["dxb1", "shj1"]);
    expect(branchesWith(principal([grant("org_owner", "ORGANIZATION")]), "pos.sell", brandOf, ["dxb1"])).toBeNull();
  });
});
