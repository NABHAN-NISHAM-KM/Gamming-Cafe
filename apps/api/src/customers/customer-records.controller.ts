import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { Prisma } from "@arena/db";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CommerceService } from "./commerce.service.js";
import { mergeCustomers } from "./merge.js";
import { RestrictionInput, syncStatus } from "./restrictions.js";

const AddRestriction = z.intersection(
  RestrictionInput,
  z.object({ reason: z.string().trim().min(3).max(200), endsAt: z.iso.datetime({ offset: true }).nullish() }),
).refine((r) => !r.endsAt || new Date(r.endsAt) > new Date(), { message: "endsAt must be in the future", path: ["endsAt"] });
const Note = z.object({ body: z.string().trim().min(1).max(1000) }).strict();
const Verify = z.object({ channel: z.enum(["email", "phone"]), verified: z.boolean() }).strict();
const Merge = z.object({ fromId: z.uuid(), branchId: z.uuid() }).strict();
const Ticket = z.object({ branchId: z.uuid(), category: z.enum(["HARDWARE", "GAME", "PAYMENT", "FOOD", "OTHER"]), subject: z.string().trim().min(3).max(120), message: z.string().max(2000).nullish() }).strict();
const Before = z.object({ before: z.iso.datetime({ offset: true }).optional() }).strict();

const STEP = 25;

/**
 * The customer's file beyond the basics: restrictions, staff notes, the
 * at-a-glance numbers and warning signs, a full activity timeline, contact
 * verification, merging a duplicate account, and support tickets.
 */
