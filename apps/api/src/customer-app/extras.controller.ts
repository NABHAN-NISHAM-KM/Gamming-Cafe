import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { Prisma, type Db, type TenantTx } from "@arena/db";
import { hashSecret, verifySecret } from "../auth/crypto.js";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { Public } from "../common/decorators.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CONFIG, type AppConfig } from "../config.js";
import { CommerceService } from "../customers/commerce.service.js";
import { movePoints } from "../loyalty/points.js";
import { completedCheckout, createCheckout, resolveSecret, verifyWebhook } from "../payments/stripe.js";
import { OrdersService } from "../pos/orders.service.js";
import { receipt } from "../pos/receipt.js";
import { PushService } from "../push/push.service.js";
import { adjustTime } from "../sessions/time-balance.js";
import { WaitlistService } from "../waitlist/waitlist.service.js";
import { fromMinor, moveMoney, orgCurrency, spentThisWeek, toMinor } from "../wallet/wallet.js";
import { CustomerAuth, Throttle, type Me } from "./customer-auth.js";

const Key = z.string().min(8).max(100);
const Money = (max: number) => z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,6}(\.\d{1,2})?$/.test(v) && Number(v) <= max, `0–${max}`);
const JoinLine = z.object({ branchId: z.uuid(), zoneId: z.uuid().nullish(), partySize: z.number().int().min(1).max(10).default(1) }).strict();
const NewLfg = z
  .object({ branchId: z.uuid(), game: z.string().trim().min(1).max(60), playersNeeded: z.number().int().min(1).max(20), startsAt: z.iso.datetime({ offset: true }), note: z.string().trim().max(300).nullish() })
  .strict()
  .refine((p) => Date.parse(p.startsAt) > Date.now() - 15 * 60_000 && Date.parse(p.startsAt) < Date.now() + 14 * 86_400_000, "within the next two weeks");
const Cap = z.object({ cap: Money(100_000).nullable() }).strict();
const LinkWard = z.object({ username: z.string().trim().min(3).max(32), code: z.string().regex(/^\d{6}$/) }).strict();
const Line = z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(20), modifierIds: z.array(z.uuid()).max(20).default([]), notes: z.string().max(200).nullish() }).strict();
const TableOrder = z.object({ lines: z.array(Line).min(1).max(30), notes: z.string().max(300).nullish(), payWith: z.enum(["BILL", "WALLET"]), idempotencyKey: Key }).strict();
const CardTopUp = z.object({ amount: Money(2000).refine((v) => Number(v) >= 5, "at least 5") }).strict();

const TierSchema = z.array(z.object({ xp: z.number().int().min(1), reward: z.object({ type: z.enum(["BONUS", "MINUTES", "POINTS"]), amount: z.number().positive() }) }));
/** XP for finishing a challenge during a season (one minute played = 1 XP). */
const XP_PER_CHALLENGE = 100;
/** Extra minutes a booking is held after "running late" (on top of the usual 15). */
const LATE_HOLD_MIN = 15;
const GUARDIAN_CODE_MIN = 15;

/**
 * The customer app's newer corners: the waitlist, "find a team", the season
 * pass, receipts, spending limits and guardians, ordering from a table's QR
 * code, card top-ups through the venue's gateway, and "running late" for a
 * booking. Everything runs as the signed-in customer, on their own records.
 */
@Public()
@Controller("app")
export class AppExtrasController {
  private readonly codeByCustomer = new Throttle(6, 15 * 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(CustomerAuth) private readonly auth: CustomerAuth,
    @Inject(WaitlistService) private readonly waitlist: WaitlistService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  private as<T>(req: Request, fn: (t: TenantTx, me: Me) => Promise<T>) {
    return this.auth.as(req, fn);
  }

  // ── waitlist ──────────────────────────────────────────────────────────────

  /** My place in line, and each open branch's zones with how many stations are free now. */
  @Get("waitlist")
  waitlistView(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const branches = await t.branch.findMany({ where: { status: "OPEN" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      const boards = await Promise.all(branches.map(async (b) => ({ ...b, zones: (await this.waitlist.board(t, b.id)).zones.map((z) => ({ id: z.id, name: z.name, free: z.free })) })));
      return { mine: await this.waitlist.mine(t, me.customerId), branches: boards };
    });
  }

  @Post("waitlist")
  joinLine(@Req() req: Request, @Body(new ZodPipe(JoinLine)) body: z.infer<typeof JoinLine>) {
    return this.as(req, async (t, me) => {
      const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { displayName: true, phone: true } });
      await this.waitlist.add(t, me.organizationId, { branchId: body.branchId, zoneId: body.zoneId ?? null, customerId: me.customerId, name: c.displayName, phone: c.phone, partySize: body.partySize, source: "APP" });
      await this.waitlist.tick(t, me.organizationId);
      return this.waitlist.mine(t, me.customerId);
    });
  }

