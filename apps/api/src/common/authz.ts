import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { assertAuthorized, missingForDelegation, type PermissionKey, type Target } from "@arena/rbac";
import { principal, state, tx } from "./request-state.js";

/** In-handler authorization for targets that come from validated body input (e.g. homeBranchId). */
export function authorizeFor(permission: PermissionKey, target: Target) {
  const s = state();
  const d = assertAuthorized(s.principal, permission, target, { reason: s.reason });
  s.decision ??= d;
  return d;
}

export type ScopeInput = { scope: "ORGANIZATION" | "BRAND" | "BRANCH"; brandId?: string | null; branchId?: string | null };

/** Turns a role-assignment scope into an authorization target (validated under RLS). */
export async function scopeTarget(s: ScopeInput): Promise<Target> {
  const organizationId = principal().organizationId;
  if (s.scope === "ORGANIZATION") {
    if (s.brandId || s.branchId) throw new ForbiddenException({ error: "invalid_scope" });
    return { organizationId };
  }
  if (s.scope === "BRAND") {
    if (!s.brandId || s.branchId) throw new ForbiddenException({ error: "invalid_scope" });
    const b = await tx().brand.findUnique({ where: { id: s.brandId }, select: { id: true } });
    if (!b) throw new NotFoundException({ error: "brand_not_found" });
    return { organizationId, brandId: b.id };
  }
  if (!s.branchId || s.brandId) throw new ForbiddenException({ error: "invalid_scope" });
  const br = await tx().branch.findUnique({ where: { id: s.branchId }, select: { id: true, brandId: true } });
  if (!br) throw new NotFoundException({ error: "branch_not_found" });
  return { organizationId, brandId: br.brandId, branchId: br.id };
}

/** Anti-escalation: you may only delegate permissions you hold over the same target. */
export function assertCanDelegate(permissions: Iterable<PermissionKey>, target: Target) {
  const missing = missingForDelegation(principal(), permissions, target);
  if (missing.length) throw new ForbiddenException({ error: "privilege_escalation", missing });
}