@Controller("customers/:customerId")
export class CustomerRecordsController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  // ── restrictions ──────────────────────────────────────────────────────────

  @RequirePermissionAnyScope("customer.view")
  @Get("restrictions")
  async restrictions(@Param("customerId") customerId: string) {
    await exists(customerId);
    return tx().customerRestriction.findMany({
      where: { customerId },
      orderBy: [{ liftedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      take: 50,
      include: { createdBy: { select: { displayName: true } } },
    });
  }

  @RequirePermissionAnyScope("customer.restrict")
  @Post("restrictions")
  async restrict(@Param("customerId") customerId: string, @Body(new ZodPipe(AddRestriction)) body: z.infer<typeof AddRestriction>) {
    await exists(customerId);
    const r = await tx().customerRestriction.create({
      data: { organizationId: orgId(), customerId, type: body.type, scope: body.scope as Prisma.InputJsonValue, reason: body.reason, endsAt: body.endsAt ? new Date(body.endsAt) : null, createdById: principal().employeeId },
    });
    const status = await syncStatus(tx(), customerId);
    await this.audit.record({ action: "customer.restrict", entityType: "Customer", entityId: customerId, after: { type: r.type, scope: body.scope, reason: r.reason, endsAt: r.endsAt, status } });
    return r;
  }

  @RequirePermissionAnyScope("customer.restrict")
  @Post("restrictions/:restrictionId/lift")
  @HttpCode(200)
  async lift(@Param("customerId") customerId: string, @Param("restrictionId") restrictionId: string) {
    const r = await tx().customerRestriction.findFirst({ where: { id: restrictionId, customerId } });
    if (!r) throw new NotFoundException({ error: "not_found" });
    if (r.liftedAt) throw new ConflictException({ error: "already_lifted" });
    const after = await tx().customerRestriction.update({ where: { id: r.id }, data: { liftedAt: new Date(), liftedById: principal().employeeId } });
    const status = await syncStatus(tx(), customerId);
    await this.audit.record({ action: "customer.lift_restriction", entityType: "Customer", entityId: customerId, before: { type: r.type, reason: r.reason }, after: { status } });
    return after;
  }

  // ── staff notes ───────────────────────────────────────────────────────────

  @RequirePermissionAnyScope("customer.view")
  @Get("notes")
  notes(@Param("customerId") customerId: string) {
    return tx().customerNote.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 100, include: { author: { select: { id: true, displayName: true } } } });
  }

  @RequirePermissionAnyScope("customer.edit")
  @Post("notes")
  async addNote(@Param("customerId") customerId: string, @Body(new ZodPipe(Note)) body: z.infer<typeof Note>) {
    await exists(customerId);
    const n = await tx().customerNote.create({ data: { organizationId: orgId(), customerId, authorId: principal().employeeId, body: body.body }, include: { author: { select: { id: true, displayName: true } } } });
    await this.audit.record({ action: "customer.note", entityType: "Customer", entityId: customerId, after: { noteId: n.id } });
    return n;
  }

  /** Only the author removes their own note. */
  @RequirePermissionAnyScope("customer.edit")
  @Delete("notes/:noteId")
  @HttpCode(204)
  async deleteNote(@Param("customerId") customerId: string, @Param("noteId") noteId: string) {
    const n = await tx().customerNote.findFirst({ where: { id: noteId, customerId } });
    if (!n) throw new NotFoundException({ error: "not_found" });
    if (n.authorId !== principal().employeeId) throw new ForbiddenException({ error: "not_your_note" });
    await tx().customerNote.delete({ where: { id: n.id } });
    await this.audit.record({ action: "customer.note_delete", entityType: "Customer", entityId: customerId, before: { body: n.body } });
  }

  // ── insights ──────────────────────────────────────────────────────────────

  /** Numbers at a glance, referrals, favourites, achievements, recent logins and warning signs. */
  @RequirePermissionAnyScope("customer.view")
  @Get("insights")
  async insights(@Param("customerId") customerId: string) {
    const t = tx();
    const c = await t.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true, displayName: true, firstName: true, lastName: true, dateOfBirth: true, totalSpend: true, totalGamingMinutes: true, lastVisitAt: true, createdAt: true, referralCode: true,
        referredBy: { select: { id: true, displayName: true, username: true } },
        referrals: { where: { status: { not: "DELETED" } }, select: { id: true, displayName: true, username: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 },
        customerFavoriteGames: { select: { game: { select: { id: true, title: true, coverUrl: true } } }, take: 20 },
        customerAchievements: { select: { earnedAt: true, achievement: { select: { name: true, description: true, iconUrl: true } } }, orderBy: { earnedAt: "desc" }, take: 30 },
        customerSessions: { select: { id: true, channel: true, ip: true, startedAt: true, endedAt: true, lastActiveAt: true, device: { select: { name: true } } }, orderBy: { startedAt: "desc" }, take: 20 },
        wallets: { select: { isFrozen: true } },
      },
    });
    if (!c) throw new NotFoundException({ error: "not_found" });
    const [[visits], [risk], duplicates, pastBans] = await Promise.all([
      t.$queryRaw<Array<{ days: number }>>`SELECT COUNT(DISTINCT ("startedAt" AT TIME ZONE 'UTC')::date)::int AS days FROM "GamingSession" WHERE "customerId" = ${customerId}::uuid AND "startedAt" IS NOT NULL`,
      // A top-up taken back within a day, and manual wallet corrections — both worth a second look.
      t.$queryRaw<Array<{ quick_refunds: number; adjustments: number }>>`
        SELECT
          (SELECT COUNT(*)::int FROM "WalletTransaction" r JOIN "Wallet" w ON w."id" = r."walletId"
            WHERE w."customerId" = ${customerId}::uuid AND r."type" = 'REFUND' AND r."createdAt" > now() - interval '90 days'
              AND EXISTS (SELECT 1 FROM "WalletTransaction" u WHERE u."walletId" = r."walletId" AND u."type" = 'TOPUP' AND u."createdAt" BETWEEN r."createdAt" - interval '24 hours' AND r."createdAt")) AS quick_refunds,
          (SELECT COUNT(*)::int FROM "WalletTransaction" a JOIN "Wallet" w ON w."id" = a."walletId"
            WHERE w."customerId" = ${customerId}::uuid AND a."type" = 'ADJUSTMENT' AND a."createdAt" > now() - interval '30 days') AS adjustments`,
      t.customer.findMany({
        where: {
          id: { not: customerId }, status: { not: "DELETED" },
          OR: [
            { displayName: { equals: c.displayName, mode: "insensitive" } },
            ...(c.firstName && c.lastName ? [{ firstName: { equals: c.firstName, mode: "insensitive" as const }, lastName: { equals: c.lastName, mode: "insensitive" as const } }] : []),
            ...(c.dateOfBirth && c.lastName ? [{ dateOfBirth: c.dateOfBirth, lastName: { equals: c.lastName, mode: "insensitive" as const } }] : []),
          ],
        },
        select: { id: true, username: true, displayName: true },
        take: 5,
      }),
      t.customerRestriction.count({ where: { customerId, type: "BAN" } }),
    ]);
    const spend = Number(c.totalSpend);
    const flags = [
      ...(c.wallets.some((w) => w.isFrozen) ? [{ level: "danger", text: "Wallet is frozen" }] : []),
      ...(risk!.quick_refunds ? [{ level: "warn", text: `${risk!.quick_refunds} top-up(s) refunded within a day (90 days)` }] : []),
      ...(risk!.adjustments >= 3 ? [{ level: "warn", text: `${risk!.adjustments} manual wallet corrections in 30 days` }] : []),
      ...(pastBans ? [{ level: "warn", text: `Banned ${pastBans} time(s) before` }] : []),
      ...(duplicates.length ? [{ level: "info", text: `Looks like ${duplicates.map((d) => `@${d.username}`).join(", ")} — same person?` }] : []),
    ];
    return {
      summary: { totalSpend: spend.toFixed(2), gamingMinutes: c.totalGamingMinutes, visits: visits!.days, avgSpendPerVisit: visits!.days ? (spend / visits!.days).toFixed(2) : null, lastVisitAt: c.lastVisitAt, memberSince: c.createdAt },
      referralCode: c.referralCode,
      referredBy: c.referredBy,
      referrals: c.referrals,
      favorites: c.customerFavoriteGames.map((f) => f.game),
      achievements: c.customerAchievements.map((a) => ({ ...a.achievement, earnedAt: a.earnedAt })),
      logins: c.customerSessions,
      flags,
      duplicates,
    };
  }

  // ── activity timeline ─────────────────────────────────────────────────────

  /** Everything the customer did, newest first, STEP at a time (pass the last `at` as ?before=). */
  @RequirePermissionAnyScope("customer.view")
  @Get("activity")
  async activity(@Param("customerId") customerId: string, @Query(new ZodPipe(Before)) q: z.infer<typeof Before>) {
    const t = tx();
    const before = q.before ? new Date(q.before) : new Date(Date.now() + 60_000);
    const page = { orderBy: { createdAt: "desc" as const }, take: STEP };
    const [sessions, orders, money, bookings, prints, points, memberships] = await Promise.all([
      t.gamingSession.findMany({ where: { customerId, createdAt: { lt: before } }, ...page, select: { id: true, createdAt: true, status: true, amountDue: true, currency: true, startedAt: true, endedAt: true, device: { select: { name: true } } } }),
      t.order.findMany({ where: { customerId, createdAt: { lt: before } }, ...page, select: { id: true, createdAt: true, number: true, status: true, total: true, currency: true, type: true } }),
      t.walletTransaction.findMany({ where: { wallet: { customerId }, createdAt: { lt: before } }, ...page, select: { id: true, createdAt: true, type: true, bucket: true, amount: true, currency: true, reason: true } }),
      t.booking.findMany({ where: { customerId, createdAt: { lt: before } }, ...page, select: { id: true, createdAt: true, reference: true, status: true, startsAt: true } }),
      t.printJob.findMany({ where: { customerId, createdAt: { lt: before } }, ...page, select: { id: true, createdAt: true, pages: true, total: true, status: true } }),
      t.loyaltyTransaction.findMany({ where: { customerId, createdAt: { lt: before } }, ...page, select: { id: true, createdAt: true, type: true, points: true, reason: true } }),
      t.membership.findMany({ where: { customerId, createdAt: { lt: before } }, ...page, select: { id: true, createdAt: true, status: true, tier: { select: { name: true } } } }),
    ]);
    const money2 = (v: unknown) => Number(v).toFixed(2);
    const items = [
      ...sessions.map((s) => ({ kind: "session", id: s.id, at: s.createdAt, title: `Played on ${s.device.name}`, detail: s.startedAt && s.endedAt ? `${Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000)} min` : s.status.toLowerCase(), amount: `${s.currency} ${money2(s.amountDue)}` })),
      ...orders.map((o) => ({ kind: "order", id: o.id, at: o.createdAt, title: `Order ${o.number}`, detail: `${o.type.toLowerCase().replace(/_/g, " ")} · ${o.status.toLowerCase()}`, amount: `${o.currency} ${money2(o.total)}` })),
      ...money.map((m) => ({ kind: "wallet", id: m.id, at: m.createdAt, title: `${m.bucket === "TIME" ? "Prepaid time" : "Wallet"} ${m.type.toLowerCase().replace(/_/g, " ")}`, detail: m.reason ?? "", amount: m.bucket === "TIME" ? `${Number(m.amount) > 0 ? "+" : ""}${Number(m.amount)} min` : `${Number(m.amount) > 0 ? "+" : ""}${money2(m.amount)} ${m.bucket === "BONUS" ? "bonus" : m.currency}` })),
      ...bookings.map((b) => ({ kind: "booking", id: b.id, at: b.createdAt, title: `Booking ${b.reference}`, detail: b.status.toLowerCase().replace(/_/g, " "), forAt: b.startsAt, amount: null })),
      ...prints.map((p) => ({ kind: "print", id: p.id, at: p.createdAt, title: `Printed ${p.pages} page(s)`, detail: p.status.toLowerCase(), amount: money2(p.total) })),
      ...points.map((p) => ({ kind: "points", id: p.id, at: p.createdAt, title: `Points ${p.type.toLowerCase()}`, detail: p.reason ?? "", amount: `${p.points > 0 ? "+" : ""}${p.points} pts` })),
      ...memberships.map((m) => ({ kind: "membership", id: m.id, at: m.createdAt, title: `${m.tier.name} membership`, detail: m.status.toLowerCase(), amount: null })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, STEP);
    // Each source gave at most STEP rows older than `before`, so the newest STEP of them are complete.
    return { items, next: items.length === STEP ? items[items.length - 1]!.at : null };
  }

  // ── contact verification ──────────────────────────────────────────────────

  /** Staff confirm an email/phone in person (no messaging provider is wired up yet). */
  @RequirePermissionAnyScope("customer.edit")
  @Post("verify")
  @HttpCode(200)
  async verify(@Param("customerId") customerId: string, @Body(new ZodPipe(Verify)) body: z.infer<typeof Verify>) {
    const c = await tx().customer.findUnique({ where: { id: customerId }, select: { email: true, phone: true } });
    if (!c) throw new NotFoundException({ error: "not_found" });
    if (body.verified && !c[body.channel]) throw new ConflictException({ error: `no_${body.channel}` });
    const field = body.channel === "email" ? "emailVerifiedAt" : "phoneVerifiedAt";
    const after = await tx().customer.update({ where: { id: customerId }, data: { [field]: body.verified ? new Date() : null }, select: { emailVerifiedAt: true, phoneVerifiedAt: true } });
    await this.audit.record({ action: "customer.verify_contact", entityType: "Customer", entityId: customerId, after: { channel: body.channel, verified: body.verified } });
    return after;
  }

  // ── merge ─────────────────────────────────────────────────────────────────

  /** Folds the duplicate `fromId` into this customer, then erases it. Sensitive: needs a reason. */
  @AnyStaff()
  @Post("merge")
  @HttpCode(200)
  async merge(@Param("customerId") customerId: string, @Body(new ZodPipe(Merge)) body: z.infer<typeof Merge>) {
    authorizeFor("customer.delete", { organizationId: orgId() });
    const b = await tx().branch.findUnique({ where: { id: body.branchId }, select: { id: true } });
    if (!b) throw new NotFoundException({ error: "branch_not_found" });
    await mergeCustomers(tx(), customerId, body.fromId, principal().employeeId, b.id);
    await this.commerce.recomputeTier(tx(), customerId);
    await syncStatus(tx(), customerId);
    await this.audit.record({ action: "customer.merge", entityType: "Customer", entityId: customerId, after: { mergedFrom: body.fromId } });
    return { merged: true };
  }

  // ── support tickets ───────────────────────────────────────────────────────

  @RequirePermissionAnyScope("customer.view")
  @Get("tickets")
  tickets(@Param("customerId") customerId: string) {
    return tx().supportTicket.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 50, include: { branch: { select: { code: true } }, device: { select: { name: true } }, assignee: { select: { displayName: true } } } });
  }

  @RequirePermissionAnyScope("support.handle")
  @Post("tickets")
  async openTicket(@Param("customerId") customerId: string, @Body(new ZodPipe(Ticket)) body: z.infer<typeof Ticket>) {
    await exists(customerId);
    if (!(await tx().branch.findUnique({ where: { id: body.branchId }, select: { id: true } }))) throw new NotFoundException({ error: "branch_not_found" });
    const tk = await tx().supportTicket.create({ data: { organizationId: orgId(), customerId, branchId: body.branchId, category: body.category, subject: body.subject, message: body.message ?? null, assigneeId: principal().employeeId } });
    await this.audit.record({ action: "ticket.open", entityType: "SupportTicket", entityId: tk.id, branchId: body.branchId, after: { customerId, subject: tk.subject } });
    return tk;
  }

  @RequirePermissionAnyScope("support.handle")
  @Post("tickets/:ticketId/resolve")
  @HttpCode(200)
  async resolve(@Param("customerId") customerId: string, @Param("ticketId") ticketId: string) {
    const tk = await tx().supportTicket.findFirst({ where: { id: ticketId, customerId } });
    if (!tk) throw new NotFoundException({ error: "not_found" });
    if (tk.status === "RESOLVED" || tk.status === "CLOSED") throw new ConflictException({ error: "already_resolved" });
    const after = await tx().supportTicket.update({ where: { id: tk.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await this.audit.record({ action: "ticket.resolve", entityType: "SupportTicket", entityId: tk.id, branchId: tk.branchId });
    return after;
  }
}

async function exists(customerId: string) {
  const c = await tx().customer.findUnique({ where: { id: customerId }, select: { status: true } });
  if (!c || c.status === "DELETED") throw new NotFoundException({ error: "not_found" });
}
