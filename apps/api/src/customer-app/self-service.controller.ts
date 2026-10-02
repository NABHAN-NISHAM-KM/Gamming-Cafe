import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { Prisma, type Db, type TenantTx } from "@arena/db";
import { burnVerify, hashSecret, verifySecret } from "../auth/crypto.js";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { Public } from "../common/decorators.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CONFIG, type AppConfig } from "../config.js";
import { CommerceService } from "../customers/commerce.service.js";
import { eraseCustomer } from "../customers/merge.js";
import { challengesFor } from "../loyalty/challenges.js";
import { OrdersService } from "../pos/orders.service.js";
import { PushService } from "../push/push.service.js";
import { ShellAuthService } from "../sessions/shell-auth.service.js";
import { SAVED_TIME_STEPS, ShellTimeService } from "../sessions/shell-time.service.js";
import { adjustTime } from "../sessions/time-balance.js";
import { fromMinor, moveMoney, orgCurrency, toMinor } from "../wallet/wallet.js";
import { CustomerAuth, Throttle, type Me } from "./customer-auth.js";

const Key = z.string().min(8).max(100);
const Phone = z.string().regex(/^\+?[0-9 ()-]{6,20}$/);
const Profile = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    phone: Phone.nullable(),
    email: z.email().max(254).nullable(),
    dateOfBirth: z.iso.date().refine((d) => d >= "1900-01-01" && new Date(d) <= new Date(), "not a real birth date").nullable(),
    locale: z.enum(["en", "ar"]),
    marketingConsent: z.boolean(),
    showOnLeaderboard: z.boolean(),
  })
  .partial()
  .strict();
const Password = z.object({ current: z.string().min(1).max(256), next: z.string().min(8).max(128) }).strict();
const Pin = z.object({ password: z.string().min(1).max(256), pin: z.string().regex(/^\d{4,8}$/).nullable() }).strict();
const Confirm = z.object({ password: z.string().min(1).max(256) }).strict();
const Reset = z.object({ username: z.string().min(1).max(254), code: z.string().regex(/^\d{6}$/), password: z.string().min(8).max(128) }).strict();
const Line = z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(20), modifierIds: z.array(z.uuid()).max(20).default([]), notes: z.string().max(200).nullish() }).strict();
const Order = z.object({ lines: z.array(Line).min(1).max(30), notes: z.string().max(300).nullish(), payWith: z.enum(["BILL", "WALLET"]), idempotencyKey: Key }).strict();
const Extend = z
  .object({ packageId: z.uuid().nullish(), savedMinutes: z.union([z.literal(SAVED_TIME_STEPS[0]), z.literal(SAVED_TIME_STEPS[1]), z.literal(SAVED_TIME_STEPS[2])]).nullish(), idempotencyKey: Key })
  .strict()
  .refine((m) => (m.packageId ? 1 : 0) + (m.savedMinutes ? 1 : 0) === 1, "packageId or savedMinutes");
const Ticket = z.object({ category: z.enum(["HARDWARE", "GAME", "PAYMENT", "FOOD", "OTHER"]), subject: z.string().trim().min(3).max(120), message: z.string().max(2000).nullish() }).strict();
const Gift = z
  .object({ to: z.string().trim().min(3).max(32), bucket: z.enum(["CASH", "TIME"]), amount: z.union([z.number(), z.string()]).transform(String), idempotencyKey: Key })
  .strict();
