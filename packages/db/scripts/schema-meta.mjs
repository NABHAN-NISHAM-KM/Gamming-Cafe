// Minimal, dependency-free reader for our Prisma schema folder.
// Used by: RLS generation, tenant-model codegen and the static tenancy tests.
// It only needs to understand the subset of syntax this repo uses.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "schema");

/**
 * Tables that intentionally have NO row-level security. Each entry needs a
 * reason; the tenancy test fails if a model is neither tenant-scoped nor listed.
 */
export const RLS_EXEMPT = {
  Country: "platform reference data (read-only to tenants via GRANT)",
  Currency: "platform reference data (read-only to tenants via GRANT)",
  SubscriptionPlan: "platform catalog (read-only to tenants via GRANT)",
  PlanFeature: "platform catalog (read-only to tenants via GRANT)",
  ClientRelease: "platform catalog (read-only to tenants via GRANT)",
  User: "global staff identity; accessed only through the auth module",
  MfaFactor: "belongs to global User; auth module only",
  PlatformRoleAssignment: "platform-level; platform admin service only",
  RefreshToken: "auth module only; looked up by token hash before tenant is known",
  Permission: "platform permission catalog (read-only to tenants via GRANT)",
  RolePermission: "scoped through Role via EXISTS policy (see 010_rls.sql)",
  AuditChainHead: "maintained only by SECURITY DEFINER audit trigger",
  Lead: "platform sales pipeline from the website; platform service only (revoked from the tenant API)",
};

export function loadSchemaText(dir = SCHEMA_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".prisma"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

/** @returns {Map<string, {name:string, fields: Array<{name:string,type:string,optional:boolean,list:boolean,attrs:string}>, blockAttrs:string[]}>} */
export function parseModels(text = loadSchemaText()) {
  const models = new Map();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(text))) {
    const [, name, body] = m;
    const fields = [];
    const blockAttrs = [];
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      if (!line) continue;
      if (line.startsWith("@@")) {
        blockAttrs.push(line);
        continue;
      }
      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!fm) continue;
      fields.push({ name: fm[1], type: fm[2], list: !!fm[3], optional: !!fm[4], attrs: fm[5] ?? "" });
    }
    models.set(name, { name, fields, blockAttrs });
  }
  return models;
}

/** Models that carry an organizationId column. */
export function tenantModels(models = parseModels()) {
  const out = [];
  for (const model of models.values()) {
    const f = model.fields.find((x) => x.name === "organizationId");
    if (f) out.push({ name: model.name, orgOptional: f.optional });
  }
  // Organization itself is the tenant root; its "organizationId" is its id.
  out.push({ name: "Organization", orgOptional: false, isRoot: true });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Relations declared with `fields:[...]` on a model. */
export function relationsOf(model) {
  const rels = [];
  for (const f of model.fields) {
    const rm = /@relation\((.*)\)/.exec(f.attrs);
    if (!rm) continue;
    const fm = /fields:\s*\[([^\]]*)\]/.exec(rm[1]);
    if (!fm) continue; // back-relation side
    const refs = /references:\s*\[([^\]]*)\]/.exec(rm[1]);
    rels.push({
      field: f.name,
      target: f.type,
      fields: fm[1].split(",").map((s) => s.trim()),
      references: refs ? refs[1].split(",").map((s) => s.trim()) : [],
    });
  }
  return rels;
}