  @Delete("waitlist")
  @HttpCode(204)
  leaveLine(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const mine = await this.waitlist.mine(t, me.customerId);
      if (!mine) throw new NotFoundException({ error: "not_waiting" });
      await this.waitlist.setStatus(t, mine.id, "CANCELLED", { customerId: me.customerId });
    });
  }

  // ── find a team ───────────────────────────────────────────────────────────

  @Get("lfg")
  lfg(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const posts = await t.lfgPost.findMany({
        where: { status: { in: ["OPEN", "FULL"] }, startsAt: { gt: new Date(Date.now() - 60 * 60_000) } },
        orderBy: { startsAt: "asc" },
        take: 50,
        include: { branch: { select: { name: true } }, customer: { select: { displayName: true } }, members: { select: { customerId: true, customer: { select: { displayName: true } } } } },
      });
      return posts.map((p) => ({
        id: p.id, game: p.game, branch: p.branch.name, branchId: p.branchId, startsAt: p.startsAt, note: p.note, status: p.status, playersNeeded: p.playersNeeded,
        host: p.customer.displayName.split(/\s+/)[0], mine: p.customerId === me.customerId, joined: p.members.some((m) => m.customerId === me.customerId),
        members: p.members.map((m) => m.customer.displayName.split(/\s+/)[0]),
      }));
    });
  }

  @Post("lfg")
  newLfg(@Req() req: Request, @Body(new ZodPipe(NewLfg)) body: z.infer<typeof NewLfg>) {
    return this.as(req, async (t, me) => {
      if (!(await t.branch.findFirst({ where: { id: body.branchId, status: "OPEN" }, select: { id: true } }))) throw new NotFoundException({ error: "branch_not_found" });
      if ((await t.lfgPost.count({ where: { customerId: me.customerId, status: "OPEN" } })) >= 3) throw new ConflictException({ error: "too_many_posts", hint: "Close one of your open posts first." });
      return t.lfgPost.create({ data: { organizationId: me.organizationId, branchId: body.branchId, customerId: me.customerId, game: body.game, playersNeeded: body.playersNeeded, startsAt: new Date(body.startsAt), note: body.note ?? null } });
    });
  }

  @Post("lfg/:postId/:action")
  @HttpCode(200)
  lfgAction(@Req() req: Request, @Param("postId") postId: string, @Param("action") action: string) {
    return this.as(req, async (t, me) => {
      const p = await t.lfgPost.findUnique({ where: { id: postId }, include: { members: { select: { customerId: true } } } });
      if (!p || p.status === "CLOSED") throw new NotFoundException({ error: "not_found" });
      if (action === "close") {
        if (p.customerId !== me.customerId) throw new ForbiddenException({ error: "not_yours" });
        return t.lfgPost.update({ where: { id: p.id }, data: { status: "CLOSED" } });
      }
      if (p.customerId === me.customerId) throw new ConflictException({ error: "own_post" });
      if (action === "join") {
        if (p.status !== "OPEN") throw new ConflictException({ error: "post_full" });
        await t.lfgMember.createMany({ data: [{ organizationId: me.organizationId, postId: p.id, customerId: me.customerId }], skipDuplicates: true });
        const count = await t.lfgMember.count({ where: { postId: p.id } });
        const full = count >= p.playersNeeded;
        if (full) await t.lfgPost.update({ where: { id: p.id }, data: { status: "FULL" } });
        const who = (await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { displayName: true } })).displayName.split(/\s+/)[0];
        await this.push.notify(t, { customerId: p.customerId, event: "lfg.join", title: full ? `Your ${p.game} team is full` : `${who} joined your ${p.game} game`, body: full ? "Everyone's in — book your stations together." : `${count} of ${p.playersNeeded} found.`, screen: "events", dedupeKey: `lfg:${p.id}:${me.customerId}` });
        return { joined: true, full };
      }
      if (action === "leave") {
        await t.lfgMember.deleteMany({ where: { postId: p.id, customerId: me.customerId } });
        if (p.status === "FULL") await t.lfgPost.update({ where: { id: p.id }, data: { status: "OPEN" } });
        return { joined: false };
      }
      throw new NotFoundException({ error: "not_found" });
    });
  }

  // ── season pass ───────────────────────────────────────────────────────────

  private async xp(t: TenantTx, customerId: string, s: { startsAt: Date; endsAt: Date }) {
    const until = new Date(Math.min(Date.now(), s.endsAt.getTime()));
    const [r] = await t.$queryRaw<Array<{ minutes: number }>>`
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE("endedAt", now()), ${until}) - GREATEST("startedAt", ${s.startsAt}))) / 60), 0)::float AS minutes
        FROM "GamingSession" WHERE "customerId" = ${customerId}::uuid AND "startedAt" IS NOT NULL AND "status" <> 'CANCELLED'
         AND "startedAt" < ${until} AND COALESCE("endedAt", now()) > ${s.startsAt}`;
    const challenges = await t.customerAchievement.count({ where: { customerId, earnedAt: { gte: s.startsAt, lt: until } } });
    return Math.floor(r?.minutes ?? 0) + challenges * XP_PER_CHALLENGE;
  }

  @Get("seasons")
  seasons(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const now = new Date();
      const list = await t.season.findMany({ where: { isActive: true, endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 14 * 86_400_000) } }, orderBy: { startsAt: "asc" }, include: { passes: { where: { customerId: me.customerId } } } });
      return Promise.all(
        list.map(async (s) => {
          const pass = s.passes[0] ?? null;
          const tiers = TierSchema.safeParse(s.tiers).success ? TierSchema.parse(s.tiers) : [];
          const xp = pass ? await this.xp(t, me.customerId, s) : 0;
          return {
            id: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, price: s.price.toFixed(2), currency: s.currency, joined: !!pass, xp,
            tiers: tiers.map((x, i) => ({ index: i, xp: x.xp, reward: x.reward, reached: !!pass && xp >= x.xp, claimed: !!pass?.claimedTiers.includes(i) })),
          };
        }),
      );
    });
  }

  @Post("seasons/:seasonId/join")
  @HttpCode(200)
  joinSeason(@Req() req: Request, @Param("seasonId") seasonId: string) {
    return this.as(req, async (t, me) => {
      const s = await t.season.findFirst({ where: { id: seasonId, isActive: true, endsAt: { gt: new Date() } } });
      if (!s) throw new NotFoundException({ error: "not_found" });
      if (await t.seasonPass.findUnique({ where: { seasonId_customerId: { seasonId, customerId: me.customerId } } })) return { joined: true };
      if (s.price.gt(0)) {
        const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { homeBranchId: true } });
        const branchId = c.homeBranchId ?? (await t.branch.findFirst({ where: { status: "OPEN" }, select: { id: true }, orderBy: { name: "asc" } }))?.id;
        if (!branchId) throw new ConflictException({ error: "venue_closed" });
        await this.commerce.sellSeasonPass(t, { customerId: me.customerId, branchId, name: s.name, price: s.price.toFixed(2), idempotencyKey: `season:${s.id}:${me.customerId}` }, { type: "CUSTOMER", id: me.customerId });
      }
      await t.seasonPass.create({ data: { organizationId: me.organizationId, seasonId, customerId: me.customerId } });
      return { joined: true };
    });
  }

  @Post("seasons/:seasonId/claim/:tier")
  @HttpCode(200)
  claimTier(@Req() req: Request, @Param("seasonId") seasonId: string, @Param("tier") tierParam: string) {
    return this.as(req, async (t, me) => {
      const pass = await t.seasonPass.findUnique({ where: { seasonId_customerId: { seasonId, customerId: me.customerId } }, include: { season: true } });
      if (!pass) throw new NotFoundException({ error: "not_joined" });
      const tiers = TierSchema.parse(pass.season.tiers);
      const i = Number(tierParam);
      const tier = Number.isInteger(i) ? tiers[i] : undefined;
      if (!tier) throw new NotFoundException({ error: "not_found" });
      if (pass.claimedTiers.includes(i)) throw new ConflictException({ error: "already_claimed" });
      if ((await this.xp(t, me.customerId, pass.season)) < tier.xp) throw new ConflictException({ error: "not_reached" });
      // Claimed first (one row update) so a double tap can't pay twice.
      const moved = await t.seasonPass.updateMany({ where: { id: pass.id, NOT: { claimedTiers: { has: i } } }, data: { claimedTiers: { push: i } } });
      if (moved.count !== 1) throw new ConflictException({ error: "already_claimed" });
      const key = `season:${seasonId}:${me.customerId}:${i}`;
      const reason = `${pass.season.name} — level ${i + 1}`;
      if (tier.reward.type === "POINTS") await movePoints(t, { customerId: me.customerId, delta: Math.round(tier.reward.amount), type: "EARN", source: "ACHIEVEMENT", reason, referenceType: "SEASON", referenceId: seasonId, idempotencyKey: key });
      else if (tier.reward.type === "MINUTES") {
        const { currency } = await orgCurrency(t);
        await adjustTime(t, { organizationId: me.organizationId, customerId: me.customerId, branchId: null, currency, deltaMinutes: Math.round(tier.reward.amount), type: "ADJUSTMENT", reason, referenceType: "SEASON", referenceId: seasonId, idempotencyKey: key });
      } else {
        const { unit } = await orgCurrency(t);
        await moveMoney(t, { customerId: me.customerId, bucket: "BONUS", deltaMinor: toMinor(tier.reward.amount, unit), type: "BONUS_GRANT", reason, referenceType: "SEASON", referenceId: seasonId, expiresAt: new Date(Date.now() + 30 * 86_400_000), idempotencyKey: key });
      }
      return { claimed: i, reward: tier.reward };
    });
  }

  // ── receipts ──────────────────────────────────────────────────────────────

  @Get("me/bills")
  bills(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const rows = await t.bill.findMany({ where: { customerId: me.customerId, status: "SETTLED" }, orderBy: { openedAt: "desc" }, take: 50, select: { id: true, number: true, total: true, currency: true, openedAt: true, closedAt: true, status: true } });
      return rows.map((b) => ({ ...b, total: b.total.toFixed(2) }));
    });
  }

  @Get("me/bills/:billId")
  bill(@Req() req: Request, @Param("billId") billId: string) {
    return this.as(req, (t, me) => receipt(t, billId, { customerId: me.customerId }));
  }

  // ── spending limit & guardians ────────────────────────────────────────────

  private async capView(t: TenantTx, customerId: string) {
    const { unit, currency } = await orgCurrency(t);
    const c = await t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { weeklySpendCap: true, spendCapByGuardian: true, guardian: { select: { displayName: true } } } });
    const spent = await spentThisWeek(t, customerId, unit);
    const cap = c.weeklySpendCap ? toMinor(c.weeklySpendCap, unit) : null;
    const f = (m: number) => fromMinor(m, unit).toFixed(unit);
    return { currency, cap: cap === null ? null : f(cap), spentThisWeek: f(spent), left: cap === null ? null : f(Math.max(0, cap - spent)), setByGuardian: c.spendCapByGuardian, guardian: c.guardian?.displayName ?? null };
  }

  @Get("me/spending")
  spending(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const wards = await t.customer.findMany({ where: { guardianId: me.customerId }, select: { id: true, displayName: true, username: true } });
      return { ...(await this.capView(t, me.customerId)), wards: await Promise.all(wards.map(async (w) => ({ id: w.id, name: w.displayName, username: w.username, ...(await this.capView(t, w.id)) }))) };
    });
  }

  @Put("me/spending")
  setCap(@Req() req: Request, @Body(new ZodPipe(Cap)) body: z.infer<typeof Cap>) {
    return this.as(req, async (t, me) => {
      const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { spendCapByGuardian: true } });
      if (c.spendCapByGuardian) throw new ForbiddenException({ error: "set_by_guardian", hint: "Your guardian set this limit." });
      await t.customer.update({ where: { id: me.customerId }, data: { weeklySpendCap: body.cap === null ? null : new Prisma.Decimal(body.cap) } });
      return this.capView(t, me.customerId);
    });
  }

  /** The child shows this code to the parent, who enters it to link the accounts. */
  @Post("me/guardian-code")
  @HttpCode(200)
  guardianCode(@Req() req: Request) {
    return this.as(req, async (t, me) => {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await t.customer.update({ where: { id: me.customerId }, data: { guardianCodeHash: await hashSecret(code), guardianCodeExpiresAt: new Date(Date.now() + GUARDIAN_CODE_MIN * 60_000) } });
      return { code, expiresInMinutes: GUARDIAN_CODE_MIN };
    });
  }

  @Post("me/wards")
  @HttpCode(200)
  linkWard(@Req() req: Request, @Body(new ZodPipe(LinkWard)) body: z.infer<typeof LinkWard>) {
    return this.as(req, async (t, me) => {
      if (!this.codeByCustomer.take(me.customerId)) throw new HttpException({ error: "too_many_attempts" }, 429);
      const w = await t.customer.findFirst({ where: { username: body.username.toLowerCase() }, select: { id: true, guardianId: true, guardianCodeHash: true, guardianCodeExpiresAt: true } });
      const ok = !!w && w.id !== me.customerId && !!w.guardianCodeHash && !!w.guardianCodeExpiresAt && w.guardianCodeExpiresAt > new Date() && (await verifySecret(w.guardianCodeHash, body.code));
      if (!ok) throw new ForbiddenException({ error: "wrong_code", hint: "Ask them to show a fresh code in their app (Me → Spending)." });
      await t.customer.update({ where: { id: w!.id }, data: { guardianId: me.customerId, guardianCodeHash: null, guardianCodeExpiresAt: null } });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "customer.guardian_link", entityType: "Customer", entityId: w!.id, after: { guardianId: me.customerId } });
      this.codeByCustomer.clear(me.customerId);
      return { linked: true };
    });
  }

  @Put("me/wards/:wardId/spending")
  setWardCap(@Req() req: Request, @Param("wardId") wardId: string, @Body(new ZodPipe(Cap)) body: z.infer<typeof Cap>) {
    return this.as(req, async (t, me) => {
      const w = await t.customer.findFirst({ where: { id: wardId, guardianId: me.customerId }, select: { id: true } });
      if (!w) throw new NotFoundException({ error: "not_found" });
      await t.customer.update({ where: { id: w.id }, data: { weeklySpendCap: body.cap === null ? null : new Prisma.Decimal(body.cap), spendCapByGuardian: body.cap !== null } });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "customer.guardian_cap", entityType: "Customer", entityId: w.id, after: { cap: body.cap } });
      return this.capView(t, w.id);
    });
  }

  @Delete("me/wards/:wardId")
  @HttpCode(204)
  unlinkWard(@Req() req: Request, @Param("wardId") wardId: string) {
    return this.as(req, async (t, me) => {
      const w = await t.customer.findFirst({ where: { id: wardId, guardianId: me.customerId }, select: { id: true } });
      if (!w) throw new NotFoundException({ error: "not_found" });
      await t.customer.update({ where: { id: w.id }, data: { guardianId: null, spendCapByGuardian: false } });
    });
  }

  // ── ordering from a table's QR code ───────────────────────────────────────

  private async table(t: TenantTx, tableId: string) {
    const table = await t.restaurantTable.findFirst({ where: { id: tableId, isActive: true }, select: { id: true, name: true, branchId: true, branch: { select: { name: true } } } });
    if (!table) throw new NotFoundException({ error: "table_not_found" });
    return table;
  }

  @Get("tables/:tableId")
  tableMenu(@Req() req: Request, @Param("tableId") tableId: string) {
    return this.as(req, async (t) => {
      const table = await this.table(t, tableId);
      return { table: { id: table.id, name: table.name, branch: table.branch.name }, menu: await this.orders.menu(t, table.branchId) };
    });
  }

  @Post("tables/:tableId/orders")
  tableOrder(@Req() req: Request, @Param("tableId") tableId: string, @Body(new ZodPipe(TableOrder)) body: z.infer<typeof TableOrder>) {
    return this.as(req, async (t, me) => {
      const table = await this.table(t, tableId);
      return this.orders.place(
        t,
        { branchId: table.branchId, channel: "MOBILE", type: "DINE_IN", tableId: table.id, customerId: me.customerId, lines: body.lines, notes: body.notes ?? null, payments: body.payWith === "WALLET" ? [{ method: "WALLET" }] : undefined, idempotencyKey: `app:${me.customerId}:${body.idempotencyKey}` },
        { type: "CUSTOMER", id: me.customerId },
      );
    });
  }

  // ── card top-up through the venue's gateway ───────────────────────────────

  private async gateway(t: TenantTx) {
    const g = await t.paymentGatewayConfig.findFirst({ where: { provider: "STRIPE", isActive: true, branchId: null } });
    const key = resolveSecret(g?.credentialsRef);
    return g && key ? { g, key } : null;
  }

  @Get("wallet/card")
  cardAvailable(@Req() req: Request) {
    return this.as(req, async (t) => ({ available: !!(await this.gateway(t)) }));
  }

  @Post("wallet/checkout")
  @HttpCode(200)
  cardCheckout(@Req() req: Request, @Body(new ZodPipe(CardTopUp)) body: z.infer<typeof CardTopUp>) {
    return this.as(req, async (t, me) => {
      const gw = await this.gateway(t);
      if (!gw) throw new HttpException({ error: "online_payment_unavailable", hint: "Top up at the counter." }, 400);
      const { currency, unit } = await orgCurrency(t);
      const org = await t.organization.findFirstOrThrow({ select: { slug: true, displayName: true } });
      const c = await t.customer.findUniqueOrThrow({ where: { id: me.customerId }, select: { email: true } });
      const row = await t.walletTopUp.create({ data: { organizationId: me.organizationId, customerId: me.customerId, amount: new Prisma.Decimal(body.amount), currency, provider: "STRIPE" } });
      const app = `${this.cfg.CUSTOMER_APP_URL.replace(/\/+$/, "")}/${org.slug}`;
      const s = await createCheckout(gw.key, {
        amountMinor: toMinor(body.amount, unit), currency, name: `${org.displayName} wallet top-up`, successUrl: `${app}?topup=done`, cancelUrl: `${app}?topup=cancelled`,
        customerEmail: c.email, metadata: { kind: "wallet_topup", topUpId: row.id, organizationId: me.organizationId },
      });
      await t.walletTopUp.update({ where: { id: row.id }, data: { providerRef: s.id } });
      return { url: s.url, topUpId: row.id };
    });
  }

  /** The gateway confirms a payment. Signed with the venue's webhook secret; the wallet is credited once. */
  @Post(":slug/stripe-webhook")
  @HttpCode(200)
  async stripeWebhook(@Req() req: Request & { rawBody?: Buffer }, @Param("slug") slug: string) {
    if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw new NotFoundException({ error: "not_found" });
    const [org] = await this.db.global.$queryRaw<Array<{ organization_id: string }>>`SELECT * FROM app.org_by_slug(${slug})`;
    if (!org) throw new NotFoundException({ error: "not_found" });
    const raw = req.rawBody?.toString("utf8") ?? "";
    return this.db.withTenant({ organizationId: org.organization_id, actorType: "SYSTEM", actorId: null }, async (t) => {
      const g = await t.paymentGatewayConfig.findFirst({ where: { provider: "STRIPE", branchId: null } });
      const secret = resolveSecret(g?.webhookSecretRef);
      if (!secret || !verifyWebhook(secret, raw, req.headers["stripe-signature"] as string | undefined)) throw new ForbiddenException({ error: "bad_signature" });
      const done = completedCheckout(JSON.parse(raw));
      if (!done || done.metadata["kind"] !== "wallet_topup") return { received: true };
      const row = await t.walletTopUp.findFirst({ where: { id: done.metadata["topUpId"] ?? "", providerRef: done.id } });
      if (!row || row.status === "PAID") return { received: true };
      if (!done.paid) {
        await t.walletTopUp.update({ where: { id: row.id }, data: { status: "FAILED" } });
        return { received: true };
      }
      const { unit } = await orgCurrency(t);
      if (done.amountMinor !== toMinor(row.amount, unit) || done.currency !== row.currency) throw new ConflictException({ error: "amount_mismatch" });
      const c = await t.customer.findUniqueOrThrow({ where: { id: row.customerId }, select: { homeBranchId: true } });
      const branchId = c.homeBranchId ?? (await t.branch.findFirst({ where: { status: "OPEN" }, select: { id: true }, orderBy: { name: "asc" } }))?.id;
      if (!branchId) throw new ConflictException({ error: "venue_closed" });
      await this.commerce.topUp(t, { customerId: row.customerId, branchId, amount: row.amount.toFixed(unit), payment: { method: "CARD", reference: done.id }, idempotencyKey: `topup:${row.id}` }, { type: "CUSTOMER", id: row.customerId });
      await t.walletTopUp.update({ where: { id: row.id }, data: { status: "PAID", paidAt: new Date() } });
      await this.push.notify(t, { customerId: row.customerId, event: "wallet.topup", title: "Top-up received", body: `${row.amount.toFixed(unit)} ${row.currency} is in your wallet.`, screen: "wallet", dedupeKey: `topup:${row.id}` });
      return { received: true };
    });
  }

  // ── bookings: running late, directions ────────────────────────────────────

  @Post("bookings/:bookingId/late")
  @HttpCode(200)
  late(@Req() req: Request, @Param("bookingId") bookingId: string) {
    return this.as(req, async (t, me) => {
      const b = await t.booking.findFirst({ where: { id: bookingId, customerId: me.customerId } });
      if (!b) throw new NotFoundException({ error: "not_found" });
      if (b.status !== "CONFIRMED") throw new ConflictException({ error: "not_confirmed" });
      if (b.runningLateUntil) throw new ConflictException({ error: "already_late" });
      const now = Date.now();
      if (now < b.startsAt.getTime() - 60 * 60_000 || now > b.startsAt.getTime() + 15 * 60_000) throw new ConflictException({ error: "not_now", hint: "You can say you're running late from an hour before until 15 minutes after the start." });
      const until = new Date(b.startsAt.getTime() + (15 + LATE_HOLD_MIN) * 60_000);
      await t.booking.update({ where: { id: b.id }, data: { runningLateUntil: until } });
      await auditAs(t, { type: "CUSTOMER", id: me.customerId }, { action: "booking.running_late", entityType: "Booking", entityId: b.id, branchId: b.branchId, after: { holdUntil: until } });
      return { holdUntil: until };
    });
  }

  @Get("bookings/:bookingId/directions")
  directions(@Req() req: Request, @Param("bookingId") bookingId: string) {
    return this.as(req, async (t, me) => {
      const b = await t.booking.findFirst({ where: { id: bookingId, customerId: me.customerId }, select: { startsAt: true, runningLateUntil: true, branch: { select: { name: true, addressLine1: true, addressLine2: true, city: true, phone: true, latitude: true, longitude: true, openingHours: true } } } });
      if (!b) throw new NotFoundException({ error: "not_found" });
      const br = b.branch;
      const address = [br.addressLine1, br.addressLine2, br.city].filter(Boolean).join(", ");
      const q = br.latitude && br.longitude ? `${br.latitude},${br.longitude}` : address || br.name;
      return { branch: br.name, address: address || null, phone: br.phone, openingHours: br.openingHours, mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, runningLateUntil: b.runningLateUntil };
    });
  }
}