const TopUp = z.object({ amount: z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,5}(\.\d{1,2})?$/.test(v) && Number(v) >= 5 && Number(v) <= 2000, "5–2000"), idempotencyKey: Key }).strict();
const Invite = z.object({ usernames: z.array(z.string().trim().min(3).max(32)).min(1).max(9) }).strict();
const Subscription = z.object({ endpoint: z.url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

const GIFT_CASH_MAX = 500; // ponytail: fixed cap per gift; make it a venue setting if anyone asks
const LIVE = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/**
 * The customer app's self-service: profile and sign-in details, ordering food
 * and adding time from the phone, live venue status, games, friends,
 * help, stats, signing in at a PC by QR, gifts, online top-up, leaderboard,
 * challenges, splitting a booking, and push notifications. Every route runs
 * as the signed-in customer (CustomerAuth) and touches only their records.
 */
@Public()
@Controller("app")
export class SelfServiceController {
  private readonly resetByIp = new Throttle(10, 15 * 60_000);
  private readonly secretByCustomer = new Throttle(6, 15 * 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(CustomerAuth) private readonly auth: CustomerAuth,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ShellTimeService) private readonly shellTime: ShellTimeService,
    @Inject(ShellAuthService) private readonly shellAuth: ShellAuthService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  private as<T>(req: Request, fn: (t: TenantTx, me: Me) => Promise<T>) {
    return this.auth.as(req, fn);
  }

  /** Re-checks the password for sensitive changes (throttled per customer). */
  private async checkPassword(t: TenantTx, me: Me, password: string) {
    if (!this.secretByCustomer.take(me.customerId)) throw new HttpException({ error: "too_many_attempts" }, 429);
    const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { passwordHash: true } });
    if (!c.passwordHash || !(await verifySecret(c.passwordHash, password))) throw new ForbiddenException({ error: "wrong_password" });
    this.secretByCustomer.clear(me.customerId);
  }

  // ── profile & sign-in details ─────────────────────────────────────────────

  @Patch("me")
  updateProfile(@Req() req: Request, @Body(new ZodPipe(Profile)) body: z.infer<typeof Profile>) {
    return this.as(req, async (t, me) => {
      const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { dateOfBirth: true } });
      // Birth date unlocks age-rated games: customers set it once, staff correct it.
      if (body.dateOfBirth !== undefined && c.dateOfBirth && body.dateOfBirth !== c.dateOfBirth.toISOString().slice(0, 10)) throw new ConflictException({ error: "dob_locked" });
      const email = body.email?.toLowerCase() ?? body.email;
      if (body.phone || email) {
        const clash = await t.customer.findFirst({ where: { id: { not: me.customerId }, OR: [...(body.phone ? [{ phone: body.phone }] : []), ...(email ? [{ email }] : [])] }, select: { id: true } });
        if (clash) throw new ConflictException({ error: "contact_taken" });
      }
      const after = await t.customer.update({
        where: { id: me.customerId },
        data: { ...body, email, dateOfBirth: body.dateOfBirth === undefined ? undefined : body.dateOfBirth ? new Date(body.dateOfBirth) : c.dateOfBirth },
        select: { displayName: true, phone: true, email: true, locale: true, marketingConsent: true, showOnLeaderboard: true },
      });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "customer.self_update", entityType: "Customer", entityId: me.customerId, after: Object.keys(body) });
      return after;
    });
  }

  /** New password; every other signed-in phone is signed out. */
  @Post("me/password")
  @HttpCode(204)
  async changePassword(@Req() req: Request, @Body(new ZodPipe(Password)) body: z.infer<typeof Password>) {
    await this.as(req, async (t, me) => {
      await this.checkPassword(t, me, body.current);
      await t.customer.update({ where: { id: me.customerId }, data: { passwordHash: await hashSecret(body.next), resetCodeHash: null, resetCodeExpiresAt: null } });
      await t.customerSession.updateMany({ where: { customerId: me.customerId, endedAt: null, id: { not: me.sid }, channel: { in: ["WEB", "MOBILE"] } }, data: { endedAt: new Date() } });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "customer.self_password", entityType: "Customer", entityId: me.customerId });
    });
  }

  /** The quick PC sign-in PIN (null removes it). */
  @Post("me/pin")
  @HttpCode(204)
  async setPin(@Req() req: Request, @Body(new ZodPipe(Pin)) body: z.infer<typeof Pin>) {
    await this.as(req, async (t, me) => {
      await this.checkPassword(t, me, body.password);
      await t.customer.update({ where: { id: me.customerId }, data: { pinHash: body.pin ? await hashSecret(body.pin) : null } });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "customer.self_pin", entityType: "Customer", entityId: me.customerId, after: { pin: !!body.pin } });
    });
  }

  /** Right to erasure, by the customer: same rules as staff Erase (no money left, nothing in progress). */
  @Post("me/delete")
  @HttpCode(200)
  deleteAccount(@Req() req: Request, @Body(new ZodPipe(Confirm)) body: z.infer<typeof Confirm>) {
    return this.as(req, async (t, me) => {
      await this.checkPassword(t, me, body.password);
      await eraseCustomer(t, me.customerId);
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "customer.self_erase", entityType: "Customer", entityId: me.customerId });
      return { deleted: true };
    });
  }

  /** Forgot password: a one-time code from the staff (no SMS/e-mail provider yet). */
  @Post(":slug/reset")
  @HttpCode(204)
  async reset(@Param("slug") slug: string, @Body(new ZodPipe(Reset)) body: z.infer<typeof Reset>, @Req() req: Request) {
    if (!this.resetByIp.take(req.ip ?? "?")) throw new HttpException({ error: "too_many_attempts" }, 429);
    if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw new NotFoundException({ error: "venue_not_found" });
    const [o] = await this.db.global.$queryRaw<Array<{ organization_id: string; org_status: string }>>`SELECT * FROM app.org_by_slug(${slug})`;
    if (!o || o.org_status !== "ACTIVE") throw new NotFoundException({ error: "venue_not_found" });
    await this.db.withTenant({ organizationId: o.organization_id, actorType: "SYSTEM", actorId: null }, async (t) => {
      const who = body.username.trim().toLowerCase();
      const c = await t.customer.findFirst({ where: { status: { notIn: ["BANNED", "DELETED"] }, OR: [{ username: who }, { email: who }, { phone: body.username.trim() }] }, select: { id: true, resetCodeHash: true, resetCodeExpiresAt: true } });
      const live = !!c?.resetCodeHash && !!c.resetCodeExpiresAt && c.resetCodeExpiresAt > new Date();
      const ok = live && (await verifySecret(c!.resetCodeHash!, body.code));
      if (!live) await burnVerify(body.code);
      if (!ok || !c) throw new UnauthorizedException({ error: "invalid_code" });
      await t.customer.update({ where: { id: c.id }, data: { passwordHash: await hashSecret(body.password), resetCodeHash: null, resetCodeExpiresAt: null } });
      await t.customerSession.updateMany({ where: { customerId: c.id, endedAt: null, channel: { in: ["WEB", "MOBILE"] } }, data: { endedAt: new Date() } });
      await auditAs(t, { type: "CUSTOMER", id: c.id }, { action: "customer.reset_password", entityType: "Customer", entityId: c.id });
    });
  }

  // ── my stats ──────────────────────────────────────────────────────────────

  @Get("me/stats")
  stats(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { totalGamingMinutes: true, totalSpend: true, createdAt: true } });
      const [[totals], favourite, months] = await Promise.all([
        t.$queryRaw<Array<{ visits: number; sessions: number }>>`
          SELECT COUNT(DISTINCT ("startedAt" AT TIME ZONE 'UTC')::date)::int AS visits, COUNT(*)::int AS sessions
            FROM "GamingSession" WHERE "customerId" = ${me.customerId}::uuid AND "startedAt" IS NOT NULL`,
        t.$queryRaw<Array<{ station: string; minutes: number }>>`
          SELECT d."name" AS station, (SUM(s."billedSeconds") / 60)::int AS minutes
            FROM "GamingSession" s JOIN "Device" d ON d."id" = s."deviceId"
           WHERE s."customerId" = ${me.customerId}::uuid AND s."status" = 'ENDED'
           GROUP BY d."name" ORDER BY minutes DESC LIMIT 1`,
        t.$queryRaw<Array<{ month: Date; minutes: number; visits: number }>>`
          SELECT date_trunc('month', s."startedAt") AS month, (SUM(s."billedSeconds") / 60)::int AS minutes,
                 COUNT(DISTINCT (s."startedAt" AT TIME ZONE 'UTC')::date)::int AS visits
            FROM "GamingSession" s
           WHERE s."customerId" = ${me.customerId}::uuid AND s."startedAt" >= date_trunc('month', now()) - interval '5 months'
           GROUP BY 1 ORDER BY 1`,
      ]);
      return {
        minutes: c.totalGamingMinutes, spend: Number(c.totalSpend).toFixed(2), visits: totals?.visits ?? 0, sessions: totals?.sessions ?? 0, memberSince: c.createdAt,
        favouriteStation: favourite[0]?.station ?? null,
        months: months.map((m) => ({ month: m.month.toISOString().slice(0, 7), minutes: m.minutes, visits: m.visits })),
      };
    });
  }

  // ── live venue status ─────────────────────────────────────────────────────

  /** Free stations right now, per zone — counts only. */
  @Get("live")
  live(@Req() req: Request) {
    return this.as(req, async (t) => {
      const branches = await t.branch.findMany({ where: { status: "OPEN" }, select: { id: true, name: true, zones: { where: { isActive: true }, select: { id: true, name: true, type: true }, orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } });
      const counts = await t.device.groupBy({ by: ["zoneId", "status"], where: { isEnabled: true, kind: { in: ["GAMING_PC", "INTERNET_PC", "CONSOLE", "VR_HEADSET", "SIMULATOR"] } }, _count: { _all: true } });
      const of = (zoneId: string, free: boolean) => counts.filter((c) => c.zoneId === zoneId && (!free || c.status === "AVAILABLE")).reduce((s, c) => s + c._count._all, 0);
      return branches.map((b) => ({ ...b, zones: b.zones.map((z) => ({ ...z, total: of(z.id, false), free: of(z.id, true) })).filter((z) => z.total > 0) }));
    });
  }

  // ── food to my seat ───────────────────────────────────────────────────────

  private async mySeat(t: TenantTx, me: Me) {
    return t.gamingSession.findFirst({ where: { customerId: me.customerId, status: { in: [...LIVE] } }, select: { id: true, deviceId: true, branchId: true, device: { select: { name: true } } } });
  }

  @Get("menu")
  menu(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const seat = await this.mySeat(t, me);
      if (!seat) return { station: null, menu: null };
      return { station: seat.device.name, menu: await this.orders.menu(t, seat.branchId, { shellOnly: true }) };
    });
  }

  /** Delivered to the PC I'm playing on; on my session's bill or paid from my wallet. */
  @Post("orders")
  placeOrder(@Req() req: Request, @Body(new ZodPipe(Order)) body: z.infer<typeof Order>) {
    return this.as(req, async (t, me) => {
      const seat = await this.mySeat(t, me);
      if (!seat) throw new ConflictException({ error: "not_playing" });
      return this.orders.place(
        t,
        { branchId: seat.branchId, channel: "MOBILE", type: "GAMING_SEAT", deviceId: seat.deviceId, lines: body.lines, notes: body.notes ?? null, payments: body.payWith === "WALLET" ? [{ method: "WALLET" }] : undefined, idempotencyKey: `app:${me.customerId}:${body.idempotencyKey}` },
        { type: "CUSTOMER", id: me.customerId },
      );
    });
  }

  @Get("orders")
  myOrders(@Req() req: Request) {
    return this.as(req, (t, me) =>
      t.order.findMany({
        where: { customerId: me.customerId, createdAt: { gte: new Date(Date.now() - 86_400_000) }, type: { in: ["GAMING_SEAT", "DINE_IN", "TAKEAWAY", "PICKUP"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, number: true, status: true, total: true, currency: true, createdAt: true, orderItems: { select: { nameSnapshot: true, quantity: true } } },
      }),
    );
  }

  // ── add time to my running session ────────────────────────────────────────

  @Get("session/offers")
  offers(@Req() req: Request) {
    return this.as(req, (t, me) => this.shellTime.offersFor(t, { customerId: me.customerId }));
  }

  @Post("session/extend")
  extend(@Req() req: Request, @Body(new ZodPipe(Extend)) body: z.infer<typeof Extend>) {
    return this.as(req, (t, me) => this.shellTime.buyFor(t, { customerId: me.customerId }, body.packageId ?? null, body.savedMinutes ?? null, `app:${me.customerId}:${body.idempotencyKey}`));
  }

  // ── games & favourites ────────────────────────────────────────────────────

  @Get("games")
  games(@Req() req: Request, @Query("branchId") branchId?: string) {
    return this.as(req, async (t, me) => {
      const settings = await t.orgGameSetting.findMany({ where: { isEnabled: true, game: { isActive: true } }, select: { gameId: true, isFeatured: true, minAgeOverride: true, game: { select: { title: true, coverUrl: true, categories: true, minAge: true } } } });
      const branch = branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined;
      const installed = await t.gameInstallation.groupBy({ by: ["gameId"], where: { status: { in: ["INSTALLED", "UPDATE_REQUIRED"] }, device: { isEnabled: true, ...(branch ? { branchId: branch } : {}) } }, _count: { _all: true } });
      const favs = new Set((await t.customerFavoriteGame.findMany({ where: { customerId: me.customerId }, select: { gameId: true } })).map((f) => f.gameId));
      return settings
        .map((s) => ({ id: s.gameId, title: s.game.title, coverUrl: s.game.coverUrl, categories: s.game.categories, minAge: s.minAgeOverride ?? s.game.minAge, featured: s.isFeatured, stations: installed.find((i) => i.gameId === s.gameId)?._count._all ?? 0, favorite: favs.has(s.gameId) }))
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title));
    });
  }

  @Post("games/:gameId/favorite")
  @HttpCode(204)
  async favorite(@Req() req: Request, @Param("gameId") gameId: string) {
    await this.as(req, async (t, me) => {
      if (!/^[0-9a-f-]{36}$/i.test(gameId) || !(await t.orgGameSetting.findFirst({ where: { gameId, isEnabled: true }, select: { gameId: true } }))) throw new NotFoundException({ error: "game_not_found" });
      await t.customerFavoriteGame.createMany({ data: [{ organizationId: me.organizationId, customerId: me.customerId, gameId }], skipDuplicates: true });
    });
  }

  @Delete("games/:gameId/favorite")
  @HttpCode(204)
  async unfavorite(@Req() req: Request, @Param("gameId") gameId: string) {
    await this.as(req, (t, me) => t.customerFavoriteGame.deleteMany({ where: { customerId: me.customerId, gameId } }));
  }

  // ── friends ───────────────────────────────────────────────────────────────

  /** My invite code, who joined with it (first names only) and the points it earned me. */
  @Get("referrals")
  referrals(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { referralCode: true, referrals: { where: { status: { not: "DELETED" } }, select: { displayName: true, createdAt: true, lastVisitAt: true }, orderBy: { createdAt: "desc" }, take: 50 } } });
      const pts = await t.loyaltyTransaction.aggregate({ where: { customerId: me.customerId, source: "REFERRAL", type: "EARN" }, _sum: { points: true } });
      return { code: c.referralCode, friends: c.referrals.map((r) => ({ name: firstName(r.displayName), joinedAt: r.createdAt, played: !!r.lastVisitAt })), points: pts._sum.points ?? 0 };
    });
  }

  // ── help ──────────────────────────────────────────────────────────────────

  @Get("tickets")
  tickets(@Req() req: Request) {
    return this.as(req, (t, me) => t.supportTicket.findMany({ where: { customerId: me.customerId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, category: true, subject: true, message: true, status: true, createdAt: true, resolvedAt: true } }));
  }

  @Post("tickets")
  openTicket(@Req() req: Request, @Body(new ZodPipe(Ticket)) body: z.infer<typeof Ticket>) {
    return this.as(req, async (t, me) => {
      const seat = await this.mySeat(t, me);
      const home = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { homeBranchId: true } });
      const branchId = seat?.branchId ?? home.homeBranchId ?? (await t.branch.findFirst({ where: { status: "OPEN" }, select: { id: true }, orderBy: { name: "asc" } }))?.id;
      if (!branchId) throw new ConflictException({ error: "venue_closed" });
      const tk = await t.supportTicket.create({ data: { organizationId: me.organizationId, branchId, customerId: me.customerId, deviceId: seat?.deviceId ?? null, category: body.category, subject: body.subject, message: body.message ?? null } });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "ticket.open", entityType: "SupportTicket", entityId: tk.id, branchId, after: { subject: tk.subject } });
      return tk;
    });
  }

  // ── sign in at a PC with the phone ────────────────────────────────────────

  @Get("pc-login/:code")
  pcPreview(@Req() req: Request, @Param("code") code: string) {
    return this.as(req, (t, me) => this.shellAuth.codePreview(t, me.organizationId, code));
  }

  @Post("pc-login")
  @HttpCode(200)
  pcLogin(@Req() req: Request, @Body(new ZodPipe(z.object({ code: z.string().regex(/^[A-Za-z0-9]{6,16}$/) }).strict())) body: { code: string }) {
    return this.as(req, (t, me) => this.shellAuth.loginWithCode(t, me.organizationId, me.customerId, body.code));
  }

  // ── gifts ─────────────────────────────────────────────────────────────────

  /** Wallet money or saved minutes to a friend, by username. Bonus credit can't be given. */
  @Post("gift")
  gift(@Req() req: Request, @Body(new ZodPipe(Gift)) body: z.infer<typeof Gift>) {
    return this.as(req, async (t, me) => {
      const [from, to] = await Promise.all([
        t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { id: true, displayName: true } }),
        t.customer.findFirst({ where: { username: body.to.toLowerCase(), status: { in: ["ACTIVE", "RESTRICTED"] } }, select: { id: true, displayName: true } }),
      ]);
      if (!to) throw new NotFoundException({ error: "player_not_found", usernames: [body.to] });
      if (to.id === me.customerId) throw new ConflictException({ error: "gift_to_self" });
      const what = await this.transfer(t, me.customerId, to.id, body.bucket, body.amount, `gift:${me.customerId}:${body.idempotencyKey}`, `Gift to ${firstName(to.displayName)}`, `Gift from ${firstName(from.displayName)}`);
      await t.notification.createMany({ data: [{ organizationId: me.organizationId, recipientType: "CUSTOMER", customerId: to.id, channel: "IN_APP", event: "gift", title: `${firstName(from.displayName)} sent you a gift`, body: what, status: "SENT", sentAt: new Date(), dedupeKey: `gift:${me.customerId}:${body.idempotencyKey}` }], skipDuplicates: true });
      await this.push.notify(t, { customerId: to.id, event: "gift", title: `${firstName(from.displayName)} sent you a gift`, body: what, screen: "wallet", dedupeKey: `push:gift:${me.customerId}:${body.idempotencyKey}` });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "customer.gift", entityType: "Customer", entityId: me.customerId, after: { to: to.id, bucket: body.bucket, amount: body.amount } });
      return { sent: what, to: firstName(to.displayName) };
    });
  }

  /** Moves CASH (money) or TIME (minutes) between two customers as ledger transfers. Returns a human summary. */
  private async transfer(t: TenantTx, fromId: string, toId: string, bucket: "CASH" | "TIME", amount: string, key: string, outReason: string, inReason: string) {
    const { organizationId, currency, unit } = await orgCurrency(t);
    if (bucket === "TIME") {
      const minutes = Number(amount);
      if (!Number.isInteger(minutes) || minutes < 15 || minutes > 600) throw new ConflictException({ error: "bad_amount", hint: "15 to 600 minutes." });
      await adjustTime(t, { organizationId, currency, customerId: fromId, branchId: null, deltaMinutes: -minutes, type: "TRANSFER_OUT", reason: outReason, referenceType: "CUSTOMER", referenceId: toId, idempotencyKey: `${key}:out` });
      await adjustTime(t, { organizationId, currency, customerId: toId, branchId: null, deltaMinutes: minutes, type: "TRANSFER_IN", reason: inReason, referenceType: "CUSTOMER", referenceId: fromId, idempotencyKey: `${key}:in` });
      return `${minutes} min of play time`;
    }
    if (!/^\d{1,6}(\.\d{1,3})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > GIFT_CASH_MAX) throw new ConflictException({ error: "bad_amount", hint: `Up to ${currency} ${GIFT_CASH_MAX}.` });
    const minor = toMinor(amount, unit);
    await moveMoney(t, { customerId: fromId, bucket: "CASH", deltaMinor: -minor, type: "TRANSFER_OUT", reason: outReason, referenceType: "CUSTOMER", referenceId: toId, idempotencyKey: `${key}:out` });
    await moveMoney(t, { customerId: toId, bucket: "CASH", deltaMinor: minor, type: "TRANSFER_IN", reason: inReason, referenceType: "CUSTOMER", referenceId: fromId, idempotencyKey: `${key}:in` });
    return `${currency} ${fromMinor(minor, unit).toFixed(unit)}`;
  }

  // ── top up online ─────────────────────────────────────────────────────────

  /** Card top-up in the app. ponytail: only the simulated card exists; a real gateway plugs in here. */
  @Post("wallet/topup")
  topUp(@Req() req: Request, @Body(new ZodPipe(TopUp)) body: z.infer<typeof TopUp>) {
    if (!this.cfg.demoPayments) throw new HttpException({ error: "online_payment_unavailable", hint: "Top up at the counter." }, 400);
    return this.as(req, async (t, me) => {
      const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { homeBranchId: true } });
      const branchId = c.homeBranchId ?? (await t.branch.findFirst({ where: { status: "OPEN" }, select: { id: true }, orderBy: { name: "asc" } }))?.id;
      if (!branchId) throw new ConflictException({ error: "venue_closed" });
      return this.commerce.topUp(t, { customerId: me.customerId, branchId, amount: body.amount, payment: { method: "CARD", reference: "app-demo-card" }, idempotencyKey: `app:${me.customerId}:${body.idempotencyKey}` }, { type: "CUSTOMER", id: me.customerId });
    });
  }

  // ── leaderboard & challenges ──────────────────────────────────────────────

  /** Most hours played this month among players who opted in; my own place is shown either way. */
  @Get("leaderboard")
  leaderboard(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const rows = await t.$queryRaw<Array<{ id: string; name: string; minutes: number; opted: boolean }>>`
        SELECT c."id", c."displayName" AS name, (SUM(s."billedSeconds") / 60)::int AS minutes, c."showOnLeaderboard" AS opted
          FROM "GamingSession" s JOIN "Customer" c ON c."id" = s."customerId"
         WHERE s."status" = 'ENDED' AND s."startedAt" >= date_trunc('month', now()) AND c."status" <> 'DELETED'
         GROUP BY c."id" HAVING SUM(s."billedSeconds") >= 60
         ORDER BY minutes DESC`;
      const rank = rows.findIndex((r) => r.id === me.customerId);
      const opted = (await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { showOnLeaderboard: true } })).showOnLeaderboard;
      return {
        top: rows.filter((r) => r.opted).slice(0, 20).map((r, i) => ({ place: i + 1, name: firstName(r.name), minutes: r.minutes, me: r.id === me.customerId })),
        me: { minutes: rank >= 0 ? rows[rank]!.minutes : 0, place: rank >= 0 ? rank + 1 : null, of: rows.length, shown: opted },
      };
    });
  }

  @Get("challenges")
  challenges(@Req() req: Request) {
    return this.as(req, (t, me) => challengesFor(t, me.customerId, this.push));
  }

  // ── splitting a booking with friends ──────────────────────────────────────

  /** Friends get an inbox message to pay their share of my booking into my wallet. */
  @Post("bookings/:bookingId/invite")
  invite(@Req() req: Request, @Param("bookingId") bookingId: string, @Body(new ZodPipe(Invite)) body: z.infer<typeof Invite>) {
    return this.as(req, async (t, me) => {
      const b = await t.booking.findFirst({ where: { id: bookingId, customerId: me.customerId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gt: new Date() } }, select: { id: true, reference: true, startsAt: true, estimatedTotal: true, currency: true, branch: { select: { timezone: true } } } });
      if (!b) throw new NotFoundException({ error: "booking_not_found" });
      const names = [...new Set(body.usernames.map((u) => u.toLowerCase()))];
      const friends = await t.customer.findMany({ where: { username: { in: names }, id: { not: me.customerId }, status: { in: ["ACTIVE", "RESTRICTED"] } }, select: { id: true, username: true } });
      const missing = names.filter((n) => !friends.some((f) => f.username === n));
      if (missing.length) throw new NotFoundException({ error: "player_not_found", usernames: missing });
      const { unit } = await orgCurrency(t);
      const shareMinor = Math.ceil(toMinor(b.estimatedTotal, unit) / (friends.length + 1));
      const share = fromMinor(shareMinor, unit).toFixed(unit);
      const host = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { displayName: true } });
      const at = b.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: b.branch.timezone });
      for (const f of friends) {
        const title = `${firstName(host.displayName)} booked for you`;
        const text = `${at} · ${b.reference}. Your share is ${b.currency} ${share}.`;
        await t.notification.createMany({ data: [{ organizationId: me.organizationId, recipientType: "CUSTOMER", customerId: f.id, channel: "IN_APP", event: "booking.split", title, body: text, data: { bookingId: b.id, hostId: me.customerId, share, currency: b.currency, paid: false }, status: "SENT", sentAt: new Date(), dedupeKey: `split:${b.id}:${f.id}` }], skipDuplicates: true });
        await this.push.notify(t, { customerId: f.id, event: "booking.split", title, body: text, screen: "inbox", dedupeKey: `push:split:${b.id}:${f.id}` });
      }
      return { invited: friends.map((f) => f.username), share, currency: b.currency };
    });
  }

  /** Who I've invited to a booking and who has paid. */
  @Get("bookings/:bookingId/shares")
  shares(@Req() req: Request, @Param("bookingId") bookingId: string) {
    return this.as(req, async (t, me) => {
      if (!(await t.booking.findFirst({ where: { id: bookingId, customerId: me.customerId }, select: { id: true } }))) throw new NotFoundException({ error: "booking_not_found" });
      const rows = await t.notification.findMany({ where: { event: "booking.split", data: { path: ["bookingId"], equals: bookingId } }, select: { data: true, customer: { select: { displayName: true } } } });
      return rows.map((r) => ({ name: firstName(r.customer?.displayName ?? "?"), paid: !!(r.data as { paid?: boolean }).paid, share: (r.data as { share?: string }).share }));
    });
  }

  /** Pays my share of a friend's booking (from the inbox message) into their wallet. */
  @Post("inbox/:notificationId/pay-share")
  @HttpCode(200)
  payShare(@Req() req: Request, @Param("notificationId") id: string) {
    return this.as(req, async (t, me) => {
      const n = await t.notification.findFirst({ where: { id, customerId: me.customerId, event: "booking.split" }, select: { id: true, data: true } });
      if (!n) throw new NotFoundException({ error: "not_found" });
      const d = n.data as { bookingId: string; hostId: string; share: string; paid?: boolean };
      if (d.paid) return { paid: true };
      const b = await t.booking.findFirst({ where: { id: d.bookingId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] } }, select: { reference: true } });
      if (!b) throw new ConflictException({ error: "booking_not_active" });
      const me_ = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { displayName: true } });
      await this.transfer(t, me.customerId, d.hostId, "CASH", d.share, `split:${n.id}`, `Share of booking ${b.reference}`, `${firstName(me_.displayName)}'s share of ${b.reference}`);
      await t.notification.update({ where: { id: n.id }, data: { data: { ...d, paid: true } as Prisma.InputJsonValue, readAt: new Date(), status: "READ" } });
      await this.push.notify(t, { customerId: d.hostId, event: "booking.share_paid", title: `${firstName(me_.displayName)} paid their share`, body: `${b.reference}: +${d.share} in your wallet`, screen: "wallet", dedupeKey: `push:share-paid:${n.id}` });
      return { paid: true };
    });
  }

  // ── push notifications ────────────────────────────────────────────────────

  @Get("push/key")
  pushKey(@Req() req: Request) {
    return this.as(req, async () => ({ publicKey: this.push.publicKey }));
  }

  @Post("push/subscribe")
  @HttpCode(204)
  async subscribe(@Req() req: Request, @Body(new ZodPipe(z.object({ subscription: Subscription }).strict())) body: { subscription: z.infer<typeof Subscription> }) {
    await this.as(req, async (t, me) => {
      const token = JSON.stringify({ endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth } });
      await t.pushSubscription.upsert({
        where: { platform_token: { platform: "WEB_PUSH", token } },
        create: { organizationId: me.organizationId, customerId: me.customerId, platform: "WEB_PUSH", token },
        update: { customerId: me.customerId, lastUsedAt: new Date() }, // same phone, someone else signed in: it's theirs now
      });
    });
  }

  @Post("push/unsubscribe")
  @HttpCode(204)
  async unsubscribe(@Req() req: Request, @Body(new ZodPipe(z.object({ endpoint: z.url().max(1000) }).strict())) body: { endpoint: string }) {
    await this.as(req, (t, me) => t.pushSubscription.deleteMany({ where: { customerId: me.customerId, token: { contains: JSON.stringify(body.endpoint) } } }));
  }
}

/** A 6-digit one-time code (staff give it to a customer who forgot their password). */
export const resetCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
