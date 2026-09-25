// Application-level tenant scoping (layer 2 of 3 — see docs/05-multi-tenancy.md).
// Pure function so it can be unit-tested without a database.
import { TENANT_MODELS, SHARED_CATALOG_MODELS, TENANT_ROOT_MODEL } from "./tenant-models.generated.js";
import { TenantViolationError } from "./tenant-context.js";

type Args = Record<string, any> | undefined;

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);
const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_OPS = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);

export function isTenantModel(model: string | undefined): boolean {
  return !!model && (TENANT_MODELS.has(model) || model === TENANT_ROOT_MODEL);
}

/**
 * Returns a copy of `args` constrained to `orgId`:
 *  - reads/updates/deletes get `organizationId = orgId` merged into `where`
 *    (shared-catalog models may also read rows where organizationId IS NULL);
 *  - creates get `organizationId` stamped on every row;
 *  - any attempt to target, write or move rows to another org throws.
 *
 * Nested relation writes are not rewritten here; they are covered by the
 * composite (id, organizationId) foreign keys and by Postgres RLS.
 */
export function scopeArgs(model: string, operation: string, args: Args, orgId: string): Args {
  if (!isTenantModel(model)) return args;
  const next: Record<string, any> = { ...(args ?? {}) };
  const isRoot = model === TENANT_ROOT_MODEL;
  const orgField = isRoot ? "id" : "organizationId";

  if (isRoot && (CREATE_OPS.has(operation) || operation === "delete" || operation === "deleteMany")) {
    throw new TenantViolationError(`Tenants cannot ${operation} organizations`);
  }

  if (WHERE_OPS.has(operation)) {
    const where: Record<string, any> = { ...(next.where ?? {}) };
    assertSameOrg(where[orgField], orgId, `${model}.${operation} where.${orgField}`);
    if (!isRoot && READ_OPS.has(operation) && SHARED_CATALOG_MODELS.has(model)) {
      delete where[orgField];
      next.where = { ...where, AND: [...toArray(where.AND), { OR: [{ organizationId: orgId }, { organizationId: null }] }] };
    } else {
      next.where = { ...where, [orgField]: orgId };
    }
  }

  if (CREATE_OPS.has(operation)) {
    next.data = Array.isArray(next.data)
      ? next.data.map((row: any) => stampOrg(row, orgId, model))
      : stampOrg(next.data, orgId, model);
  }

  if (UPDATE_OPS.has(operation)) {
    if (operation === "upsert") {
      next.create = stampOrg(next.create, orgId, model);
      assertNotMoved(next.update, orgField, orgId, model);
    } else {
      assertNotMoved(next.data, orgField, orgId, model);
    }
  }

  return next;
}

function stampOrg(row: any, orgId: string, model: string) {
  const data = { ...(row ?? {}) };
  assertSameOrg(data.organizationId, orgId, `${model} create data.organizationId`);
  // Relation-style connect for the tenant is also rejected unless it matches.
  const connectId = data.organization?.connect?.id;
  assertSameOrg(connectId, orgId, `${model} create organization.connect`);
  if (!data.organization) data.organizationId = orgId;
  return data;
}

function assertNotMoved(data: any, orgField: string, orgId: string, model: string) {
  if (!data) return;
  assertSameOrg(data[orgField], orgId, `${model} update data.${orgField}`);
  if (data.organization) throw new TenantViolationError(`${model}: changing the owning organization is not allowed`);
}

function assertSameOrg(value: unknown, orgId: string, where: string) {
  if (value === undefined) return;
  if (value === orgId) return;
  if (typeof value === "object" && value !== null && (value as any).equals === orgId && Object.keys(value).length === 1) return;
  throw new TenantViolationError(`Cross-tenant access blocked (${where})`);
}

function toArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
