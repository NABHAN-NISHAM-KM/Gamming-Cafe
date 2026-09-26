import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CrmService } from "./crm.service.js";
import { SegmentRules } from "./segments.js";

const Segment = z.object({ name: z.string().min(2).max(80), kind: z.enum(["STATIC", "DYNAMIC"]), rules: SegmentRules.default({}) }).strict();
const Members = z.object({ add: z.array(z.uuid()).max(1000).default([]), remove: z.array(z.uuid()).max(1000).default([]) }).strict();
const Campaign = z
  .object({
    name: z.string().min(2).max(80),
    channel: z.enum(["IN_APP", "SHELL", "EMAIL", "SMS", "WHATSAPP", "PUSH"]),
    segmentId: z.uuid().nullish(),
    promotionId: z.uuid().nullish(),
    subject: z.string().max(120).nullish(),
    body: z.string().min(1).max(1000),
    scheduledAt: z.coerce.date().nullish(),
  })
  .strict();

const org = () => ({ organizationId: orgId() });

/** Segments & campaigns (organization-wide). Sending is sensitive: a reason is required. */
@Controller()
export class CrmController {
  constructor(
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermissionAnyScope("crm.view")
  @Get("segments")
  async segments() {
    await this.crm.ensureBuiltIns(tx());
    return tx().customerSegment.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] });
  }

  @RequirePermissionAnyScope("crm.view")
  @Get("segments/:id/members")
  async members(@Param("id") id: string) {
    const rows = await tx().customerSegmentMember.findMany({ where: { segmentId: id }, take: 500, include: { customer: { select: { id: true, displayName: true, username: true, marketingConsent: true, loyaltyPoints: true, lastVisitAt: true } } }, orderBy: { addedAt: "desc" } });
    return rows.map((r) => r.customer);
  }

  @AnyStaff()
  @Post("segments")
  async addSegment(@Body(new ZodPipe(Segment)) body: z.infer<typeof Segment>) {
    authorizeFor("crm.campaign_send", org());
    const s = await tx().customerSegment.create({ data: { organizationId: orgId(), name: body.name, kind: body.kind, rules: body.rules as Prisma.InputJsonValue } });
    await this.audit.record({ action: "segment.create", entityType: "CustomerSegment", entityId: s.id, after: body });
    if (s.kind === "DYNAMIC") await this.crm.evaluateAll(tx());
    return tx().customerSegment.findUniqueOrThrow({ where: { id: s.id } });
  }

  @AnyStaff()
  @Patch("segments/:id")
  async editSegment(@Param("id") id: string, @Body(new ZodPipe(Segment.pick({ name: true, rules: true }).partial())) body: { name?: string; rules?: z.infer<typeof SegmentRules> }) {
    authorizeFor("crm.campaign_send", org());
    const s = await tx().customerSegment.findUnique({ where: { id } });
    if (!s) throw new NotFoundException({ error: "segment_not_found" });
    if (s.key) throw new ConflictException({ error: "segment_built_in", hint: "Built-in segments can't be changed — create your own." });
    await tx().customerSegment.update({ where: { id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.rules ? { rules: body.rules as Prisma.InputJsonValue } : {}) } });
    if (s.kind === "DYNAMIC") await this.crm.evaluateAll(tx());
    await this.audit.record({ action: "segment.update", entityType: "CustomerSegment", entityId: id, after: body });
    return tx().customerSegment.findUniqueOrThrow({ where: { id } });
  }

  @AnyStaff()
  @Post("segments/:id/members")
  @HttpCode(200)
  async setMembers(@Param("id") id: string, @Body(new ZodPipe(Members)) body: z.infer<typeof Members>) {
    authorizeFor("crm.campaign_send", org());
    return this.crm.setStaticMembers(tx(), id, body.add, body.remove);
  }

  @RequirePermissionAnyScope("crm.view")
  @Post("segments/refresh")
  @HttpCode(200)
  refresh() {
    return this.crm.evaluateAll(tx());
  }

  @RequirePermissionAnyScope("crm.view")
  @Get("campaigns")
  campaigns() {
    return tx().campaign.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { segment: { select: { name: true } }, promotion: { select: { name: true } } } });
  }

  @RequirePermissionAnyScope("crm.view")
  @Get("campaigns/:id")
  campaign(@Param("id") id: string) {
    return this.crm.campaignView(tx(), id);
  }

  @RequirePermissionAnyScope("crm.view")
  @Post("campaigns/audience")
  @HttpCode(200)
  audience(@Body(new ZodPipe(z.object({ segmentId: z.uuid().nullish() }).strict())) body: { segmentId?: string | null }) {
    return this.crm.audience(tx(), body.segmentId ?? null);
  }

  @RequirePermissionAnyScope("crm.view")
  @Post("campaigns")
  async create(@Body(new ZodPipe(Campaign)) body: z.infer<typeof Campaign>) {
    const c = await tx().campaign.create({ data: { ...body, organizationId: orgId(), status: "DRAFT", createdById: principal().employeeId } });
    await this.audit.record({ action: "campaign.create", entityType: "Campaign", entityId: c.id, after: body });
    return c;
  }

  /** Send now (or confirm the schedule if it has one). Sensitive: needs a reason. */
  @AnyStaff()
  @Post("campaigns/:id/send")
  @HttpCode(200)
  async send(@Param("id") id: string) {
    authorizeFor("crm.campaign_send", org());
    const c = await tx().campaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException({ error: "campaign_not_found" });
    if (c.scheduledAt && c.scheduledAt > new Date() && c.status === "DRAFT") {
      await tx().campaign.update({ where: { id }, data: { status: "SCHEDULED" } });
      await this.audit.record({ action: "campaign.schedule", entityType: "Campaign", entityId: id, after: { at: c.scheduledAt } });
      return { scheduled: c.scheduledAt };
    }
    return this.crm.send(tx(), id, { type: "EMPLOYEE", id: principal().employeeId });
  }

  @AnyStaff()
  @Post("campaigns/:id/cancel")
  @HttpCode(200)
  async cancel(@Param("id") id: string) {
    authorizeFor("crm.campaign_send", org());
    const c = await tx().campaign.updateMany({ where: { id, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { status: "CANCELLED" } });
    if (!c.count) throw new ConflictException({ error: "campaign_not_cancellable" });
    await this.audit.record({ action: "campaign.cancel", entityType: "Campaign", entityId: id });
    return { cancelled: true };
  }
}
