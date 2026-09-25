import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const pct = z.number().min(0).max(100);
const Tier = z
  .object({
    code: z.string().regex(/^[A-Z0-9_]{2,20}$/),
    name: z.string().min(1).max(40),
    rank: z.number().int().min(0).max(100),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    price: z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,7}(\.\d{1,3})?$/.test(v), "invalid price").nullish(),
    durationDays: z.number().int().min(1).max(730).nullish(),
    gamingDiscountPct: pct.default(0),
    restaurantDiscountPct: pct.default(0),
    tournamentDiscountPct: pct.default(0),
    bonusMinutesMonthly: z.number().int().min(0).max(10_000).default(0),
    priorityBooking: z.boolean().default(false),
    bookingWindowDays: z.number().int().min(1).max(90).default(7),
    isActive: z.boolean().default(true),
  })
  .strict();

/** Membership tiers (Silver, Gold…): what they cost and what they give. */
@Controller("membership-tiers")
export class TiersController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @RequirePermissionAnyScope("membership.view")
  @Get()
  async list() {
    const tiers = await tx().membershipTier.findMany({ orderBy: { rank: "asc" }, include: { _count: { select: { customers: true } } } });
    return tiers.map(({ _count, ...t }) => ({ ...t, members: _count.customers }));
  }

  @AnyStaff()
  @Post()
  async create(@Body(new ZodPipe(Tier)) body: z.infer<typeof Tier>) {
    authorizeFor("membership.manage", { organizationId: orgId() });
    this.check(body);
    if (await tx().membershipTier.findFirst({ where: { code: body.code } })) throw new ConflictException({ error: "code_taken" });
    const tier = await tx().membershipTier.create({ data: { ...body, organizationId: orgId() } });
    await this.audit.record({ action: "membership.tier.create", entityType: "MembershipTier", entityId: tier.id, after: tier });
    return tier;
  }

  @AnyStaff()
  @Patch(":tierId")
  async update(@Param("tierId") tierId: string, @Body(new ZodPipe(Tier.partial())) body: Partial<z.infer<typeof Tier>>) {
    authorizeFor("membership.manage", { organizationId: orgId() });
    const before = await tx().membershipTier.findUnique({ where: { id: tierId } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    this.check({ ...before, ...body, price: body.price !== undefined ? body.price : before.price?.toString() ?? null });
    const after = await tx().membershipTier.update({ where: { id: tierId }, data: body });
    await this.audit.record({ action: "membership.tier.update", entityType: "MembershipTier", entityId: tierId, before, after });
    return after;
  }

  private check(t: { price?: string | null; durationDays?: number | null }) {
    if (t.price != null && !t.durationDays) throw new ConflictException({ error: "sold_tier_needs_duration", hint: "A tier with a price must say how many days it lasts." });
  }
}
