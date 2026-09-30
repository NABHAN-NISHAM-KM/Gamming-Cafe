import { Body, ConflictException, Controller, Get, HttpException, Inject, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { branchesWith } from "@arena/rbac";
import { AuditService } from "../common/audit.service.js";
import { AnyStaff, RequirePermission, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const Hours = z.partialRecord(
  z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  z.array(z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })).max(4),
);

const CreateBranch = z
  .object({
    brandId: z.uuid(),
    code: z.string().regex(/^[A-Z0-9]{2,8}$/, "2–8 uppercase letters/digits, e.g. DXB1"),
    name: z.string().min(2).max(120),
    countryCode: z.string().length(2).toUpperCase(),
    currency: z.string().length(3).toUpperCase(),
    timezone: z.string().min(3).max(64),
    locale: z.string().min(2).max(10).default("en"),
    addressLine1: z.string().max(200).nullish(),
    addressLine2: z.string().max(200).nullish(),
    city: z.string().max(100).nullish(),
    region: z.string().max(100).nullish(),
    postalCode: z.string().max(20).nullish(),
    phone: z.string().max(32).nullish(),
    email: z.email().nullish(),
    taxProfileId: z.uuid().nullish(),
    openingHours: Hours.default({}),
    allowedIpCidrs: z.array(z.string().max(64)).max(50).default([]),
  })
  .strict();

const UpdateBranch = CreateBranch.omit({ brandId: true, code: true })
  .extend({ status: z.enum(["SETUP", "OPEN", "TEMPORARILY_CLOSED", "CLOSED"]) })
  .partial()
  .strict();

@Controller("branches")
export class BranchesController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Lists only branches the caller may view (org grant → all; branch/brand grants → those). */
  /** Every screen's branch picker needs this, so any staff member sees at least the branches they're assigned to. */
  @AnyStaff()
  @Get()
  async list() {
    const all = await tx().branch.findMany({ orderBy: [{ name: "asc" }], include: { brand: { select: { name: true } } } });
    const p = principal();
    const brandOf = (id: string) => all.find((b) => b.id === id)?.brandId;
    const allowed = branchesWith(p, "branch.view", brandOf, all.map((b) => b.id));
    if (allowed === null) return all;
    const now = new Date();
    const live = p.grants.filter((g) => !g.expiresAt || g.expiresAt > now);
    if (live.some((g) => g.scope === "ORGANIZATION")) return all;
    return all.filter((b) => allowed.includes(b.id) || live.some((g) => (g.scope === "BRANCH" && g.branchId === b.id) || (g.scope === "BRAND" && g.brandId === b.brandId)));
  }

  @RequirePermission("branch.view")
  @Get(":branchId")
  get(@Param("branchId") branchId: string) {
    return tx().branch.findUniqueOrThrow({
      where: { id: branchId },
      include: { brand: { select: { id: true, name: true } }, zones: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
    });
  }

  @RequirePermission("branch.manage")
  @Post()
  async create(@Body(new ZodPipe(CreateBranch)) body: z.infer<typeof CreateBranch>) {
    const limit = principal().limits.MAX_BRANCHES;
    if (limit !== undefined) {
      const count = await tx().branch.count({ where: { status: { not: "CLOSED" } } });
      if (count >= limit) throw new HttpException({ error: "plan_limit_reached", limit: "MAX_BRANCHES", max: limit }, 402);
    }
    const exists = await tx().branch.findFirst({ where: { code: body.code }, select: { id: true } });
    if (exists) throw new ConflictException({ error: "branch_code_taken" });

    const branch = await tx().branch.create({ data: { ...body, organizationId: orgId() } });
    await this.audit.record({ action: "branch.create", entityType: "Branch", entityId: branch.id, branchId: branch.id, after: branch });
    return branch;
  }

  @RequirePermission("branch.manage")
  @Patch(":branchId")
  async update(@Param("branchId") branchId: string, @Body(new ZodPipe(UpdateBranch)) body: z.infer<typeof UpdateBranch>) {
    const before = await tx().branch.findUniqueOrThrow({ where: { id: branchId } });
    const after = await tx().branch.update({ where: { id: branchId }, data: body });
    await this.audit.record({ action: "branch.update", entityType: "Branch", entityId: branchId, branchId, before, after });
    return after;
  }
}
