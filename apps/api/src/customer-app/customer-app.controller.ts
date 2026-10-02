import { Body, ConflictException, Controller, Delete, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db, TenantTx } from "@arena/db";
import { burnVerify, hashSecret, verifySecret } from "../auth/crypto.js";
import { TokensService } from "../auth/tokens.service.js";
import { CONFIG, type AppConfig } from "../config.js";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { Public } from "../common/decorators.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { BookingsService } from "../bookings/bookings.service.js";
import { CommerceService } from "../customers/commerce.service.js";
import { balances, walletView } from "../wallet/wallet.js";
import { LoyaltyService } from "../loyalty/loyalty.service.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";
import { CustomerAuth, Throttle, type Me } from "./customer-auth.js";

const Register = z
  .object({
    username: z.string().regex(/^[a-zA-Z0-9._-]{3,32}$/, "3–32 letters, digits, . _ -").transform((u) => u.toLowerCase()),
    displayName: z.string().min(1).max(60),
    password: z.string().min(8).max(128),
    phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/).nullish(),
    email: z.email().max(254).nullish(),
    dateOfBirth: z.iso.date().nullish(),
    marketingConsent: z.boolean().default(false),
    /** A friend's referral code: they earn points when you first play. */
    referralCode: z.string().regex(/^[A-Za-z0-9]{4,16}$/).nullish(),
  })
  .strict();
