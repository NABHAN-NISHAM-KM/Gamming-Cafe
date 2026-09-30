import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { branchesWith, isPermissionKey, type PermissionKey, type Target } from "@arena/rbac";
import { hashSecret } from "../auth/crypto.js";
import { AuditService } from "../common/audit.service.js";
import { assertCanDelegate, authorizeFor, scopeTarget, type ScopeInput } from "../common/authz.js";
import { AnyStaff, RequirePermission, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const RoleGrant = z
  .object({
    roleId: z.uuid(),
    scope: z.enum(["ORGANIZATION", "BRAND", "BRANCH"]),
    brandId: z.uuid().nullish(),
    branchId: z.uuid().nullish(),
    expiresAt: z.coerce.date().nullish(),
  })
  .strict();

const Invite = z
  .object({
    email: z.email().max(254).transform((e) => e.toLowerCase()),
    displayName: z.string().min(2).max(80),
    employeeCode: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
    jobTitle: z.string().max(80).nullish(),
    homeBranchId: z.uuid().nullish(),
    // Used only when the email has no account yet. Email invitations replace this in the notifications phase.
    initialPassword: z.string().min(12).max(256),
    roles: z.array(RoleGrant).max(20).default([]),
  })
  .strict();

const Update = z
  .object({
    displayName: z.string().min(2).max(80),
    jobTitle: z.string().max(80).nullable(),
    homeBranchId: z.uuid().nullable(),
    status: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED"]),
    hourlyRate: z.number().nonnegative().nullable(),
  })
  .partial()
  .strict();

const Pin = z.object({ pin: z.string().regex(/^\d{4,8}$/) }).strict();

const PUBLIC_FIELDS = {
  id: true, employeeCode: true, displayName: true, jobTitle: true, status: true, homeBranchId: true,
  hiredAt: true, terminatedAt: true, createdAt: true,
  user: { select: { email: true } },
  employeeRoleAssignments: {
    select: { id: true, scope: true, brandId: true, branchId: true, expiresAt: true, role: { select: { id: true, key: true, name: true } } },
  },
} as const;

@Controller("employees")
export class EmployeesController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  private async homeTarget(homeBranchId: string | null | undefined): Promise<Target> {
    return homeBranchId ? scopeTarget({ scope: "BRANCH", branchId: homeBranchId }) : { organizationId: principal().organizationId };
  }

  private async rolePermissions(roleId: string): Promise<{ key: string; permissions: PermissionKey[] }> {
    const role = await tx().role.findUnique({ where: { id: roleId }, select: { key: true, rolePermissions: { select: { permissionKey: true } } } });
    if (!role) throw new NotFoundException({ error: "role_not_found" });
    return { key: role.key, permissions: role.rolePermissions.map((r) => r.permissionKey).filter(isPermissionKey) };
  }

  /** employee.assign_roles over the scope + anti-escalation on the role's permissions. */
  private async checkGrant(g: ScopeInput & { roleId: string }) {
    const target = await scopeTarget(g);
    authorizeFor("employee.assign_roles", target);
    const role = await this.rolePermissions(g.roleId);
    assertCanDelegate(role.permissions, target);
    return role;
  }

  /**
   * Suspending or terminating someone takes away everything they hold, so it
   * needs the same rights as revoking their roles would (an org admin can't
   * lock out the owner), and the last active owner can never be taken out.
   */
  private async checkCanDeactivate(employeeId: string) {
    const held = await tx().employeeRoleAssignment.findMany({
      where: { employeeId },
      select: { roleId: true, scope: true, brandId: true, branchId: true, role: { select: { key: true } } },
    });
    for (const a of held) assertCanDelegate((await this.rolePermissions(a.roleId)).permissions, await scopeTarget(a));
    if (held.some((a) => a.role.key === "org_owner" && a.scope === "ORGANIZATION")) {
      const others = await tx().employeeRoleAssignment.count({
        where: { scope: "ORGANIZATION", role: { key: "org_owner" }, employee: { status: "ACTIVE", id: { not: employeeId } } },
      });
      if (others === 0) throw new ConflictException({ error: "last_owner" });
    }
  }

  @RequirePermissionAnyScope("employee.view")
  @Get()
  async list() {
    const all = await tx().employee.findMany({ select: PUBLIC_FIELDS, orderBy: { displayName: "asc" } });
    const branches = await tx().branch.findMany({ select: { id: true, brandId: true } });
    const allowed = branchesWith(principal(), "employee.view", (id) => branches.find((b) => b.id === id)?.brandId, branches.map((b) => b.id));
    return allowed === null ? all : all.filter((e) => e.homeBranchId && allowed.includes(e.homeBranchId));
  }

  @RequirePermission("employee.view")
  @Get(":employeeId")
  async get(@Param("employeeId") employeeId: string) {
    const { pinHash, ...e } = await tx().employee.findUniqueOrThrow({ where: { id: employeeId }, select: { ...PUBLIC_FIELDS, pinHash: true } });
    return { ...e, hasPin: pinHash !== null };
  }

  /** Target = the new employee's home branch (branch managers hire for their own branch). */
  @AnyStaff()
  @Post()
  async invite(@Body(new ZodPipe(Invite)) body: z.infer<typeof Invite>) {
    authorizeFor("employee.manage", await this.homeTarget(body.homeBranchId));
    for (const g of body.roles) await this.checkGrant(g);

    const limit = principal().limits.MAX_EMPLOYEES;
    if (limit !== undefined && (await tx().employee.count({ where: { status: { in: ["INVITED", "ACTIVE"] } } })) >= limit) {
      throw new HttpException({ error: "plan_limit_reached", limit: "MAX_EMPLOYEES", max: limit }, 402);
    }
    if (await tx().employee.findFirst({ where: { employeeCode: body.employeeCode }, select: { id: true } })) {
      throw new ConflictException({ error: "employee_code_taken" });
    }

    // Users are global identities: link an existing account, never overwrite its password.
    const user =
      (await tx().user.findUnique({ where: { email: body.email }, select: { id: true } })) ??
      (await tx().user.create({
        data: { email: body.email, displayName: body.displayName, passwordHash: await hashSecret(body.initialPassword) },
        select: { id: true },
      }));
    if (await tx().employee.findFirst({ where: { userId: user.id }, select: { id: true } })) {
      throw new ConflictException({ error: "already_member" });
    }

    const employee = await tx().employee.create({
      data: {
        organizationId: orgId(),
        userId: user.id,
        employeeCode: body.employeeCode,
        displayName: body.displayName,
        jobTitle: body.jobTitle ?? null,
        homeBranchId: body.homeBranchId ?? null,
        status: "ACTIVE",
        hiredAt: new Date(),
      },
      select: { id: true },
    });
    for (const g of body.roles) {
      await tx().employeeRoleAssignment.create({
        data: { organizationId: orgId(), employeeId: employee.id, roleId: g.roleId, scope: g.scope, brandId: g.brandId ?? null, branchId: g.branchId ?? null, expiresAt: g.expiresAt ?? null, grantedById: principal().employeeId },
      });
    }
    const after = await tx().employee.findUniqueOrThrow({ where: { id: employee.id }, select: PUBLIC_FIELDS });
    await this.audit.record({ action: "employee.create", entityType: "Employee", entityId: employee.id, branchId: body.homeBranchId ?? null, after });
    return after;
  }

  @RequirePermission("employee.manage")
  @Patch(":employeeId")
  async update(@Param("employeeId") employeeId: string, @Body(new ZodPipe(Update)) body: z.infer<typeof Update>) {
    if (employeeId === principal().employeeId && body.status && body.status !== "ACTIVE") {
      throw new ForbiddenException({ error: "cannot_deactivate_self" });
    }
    if (body.status && body.status !== "ACTIVE") await this.checkCanDeactivate(employeeId);
    // Moving someone to another branch requires rights over the destination too.
    if (body.homeBranchId !== undefined) authorizeFor("employee.manage", await this.homeTarget(body.homeBranchId));
    const before = await tx().employee.findUniqueOrThrow({ where: { id: employeeId }, select: PUBLIC_FIELDS });
    const data: Record<string, unknown> = { ...body };
    if (body.status === "TERMINATED") data["terminatedAt"] = new Date();
    await tx().employee.update({ where: { id: employeeId }, data });
    const after = await tx().employee.findUniqueOrThrow({ where: { id: employeeId }, select: PUBLIC_FIELDS });
    await this.audit.record({ action: "employee.update", entityType: "Employee", entityId: employeeId, branchId: after.homeBranchId, before, after });
    return after;
  }

  @RequirePermission("employee.manage")
  @Post(":employeeId/pin")
  @HttpCode(204)
  async setPin(@Param("employeeId") employeeId: string, @Body(new ZodPipe(Pin)) body: z.infer<typeof Pin>) {
    await tx().employee.update({ where: { id: employeeId }, data: { pinHash: await hashSecret(body.pin) } });
    await this.audit.record({ action: "employee.set_pin", entityType: "Employee", entityId: employeeId });
  }

  @RequirePermission("employee.assign_roles")
  @Post(":employeeId/roles")
  async assignRole(@Param("employeeId") employeeId: string, @Body(new ZodPipe(RoleGrant)) body: z.infer<typeof RoleGrant>) {
    await this.checkGrant(body);
    const a = await tx().employeeRoleAssignment.create({
      data: { organizationId: orgId(), employeeId, roleId: body.roleId, scope: body.scope, brandId: body.brandId ?? null, branchId: body.branchId ?? null, expiresAt: body.expiresAt ?? null, grantedById: principal().employeeId },
      include: { role: { select: { key: true } } },
    });
    await this.audit.record({ action: "employee.assign_role", entityType: "EmployeeRoleAssignment", entityId: a.id, branchId: a.branchId, after: a });
    return a;
  }

  @RequirePermission("employee.assign_roles")
  @Delete(":employeeId/roles/:assignmentId")
  @HttpCode(204)
  async revokeRole(@Param("employeeId") employeeId: string, @Param("assignmentId") assignmentId: string) {
    const a = await tx().employeeRoleAssignment.findFirst({ where: { id: assignmentId, employeeId }, include: { role: { select: { key: true } } } });
    if (!a) throw new NotFoundException({ error: "not_found" });
    // You may only take away what you could have granted.
    await this.checkGrant(a);
    if (a.role.key === "org_owner" && a.scope === "ORGANIZATION") {
      const owners = await tx().employeeRoleAssignment.count({ where: { scope: "ORGANIZATION", role: { key: "org_owner" }, employee: { status: "ACTIVE" } } });
      if (owners <= 1) throw new ConflictException({ error: "last_owner" });
    }
    await tx().employeeRoleAssignment.delete({ where: { id: assignmentId } });
    await this.audit.record({ action: "employee.revoke_role", entityType: "EmployeeRoleAssignment", entityId: assignmentId, branchId: a.branchId, before: a });
  }
}
