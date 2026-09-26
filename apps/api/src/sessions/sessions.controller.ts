import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { authorizeFor } from "../common/authz.js";
import { RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { LIVE_STATUSES, SessionsService } from "./sessions.service.js";

const Request = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("minutes"), minutes: z.number().int().min(1).max(1440) }),
  z.object({ kind: z.literal("package"), packageId: z.uuid() }),
  z.object({ kind: z.literal("pass") }),
  z.object({ kind: z.literal("open") }),
]);
const Discount = z
  .object({ percent: z.number().min(0).max(100).optional(), amountMinor: z.number().int().min(0).optional(), reason: z.string().min(3).max(200) })
  .refine((d) => d.percent || d.amountMinor, "percent or amountMinor required");
const Payment = z.object({ method: z.enum(["CASH", "CARD", "WALLET", "TIME_BALANCE", "PAY_LATER"]), reference: z.string().max(100).nullish() });

const Quote = z.object({ customerId: z.uuid().nullish(), planId: z.uuid().nullish(), request: Request.optional(), discount: Discount.nullish(), players: z.number().int().min(1).max(16).optional(), promoCode: z.string().regex(/^[A-Za-z0-9-]{3,40}$/).nullish() }).strict();
const Start = z
  .object({
    customerId: z.uuid().nullish(),
    guestLabel: z.string().max(40).nullish(),
    planId: z.uuid().nullish(),
    request: Request,
    discount: Discount.nullish(),
    payment: Payment,
    idempotencyKey: z.string().min(8).max(100),
    players: z.number().int().min(1).max(16).optional(),
    ageConfirmed: z.boolean().optional(),
    promoCode: z.string().regex(/^[A-Za-z0-9-]{3,40}$/).nullish(),
  })
  .strict();
const Extend = z
  .object({ minutes: z.number().int().min(1).max(720).optional(), packageId: z.uuid().optional(), payment: Payment, idempotencyKey: z.string().min(8).max(100) })
  .strict()
  .refine((e) => e.minutes || e.packageId, "minutes or packageId required");
const End = z.object({ reason: z.string().max(200).optional() }).strict();
const Move = z.object({ toDeviceId: z.uuid(), reason: z.string().max(200).nullish() }).strict();

const employee = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });

@Controller()
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  private async requireDiscountRight(deviceOrSessionBranch: string) {
    const b = await tx().branch.findUniqueOrThrow({ where: { id: deviceOrSessionBranch }, select: { brandId: true } });
    authorizeFor("pos.discount", { organizationId: orgId(), brandId: b.brandId, branchId: deviceOrSessionBranch });
  }

  @RequirePermission("station.start_session")
  @Post("devices/:deviceId/sessions/quote")
  @HttpCode(200)
  quote(@Param("deviceId") deviceId: string, @Body(new ZodPipe(Quote)) body: z.infer<typeof Quote>) {
    return this.sessions.quote(tx(), deviceId, body);
  }

  @RequirePermission("station.start_session")
  @Post("devices/:deviceId/sessions")
  async start(@Param("deviceId") deviceId: string, @Body(new ZodPipe(Start)) body: z.infer<typeof Start>) {
    if (body.discount) {
      const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { branchId: true } });
      await this.requireDiscountRight(d.branchId);
    }
    return this.sessions.start(tx(), { ...body, deviceId }, employee());
  }

  @RequirePermission("station.view")
  @Get("devices/:deviceId/session")
  async current(@Param("deviceId") deviceId: string) {
    return (await this.sessions.liveForDevice(tx(), deviceId)) ?? { session: null };
  }

  @RequirePermission("station.extend_session")
  @Post("sessions/:sessionId/extend")
  @HttpCode(200)
  extend(@Param("sessionId") sessionId: string, @Body(new ZodPipe(Extend)) body: z.infer<typeof Extend>) {
    return this.sessions.extend(tx(), sessionId, body, employee());
  }

  @RequirePermission("station.end_session")
  @Post("sessions/:sessionId/end")
  @HttpCode(200)
  end(@Param("sessionId") sessionId: string, @Body(new ZodPipe(End)) _body: z.infer<typeof End>) {
    return this.sessions.end(tx(), sessionId, "STAFF_ENDED", employee());
  }

  @RequirePermission("station.move_session")
  @Post("sessions/:sessionId/move")
  @HttpCode(200)
  move(@Param("sessionId") sessionId: string, @Body(new ZodPipe(Move)) body: z.infer<typeof Move>) {
    return this.sessions.move(tx(), sessionId, body.toDeviceId, body.reason ?? null, employee());
  }

  @RequirePermission("station.view")
  @Get("sessions/:sessionId")
  get(@Param("sessionId") sessionId: string) {
    return this.sessions.view(tx(), sessionId);
  }

  /** Live sessions (default) or the last 100 finished ones for a branch. */
  @RequirePermission("station.view")
  @Get("branches/:branchId/sessions")
  async list(@Param("branchId") branchId: string, @Query("state") state?: string) {
    const live = state !== "recent";
    const rows = await tx().gamingSession.findMany({
      where: { branchId, status: live ? { in: [...LIVE_STATUSES] } : { in: ["ENDED", "CANCELLED"] } },
      orderBy: live ? { expiresAt: "asc" } : { endedAt: "desc" },
      take: 100,
      select: { id: true },
    });
    const out = [];
    for (const r of rows) out.push(await this.sessions.view(tx(), r.id));
    return out;
  }
}
