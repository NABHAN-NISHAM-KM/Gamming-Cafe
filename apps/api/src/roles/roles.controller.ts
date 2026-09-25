import { Body, ConflictException, Controller, ForbiddenException, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { isPermissionKey, type PermissionKey } from "@arena/rbac";
import { AuditService } from "../common/audit.service.js";
import { assertCanDelegate } from "../common/authz.js";
import { RequirePermission, RequirePermissionAnyScope } from "../common/decorators.js";
import { principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const permissionKey = z.string().refine(isPermissionKey, "unknown permission") as unknown as z.ZodType<PermissionKey>;

const CreateRole = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
    name: z.string().min(2).max(80),
    description: z.string().max(300).optional(),
    permissions: z.array(permissionKey).min(1).max(500),
  })
  .strict();
const UpdateRole = CreateRole.omit({ key: true }).partial().strict();

const withPerms = { rolePermissions: { select: { permissionKey: true } } } as const;
const shape = (r: { rolePermissions: { permissionKey: string }[] } & Record<string, unknown>) => {
  const { rolePermissions, ...rest } = r;
  return { ...rest, permissions: rolePermissions.map((p) => p.permissionKey).sort() };
};

@Controller("roles")
export class RolesController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Platform templates (organizationId = null) + this org's custom roles. */
  @RequirePermissionAnyScope("employee.view")
  @Get()
  async list() {
    const roles = await tx().role.findMany({ include: withPerms, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
    return roles.map(shape);
  }

  @RequirePermission("employee.roles_manage")
  @Post()
  async create(@Body(new ZodPipe(CreateRole)) body: z.infer<typeof CreateRole>) {
    const perms = [...new Set(body.permissions)];
    assertCanDelegate(perms, { organizationId: principal().organizationId });
    if (await tx().role.findFirst({ where: { key: body.key, organizationId: principal().organizationId }, select: { id: true } })) {
      throw new ConflictException({ error: "role_key_taken" });
    }
    const role = await tx().role.create({
      data: {
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        rolePermissions: { create: perms.map((permissionKey) => ({ permissionKey })) },
      },
      include: withPerms,
    });
    await this.audit.record({ action: "role.create", entityType: "Role", entityId: role.id, after: shape(role) });
    return shape(role);
  }

  @RequirePermission("employee.roles_manage")
  @Patch(":roleId")
  async update(@Param("roleId") roleId: string, @Body(new ZodPipe(UpdateRole)) body: z.infer<typeof UpdateRole>) {
    const before = await tx().role.findUniqueOrThrow({ where: { id: roleId }, include: withPerms });
    if (before.organizationId === null || before.isSystem) throw new ForbiddenException({ error: "system_role_readonly" });
    if (body.permissions) assertCanDelegate(new Set(body.permissions), { organizationId: principal().organizationId });

    await tx().role.update({ where: { id: roleId }, data: { name: body.name, description: body.description } });
    if (body.permissions) {
      await tx().rolePermission.deleteMany({ where: { roleId } });
      await tx().rolePermission.createMany({ data: [...new Set(body.permissions)].map((permissionKey) => ({ roleId, permissionKey })) });
    }
    const after = await tx().role.findUniqueOrThrow({ where: { id: roleId }, include: withPerms });
    await this.audit.record({ action: "role.update", entityType: "Role", entityId: roleId, before: shape(before), after: shape(after) });
    return shape(after);
  }
}
