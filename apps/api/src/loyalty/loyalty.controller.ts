import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { LoyaltyService, RewardValue, type RewardKind } from "./loyalty.service.js";

const Rule = z
  .object({
    source: z.enum(["GAMING", "RESTAURANT", "BOOKING", "TOURNAMENT", "TOPUP", "REFERRAL", "BIRTHDAY"]),
    unit: z.enum(["CURRENCY", "MINUTE", "EVENT"]),
    pointsPerUnit: z.number().min(0).max(10_000),
    branchIds: z.array(z.uuid()).max(50).default([]),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((r) => !(r.unit === "MINUTE" && r.source !== "GAMING"), "Per-minute points are for gaming only")
  .refine((r) => !(r.unit === "EVENT" && ["GAMING", "RESTAURANT", "TOPUP"].includes(r.source)) && !(r.unit !== "EVENT" && ["BOOKING", "TOURNAMENT", "REFERRAL", "BIRTHDAY"].includes(r.source)), "That source is earned per event (or per spend) only");
const Reward = z
  .object({
    name: z.string().min(2).max(80),
    description: z.string().max(300).nullish(),
    imageUrl: z.url().max(500).nullish(),
    costPoints: z.number().int().min(1).max(1_000_000),
    rewardType: z.enum(Object.keys(RewardValue) as [RewardKind, ...RewardKind[]]),
    value: z.record(z.string(), z.unknown()),
    stock: z.number().int().min(0).nullish(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((r, ctx) => {
    const ok = RewardValue[r.rewardType].safeParse(r.value);
    if (!ok.success) ctx.addIssue({ code: "custom", message: `value doesn't fit ${r.rewardType}`, path: ["value"] });
  });
const Adjust = z.object({ points: z.number().int().min(-1_000_000).max(1_000_000).refine((x) => x !== 0), reason: z.string().min(3).max(200), idempotencyKey: z.string().min(8).max(100) }).strict();
const Redeem = z.object({ rewardId: z.uuid(), idempotencyKey: z.string().min(8).max(100) }).strict();

const org = () => ({ organizationId: orgId() });
const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });

/** Loyalty rules and rewards (organization-wide), and a customer's points. */
@Controller()
export class LoyaltyController {
  constructor(
    @Inject(LoyaltyService) private readonly svc: LoyaltyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermissionAnyScope("loyalty.view")
  @Get("loyalty/rules")
  rules() {
    return tx().loyaltyRule.findMany({ orderBy: [{ source: "asc" }, { createdAt: "asc" }] });
  }

  @AnyStaff()
  @Post("loyalty/rules")
  async addRule(@Body(new ZodPipe(Rule)) body: z.infer<typeof Rule>) {
    authorizeFor("loyalty.manage", org());
    const r = await tx().loyaltyRule.create({ data: { ...body, organizationId: orgId() } });
    await this.audit.record({ action: "loyalty.rule.create", entityType: "LoyaltyRule", entityId: r.id, after: body });
    return r;
  }

  @AnyStaff()
  @Patch("loyalty/rules/:id")
  async editRule(@Param("id") id: string, @Body(new ZodPipe(z.object({ pointsPerUnit: z.number().min(0).max(10_000), isActive: z.boolean(), branchIds: z.array(z.uuid()).max(50) }).partial().strict())) body: { pointsPerUnit?: number; isActive?: boolean; branchIds?: string[] }) {
    authorizeFor("loyalty.manage", org());
    const r = await tx().loyaltyRule.update({ where: { id }, data: body });
    await this.audit.record({ action: "loyalty.rule.update", entityType: "LoyaltyRule", entityId: id, after: body });
    return r;
  }

  @RequirePermissionAnyScope("loyalty.view")
  @Get("loyalty/rewards")
  rewards() {
    return tx().loyaltyReward.findMany({ orderBy: [{ isActive: "desc" }, { costPoints: "asc" }] });
  }

  @AnyStaff()
  @Post("loyalty/rewards")
  async addReward(@Body(new ZodPipe(Reward)) body: z.infer<typeof Reward>) {
    authorizeFor("loyalty.manage", org());
    const r = await tx().loyaltyReward.create({ data: { ...body, value: body.value as Prisma.InputJsonValue, organizationId: orgId() } });
    await this.audit.record({ action: "loyalty.reward.create", entityType: "LoyaltyReward", entityId: r.id, after: body });
    return r;
  }

  @AnyStaff()
  @Patch("loyalty/rewards/:id")
  async editReward(@Param("id") id: string, @Body(new ZodPipe(z.object({ name: z.string().min(2).max(80), description: z.string().max(300).nullable(), costPoints: z.number().int().min(1), stock: z.number().int().min(0).nullable(), isActive: z.boolean() }).partial().strict())) body: Record<string, unknown>) {
    authorizeFor("loyalty.manage", org());
    if (!(await tx().loyaltyReward.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException({ error: "reward_not_found" });
    const r = await tx().loyaltyReward.update({ where: { id }, data: body });
    await this.audit.record({ action: "loyalty.reward.update", entityType: "LoyaltyReward", entityId: id, after: body });
    return r;
  }

  @RequirePermissionAnyScope("customer.view")
  @Get("customers/:id/loyalty")
  summary(@Param("id") id: string) {
    return this.svc.summary(tx(), id);
  }

  /** Sensitive: a reason is required and kept in the audit log. */
  @RequirePermissionAnyScope("customer.adjust_points")
  @Post("customers/:id/loyalty/adjust")
  @HttpCode(200)
  adjust(@Param("id") id: string, @Body(new ZodPipe(Adjust)) body: z.infer<typeof Adjust>) {
    return this.svc.adjust(tx(), id, body.points, body.reason, principal().employeeId, body.idempotencyKey);
  }

  @RequirePermissionAnyScope("loyalty.redeem")
  @Post("customers/:id/loyalty/redeem")
  @HttpCode(200)
  redeem(@Param("id") id: string, @Body(new ZodPipe(Redeem)) body: z.infer<typeof Redeem>) {
    return this.svc.redeem(tx(), id, body.rewardId, me(), body.idempotencyKey);
  }
}