const Login = z.object({ username: z.string().min(1).max(254), password: z.string().min(1).max(256) }).strict();
const BookingBody = z
  .object({
    branchId: z.uuid(),
    zoneId: z.uuid(),
    /** Specific stations the customer picked; otherwise the first free ones for `players`. */
    deviceIds: z.array(z.uuid()).min(1).max(10).optional(),
    players: z.number().int().min(1).max(10).default(1),
    /** VENUE = pay on arrival; DEMO_CARD = simulated "Pay now" (demo installs only). */
    payment: z.object({ method: z.enum(["VENUE", "DEMO_CARD"]) }).default({ method: "VENUE" }),
    startsAt: z.coerce.date(),
    minutes: z.number().int().min(30).max(720),
    notes: z.string().max(300).nullish(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const BuyTime = z.object({ branchId: z.uuid(), planId: z.uuid(), packageId: z.uuid(), idempotencyKey: z.string().min(8).max(100) }).strict();
const BuyMembership = z.object({ branchId: z.uuid(), tierId: z.uuid(), idempotencyKey: z.string().min(8).max(100) }).strict();

/**
 * The customer app (PWA) API: sign up, sign in, see balance and history, book
 * a station, and buy time or a membership with wallet credit. Customers never
 * pass through the staff pipeline: every request verifies a customer token
 * (its own audience, revocable per login) and runs in the customer's own
 * tenant as the CUSTOMER actor, touching only that customer's records.
 */
@Public()
@Controller("app")
export class CustomerAppController {
  private readonly loginByIp = new Throttle(20, 15 * 60_000);
  private readonly loginByAccount = new Throttle(8, 15 * 60_000);
  private readonly registerByIp = new Throttle(5, 60 * 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(LoyaltyService) private readonly loyalty: LoyaltyService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(CustomerAuth) private readonly auth: CustomerAuth,
  ) {}

  // ── venue & auth (public) ────────────────────────────────────────────────

  private async org(slug: string) {
    if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw new NotFoundException({ error: "venue_not_found" });
    const rows = await this.db.global.$queryRaw<Array<{ organization_id: string; org_status: string }>>`SELECT * FROM app.org_by_slug(${slug})`;
    const o = rows[0];
    if (!o || o.org_status !== "ACTIVE") throw new NotFoundException({ error: "venue_not_found" });
    return o.organization_id;
  }

  @Get(":slug/venue")
  async venue(@Param("slug") slug: string) {
    const organizationId = await this.org(slug);
    return this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (t) => {
      const o = await t.organization.findFirstOrThrow({ select: { displayName: true, defaultCurrency: true } });
      const branches = await t.branch.findMany({
        where: { status: "OPEN" },
        select: {
          id: true, name: true, code: true, timezone: true, currency: true, brand: { select: { name: true, logoUrl: true } },
          zones: { where: { isActive: true }, select: { id: true, name: true, type: true, _count: { select: { devices: { where: { isEnabled: true } } } } }, orderBy: { sortOrder: "asc" } },
        },
        orderBy: { name: "asc" },
      });
      const shaped = branches.map((b) => ({ ...b, zones: b.zones.map(({ _count, ...z }) => ({ ...z, stations: _count.devices })) }));
      // Branches with stations first, so the app opens somewhere you can actually book.
      shaped.sort((a, b) => Number(b.zones.some((z) => z.stations > 0)) - Number(a.zones.some((z) => z.stations > 0)));
      return { name: o.displayName, currency: o.defaultCurrency, demoPayments: this.cfg.demoPayments, branches: shaped };
    });
  }

  @Post(":slug/register")
  async register(@Param("slug") slug: string, @Body(new ZodPipe(Register)) body: z.infer<typeof Register>, @Req() req: Request) {
    if (!this.registerByIp.take(req.ip ?? "?")) throw new HttpException({ error: "too_many_attempts" }, 429);
    const organizationId = await this.org(slug);
    return this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (t) => {
      const clash = await t.customer.findFirst({
        where: { OR: [{ username: body.username }, ...(body.email ? [{ email: body.email.toLowerCase() }] : []), ...(body.phone ? [{ phone: body.phone }] : [])] },
        select: { username: true, email: true, phone: true },
      });
      if (clash) throw new ConflictException({ error: clash.username === body.username ? "username_taken" : "already_registered", hint: "Sign in instead, or ask staff to reset your password." });
      const referrer = body.referralCode ? await t.customer.findFirst({ where: { referralCode: body.referralCode.toUpperCase(), status: "ACTIVE" }, select: { id: true } }) : null;
      if (body.referralCode && !referrer) throw new ConflictException({ error: "referral_code_invalid" });
      const c = await t.customer.create({
        data: {
          organizationId, username: body.username, displayName: body.displayName, passwordHash: await hashSecret(body.password), phone: body.phone ?? null,
          email: body.email?.toLowerCase() ?? null, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null, marketingConsent: body.marketingConsent,
          referralCode: randomBytes(4).toString("hex").toUpperCase(), referredById: referrer?.id ?? null,
        },
      });
      await auditAs(t, { type: "CUSTOMER", id: c.id }, { action: "customer.self_register", entityType: "Customer", entityId: c.id, after: { username: c.username } });
      return this.startSession(t, c.id, organizationId, req);
    });
  }

  @Post(":slug/login")
  @HttpCode(200)
  async login(@Param("slug") slug: string, @Body(new ZodPipe(Login)) body: z.infer<typeof Login>, @Req() req: Request) {
    const organizationId = await this.org(slug);
    const who = body.username.trim().toLowerCase();
    if (!this.loginByIp.take(req.ip ?? "?") || !this.loginByAccount.take(`${organizationId}:${who}`)) throw new HttpException({ error: "too_many_attempts" }, 429);
    return this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (t) => {
      const c = await t.customer.findFirst({ where: { OR: [{ username: who }, { email: who }, { phone: body.username.trim() }] }, select: { id: true, status: true, passwordHash: true } });
      const ok = !!c?.passwordHash && (await verifySecret(c.passwordHash, body.password));
      if (!c) await burnVerify(body.password);
      if (!ok || !c) throw new UnauthorizedException({ error: "invalid_credentials" });
      if (c.status === "BANNED" || c.status === "DELETED") throw new UnauthorizedException({ error: "account_blocked" });
      this.loginByAccount.clear(`${organizationId}:${who}`);
      return this.startSession(t, c.id, organizationId, req);
    });
  }

  private async startSession(t: TenantTx, customerId: string, organizationId: string, req: Request) {
    const s = await t.customerSession.create({ data: { organizationId, customerId, channel: "WEB", ip: req.ip ?? null, userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null } });
    return { accessToken: await this.tokens.signCustomer({ customerId, org: organizationId, sid: s.id }), expiresInSec: 12 * 3600 };
  }

  // ── signed-in customer ───────────────────────────────────────────────────

  private as<T>(req: Request, fn: (t: TenantTx, me: Me) => Promise<T>): Promise<T> {
    return this.auth.as(req, fn);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request) {
    await this.as(req, (t, me) => t.customerSession.update({ where: { id: me.sid }, data: { endedAt: new Date() } }));
  }

  @Get("me")
  me(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const c = await t.customer.findUniqueOrThrow({
        where: { id: me.customerId },
        select: {
          id: true, username: true, displayName: true, email: true, phone: true, dateOfBirth: true, referralCode: true, createdAt: true,
          locale: true, marketingConsent: true, showOnLeaderboard: true, pinHash: true,
          membershipTier: { select: { id: true, name: true, code: true, color: true, gamingDiscountPct: true, bookingWindowDays: true, priorityBooking: true } },
          memberships: { where: { status: "ACTIVE" }, select: { id: true, expiresAt: true, tier: { select: { name: true } } }, orderBy: { expiresAt: "desc" }, take: 1 },
        },
      });
      const b = await balances(t, me.customerId);
      const f = (m: number) => (m / 10 ** b.unit).toFixed(b.unit);
      const live = await t.gamingSession.findFirst({ where: { customerId: me.customerId, status: { in: ["ACTIVE", "ENDING", "PAUSED"] } }, select: { id: true, expiresAt: true, device: { select: { name: true } } } });
      const { memberships, pinHash, ...rest } = c;
      return {
        ...rest,
        dateOfBirth: c.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        hasPin: !!pinHash,
        membership: memberships[0] ?? null,
        wallet: { currency: b.currency, cash: f(b.cashMinor), bonus: f(b.bonusMinor), total: f(b.cashMinor + b.bonusMinor), timeMinutes: b.timeMinutes, frozen: b.frozen },
        playingNow: live ? { sessionId: live.id, station: live.device.name, expiresAt: live.expiresAt } : null,
      };
    });
  }

  @Get("wallet")
  wallet(@Req() req: Request) {
    return this.as(req, (t, me) => walletView(t, me.customerId, 100));
  }

  @Get("visits")
  visits(@Req() req: Request) {
    return this.as(req, (t, me) =>
      t.gamingSession.findMany({
        where: { customerId: me.customerId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, status: true, startedAt: true, endedAt: true, allocatedMinutes: true, amountDue: true, currency: true, device: { select: { name: true } }, branch: { select: { name: true } } },
      }),
    );
  }

  // ── bookings ─────────────────────────────────────────────────────────────

  @Get("availability")
  availability(@Req() req: Request, @Query("branchId") branchId: string, @Query("zoneId") zoneId: string, @Query("startsAt") startsAt: string, @Query("minutes") minutes: string) {
    return this.as(req, async (t) => {
      const at = new Date(startsAt);
      const m = Number(minutes);
      if (!/^[0-9a-f-]{36}$/i.test(branchId ?? "") || Number.isNaN(at.getTime()) || !Number.isInteger(m) || m < 30 || m > 720) throw new HttpException({ error: "bad_query" }, 400);
      // Customers see how many stations are free, not which ones or who has the others.
      return (await this.bookings.availability(t, { branchId, zoneId: zoneId || null, startsAt: at, minutes: m })).map(({ devices: _d, ...z }) => z);
    });
  }

  /** Stations in a zone with the times they're taken — names only, never who. */
  @Get("stations")
  stations(@Req() req: Request, @Query("branchId") branchId: string, @Query("zoneId") zoneId: string, @Query("from") from: string, @Query("to") to: string) {
    return this.as(req, (t) => {
      const f = new Date(from);
      const tt = new Date(to);
      if (!/^[0-9a-f-]{36}$/i.test(branchId ?? "") || !/^[0-9a-f-]{36}$/i.test(zoneId ?? "") || Number.isNaN(f.getTime()) || Number.isNaN(tt.getTime()) || tt <= f || tt.getTime() - f.getTime() > 2 * 86_400_000) {
        throw new HttpException({ error: "bad_query" }, 400);
      }
      return this.bookings.schedule(t, { branchId, zoneId, from: f, to: tt });
    });
  }

  @Get("estimate")
  estimate(@Req() req: Request, @Query("branchId") branchId: string, @Query("zoneId") zoneId: string, @Query("startsAt") startsAt: string, @Query("minutes") minutes: string) {
    return this.as(req, (t, me) => {
      const at = new Date(startsAt);
      const m = Number(minutes);
      if (!/^[0-9a-f-]{36}$/i.test(branchId ?? "") || !/^[0-9a-f-]{36}$/i.test(zoneId ?? "") || Number.isNaN(at.getTime()) || !Number.isInteger(m) || m < 30 || m > 720) throw new HttpException({ error: "bad_query" }, 400);
      return this.bookings.estimateFor(t, { branchId, zoneId, startsAt: at, minutes: m, customerId: me.customerId });
    });
  }

  @Get("bookings")
  myBookings(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const rows = await t.booking.findMany({ where: { customerId: me.customerId }, orderBy: { startsAt: "desc" }, take: 30, select: { id: true } });
      return Promise.all(rows.map((r) => this.bookings.view(t, r.id).then(({ createdById: _c, notes: _n, ...b }) => b)));
    });
  }

  @Post("bookings")
  book(@Req() req: Request, @Body(new ZodPipe(BookingBody)) body: z.infer<typeof BookingBody>) {
    const { payment, ...rest } = body;
    if (payment.method === "DEMO_CARD" && !this.cfg.demoPayments) throw new HttpException({ error: "online_payment_unavailable", hint: "Pay at the venue." }, 400);
    return this.as(req, async (t, me) => {
      const actor = { type: "CUSTOMER" as const, id: me.customerId };
      const b = await this.bookings.create(t, { ...rest, players: rest.deviceIds?.length ?? rest.players, customerId: me.customerId, source: "CUSTOMER_WEB" }, actor);
      // Same transaction: if the payment fails, the booking doesn't happen either.
      return payment.method === "DEMO_CARD" ? this.bookings.prepay(t, b.id, "DEMO_CARD", actor, body.idempotencyKey) : b;
    });
  }

  @Post("bookings/:bookingId/cancel")
  @HttpCode(200)
  cancel(@Req() req: Request, @Param("bookingId") id: string) {
    return this.as(req, (t, me) => this.bookings.cancel(t, id, "Cancelled by customer", { type: "CUSTOMER", id: me.customerId }));
  }

  // ── buying with wallet credit ────────────────────────────────────────────

  @Get("shop")
  shop(@Req() req: Request, @Query("branchId") branchId?: string) {
    return this.as(req, async (t) => {
      const plans = await t.pricingPlan.findMany({
        // Every live rate, for the price list; the ones with packages are also sold as play time.
        where: { isActive: true, AND: [{ OR: [{ validTo: null }, { validTo: { gt: new Date() } }] }], ...(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? { OR: [{ branchId: null }, { branchId }] } : { branchId: null }) },
        select: { id: true, name: true, stationClass: true, currency: true, rate: true, billingMode: true, paymentTiming: true, schedule: true, passStartTime: true, passEndTime: true, membershipTier: { select: { name: true } }, zone: { select: { name: true } }, pricingPackages:{ where: { isActive: true }, select: { id: true, name: true, durationMinutes: true, bonusMinutes: true, price: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { name: "asc" },
      });
      const tiers = await t.membershipTier.findMany({
        where: { isActive: true, price: { not: null } },
        select: { id: true, name: true, code: true, color: true, price: true, durationDays: true, gamingDiscountPct: true, bonusMinutesMonthly: true, bookingWindowDays: true, priorityBooking: true },
        orderBy: { rank: "asc" },
      });
      return { plans, tiers };
    });
  }

  @Post("time")
  buyTime(@Req() req: Request, @Body(new ZodPipe(BuyTime)) body: z.infer<typeof BuyTime>) {
    return this.as(req, (t, me) => this.commerce.sellTime(t, { ...body, customerId: me.customerId, payment: { method: "WALLET" } }, { type: "CUSTOMER", id: me.customerId }));
  }

  @Post("memberships")
  buyMembership(@Req() req: Request, @Body(new ZodPipe(BuyMembership)) body: z.infer<typeof BuyMembership>) {
    return this.as(req, (t, me) => this.commerce.sellMembership(t, { ...body, customerId: me.customerId, payment: { method: "WALLET" } }, { type: "CUSTOMER", id: me.customerId }));
  }

  // ── loyalty ──────────────────────────────────────────────────────────────

  @Get("loyalty")
  myLoyalty(@Req() req: Request) {
    return this.as(req, (t, me) => this.loyalty.summary(t, me.customerId));
  }

  @Post("loyalty/redeem")
  @HttpCode(200)
  redeem(@Body(new ZodPipe(z.object({ rewardId: z.uuid(), idempotencyKey: z.string().min(8).max(100) }).strict())) body: { rewardId: string; idempotencyKey: string }, @Req() req: Request) {
    return this.as(req, (t, me) => this.loyalty.redeem(t, me.customerId, body.rewardId, { type: "CUSTOMER", id: me.customerId }, `app:${me.customerId}:${body.idempotencyKey}`));
  }

  // ── tournaments ──────────────────────────────────────────────────────────

  @Get("tournaments")
  listTournaments(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const rows = await t.tournament.findMany({
        where: { isPublic: true, OR: [{ status: { in: ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN", "IN_PROGRESS"] } }, { status: "COMPLETED", endsAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] },
        orderBy: { startsAt: "asc" },
        include: { branch: { select: { name: true } }, game: { select: { title: true, coverUrl: true } }, _count: { select: { teams: { where: { status: { notIn: ["WITHDRAWN", "DISQUALIFIED"] } } } } } },
      });
      const mine = await t.tournamentPlayer.findMany({ where: { customerId: me.customerId, tournamentId: { in: rows.map((r) => r.id) } }, select: { tournamentId: true, team: { select: { name: true, status: true, finalPlacement: true } } } });
      return rows.map((r) => ({
        id: r.id, name: r.name, status: r.status, format: r.format, game: r.game?.title ?? r.customGameName, coverUrl: r.game?.coverUrl ?? r.bannerUrl, branch: r.branch.name, startsAt: r.startsAt,
        teamSize: r.teamSize, maxTeams: r.maxTeams, entered: r._count.teams, entryFee: r.entryFee.toFixed(2), prizePool: r.prizePool.toFixed(2), currency: r.currency,
        myTeam: mine.find((m) => m.tournamentId === r.id)?.team ?? null,
      }));
    });
  }

  @Get("tournaments/:id")
  tournament(@Param("id") id: string, @Req() req: Request) {
    return this.as(req, async (t, me) => {
      const v = await this.tournaments.view(t, id, { publicOnly: true });
      const mine = await t.tournamentPlayer.findFirst({ where: { tournamentId: id, customerId: me.customerId }, select: { teamId: true } });
      return { ...v, myTeamId: mine?.teamId ?? null };
    });
  }

  /** Enter with your team: teammates by username; the fee comes from your wallet. */
  @Post("tournaments/:id/register")
  registerTeam(@Param("id") id: string, @Body(new ZodPipe(z.object({ teamName: z.string().min(1).max(40), teammates: z.array(z.string().min(3).max(32)).max(9).default([]), idempotencyKey: z.string().min(8).max(100) }).strict())) body: { teamName: string; teammates: string[]; idempotencyKey: string }, @Req() req: Request) {
    return this.as(req, async (t, me) => {
      const mates = body.teammates.length ? await t.customer.findMany({ where: { username: { in: body.teammates.map((u) => u.toLowerCase()) }, status: "ACTIVE" }, select: { id: true, username: true } }) : [];
      const missing = body.teammates.filter((u) => !mates.some((m) => m.username === u.toLowerCase()));
      if (missing.length) throw new NotFoundException({ error: "player_not_found", usernames: missing });
      const tr = await t.tournament.findUnique({ where: { id }, select: { isPublic: true, entryFee: true } });
      if (!tr?.isPublic) throw new NotFoundException({ error: "tournament_not_found" });
      return this.tournaments.register(t, id, { teamName: body.teamName, captainId: me.customerId, playerIds: mates.map((m) => m.id), payment: Number(tr.entryFee) > 0 ? { method: "WALLET" } : null, idempotencyKey: `app:${me.customerId}:${body.idempotencyKey}` }, { type: "CUSTOMER", id: me.customerId });
    });
  }

  // ── inbox ────────────────────────────────────────────────────────────────

  @Get("inbox")
  inbox(@Req() req: Request) {
    return this.as(req, (t, me) =>
      t.notification.findMany({ where: { customerId: me.customerId, channel: "IN_APP", createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, body: true, data: true, readAt: true, createdAt: true } }),
    );
  }

  // ── screenshots (taken on a gaming PC with Print Screen) ─────────────────

  @Get("screenshots")
  screenshots(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const rows = await t.screenshot.findMany({
        where: { customerId: me.customerId, expiresAt: { gt: new Date() } },
        orderBy: { takenAt: "desc" },
        take: 100,
        select: { id: true, takenAt: true, expiresAt: true, width: true, height: true, thumb: true },
      });
      return rows.map(({ thumb, ...r }) => ({ ...r, thumb: `data:image/jpeg;base64,${Buffer.from(thumb).toString("base64")}` }));
    });
  }

  @Get("screenshots/:id")
  screenshot(@Param("id") id: string, @Req() req: Request) {
    return this.as(req, async (t, me) => {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ error: "not_found" });
      const s = await t.screenshot.findFirst({ where: { id, customerId: me.customerId }, select: { id: true, takenAt: true, image: true } });
      if (!s) throw new NotFoundException({ error: "not_found" });
      return { id: s.id, takenAt: s.takenAt, image: `data:image/jpeg;base64,${Buffer.from(s.image).toString("base64")}` };
    });
  }

  @Delete("screenshots/:id")
  @HttpCode(204)
  async deleteScreenshot(@Param("id") id: string, @Req() req: Request) {
    await this.as(req, (t, me) => t.screenshot.deleteMany({ where: { id, customerId: me.customerId } }));
  }

  @Post("inbox/:id/read")
  @HttpCode(200)
  read(@Param("id") id: string, @Req() req: Request) {
    return this.as(req, async (t, me) => {
      await t.notification.updateMany({ where: { id, customerId: me.customerId, readAt: null }, data: { readAt: new Date(), status: "READ" } });
      return { read: true };
    });
  }
}
