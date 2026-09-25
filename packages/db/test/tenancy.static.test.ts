// Static guarantees about the schema and migrations. These run without a
// database and fail CI the moment someone adds a table that could leak data.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs helper without type declarations
import { parseModels, tenantModels, relationsOf, RLS_EXEMPT } from "../scripts/schema-meta.mjs";
// @ts-expect-error — plain .mjs helper without type declarations
import { SHARED_CATALOG } from "../scripts/gen-rls.mjs";
import { TENANT_MODELS } from "../src/tenant-models.generated.js";

const MIGRATIONS = join(__dirname, "..", "prisma", "migrations");
const allSql = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => readFileSync(join(MIGRATIONS, d.name, "migration.sql"), "utf8"))
  .join("\n");

const models: Map<string, any> = parseModels();
const tenants: Array<{ name: string; orgOptional: boolean; isRoot?: boolean }> = tenantModels(models);
const tenantNames = new Set(tenants.map((t) => t.name));

describe("tenant data model", () => {
  it("every model is either tenant-scoped or explicitly exempt with a reason", () => {
    const unclassified = [...models.keys()].filter((m) => !tenantNames.has(m) && !(m in RLS_EXEMPT));
    expect(unclassified).toEqual([]);
  });

  it("only shared catalogs / platform-audit tables have a nullable organizationId", () => {
    const allowed = new Set([...SHARED_CATALOG, "AuditLog", "RefreshToken"]);
    const nullable = tenants.filter((t) => t.orgOptional && !allowed.has(t.name)).map((t) => t.name);
    expect(nullable).toEqual([]);
  });

  it("every tenant model exposes @@unique([id, organizationId]) when referenced by children", () => {
    const referenced = new Set<string>();
    for (const m of models.values()) for (const r of relationsOf(m)) if (r.fields.includes("organizationId")) referenced.add(r.target);
    const missing = [...referenced].filter(
      (name) => name !== "Organization" && !models.get(name).blockAttrs.some((a: string) => /@@unique\(\[id, organizationId\]\)/.test(a)),
    );
    expect(missing).toEqual([]);
  });

  it("tenant → tenant relations use composite (fk, organizationId) keys — no cross-org pointers possible", () => {
    const offenders: string[] = [];
    for (const m of models.values()) {
      if (!tenantNames.has(m.name) || m.name === "Organization") continue;
      const own = m.fields.find((f: any) => f.name === "organizationId");
      if (own?.optional) continue; // shared catalog rows may point at platform rows
      for (const r of relationsOf(m)) {
        const targetIsTenant = tenantNames.has(r.target) && r.target !== "Organization";
        const targetIsCatalog = SHARED_CATALOG.has(r.target);
        if (!targetIsTenant || targetIsCatalog) continue;
        if (!r.fields.includes("organizationId") || !r.references.includes("organizationId")) {
          offenders.push(`${m.name}.${r.field} → ${r.target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every tenant → shared-catalog reference is guarded by a catalog_ref trigger", () => {
    const unguarded: string[] = [];
    for (const m of models.values()) {
      if (!tenantNames.has(m.name)) continue;
      for (const r of relationsOf(m)) {
        if (!SHARED_CATALOG.has(r.target) || r.fields.includes("organizationId")) continue;
        const col = r.fields[0];
        const guarded = new RegExp(`\\('${m.name}',\\s*'${col}',\\s*'${r.target}'\\)`).test(allSql);
        if (!guarded) unguarded.push(`${m.name}.${col} → ${r.target}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("generated TENANT_MODELS is in sync with the schema (run `npm run codegen`)", () => {
    const expected = tenants.filter((t) => !t.isRoot && !(t.name in RLS_EXEMPT)).map((t) => t.name).sort();
    expect([...TENANT_MODELS].sort()).toEqual(expected);
  });
});

describe("row-level security migrations", () => {
  const rlsTables = tenants.filter((t) => !(t.name in RLS_EXEMPT));

  it.each(rlsTables.map((t) => t.name))("%s has RLS enabled, forced, and a tenant policy", (name) => {
    expect(allSql).toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`);
    expect(allSql).toContain(`ALTER TABLE "${name}" FORCE ROW LEVEL SECURITY;`);
    expect(allSql).toMatch(new RegExp(`CREATE POLICY \\w+ ON "${name}"`));
  });

  it("RolePermission is scoped through Role", () => {
    expect(allSql).toContain(`CREATE POLICY via_role_write ON "RolePermission"`);
  });

  it("the tenant setting fails closed when unset", () => {
    expect(allSql).toContain(`NULLIF(current_setting('app.current_org', true), '')::uuid`);
  });
});

describe("ledger immutability", () => {
  it.each(["WalletTransaction", "LoyaltyTransaction", "StockMovement", "CashMovement", "JournalLine", "SessionExtension", "AuditLog"])(
    "%s is append-only",
    (name) => {
      expect(allSql).toMatch(new RegExp(`'${name}'`));
      expect(models.get(name).fields.some((f: any) => f.name === "updatedAt")).toBe(false);
    },
  );

  it("financial & ledger writes carry idempotency keys", () => {
    for (const name of ["Payment", "Refund", "WalletTransaction", "LoyaltyTransaction", "StockMovement", "SessionExtension"]) {
      const m = models.get(name);
      expect(m.fields.some((f: any) => f.name === "idempotencyKey"), name).toBe(true);
      expect(m.blockAttrs.some((a: string) => a.includes("@@unique([organizationId, idempotencyKey])")), name).toBe(true);
    }
  });
});
