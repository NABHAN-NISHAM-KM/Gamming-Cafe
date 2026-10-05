import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Logger, NotFoundException, Param, Patch, Post, Query, Req, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import type { PlatformClient } from "@arena/db";
import { uuidParam, ZodPipe } from "../common/zod.pipe.js";
import { completedCheckout, verifyWebhook } from "../payments/stripe.js";
import { PlatformAuthService } from "./auth.service.js";
import { applyInvoicePayment, billingSweep } from "./billing.js";
import { PDB, PLATFORM_CONFIG, type PlatformConfig } from "./config.js";
import { clientMeta, PlatformPublic, PlatformRoles, READ_ROLES, type PlatformRequest } from "./guard.js";

const id = (v: string) => {
  if (!uuidParam.test(v)) throw new NotFoundException({ error: "not_found" });
  return v;
};

const Impersonate = z.object({ reason: z.string().trim().min(5).max(500), minutes: z.number().int().min(5).max(60).default(30), canWrite: z.boolean().default(false) }).strict();
const Release = z
  .object({
    component: z.enum(["WINDOWS_SHELL", "WINDOWS_AGENT", "EDGE_SERVER", "KDS", "POS"]),
    channel: z.enum(["STABLE", "BETA", "CANARY"]).default("STABLE"),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "like 1.4.2"),
    artifactUrl: z.url().max(1000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i, "64 hex characters").toLowerCase(),
    signature: z.string().min(16).max(4000),
    releaseNotes: z.string().max(4000).nullish(),
    minVersion: z.string().regex(/^\d+\.\d+\.\d+$/).nullish(),
    rolloutPercent: z.number().int().min(0).max(100).default(10),
  })
  .strict();
const ReleaseChange = z
  .object({ rolloutPercent: z.number().int().min(0).max(100), paused: z.boolean(), publish: z.literal(true), revoke: z.literal(true) })
  .partial()
  .strict();
const Check = z.object({ component: z.enum(["WINDOWS_SHELL", "WINDOWS_AGENT", "EDGE_SERVER", "KDS", "POS"]), version: z.string().max(40), deviceId: z.string().min(8).max(64), channel: z.enum(["STABLE", "BETA", "CANARY"]).default("STABLE") });
const Announcement = z
  .object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(2000), severity: z.enum(["INFO", "WARNING"]).default("INFO"), startsAt: z.iso.datetime({ offset: true }).nullish(), endsAt: z.iso.datetime({ offset: true }).nullish() })
  .strict();
const InvoiceChange = z.object({ status: z.enum(["PAID", "VOID"]) }).strict();

/** "1.10.0" > "1.9.3": numeric comparison per part (pre-release tags are ignored). */
export const newer = (a: string, b: string) => {
  const pa = a.split(/[-+]/)[0]!.split(".").map(Number);
  const pb = b.split(/[-+]/)[0]!.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};
/** Stable 0–99 bucket per device and release: raising the percentage only ever adds stations. */
export const bucket = (deviceId: string, releaseId: string) => createHash("sha256").update(`${releaseId}:${deviceId}`).digest().readUInt16BE(0) % 100;

/**
 * Running the platform day to day: support signing in as a venue, client
 * releases rolled out by percentage, announcements to every venue, each
 * venue's health, and invoices (with the card-payment webhook).
 */
