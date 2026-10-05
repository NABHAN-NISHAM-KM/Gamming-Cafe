import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { auditAs } from "../common/audit.service.js";
import { RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { WaitlistService } from "./waitlist.service.js";

const Add = z
  .object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/).nullish(),
    partySize: z.number().int().min(1).max(20).default(1),
    zoneId: z.uuid().nullish(),
    customerId: z.uuid().nullish(),
  })
  .strict();

/** The front desk's waitlist when the floor is full. */
@Controller()
export class WaitlistController {
  constructor(@Inject(WaitlistService) private readonly waitlist: WaitlistService) {}

  @RequirePermission("booking.view")
  @Get("branches/:branchId/waitlist")
  board(@Param("branchId") branchId: string) {
    return this.waitlist.board(tx(), branchId);
  }

  @RequirePermission("booking.create")
  @Post("branches/:branchId/waitlist")
  async add(@Param("branchId") branchId: string, @Body(new ZodPipe(Add)) body: z.infer<typeof Add>) {
    if (body.customerId && !(await tx().customer.findUnique({ where: { id: body.customerId }, select: { id: true } }))) throw new NotFoundException({ error: "customer_not_found" });
    const row = await this.waitlist.add(tx(), orgId(), { ...body, branchId, source: "STAFF", createdById: principal().employeeId });
    await auditAs(tx(), { type: "EMPLOYEE", id: principal().employeeId }, { action: "waitlist.add", entityType: "WaitlistEntry", entityId: row.id, branchId, after: { name: row.name, partySize: row.partySize } });
    // Someone may already fit: offer straight away rather than at the next sweep.
    await this.waitlist.tick(tx(), orgId());
    return this.waitlist.board(tx(), branchId);
  }

  @RequirePermission("booking.create")
  @Post("branches/:branchId/waitlist/:entryId/:action")
  @HttpCode(200)
  async act(@Param("branchId") branchId: string, @Param("entryId") entryId: string, @Param("action") action: string) {
    if (action !== "seat" && action !== "cancel") throw new NotFoundException({ error: "not_found" });
    await this.waitlist.setStatus(tx(), entryId, action === "seat" ? "SEATED" : "CANCELLED", { branchId });
    await auditAs(tx(), { type: "EMPLOYEE", id: principal().employeeId }, { action: `waitlist.${action}`, entityType: "WaitlistEntry", entityId: entryId, branchId });
    await this.waitlist.tick(tx(), orgId());
    return this.waitlist.board(tx(), branchId);
  }
}
