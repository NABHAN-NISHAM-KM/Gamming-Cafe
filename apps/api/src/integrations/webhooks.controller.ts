import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { authorize } from "@arena/rbac";
import { auditAs } from "../common/audit.service.js";
import { AnyStaff, RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { validPattern, WEBHOOK_FAMILIES, WebhooksService } from "./webhooks.service.js";

const Events = z.array(z.string().refine(validPattern, "unknown event")).min(1).max(30);
const Create = z.object({ url: z.string().url().max(500), events: Events, description: z.string().trim().max(120).nullish() }).strict();
const Update = z.object({ events: Events, description: z.string().trim().max(120).nullish(), isActive: z.boolean() }).partial().strict();

/** Signed webhooks: the venue's own systems hear about what happens, as it happens. */
@Controller("webhooks")
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly hooks: WebhooksService) {}

  /** Looking costs no reason (no secret is ever in the answer); changing things does. The plan and the permission are still checked. */
  @AnyStaff()
  @Get()
  async list() {
    const d = authorize(principal(), "integration.manage", { organizationId: orgId() }, { reason: "read-only listing" });
    if (!d.allowed) throw new ForbiddenException({ error: "forbidden", permission: "integration.manage", reason: d.reason });
    return { events: WEBHOOK_FAMILIES.map((f) => `${f}.*`), endpoints: await this.hooks.list(tx()) };
  }

  /** The signing secret is in this answer and nowhere else, ever again. */
  @RequirePermission("integration.manage")
  @Post()
  async create(@Body(new ZodPipe(Create)) body: z.infer<typeof Create>) {
    const { row, secret } = await this.hooks.create(tx(), orgId(), body);
    await auditAs(tx(), { type: "EMPLOYEE", id: principal().employeeId }, { action: "integration.webhook_create", entityType: "WebhookEndpoint", entityId: row.id, after: { url: row.url, events: row.events } });
    return { id: row.id, url: row.url, events: row.events, secret };
  }

  @RequirePermission("integration.manage")
  @Put(":id")
  async update(@Param("id") id: string, @Body(new ZodPipe(Update)) body: z.infer<typeof Update>) {
    const row = await tx().webhookEndpoint.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ error: "not_found" });
    const after = await tx().webhookEndpoint.update({
      where: { id },
      data: { ...(body.events ? { events: [...new Set(body.events)] } : {}), ...(body.description !== undefined ? { description: body.description } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive, ...(body.isActive ? { failureCount: 0, disabledReason: null } : {}) } : {}) },
      select: { id: true, events: true, isActive: true, description: true },
    });
    await auditAs(tx(), { type: "EMPLOYEE", id: principal().employeeId }, { action: "integration.webhook_update", entityType: "WebhookEndpoint", entityId: id, before: { events: row.events, isActive: row.isActive }, after });
    return after;
  }

  @RequirePermission("integration.manage")
  @Post(":id/rotate-secret")
  @HttpCode(200)
  async rotate(@Param("id") id: string) {
    const secret = await this.hooks.rotate(tx(), id);
    await auditAs(tx(), { type: "EMPLOYEE", id: principal().employeeId }, { action: "integration.webhook_rotate", entityType: "WebhookEndpoint", entityId: id });
    return { secret };
  }

  /** Sends a "webhook.test" event now, so the venue can see their endpoint answer. */
  @RequirePermission("integration.manage")
  @Post(":id/test")
  @HttpCode(200)
  async test(@Param("id") id: string) {
    await this.hooks.ping(tx(), orgId(), id);
    return { queued: true };
  }

  @RequirePermission("integration.manage")
  @Post("deliveries/:deliveryId/retry")
  @HttpCode(200)
  async retry(@Param("deliveryId") deliveryId: string) {
    await this.hooks.retry(tx(), deliveryId);
    return { queued: true };
  }

  @RequirePermission("integration.manage")
  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string) {
    const done = await tx().webhookEndpoint.deleteMany({ where: { id } });
    if (!done.count) throw new NotFoundException({ error: "not_found" });
    await auditAs(tx(), { type: "EMPLOYEE", id: principal().employeeId }, { action: "integration.webhook_delete", entityType: "WebhookEndpoint", entityId: id });
  }
}