@Controller()
export class PlatformOpsController implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("PlatformOps");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PDB) private readonly db: PlatformClient,
    @Inject(PLATFORM_CONFIG) private readonly cfg: PlatformConfig,
    @Inject(PlatformAuthService) private readonly auth: PlatformAuthService,
  ) {}

  onModuleInit() {
    if (this.cfg.BILLING_SWEEP === "off") return;
    this.timer = setInterval(() => void billingSweep(this.db).catch((e) => this.log.error(`billing sweep: ${e}`)), 60 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ── support: signing in as a venue ────────────────────────────────────────

  /**
   * A short-lived sign-in as the venue's owner, for support. Read-only unless
   * changes are asked for (super admins only). The venue's audit log records
   * every action with the platform admin behind it, and the venue sees a banner.
   */
  @PlatformRoles("SUPER_ADMIN", "PLATFORM_SUPPORT")
  @Post("platform/organizations/:orgId/impersonate")
  async impersonate(@Param("orgId") orgId: string, @Body(new ZodPipe(Impersonate)) body: z.infer<typeof Impersonate>, @Req() req: PlatformRequest) {
    const p = req.platform!;
    if (body.canWrite && p.viaRole !== "SUPER_ADMIN") throw new ForbiddenException({ error: "forbidden", hint: "Only a super admin can make changes as a venue." });
    const org = await this.db.organization.findUnique({ where: { id: id(orgId) }, select: { id: true, status: true, displayName: true } });
    if (!org) throw new NotFoundException({ error: "not_found" });
    if (org.status === "CANCELLED") throw new ConflictException({ error: "organization_cancelled" });
    const owner = await this.db.employee.findFirst({
      where: { organizationId: org.id, status: "ACTIVE", employeeRoleAssignments: { some: { scope: "ORGANIZATION", role: { key: "org_owner" } } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, displayName: true },
    });
    if (!owner) throw new ConflictException({ error: "no_owner", hint: "This venue has no active owner to sign in as." });
    const expiresAt = new Date(Date.now() + body.minutes * 60_000);
    const s = await this.db.impersonationSession.create({ data: { platformUserId: p.userId, organizationId: org.id, targetEmployeeId: owner.id, reason: body.reason, expiresAt, canWrite: body.canWrite } });
    // The tenant API checks the session's refresh family on every request: one that ends with the support session.
    await this.db.refreshToken.create({ data: { subjectType: "USER", userId: owner.userId, organizationId: org.id, familyId: s.id, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), expiresAt } });
    const accessToken = await new SignJWT({ org: org.id, emp: owner.id, sid: s.id, imp: p.userId })
      .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt" })
      .setSubject(owner.userId)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience("arena:staff")
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(await importPKCS8(this.cfg.JWT_PRIVATE_KEY_B64, "EdDSA"));
    const meta = { ...clientMeta(req), reason: body.reason };
    await this.auth.audit(p.userId, p.viaRole, meta, { action: "platform.impersonate.start", entityType: "ImpersonationSession", entityId: s.id, organizationId: org.id, after: { as: owner.displayName, minutes: body.minutes, canWrite: body.canWrite } });
    return { sessionId: s.id, accessToken, expiresIn: body.minutes * 60, expiresAt, as: owner.displayName, canWrite: body.canWrite };
  }

  @PlatformRoles(...READ_ROLES)
  @Get("platform/organizations/:orgId/impersonations")
  impersonations(@Param("orgId") orgId: string) {
    return this.db.impersonationSession.findMany({ where: { organizationId: id(orgId) }, orderBy: { startedAt: "desc" }, take: 20, include: { platformUser: { select: { displayName: true, email: true } }, targetEmployee: { select: { displayName: true } } } });
  }

  @PlatformRoles("SUPER_ADMIN", "PLATFORM_SUPPORT")
  @Post("platform/impersonation/:sessionId/end")
  @HttpCode(200)
  async endImpersonation(@Param("sessionId") sessionId: string, @Req() req: PlatformRequest) {
    const s = await this.db.impersonationSession.findUnique({ where: { id: id(sessionId) } });
    if (!s) throw new NotFoundException({ error: "not_found" });
    if (!s.endedAt) {
      await this.db.impersonationSession.update({ where: { id: s.id }, data: { endedAt: new Date() } });
      await this.db.refreshToken.updateMany({ where: { familyId: s.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "impersonation_ended" } });
      const p = req.platform!;
      await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.impersonate.end", entityType: "ImpersonationSession", entityId: s.id, organizationId: s.organizationId });
    }
    return { ended: true };
  }

  // ── client releases ───────────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("platform/releases")
  releases() {
    return this.db.clientRelease.findMany({ orderBy: [{ component: "asc" }, { createdAt: "desc" }], take: 100 });
  }

  /** A new build, unpublished: it reaches stations once published, to rolloutPercent of them. */
  @PlatformRoles("SUPER_ADMIN")
  @Post("platform/releases")
  async addRelease(@Body(new ZodPipe(Release)) body: z.infer<typeof Release>, @Req() req: PlatformRequest) {
    try {
      const r = await this.db.clientRelease.create({ data: { ...body, releaseNotes: body.releaseNotes ?? null, minVersion: body.minVersion ?? null } });
      const p = req.platform!;
      await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.release.create", entityType: "ClientRelease", entityId: r.id, after: { component: r.component, version: r.version, channel: r.channel } });
      return r;
    } catch (e) {
      if (String(e).includes("Unique constraint")) throw new ConflictException({ error: "version_exists" });
      throw e;
    }
  }

  @PlatformRoles("SUPER_ADMIN")
  @Patch("platform/releases/:releaseId")
  async changeRelease(@Param("releaseId") releaseId: string, @Body(new ZodPipe(ReleaseChange)) body: z.infer<typeof ReleaseChange>, @Req() req: PlatformRequest) {
    const before = await this.db.clientRelease.findUnique({ where: { id: id(releaseId) } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    if (before.isRevoked) throw new ConflictException({ error: "revoked" });
    const after = await this.db.clientRelease.update({
      where: { id: before.id },
      data: {
        ...(body.rolloutPercent !== undefined ? { rolloutPercent: body.rolloutPercent } : {}),
        ...(body.paused !== undefined ? { pausedAt: body.paused ? new Date() : null } : {}),
        ...(body.publish && !before.publishedAt ? { publishedAt: new Date() } : {}),
        ...(body.revoke ? { isRevoked: true } : {}),
      },
    });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.release.change", entityType: "ClientRelease", entityId: before.id, before: { rolloutPercent: before.rolloutPercent, paused: !!before.pausedAt, published: !!before.publishedAt }, after: { rolloutPercent: after.rolloutPercent, paused: !!after.pausedAt, published: !!after.publishedAt, revoked: after.isRevoked } });
    return after;
  }

  /**
   * Stations ask "is there an update for me?". Only published, unpaused,
   * unrevoked builds, and only for stations whose bucket is inside the rollout.
   */
  @PlatformPublic()
  @Get("public/releases/check")
  async check(@Query(new ZodPipe(Check)) q: z.infer<typeof Check>) {
    const rows = await this.db.clientRelease.findMany({ where: { component: q.component, channel: q.channel, isRevoked: false, pausedAt: null, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, take: 20 });
    // The newest build this station is inside the rollout for (a build still at 5% doesn't hold back the one before it).
    const latest = rows
      .filter((r) => newer(r.version, q.version))
      .sort((a, b) => (newer(a.version, b.version) ? -1 : 1))
      .find((r) => bucket(q.deviceId, r.id) < r.rolloutPercent);
    if (!latest) return { update: null };
    return { update: { version: latest.version, artifactUrl: latest.artifactUrl, sha256: latest.sha256, signature: latest.signature, releaseNotes: latest.releaseNotes, mandatory: !!latest.minVersion && newer(latest.minVersion, q.version) } };
  }

  // ── announcements ─────────────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("platform/announcements")
  async announcements() {
    const rows = await this.db.platformAnnouncement.findMany({ orderBy: { startsAt: "desc" }, take: 50 });
    const reads = await this.db.announcementRead.groupBy({ by: ["announcementId"], where: { announcementId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    const venues = await this.db.$queryRaw<Array<{ id: string; n: number }>>`SELECT "announcementId" AS id, COUNT(DISTINCT "organizationId")::int AS n FROM "AnnouncementRead" GROUP BY 1`;
    return rows.map((r) => ({ ...r, reads: reads.find((x) => x.announcementId === r.id)?._count._all ?? 0, venues: venues.find((v) => v.id === r.id)?.n ?? 0 }));
  }

  @PlatformRoles("SUPER_ADMIN", "PLATFORM_SUPPORT")
  @Post("platform/announcements")
  async announce(@Body(new ZodPipe(Announcement)) body: z.infer<typeof Announcement>, @Req() req: PlatformRequest) {
    const p = req.platform!;
    const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
    if (body.endsAt && new Date(body.endsAt) <= startsAt) throw new ConflictException({ error: "ends_before_start" });
    const a = await this.db.platformAnnouncement.create({ data: { title: body.title, body: body.body, severity: body.severity, startsAt, endsAt: body.endsAt ? new Date(body.endsAt) : null, createdById: p.userId } });
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.announce", entityType: "PlatformAnnouncement", entityId: a.id, after: { title: a.title, severity: a.severity } });
    return a;
  }

  @PlatformRoles("SUPER_ADMIN", "PLATFORM_SUPPORT")
  @Post("platform/announcements/:announcementId/end")
  @HttpCode(200)
  async endAnnouncement(@Param("announcementId") announcementId: string, @Req() req: PlatformRequest) {
    const a = await this.db.platformAnnouncement.findUnique({ where: { id: id(announcementId) } });
    if (!a) throw new NotFoundException({ error: "not_found" });
    const now = new Date();
    const after = await this.db.platformAnnouncement.update({ where: { id: a.id }, data: { endsAt: now, ...(a.startsAt > now ? { startsAt: new Date(now.getTime() - 1000) } : {}) } });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.announce.end", entityType: "PlatformAnnouncement", entityId: a.id });
    return after;
  }

  // ── venue health ──────────────────────────────────────────────────────────

  /** Every venue at a glance: stations online, last activity, recent drop-offs, and trials that never connected a PC. */
  @PlatformRoles(...READ_ROLES)
  @Get("platform/health")
  async health() {
    const rows = await this.db.$queryRaw<Array<{ id: string; slug: string; name: string; status: string; plan: string | null; stations: number; online: number; lastSession: Date | null; sessions7d: number; drops7d: number; openAlerts: number; createdAt: Date }>>`
      SELECT o."id", o."slug", o."displayName" AS name, o."status"::text AS status,
             (SELECT p."name" FROM "Subscription" s JOIN "SubscriptionPlan" p ON p."id" = s."planId" WHERE s."organizationId" = o."id" ORDER BY s."createdAt" DESC LIMIT 1) AS plan,
             (SELECT COUNT(*)::int FROM "Device" d WHERE d."organizationId" = o."id" AND d."isEnabled") AS stations,
             (SELECT COUNT(*)::int FROM "Device" d WHERE d."organizationId" = o."id" AND d."isEnabled" AND d."isOnline") AS online,
             (SELECT MAX(g."startedAt") FROM "GamingSession" g WHERE g."organizationId" = o."id") AS "lastSession",
             (SELECT COUNT(*)::int FROM "GamingSession" g WHERE g."organizationId" = o."id" AND g."startedAt" > now() - interval '7 days') AS "sessions7d",
             (SELECT COUNT(*)::int FROM "Alert" a WHERE a."organizationId" = o."id" AND a."type" = 'CLIENT_OFFLINE' AND a."openedAt" > now() - interval '7 days') AS "drops7d",
             (SELECT COUNT(*)::int FROM "Alert" a WHERE a."organizationId" = o."id" AND a."status" <> 'RESOLVED') AS "openAlerts",
             o."createdAt"
        FROM "Organization" o WHERE o."status" <> 'CANCELLED' ORDER BY o."displayName"`;
    const venues = rows.map((r) => {
      const flags: string[] = [];
      if (r.status === "TRIAL" && r.stations === 0) flags.push("Trial with no PCs connected");
      if (r.stations > 0 && r.online === 0) flags.push("No stations online");
      if (r.stations > 0 && r.sessions7d === 0) flags.push("No sessions this week");
      if (r.drops7d >= 20) flags.push(`${r.drops7d} station drop-offs this week`);
      if (r.status === "PAST_DUE") flags.push("Payment overdue");
      return { ...r, flags };
    });
    return { venues, attention: venues.filter((v) => v.flags.length).length };
  }

  // ── website stats ─────────────────────────────────────────────────────────

  /** Anonymous website stats: views per day, top pages, where visitors came from, and the sign-up funnel. */
  @PlatformRoles(...READ_ROLES)
  @Get("platform/site-stats")
  async siteStats(@Query("days") daysParam?: string) {
    const days = Math.min(365, Math.max(1, Number(daysParam) || 30));
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const n = (x: unknown) => Number(x ?? 0);
    const [byDay, pages, referrers, events] = await Promise.all([
      this.db.$queryRaw<Array<{ day: Date; views: bigint }>>`SELECT "day", SUM("count") AS views FROM "SiteStat" WHERE "event" = 'view' AND "day" >= ${since}::date GROUP BY 1 ORDER BY 1`,
      this.db.$queryRaw<Array<{ path: string; views: bigint }>>`SELECT "path", SUM("count") AS views FROM "SiteStat" WHERE "event" = 'view' AND "day" >= ${since}::date GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      this.db.$queryRaw<Array<{ referrer: string; views: bigint }>>`SELECT "referrer", SUM("count") AS views FROM "SiteStat" WHERE "event" = 'view' AND "referrer" <> '' AND "day" >= ${since}::date GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      this.db.$queryRaw<Array<{ event: string; count: bigint }>>`SELECT "event", SUM("count") AS count FROM "SiteStat" WHERE "day" >= ${since}::date GROUP BY 1`,
    ]);
    const ev = (k: string) => n(events.find((e) => e.event === k)?.count);
    const signupViews = n(pages.find((p) => p.path === "/signup.html")?.views);
    return {
      days,
      views: byDay.reduce((a, d) => a + n(d.views), 0),
      byDay: byDay.map((d) => ({ day: d.day.toISOString().slice(0, 10), views: n(d.views) })),
      pages: pages.map((p) => ({ path: p.path, views: n(p.views) })),
      referrers: referrers.map((r) => ({ referrer: r.referrer, views: n(r.views) })),
      funnel: { signupViews, trialStarted: ev("trial_started"), trialDone: ev("trial_done"), contactSent: ev("contact_sent"), demoBooked: ev("demo_booked"), partnerSent: ev("partner_sent"), quoteMade: ev("quote_made"), venueBooked: ev("venue_booked"), helpAsked: ev("help_asked") },
    };
  }

  // ── invoices ──────────────────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("platform/organizations/:orgId/invoices")
  invoices(@Param("orgId") orgId: string) {
    return this.db.subscriptionInvoice.findMany({ where: { organizationId: id(orgId) }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  /** Marked paid (bank transfer, cash) or voided by billing staff. */
  @PlatformRoles("SUPER_ADMIN", "PLATFORM_BILLING")
  @Patch("platform/invoices/:invoiceId")
  async changeInvoice(@Param("invoiceId") invoiceId: string, @Body(new ZodPipe(InvoiceChange)) body: z.infer<typeof InvoiceChange>, @Req() req: PlatformRequest) {
    const inv = await this.db.subscriptionInvoice.findUnique({ where: { id: id(invoiceId) } });
    if (!inv) throw new NotFoundException({ error: "not_found" });
    if (inv.status === "PAID" || inv.status === "VOID") throw new ConflictException({ error: "invoice_closed" });
    if (body.status === "PAID") await applyInvoicePayment(this.db, inv.id);
    else await this.db.subscriptionInvoice.update({ where: { id: inv.id }, data: { status: "VOID" } });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: `platform.invoice.${body.status.toLowerCase()}`, entityType: "SubscriptionInvoice", entityId: inv.id, organizationId: inv.organizationId, before: { status: inv.status }, after: { status: body.status } });
    return this.db.subscriptionInvoice.findUnique({ where: { id: inv.id } });
  }

  /** Runs the billing clock now (renewals, overdue) — for staff after a change, and for tests. */
  @PlatformRoles("SUPER_ADMIN", "PLATFORM_BILLING")
  @Post("platform/billing/sweep")
  @HttpCode(200)
  sweep() {
    return billingSweep(this.db);
  }

  /** Stripe says a venue paid its ArenaOS invoice. */
  @PlatformPublic()
  @Post("public/billing/stripe-webhook")
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }) {
    const secret = this.cfg.BILLING_STRIPE_WEBHOOK_SECRET;
    const raw = req.rawBody?.toString("utf8") ?? "";
    if (!secret || !verifyWebhook(secret, raw, req.headers["stripe-signature"] as string | undefined)) throw new ForbiddenException({ error: "bad_signature" });
    const done = completedCheckout(JSON.parse(raw));
    if (!done || done.metadata["kind"] !== "subscription_invoice" || !done.paid) return { received: true };
    const inv = await this.db.subscriptionInvoice.findFirst({ where: { id: done.metadata["invoiceId"] ?? "", providerRef: done.id } });
    if (!inv) return { received: true };
    const unit = (await this.db.currency.findUnique({ where: { code: inv.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    if (done.amountMinor !== Math.round(Number(inv.amount) * 10 ** unit) || done.currency !== inv.currency) throw new ConflictException({ error: "amount_mismatch" });
    const planId = done.metadata["planId"];
    await applyInvoicePayment(this.db, inv.id, { planId: planId && uuidParam.test(planId) ? planId : null, providerRef: done.id });
    return { received: true };
  }
}
