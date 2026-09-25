import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { TenantTx } from "@arena/db";
import { resolveFeatures } from "@arena/contracts";
import { isPermissionKey, type Grant, type PermissionKey } from "@arena/rbac";
import type { StaffPrincipal } from "../common/request-state.js";

const BLOCKED_ORG_STATUS = new Set(["SUSPENDED", "CANCELLED"]);

/**
 * Builds the authorization principal for a staff member, inside the tenant
 * transaction (so RLS guarantees we only ever read this org's rows).
 */
@Injectable()
export class PrincipalService {
  async load(tx: TenantTx, claims: { sub: string; org: string; emp: string; sid: string; imp?: string }): Promise<StaffPrincipal> {
    // Logout / reuse detection revokes the whole refresh family; access tokens
    // of that session die immediately instead of at expiry.
    const live = await tx.refreshToken.findFirst({
      where: { familyId: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!live) throw new UnauthorizedException({ error: "session_revoked" });

    // Sequential on purpose: an interactive transaction owns one connection.
    const org = await tx.organization.findFirst({ select: { status: true } });
    const employee = await tx.employee.findUnique({
        where: { id: claims.emp },
        select: {
          id: true,
          userId: true,
          status: true,
          displayName: true,
          employeeRoleAssignments: {
            select: {
              scope: true,
              brandId: true,
              branchId: true,
              expiresAt: true,
              role: { select: { key: true, rolePermissions: { select: { permissionKey: true } } } },
            },
          },
        },
      });
    const subscription = await tx.subscription.findFirst({
        where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
        orderBy: { currentPeriodEnd: "desc" },
        select: { maxBranches: true, maxDevices: true, maxEmployees: true, plan: { select: { features: true, maxBranches: true, maxDevices: true, maxEmployees: true } } },
      });
    const overrides = await tx.organizationFeature.findMany({ select: { featureKey: true, enabled: true, limitValue: true } });

    if (!org || BLOCKED_ORG_STATUS.has(org.status)) throw new ForbiddenException({ error: "organization_inactive" });
    if (!employee || employee.userId !== claims.sub || employee.status !== "ACTIVE") {
      throw new ForbiddenException({ error: "employee_inactive" });
    }

    const { enabled, limits } = resolveFeatures(subscription?.plan.features ?? [], overrides);
    const pick = (org?: number | null, plan?: number | null) => org ?? plan ?? undefined;
    const planLimits = {
      MAX_BRANCHES: pick(subscription?.maxBranches, subscription?.plan.maxBranches),
      MAX_DEVICES: pick(subscription?.maxDevices, subscription?.plan.maxDevices),
      MAX_EMPLOYEES: pick(subscription?.maxEmployees, subscription?.plan.maxEmployees),
    };

    const grants: Grant[] = employee.employeeRoleAssignments.map((a) => ({
      roleKey: a.role.key,
      scope: a.scope,
      brandId: a.brandId,
      branchId: a.branchId,
      expiresAt: a.expiresAt,
      permissions: new Set(a.role.rolePermissions.map((rp) => rp.permissionKey).filter(isPermissionKey) as PermissionKey[]),
    }));

    return {
      organizationId: claims.org,
      userId: claims.sub,
      employeeId: employee.id,
      displayName: employee.displayName,
      grants,
      features: enabled,
      limits: { ...Object.fromEntries(Object.entries(planLimits).filter(([, v]) => v !== undefined)), ...limits },
      impersonatorId: claims.imp ?? null,
    };
  }
}
