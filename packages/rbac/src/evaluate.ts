// Server-side authorization decision. Every sensitive endpoint calls
// `authorize()` (via a NestJS guard in Phase 2) — the UI hiding a button is
// never the security boundary.
import type { FeatureKey } from "@arena/contracts";
import { MODULE_FEATURE, PERMISSION_FEATURE, permissionDef, type PermissionKey } from "./permissions.js";
import type { RoleScopeType } from "./roles.js";

export interface Grant {
  roleKey: string;
  permissions: ReadonlySet<PermissionKey>;
  scope: RoleScopeType;
  brandId?: string | null;
  branchId?: string | null;
  expiresAt?: Date | null;
}

export interface Principal {
  organizationId: string;
  grants: readonly Grant[];
  /** Enabled modules for the principal's organization (resolveFeatures). */
  features: ReadonlySet<FeatureKey>;
  /** Set when a platform admin is impersonating; some actions are refused. */
  impersonatorId?: string | null;
}

/** The resource being acted on. Omit brand/branch for org-level resources. */
export interface Target {
  organizationId: string;
  brandId?: string | null;
  branchId?: string | null;
}

export type DenyReason = "WRONG_TENANT" | "FEATURE_DISABLED" | "NOT_GRANTED" | "OUT_OF_SCOPE" | "REASON_REQUIRED" | "IMPERSONATION_BLOCKED";

export type Decision =
  | { allowed: true; sensitive: boolean; viaRole: string }
  | { allowed: false; reason: DenyReason };

/** Actions an impersonating Super Admin may never perform on a tenant's behalf. */
export const IMPERSONATION_BLOCKED: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  "customer.adjust_wallet",
  "pos.refund",
  "employee.assign_roles",
  "payment.gateway_manage",
  "integration.manage",
  "customer.export",
]);

function covers(grant: Grant, target: Target): boolean {
  switch (grant.scope) {
    case "ORGANIZATION":
      return true;
    case "BRAND":
      // A brand grant covers that brand's branches, and brand-level resources.
      return !!grant.brandId && target.brandId === grant.brandId;
    case "BRANCH":
      // A branch grant never covers org- or brand-level resources.
      return !!grant.branchId && target.branchId === grant.branchId;
  }
}

export interface AuthorizeOptions {
  now?: Date;
  /** Free-text justification; mandatory for sensitive permissions. */
  reason?: string | null;
}

export function authorize(p: Principal, permission: PermissionKey, target: Target, opts: AuthorizeOptions = {}): Decision {
  const def = permissionDef(permission);
  const now = opts.now ?? new Date();

  // 1. Tenant boundary first — cheap and absolute.
  if (target.organizationId !== p.organizationId) return { allowed: false, reason: "WRONG_TENANT" };

  // 2. Module must be enabled for the organization's plan.
  const feature = PERMISSION_FEATURE[permission] ?? MODULE_FEATURE[def.module];
  if (feature && !p.features.has(feature)) return { allowed: false, reason: "FEATURE_DISABLED" };

  if (p.impersonatorId && IMPERSONATION_BLOCKED.has(permission)) return { allowed: false, reason: "IMPERSONATION_BLOCKED" };

  // 3. Some live grant must include the permission AND cover the target.
  const live = p.grants.filter((g) => !g.expiresAt || g.expiresAt > now);
  const withPerm = live.filter((g) => g.permissions.has(permission));
  if (withPerm.length === 0) return { allowed: false, reason: "NOT_GRANTED" };
  const hit = withPerm.find((g) => covers(g, target));
  if (!hit) return { allowed: false, reason: "OUT_OF_SCOPE" };

  // 4. Sensitive actions need a justification (recorded in the audit log).
  if (def.sensitive && !(opts.reason && opts.reason.trim().length >= 3)) return { allowed: false, reason: "REASON_REQUIRED" };

  return { allowed: true, sensitive: !!def.sensitive, viaRole: hit.roleKey };
}

/**
 * For list endpoints: the principal must hold `permission` at *some* scope;
 * the handler then filters results to the scopes it covers (branchesWith).
 */
export function authorizeAnywhere(p: Principal, permission: PermissionKey, opts: AuthorizeOptions = {}): Decision {
  const def = permissionDef(permission);
  const now = opts.now ?? new Date();
  const feature = PERMISSION_FEATURE[permission] ?? MODULE_FEATURE[def.module];
  if (feature && !p.features.has(feature)) return { allowed: false, reason: "FEATURE_DISABLED" };
  if (p.impersonatorId && IMPERSONATION_BLOCKED.has(permission)) return { allowed: false, reason: "IMPERSONATION_BLOCKED" };
  const hit = p.grants.find((g) => (!g.expiresAt || g.expiresAt > now) && g.permissions.has(permission));
  if (!hit) return { allowed: false, reason: "NOT_GRANTED" };
  if (def.sensitive && !(opts.reason && opts.reason.trim().length >= 3)) return { allowed: false, reason: "REASON_REQUIRED" };
  return { allowed: true, sensitive: !!def.sensitive, viaRole: hit.roleKey };
}

export class ForbiddenError extends Error {
  constructor(
    public readonly permission: PermissionKey,
    public readonly reason: DenyReason,
  ) {
    super(`Forbidden: ${permission} (${reason})`);
    this.name = "ForbiddenError";
  }
}

export function assertAuthorized(p: Principal, permission: PermissionKey, target: Target, opts?: AuthorizeOptions) {
  const d = authorize(p, permission, target, opts);
  if (!d.allowed) throw new ForbiddenError(permission, d.reason);
  return d;
}

/**
 * Does the principal *hold* `permission` over `target`? Ignores feature flags,
 * reasons and impersonation — this is for delegation checks ("you may only
 * grant what you have"), not for performing the action.
 */
export function holdsPermission(p: Principal, permission: PermissionKey, target: Target, now = new Date()): boolean {
  if (target.organizationId !== p.organizationId) return false;
  return p.grants.some((g) => (!g.expiresAt || g.expiresAt > now) && g.permissions.has(permission) && covers(g, target));
}

/**
 * Does the principal work at `target` at all — any live role there, whatever it
 * grants? For a staff member's own routine actions (clocking in, handover
 * notes) that every role at a branch may do.
 */
export function worksAt(p: Principal, target: Target, now = new Date()): boolean {
  if (target.organizationId !== p.organizationId) return false;
  return p.grants.some((g) => (!g.expiresAt || g.expiresAt > now) && covers(g, target));
}

/** Permissions from `wanted` the principal does NOT hold over `target` (empty = OK to delegate). */
export function missingForDelegation(p: Principal, wanted: Iterable<PermissionKey>, target: Target, now = new Date()): PermissionKey[] {
  return [...wanted].filter((k) => !holdsPermission(p, k, target, now));
}

/** Branch ids where the principal holds `permission` (for list filtering). null = every branch. */
export function branchesWith(p: Principal, permission: PermissionKey, brandOfBranch: (branchId: string) => string | undefined, allBranchIds: readonly string[], now = new Date()): string[] | null {
  const grants = p.grants.filter((g) => g.permissions.has(permission) && (!g.expiresAt || g.expiresAt > now));
  if (grants.some((g) => g.scope === "ORGANIZATION")) return null;
  return allBranchIds.filter((b) =>
    grants.some((g) => (g.scope === "BRANCH" && g.branchId === b) || (g.scope === "BRAND" && g.brandId === brandOfBranch(b))),
  );
}
