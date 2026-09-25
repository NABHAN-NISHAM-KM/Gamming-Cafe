import { Body, Controller, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { BookingsService } from "./bookings.service.js";

const Create = z
  .object({
    zoneId: z.uuid().nullish(),
    deviceIds: z.array(z.uuid()).max(20).optional(),
    players: z.number().int().min(1).max(20).default(1),
    startsAt: z.coerce.date(),
    minutes: z.number().int().min(30).max(720),
    customerId: z.uuid().nullish(),
    contactName: z.string().min(1).max(80).nullish(),
    contactPhone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/).nullish(),
    notes: z.string().max(300).nullish(),
    source: z.enum(["STAFF", "PHONE"]).default("STAFF"),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const Cancel = z.object({ reason: z.string().min(2).max(200) }).strict();
const CheckIn = z.object({ payment: z.object({ method: z.enum(["CASH", "CARD", "WALLET", "TIME_BALANCE", "PAY_LATER"]), reference: z.string().max(100).nullish() }) }).strict();

function day(date: string | undefined, tz: string) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  // The branch's local day, as a UTC window wide enough to cover any offset; the client filters by local date.
  const start = new Date(`${d}T00:00:00Z`);
  return { from: new Date(start.getTime() - 14 * 3_600_000), to: new Date(start.getTime() + 38 * 3_600_000), date: d };
}

@Controller()
export class BookingsController {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  private async booking(id: string) {
    const b = await tx().booking.findUnique({ where: { id }, select: { id: true, branchId: true, branch: { select: { brandId: true } } } });
    if (!b) throw new NotFoundException({ error: "not_found" });
    return { organizationId: orgId(), brandId: b.branch.brandId, branchId: b.branchId };
  }

  @RequirePermission("booking.view")
  @Get("branches/:branchId/bookings")
  async list(@Param("branchId") branchId: string, @Query("date") date?: string, @Query("upcoming") upcoming?: string) {
    const branch = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { timezone: true } });
    const where = upcoming ? { branchId, endsAt: { gte: new Date() }, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] as ("PENDING" | "CONFIRMED" | "CHECKED_IN")[] } } : (() => {
      const w = day(date, branch.timezone);
      return { branchId, startsAt: { gte: w.from, lt: w.to } };
    })();
    const rows = await tx().booking.findMany({ where, select: { id: true }, orderBy: { startsAt: "asc" }, take: 300 });
    return Promise.all(rows.map((r) => this.bookings.view(tx(), r.id)));
  }

  @RequirePermission("booking.view")
  @Get("branches/:branchId/availability")
  availability(@Param("branchId") branchId: string, @Query("startsAt") startsAt: string, @Query("minutes") minutes: string, @Query("zoneId") zoneId?: string) {
    const at = new Date(startsAt);
    const m = Number(minutes);
    if (Number.isNaN(at.getTime()) || !Number.isInteger(m) || m < 30 || m > 720) throw new HttpException({ error: "bad_query" }, 400);
    return this.bookings.availability(tx(), { branchId, zoneId: zoneId || null, startsAt: at, minutes: m });
  }

  @RequirePermission("booking.create")
  @Post("branches/:branchId/bookings")
  create(@Param("branchId") branchId: string, @Body(new ZodPipe(Create)) body: z.infer<typeof Create>) {
    return this.bookings.create(tx(), { ...body, branchId }, { type: "EMPLOYEE", id: principal().employeeId });
  }

  @AnyStaff()
  @Get("bookings/:bookingId")
  async get(@Param("bookingId") id: string) {
    authorizeFor("booking.view", await this.booking(id));
    return this.bookings.view(tx(), id);
  }

  @AnyStaff()
  @Post("bookings/:bookingId/cancel")
  @HttpCode(200)
  async cancel(@Param("bookingId") id: string, @Body(new ZodPipe(Cancel)) body: z.infer<typeof Cancel>) {
    authorizeFor("booking.cancel", await this.booking(id));
    return this.bookings.cancel(tx(), id, body.reason, { type: "EMPLOYEE", id: principal().employeeId });
  }

  @AnyStaff()
  @Post("bookings/:bookingId/no-show")
  @HttpCode(200)
  async noShow(@Param("bookingId") id: string) {
    authorizeFor("booking.cancel", await this.booking(id));
    return this.bookings.noShow(tx(), id, { type: "EMPLOYEE", id: principal().employeeId });
  }

  /** Arrival: starts the booked sessions. Needs both booking and session rights at the branch. */
  @AnyStaff()
  @Post("bookings/:bookingId/check-in")
  @HttpCode(200)
  async checkIn(@Param("bookingId") id: string, @Body(new ZodPipe(CheckIn)) body: z.infer<typeof CheckIn>) {
    const target = await this.booking(id);
    authorizeFor("booking.create", target);
    authorizeFor("station.start_session", target);
    return this.bookings.checkIn(tx(), id, body.payment, { type: "EMPLOYEE", id: principal().employeeId });
  }
}
