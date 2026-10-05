import { Body, Controller, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "@arena/db";
import { DB } from "../common/db.module.js";
import { Public } from "../common/decorators.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { Throttle } from "./customer-auth.js";

const Uuid = z.uuid();
const GuestBooking = z
  .object({
    branchId: z.uuid(),
    zoneId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    minutes: z.number().int().min(30).max(360),
    players: z.number().int().min(1).max(10),
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/),
    /** Honeypot: people never see this field. */
    website: z.string().max(200).optional(),
  })
  .strict()
  .refine((b) => Date.parse(b.startsAt) > Date.now() + 15 * 60_000 && Date.parse(b.startsAt) < Date.now() + 14 * 86_400_000, "between 15 minutes and two weeks ahead");

/**
 * The public side of venues on the website: the venue finder (every venue that
 * published its page) and booking a station from a venue's page without the
 * app — a name and phone number, like calling the venue. Venues that haven't
 * published their page are invisible here.
 */
@Public()
@Controller("app")
export class VenuePublicController {
  private readonly bookByIp = new Throttle(3, 60 * 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  /** Every published venue with its open branches, for the website's venue finder. */
  @Get("venues")
  async venues() {
    const rows = await this.db.global.$queryRaw<Array<{ slug: string; name: string; logo_url: string | null; color: string | null; branch_id: string; branch_name: string; address: string | null; city: string | null; country_code: string; latitude: unknown; longitude: unknown; zone_types: string[] }>>`
      SELECT * FROM app.public_venues()`;
    const venues = new Map<string, { slug: string; name: string; logoUrl: string | null; color: string | null; branches: Array<{ id: string; name: string; address: string | null; city: string | null; country: string; lat: number | null; lng: number | null; kinds: string[] }> }>();
    for (const r of rows) {
      const v = venues.get(r.slug) ?? { slug: r.slug, name: r.name, logoUrl: r.logo_url, color: r.color, branches: [] };
      v.branches.push({ id: r.branch_id, name: r.branch_name, address: r.address, city: r.city, country: r.country_code, lat: r.latitude == null ? null : Number(r.latitude), lng: r.longitude == null ? null : Number(r.longitude), kinds: r.zone_types });
      venues.set(r.slug, v);
    }
    return [...venues.values()];
  }

  /** The venue's organization, only if it published its page. */
  private async published(slug: string) {
    if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw new NotFoundException({ error: "venue_not_found" });
    const [o] = await this.db.global.$queryRaw<Array<{ organization_id: string; org_status: string }>>`SELECT * FROM app.org_by_slug(${slug})`;
    if (!o || o.org_status !== "ACTIVE") throw new NotFoundException({ error: "venue_not_found" });
    const on = await this.db.withTenant({ organizationId: o.organization_id, actorType: "SYSTEM", actorId: null }, async (t) => ((await t.organization.findFirst({ select: { settings: true } }))?.settings as { publicPage?: boolean } | null)?.publicPage === true);
    if (!on) throw new NotFoundException({ error: "venue_not_found" });
    return o.organization_id;
  }

  /** How many stations are free in each zone for a time — counts only. */
  @Get(":slug/public-availability")
  async availability(@Param("slug") slug: string, @Query("branchId") branchId: string, @Query("startsAt") startsAt: string, @Query("minutes") minutes: string) {
    const organizationId = await this.published(slug);
    const at = new Date(startsAt);
    const m = Number(minutes);
    if (!Uuid.safeParse(branchId).success || Number.isNaN(at.getTime()) || !Number.isInteger(m) || m < 30 || m > 360) throw new HttpException({ error: "bad_query" }, 400);
    return this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (t) => (await this.bookings.availability(t, { branchId, zoneId: null, startsAt: at, minutes: m })).map(({ devices: _d, ...z }) => z));
  }

  /** Book from the website: confirmed straight away, held 15 minutes past the start like any booking. */
  @Post(":slug/book")
  @HttpCode(201)
  async book(@Param("slug") slug: string, @Body(new ZodPipe(GuestBooking)) body: z.infer<typeof GuestBooking>, @Req() req: Request) {
    if (body.website) throw new HttpException({ error: "rejected" }, 400);
    if (!this.bookByIp.take(req.ip ?? "?")) throw new HttpException({ error: "too_many_attempts" }, 429);
    const organizationId = await this.published(slug);
    return this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (t) => {
      const b = await this.bookings.create(
        t,
        { branchId: body.branchId, zoneId: body.zoneId, players: body.players, startsAt: new Date(body.startsAt), minutes: body.minutes, contactName: body.name, contactPhone: body.phone, notes: "Booked on the website", source: "CUSTOMER_WEB", idempotencyKey: `web:${randomUUID()}` },
        { type: "SYSTEM", id: null },
      );
      return { reference: b.reference, startsAt: b.startsAt, minutes: b.minutes, status: b.status, estimatedTotal: b.estimatedTotal, currency: b.currency };
    });
  }
}
