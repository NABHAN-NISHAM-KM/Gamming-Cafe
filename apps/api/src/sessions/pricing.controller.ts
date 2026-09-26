import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const money = z.union([z.number(), z.string()]).transform((v) => String(v)).refine((v) => /^\d{1,13}(\.\d{1,4})?$/.test(v), "invalid amount");
const Window = z.object({ days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).min(1), from: hhmm, to: hhmm });

const PlanBody = z
  .object({
    name: z.string().min(2).max(80),
    stationClass: z.enum(["PC", "CONSOLE", "VR", "SIMULATOR", "INTERNET", "PRIVATE_ROOM"]),
    billingMode: z.enum(["PER_MINUTE", "PER_HOUR", "FIXED_DURATION", "DAY_PASS", "NIGHT_PASS", "PACKAGE"]),
    paymentTiming: z.enum(["PREPAID", "POSTPAID"]).default("PREPAID"),
    rate: money,
    currency: z.string().length(3).toUpperCase().optional(),
    branchId: z.uuid().nullish(),
    zoneId: z.uuid().nullish(),
    membershipTierId: z.uuid().nullish(),
    minMinutes: z.number().int().min(0).max(1440).default(0),
    includedPlayers: z.number().int().min(1).max(16).default(1),
    extraPlayerRate: money.nullish(),
    roundingMinutes: z.number().int().min(1).max(120).default(1),
    graceMinutes: z.number().int().min(0).max(60).default(0),
    schedule: z.array(Window).max(20).default([]),
    passStartTime: hhmm.nullish(),
    passEndTime: hhmm.nullish(),
    priority: z.number().int().min(-100).max(100).default(0),
    validFrom: z.coerce.date().nullish(),
    validTo: z.coerce.date().nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();

const PackageBody = z
  .object({
    name: z.string().min(1).max(60),
    durationMinutes: z.number().int().min(1).max(1440),
    price: money,
    bonusMinutes: z.number().int().min(0).max(600).default(0),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

const withPackages = { pricingPackages: { orderBy: { sortOrder: "asc" as const } }, branch: { select: { code: true, name: true } }, zone: { select: { name: true } } };

@Controller("pricing-plans")
export class PricingController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Rate cards affecting a branch are managed by whoever holds pricing.manage for that branch; org-wide ones need org scope. */
  private async authorizeScope(branchId: string | null | undefined, zoneId: string | null | undefined) {
    if (zoneId) {
      const z = await tx().zone.findUnique({ where: { id: zoneId }, select: { branchId: true } });
      if (!z || (branchId && z.branchId !== branchId)) throw new NotFoundException({ error: "zone_not_found" });
      branchId = z.branchId;
    }
    if (!branchId) return authorizeFor("pricing.manage", { organizationId: orgId() }), null;
    const b = await tx().branch.findUnique({ where: { id: branchId }, select: { brandId: true } });
    if (!b) throw new NotFoundException({ error: "branch_not_found" });
    authorizeFor("pricing.manage", { organizationId: orgId(), brandId: b.brandId, branchId });
    return branchId;
  }

  private validate(p: Partial<z.infer<typeof PlanBody>>) {
    if ((p.billingMode === "NIGHT_PASS" || p.billingMode === "DAY_PASS") && !p.passEndTime) throw new ConflictException({ error: "pass_needs_end_time" });
    if (p.paymentTiming === "POSTPAID" && p.billingMode && !["PER_MINUTE", "PER_HOUR"].includes(p.billingMode)) throw new ConflictException({ error: "postpaid_needs_time_rate" });
  }

  @RequirePermissionAnyScope("pricing.view")
  @Get()
  list() {
    return tx().pricingPlan.findMany({ include: withPackages, orderBy: [{ stationClass: "asc" }, { priority: "desc" }, { name: "asc" }] });
  }

  @AnyStaff()
  @Post()
  async create(@Body(new ZodPipe(PlanBody)) body: z.infer<typeof PlanBody>) {
    this.validate(body);
    const branchId = await this.authorizeScope(body.branchId, body.zoneId);
    const org = await tx().organization.findFirstOrThrow({ select: { defaultCurrency: true } });
    const plan = await tx().pricingPlan.create({
      data: { ...body, branchId, currency: body.currency ?? org.defaultCurrency, schedule: body.schedule as object, organizationId: orgId() },
      include: withPackages,
    });
    await this.audit.record({ action: "pricing.plan.create", entityType: "PricingPlan", entityId: plan.id, branchId, after: plan });
    return plan;
  }

  @AnyStaff()
  @Patch(":planId")
  async update(@Param("planId") planId: string, @Body(new ZodPipe(PlanBody.partial())) body: Partial<z.infer<typeof PlanBody>>) {
    const before = await tx().pricingPlan.findUnique({ where: { id: planId }, include: withPackages });
    if (!before) throw new NotFoundException({ error: "not_found" });
    await this.authorizeScope(before.branchId, before.zoneId);
    if (body.branchId !== undefined || body.zoneId !== undefined) await this.authorizeScope(body.branchId ?? before.branchId, body.zoneId ?? before.zoneId);
    this.validate({ ...before, ...body, passEndTime: body.passEndTime ?? before.passEndTime } as any);
    const after = await tx().pricingPlan.update({ where: { id: planId }, data: { ...body, schedule: body.schedule as object | undefined }, include: withPackages });
    await this.audit.record({ action: "pricing.plan.update", entityType: "PricingPlan", entityId: planId, branchId: after.branchId, before, after });
    return after;
  }

  @AnyStaff()
  @Post(":planId/packages")
  async addPackage(@Param("planId") planId: string, @Body(new ZodPipe(PackageBody)) body: z.infer<typeof PackageBody>) {
    const plan = await tx().pricingPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException({ error: "not_found" });
    await this.authorizeScope(plan.branchId, plan.zoneId);
    const pkg = await tx().pricingPackage.create({ data: { ...body, organizationId: orgId(), pricingPlanId: planId } });
    await this.audit.record({ action: "pricing.package.create", entityType: "PricingPackage", entityId: pkg.id, branchId: plan.branchId, after: pkg });
    return pkg;
  }

  @AnyStaff()
  @Patch(":planId/packages/:packageId")
  async updatePackage(@Param("planId") planId: string, @Param("packageId") packageId: string, @Body(new ZodPipe(PackageBody.partial())) body: Partial<z.infer<typeof PackageBody>>) {
    const plan = await tx().pricingPlan.findUnique({ where: { id: planId } });
    const before = await tx().pricingPackage.findFirst({ where: { id: packageId, pricingPlanId: planId } });
    if (!plan || !before) throw new NotFoundException({ error: "not_found" });
    await this.authorizeScope(plan.branchId, plan.zoneId);
    const after = await tx().pricingPackage.update({ where: { id: packageId }, data: body });
    await this.audit.record({ action: "pricing.package.update", entityType: "PricingPackage", entityId: packageId, branchId: plan.branchId, before, after });
    return after;
  }
}
