import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { Conditions, Effects } from "./engine.js";
import { PromotionsService } from "./promotions.service.js";

const TYPES = ["PROMO_CODE", "HAPPY_HOUR", "BUY_X_GET_Y", "BUNDLE", "PACKAGE", "BIRTHDAY", "WEEKEND", "REFERRAL", "FIRST_VISIT", "AUTOMATIC_DISCOUNT"] as const;
const Promo = z
  .object({
    name: z.string().min(2).max(80),
    description: z.string().max(300).nullish(),
    type: z.enum(TYPES),
    conditions: Conditions.default({}),
    effects: Effects,
    priority: z.number().int().min(-100).max(100).default(0),
    isStackable: z.boolean().default(false),
    requiresCode: z.boolean().default(false),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    totalUsageLimit: z.number().int().min(1).nullish(),
    perCustomerLimit: z.number().int().min(1).nullish(),
    budgetAmount: z.number().gt(0).nullish(),
  })
  .strict();
const Status = z.object({ status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]) }).strict();
const Codes = z
  .object({ count: z.number().int().min(1).max(1000).default(1), prefix: z.string().regex(/^[A-Za-z0-9]{0,8}$/).optional(), code: z.string().regex(/^[A-Za-z0-9-]{3,40}$/).nullish(), maxUses: z.number().int().min(1).nullish(), expiresAt: z.coerce.date().nullish(), customerId: z.uuid().nullish() })
  .strict();
const Evaluate = z
  .object({
    branchId: z.uuid(), customerId: z.uuid().nullish(), code: z.string().max(40).nullish(),
    gaming: z.object({ amount: z.number().min(0), minutes: z.number().int().min(1).nullable() }).strict().nullish(),
  })
  .strict();

const org = () => ({ organizationId: orgId() });

/** Promotions & promo codes (organization-wide). Changing them is sensitive: a reason is required. */
@Controller()
export class PromotionsController {
  constructor(
    @Inject(PromotionsService) private readonly svc: PromotionsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermissionAnyScope("promotion.view")
  @Get("promotions")
  async list(@Query("status") status?: string) {
    const rows = await tx().promotion.findMany({
      // NULL NOT LIKE … is NULL in SQL, so null descriptions must be let through explicitly.
      where: { OR: [{ description: null }, { description: { not: { startsWith: "reward:" } } }], ...(status && /^[A-Z]{4,10}$/.test(status) ? { status: status as never } : {}) },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { promoCodes: true, promotionRedemptions: true } } },
    });
    return rows.map(({ _count, ...p }) => ({ ...p, codes: _count.promoCodes, redemptions: _count.promotionRedemptions }));
  }

  @RequirePermissionAnyScope("promotion.view")
  @Get("promotions/:id")
  get(@Param("id") id: string) {
    return this.svc.view(tx(), id);
  }

  @AnyStaff()
  @Post("promotions")
  async create(@Body(new ZodPipe(Promo)) body: z.infer<typeof Promo>) {
    authorizeFor("promotion.manage", org());
    const p = await tx().promotion.create({
      data: { ...body, organizationId: orgId(), conditions: body.conditions as Prisma.InputJsonValue, effects: body.effects as Prisma.InputJsonValue, budgetAmount: body.budgetAmount ?? null, createdById: principal().employeeId, status: "DRAFT" },
    });
    await this.audit.record({ action: "promotion.create", entityType: "Promotion", entityId: p.id, after: body });
    return p;
  }

  @AnyStaff()
  @Patch("promotions/:id")
  async edit(@Param("id") id: string, @Body(new ZodPipe(Promo.partial())) body: Partial<z.infer<typeof Promo>>) {
    authorizeFor("promotion.manage", org());
    const before = await tx().promotion.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: "promotion_not_found" });
    const p = await tx().promotion.update({
      where: { id },
      data: { ...body, ...(body.conditions ? { conditions: body.conditions as Prisma.InputJsonValue } : {}), ...(body.effects ? { effects: body.effects as Prisma.InputJsonValue } : {}) },
    });
    await this.audit.record({ action: "promotion.update", entityType: "Promotion", entityId: id, before, after: body });
    return p;
  }

  @AnyStaff()
  @Post("promotions/:id/status")
  @HttpCode(200)
  async status(@Param("id") id: string, @Body(new ZodPipe(Status)) body: z.infer<typeof Status>) {
    authorizeFor("promotion.manage", org());
    const p = await tx().promotion.update({ where: { id }, data: { status: body.status } });
    await this.audit.record({ action: `promotion.${body.status.toLowerCase()}`, entityType: "Promotion", entityId: id });
    return p;
  }

  @AnyStaff()
  @Post("promotions/:id/codes")
  async codes(@Param("id") id: string, @Body(new ZodPipe(Codes)) body: z.infer<typeof Codes>) {
    authorizeFor("promotion.manage", org());
    const codes = await this.svc.generateCodes(tx(), id, { count: body.count, prefix: body.prefix, code: body.code ?? null, maxUses: body.maxUses ?? null, expiresAt: body.expiresAt ?? null, customerId: body.customerId ?? null });
    await tx().promotion.update({ where: { id }, data: { requiresCode: true } });
    await this.audit.record({ action: "promotion.codes", entityType: "Promotion", entityId: id, after: { count: codes.length } });
    return { codes };
  }

  /** "What would apply?" — for the till before starting a session. */
  @RequirePermissionAnyScope("promotion.view")
  @Post("promotions/evaluate")
  @HttpCode(200)
  async evaluate(@Body(new ZodPipe(Evaluate)) body: z.infer<typeof Evaluate>) {
    const unit = 2;
    const r = await this.svc.evaluate(tx(), { branchId: body.branchId, customerId: body.customerId ?? null, gaming: body.gaming ? { amountMinor: Math.round(body.gaming.amount * 10 ** unit), minutes: body.gaming.minutes } : null }, body.code ?? null);
    return { applied: r.applied, discount: (r.discountMinor / 10 ** r.minorUnit).toFixed(r.minorUnit), bonusMinutes: r.bonusMinutes };
  }
}
