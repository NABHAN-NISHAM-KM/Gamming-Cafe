import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { FEATURES, type FeatureKey } from "@arena/contracts";
import type { OrganizationStatus, PlatformClient, SubscriptionStatus } from "@arena/db";
import { hashSecret } from "../auth/crypto.js";
import { uuidParam, ZodPipe } from "../common/zod.pipe.js";
import { PDB } from "./config.js";
import { provisionOrganization } from "./provision.js";
import { PlatformAuthService } from "./auth.service.js";
import { clientMeta, PlatformRoles, READ_ROLES, type PlatformRequest } from "./guard.js";

const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
const LIVE_SUBSCRIPTION: SubscriptionStatus[] = ["ACTIVE", "PAST_DUE", "TRIALING"];
const monthly = (price: unknown, interval: string) => Number(price) / (interval === "YEARLY" ? 12 : 1);

const id = (v: string) => {
  if (!uuidParam.test(v)) throw new NotFoundException({ error: "not_found" });
  return v;
};

const Limit = z.number().int().min(0).max(100_000).nullable();
const OrgStatusBody = z.object({ status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]), reason: z.string().trim().max(500).optional() });
const SubscriptionBody = z
  .object({
    planId: z.string().regex(uuidParam),
    status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"]),
    maxBranches: Limit,
    maxDevices: Limit,
    maxEmployees: Limit,
    extendDays: z.number().int().min(1).max(3650),
  })
  .partial()
  .strict();
const FeatureBody = z.object({ enabled: z.boolean(), limitValue: z.number().int().min(0).nullable().optional(), reason: z.string().trim().min(3).max(500) });
const CreateOrg = z.object({
  displayName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(200).optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3–40 lowercase letters, digits or dashes"),
  countryCode: z.string().length(2).toUpperCase(),
  planId: z.string().regex(uuidParam),
  trialDays: z.number().int().min(0).max(90).default(14),
  ownerEmail: z.email().max(254).toLowerCase(),
  ownerName: z.string().trim().min(2).max(120),
});
const PlanBody = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).nullable(),
    price: z.number().min(0).max(1_000_000),
    maxBranches: Limit,
    maxDevices: Limit,
    maxEmployees: Limit,
    isActive: z.boolean(),
    isPublic: z.boolean(),
  })
  .partial()
  .strict();
const PlanFeatureBody = z.object({ enabled: z.boolean() });
const LeadChange = z
  .object({ status: z.enum(["NEW", "CONTACTED", "WON", "LOST"]), staffNotes: z.string().max(4000).nullable(), nextActionAt: z.iso.datetime({ offset: true }).nullable() })
  .partial()
  .strict();

@Controller("platform")
export class PlatformAdminController {
  constructor(
    @Inject(PDB) private readonly db: PlatformClient,
    @Inject(PlatformAuthService) private readonly auth: PlatformAuthService,
  ) {}

  // ── Overview ──────────────────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("overview")
  async overview() {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 5, 1);
    since.setUTCHours(0, 0, 0, 0);
    const [byStatus, branches, devices, online, employees, customers, subs, recent, signups, activity] = await Promise.all([
      this.db.organization.groupBy({ by: ["status"], _count: { _all: true } }),
      this.db.branch.count(),
      this.db.device.count(),
      this.db.device.count({ where: { isOnline: true } }),
      this.db.employee.count({ where: { status: "ACTIVE" } }),
      this.db.customer.count(),
      this.db.subscription.findMany({ where: { status: { in: LIVE_SUBSCRIPTION } }, select: { status: true, organizationId: true, plan: { select: { id: true, name: true, code: true, price: true, currency: true, interval: true } } } }),
      this.db.organization.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, slug: true, displayName: true, status: true, countryCode: true, createdAt: true } }),
      this.db.organization.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.recentAudit({ take: 8, platformOnly: true }),
    ]);

    const mrr: Record<string, number> = {};
    const planMix = new Map<string, { planId: string; name: string; code: string; count: number }>();
    for (const s of subs) {
      if (s.status !== "TRIALING") mrr[s.plan.currency] = (mrr[s.plan.currency] ?? 0) + monthly(s.plan.price, s.plan.interval);
      const p = planMix.get(s.plan.id) ?? { planId: s.plan.id, name: s.plan.name, code: s.plan.code, count: 0 };
      p.count += 1;
      planMix.set(s.plan.id, p);
    }
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(since);
      d.setUTCMonth(since.getUTCMonth() + i);
      return d.toISOString().slice(0, 7);
    });
    const perMonth = Object.fromEntries(months.map((m) => [m, 0]));
    for (const o of signups) {
      const k = o.createdAt.toISOString().slice(0, 7);
      if (k in perMonth) perMonth[k]! += 1;
    }

    return {
      organizations: { total: byStatus.reduce((n, s) => n + s._count._all, 0), byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) },
      branches,
      devices: { total: devices, online },
      employees,
      customers,
      mrr: Object.entries(mrr).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
      planMix: [...planMix.values()].sort((a, b) => b.count - a.count),
      signups: months.map((m) => ({ month: m, count: perMonth[m] })),
      recent,
      activity,
    };
  }

  // ── Organizations ─────────────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("organizations")
  async organizations(@Query("q") q?: string, @Query("status") status?: string) {
    const term = q?.trim().slice(0, 80);
    const orgs = await this.db.organization.findMany({
      where: {
        ...(status && ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].includes(status) ? { status: status as OrganizationStatus } : {}),
        ...(term ? { OR: [{ displayName: { contains: term, mode: "insensitive" } }, { slug: { contains: term, mode: "insensitive" } }, { billingEmail: { contains: term, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, slug: true, displayName: true, status: true, countryCode: true, defaultCurrency: true, createdAt: true, billingEmail: true,
        _count: { select: { branches: true, customers: true } },
        subscriptions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, currentPeriodEnd: true, plan: { select: { name: true, code: true } } } },
      },
    });
    const ids = orgs.map((o) => o.id);
    const [devices, online, staff] = await Promise.all([
      this.db.device.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids } }, _count: { _all: true } }),
      this.db.device.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, isOnline: true }, _count: { _all: true } }),
      this.db.employee.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
    ]);
    const count = (rows: Array<{ organizationId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.organizationId, r._count._all]));
    const [d, on, st] = [count(devices), count(online), count(staff)];
    return orgs.map(({ subscriptions, _count, ...o }) => ({
      ...o,
      subscription: subscriptions[0] ?? null,
      counts: { branches: _count.branches, customers: _count.customers, devices: d.get(o.id) ?? 0, online: on.get(o.id) ?? 0, staff: st.get(o.id) ?? 0 },
    }));
  }

  @PlatformRoles(...READ_ROLES)
  @Get("organizations/:orgId")
  async organization(@Param("orgId") orgId: string) {
    const org = await this.db.organization.findUnique({
      where: { id: id(orgId) },
      include: {
        subscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { plan: { include: { features: true } } } },
        organizationFeatures: true,
        branches: { orderBy: { code: "asc" }, select: { id: true, code: true, name: true, status: true, city: true, currency: true, timezone: true, _count: { select: { devices: true } } } },
      },
    });
    if (!org) throw new NotFoundException({ error: "not_found" });
    const [devices, online, staff, customers, owners, activity] = await Promise.all([
      this.db.device.count({ where: { organizationId: org.id } }),
      this.db.device.count({ where: { organizationId: org.id, isOnline: true } }),
      this.db.employee.count({ where: { organizationId: org.id, status: "ACTIVE" } }),
      this.db.customer.count({ where: { organizationId: org.id } }),
      this.db.employee.findMany({
        where: { organizationId: org.id, employeeRoleAssignments: { some: { role: { key: "org_owner" } } } },
        select: { id: true, displayName: true, status: true, user: { select: { email: true, lastLoginAt: true } } },
      }),
      this.recentAudit({ organizationId: org.id, take: 25 }),
    ]);
    const { subscriptions, organizationFeatures, branches, ...rest } = org;
    const sub = subscriptions[0] ?? null;
    const planFeatures = new Map(sub?.plan.features.map((f) => [f.featureKey, f]) ?? []);
    const overrides = new Map(organizationFeatures.map((f) => [f.featureKey, f]));
    const features = FEATURE_KEYS.map((key) => {
      const planOn = planFeatures.get(key)?.enabled ?? false;
      const o = overrides.get(key);
      return { key, label: FEATURES[key].label, plan: planOn, override: o ? { enabled: o.enabled, reason: o.reason, limitValue: o.limitValue } : null, enabled: o ? o.enabled : planOn };
    });
    const plan = sub ? { ...sub.plan, features: undefined } : null;
    return {
      ...rest,
      subscription: sub ? { ...sub, plan } : null,
      features,
      branches: branches.map(({ _count, ...b }) => ({ ...b, devices: _count.devices })),
      counts: { branches: branches.length, devices, online, staff, customers },
      owners: owners.map((e) => ({ id: e.id, name: e.displayName, status: e.status, email: e.user.email, lastLoginAt: e.user.lastLoginAt })),
      activity,
    };
  }

  @PlatformRoles("SUPER_ADMIN")
  @Post("organizations")
  async createOrganization(@Body(new ZodPipe(CreateOrg)) body: z.infer<typeof CreateOrg>, @Req() req: PlatformRequest) {
    const r = await provisionOrganization(this.db, body);
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.org.create", entityType: "Organization", entityId: r.organization.id, organizationId: r.organization.id, after: { slug: r.organization.slug, displayName: r.organization.displayName, plan: r.plan.code, owner: body.ownerEmail } });
    return { organization: r.organization, owner: r.owner };
  }

  @PlatformRoles("SUPER_ADMIN", "PLATFORM_SUPPORT")
  @Patch("organizations/:orgId/status")
  async setStatus(@Param("orgId") orgId: string, @Body(new ZodPipe(OrgStatusBody)) body: z.infer<typeof OrgStatusBody>, @Req() req: PlatformRequest) {
    const p = req.platform!;
    if ((body.status === "SUSPENDED" || body.status === "CANCELLED") && !body.reason) {
      throw new BadRequestException({ error: "reason_required" });
    }
    // Support can suspend and reactivate; only a Super Admin can cancel an organization.
    if (body.status === "CANCELLED" && !p.roles.includes("SUPER_ADMIN")) throw new ForbiddenException({ error: "forbidden", reason: "NOT_GRANTED" });
    const before = await this.db.organization.findUnique({ where: { id: id(orgId) }, select: { id: true, status: true, suspendedAt: true, suspendReason: true } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    const suspended = body.status === "SUSPENDED";
    const after = await this.db.organization.update({
      where: { id: before.id },
      data: { status: body.status, suspendedAt: suspended ? new Date() : null, suspendReason: suspended ? body.reason! : null },
      select: { id: true, status: true, suspendedAt: true, suspendReason: true },
    });
    // Suspending or cancelling ends every staff session of that organization now.
    if (body.status === "SUSPENDED" || body.status === "CANCELLED") {
      await this.db.refreshToken.updateMany({ where: { organizationId: before.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "org_suspended" } });
    }
    await this.auth.audit(p.userId, p.viaRole, { ...clientMeta(req), reason: body.reason ?? null }, { action: "platform.org.status", entityType: "Organization", entityId: before.id, organizationId: before.id, before, after });
    return after;
  }

  @PlatformRoles("SUPER_ADMIN", "PLATFORM_BILLING")
  @Patch("organizations/:orgId/subscription")
  async setSubscription(@Param("orgId") orgId: string, @Body(new ZodPipe(SubscriptionBody)) body: z.infer<typeof SubscriptionBody>, @Req() req: PlatformRequest) {
    const before = await this.db.subscription.findFirst({ where: { organizationId: id(orgId) }, orderBy: { createdAt: "desc" } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    if (body.planId && !(await this.db.subscriptionPlan.findUnique({ where: { id: body.planId }, select: { id: true } }))) {
      throw new BadRequestException({ error: "validation_failed", issues: [{ path: "planId", message: "Unknown plan" }] });
    }
    const { extendDays, ...rest } = body;
    const base = Math.max(before.currentPeriodEnd.getTime(), Date.now());
    const after = await this.db.subscription.update({
      where: { id: before.id },
      data: { ...rest, ...(extendDays ? { currentPeriodEnd: new Date(base + extendDays * 86_400_000) } : {}) },
    });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.subscription.update", entityType: "Subscription", entityId: before.id, organizationId: before.organizationId, before, after });
    return after;
  }

  @PlatformRoles("SUPER_ADMIN")
  @Put("organizations/:orgId/features/:key")
  async setFeature(@Param("orgId") orgId: string, @Param("key") key: string, @Body(new ZodPipe(FeatureBody)) body: z.infer<typeof FeatureBody>, @Req() req: PlatformRequest) {
    if (!FEATURE_KEYS.includes(key as FeatureKey)) throw new NotFoundException({ error: "not_found" });
    const org = await this.db.organization.findUnique({ where: { id: id(orgId) }, select: { id: true } });
    if (!org) throw new NotFoundException({ error: "not_found" });
    const p = req.platform!;
    const before = await this.db.organizationFeature.findUnique({ where: { organizationId_featureKey: { organizationId: org.id, featureKey: key } } });
    const after = await this.db.organizationFeature.upsert({
      where: { organizationId_featureKey: { organizationId: org.id, featureKey: key } },
      update: { enabled: body.enabled, limitValue: body.limitValue ?? null, reason: body.reason, updatedByUserId: p.userId },
      create: { organizationId: org.id, featureKey: key, enabled: body.enabled, limitValue: body.limitValue ?? null, reason: body.reason, updatedByUserId: p.userId },
    });
    await this.auth.audit(p.userId, p.viaRole, { ...clientMeta(req), reason: body.reason }, { action: "platform.feature.override", entityType: "OrganizationFeature", entityId: key, organizationId: org.id, before, after });
    return after;
  }

  @PlatformRoles("SUPER_ADMIN")
  @Delete("organizations/:orgId/features/:key")
  @HttpCode(204)
  async clearFeature(@Param("orgId") orgId: string, @Param("key") key: string, @Req() req: PlatformRequest) {
    const where = { organizationId_featureKey: { organizationId: id(orgId), featureKey: key } };
    const before = await this.db.organizationFeature.findUnique({ where });
    if (!before) return;
    await this.db.organizationFeature.delete({ where });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.feature.reset", entityType: "OrganizationFeature", entityId: key, organizationId: before.organizationId, before });
  }

  // ── Leads from the website ────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("leads")
  async leads(@Query("status") status?: string, @Query("kind") kind?: string, @Query("due") due?: string) {
    const leads = await this.db.lead.findMany({
      where: {
        ...(status && ["NEW", "CONTACTED", "WON", "LOST"].includes(status) ? { status: status as "NEW" } : {}),
        ...(kind && ["CONTACT", "DEMO", "TRIAL", "UPGRADE", "PARTNER"].includes(kind) ? { kind: kind as "DEMO" } : {}),
        // Follow-ups due now, and calls in the next 24 hours: what the sales team should do today.
        ...(due ? { status: { in: ["NEW", "CONTACTED"] }, OR: [{ nextActionAt: { lte: new Date() } }, { kind: "DEMO", demoAt: { gte: new Date(Date.now() - 3_600_000), lte: new Date(Date.now() + 86_400_000) } }] } : {}),
      },
      orderBy: due ? [{ nextActionAt: { sort: "asc", nulls: "last" } }, { demoAt: { sort: "asc", nulls: "last" } }] : { createdAt: "desc" },
      take: 200,
    });
    // The venue whose referral link brought the lead in.
    const ids = [...new Set(leads.map((l) => l.referrerOrgId).filter((x): x is string => !!x))];
    const orgs = ids.length ? await this.db.organization.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
    return leads.map((l) => ({ ...l, referrer: ((o) => (o ? { id: o.id, name: o.displayName } : null))(orgs.find((o) => o.id === l.referrerOrgId)) }));
  }

  @PlatformRoles("SUPER_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_BILLING")
  @Patch("leads/:leadId")
  async updateLead(@Param("leadId") leadId: string, @Body(new ZodPipe(LeadChange)) body: z.infer<typeof LeadChange>, @Req() req: PlatformRequest) {
    const before = await this.db.lead.findUnique({ where: { id: id(leadId) } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    const after = await this.db.lead.update({
      where: { id: before.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.staffNotes !== undefined ? { staffNotes: body.staffNotes || null } : {}),
        ...(body.nextActionAt !== undefined ? { nextActionAt: body.nextActionAt ? new Date(body.nextActionAt) : null } : {}),
      },
    });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.lead.update", entityType: "Lead", entityId: before.id, before: { status: before.status, nextActionAt: before.nextActionAt }, after: { status: after.status, nextActionAt: after.nextActionAt, notes: body.staffNotes !== undefined } });
    return after;
  }

  // ── Plans ─────────────────────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("plans")
  async plans() {
    const [plans, counts] = await Promise.all([
      this.db.subscriptionPlan.findMany({ orderBy: { price: "asc" }, include: { features: true } }),
      this.db.subscription.groupBy({ by: ["planId"], where: { status: { in: LIVE_SUBSCRIPTION } }, _count: { _all: true } }),
    ]);
    const subscribers = new Map(counts.map((c) => [c.planId, c._count._all]));
    return {
      catalog: FEATURE_KEYS.map((key) => ({ key, label: FEATURES[key].label })),
      plans: plans.map(({ features, ...p }) => ({
        ...p,
        subscribers: subscribers.get(p.id) ?? 0,
        features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, features.find((f) => f.featureKey === k)?.enabled ?? false])),
      })),
    };
  }

  @PlatformRoles("SUPER_ADMIN", "PLATFORM_BILLING")
  @Patch("plans/:planId")
  async updatePlan(@Param("planId") planId: string, @Body(new ZodPipe(PlanBody)) body: z.infer<typeof PlanBody>, @Req() req: PlatformRequest) {
    const before = await this.db.subscriptionPlan.findUnique({ where: { id: id(planId) } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    const after = await this.db.subscriptionPlan.update({ where: { id: before.id }, data: body });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.plan.update", entityType: "SubscriptionPlan", entityId: before.id, before, after });
    return after;
  }

  @PlatformRoles("SUPER_ADMIN")
  @Put("plans/:planId/features/:key")
  async setPlanFeature(@Param("planId") planId: string, @Param("key") key: string, @Body(new ZodPipe(PlanFeatureBody)) body: z.infer<typeof PlanFeatureBody>, @Req() req: PlatformRequest) {
    if (!FEATURE_KEYS.includes(key as FeatureKey)) throw new NotFoundException({ error: "not_found" });
    const plan = await this.db.subscriptionPlan.findUnique({ where: { id: id(planId) }, select: { id: true, code: true } });
    if (!plan) throw new NotFoundException({ error: "not_found" });
    const after = await this.db.planFeature.upsert({
      where: { planId_featureKey: { planId: plan.id, featureKey: key } },
      update: { enabled: body.enabled },
      create: { planId: plan.id, featureKey: key, enabled: body.enabled },
    });
    const p = req.platform!;
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.plan.feature", entityType: "PlanFeature", entityId: `${plan.code}:${key}`, after });
    return after;
  }

  // ── Audit & admins ────────────────────────────────────────────────────────

  @PlatformRoles(...READ_ROLES)
  @Get("audit")
  audit(@Query("organizationId") organizationId?: string, @Query("scope") scope?: string) {
    if (organizationId) return this.recentAudit({ organizationId: id(organizationId), take: 100 });
    return this.recentAudit({ take: 100, platformOnly: scope !== "all" });
  }

  @PlatformRoles(...READ_ROLES)
  @Get("admins")
  async admins() {
    const rows = await this.db.platformRoleAssignment.findMany({
      orderBy: { createdAt: "asc" },
      select: { role: true, createdAt: true, user: { select: { id: true, email: true, displayName: true, isDisabled: true, lastLoginAt: true, mfaFactors: { where: { type: "TOTP", confirmedAt: { not: null } }, select: { id: true } } } } },
    });
    const byUser = new Map<string, { id: string; email: string; displayName: string; disabled: boolean; lastLoginAt: Date | null; mfa: boolean; roles: string[]; since: Date }>();
    for (const r of rows) {
      const u = byUser.get(r.user.id) ?? { id: r.user.id, email: r.user.email, displayName: r.user.displayName, disabled: r.user.isDisabled, lastLoginAt: r.user.lastLoginAt, mfa: r.user.mfaFactors.length > 0, roles: [], since: r.createdAt };
      u.roles.push(r.role);
      byUser.set(r.user.id, u);
    }
    return [...byUser.values()];
  }

  private async recentAudit(opts: { organizationId?: string; take: number; platformOnly?: boolean }) {
    const rows = await this.db.auditLog.findMany({
      where: opts.organizationId ? { organizationId: opts.organizationId } : opts.platformOnly ? { actorType: "PLATFORM_ADMIN" } : {},
      orderBy: { createdAt: "desc" },
      take: opts.take,
      select: { id: true, organizationId: true, actorType: true, actorId: true, actorRole: true, action: true, entityType: true, entityId: true, reason: true, ip: true, createdAt: true },
    });
    const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
    const actorIds = [...new Set(rows.filter((r) => r.actorType === "PLATFORM_ADMIN" && r.actorId).map((r) => r.actorId!))];
    const empIds = [...new Set(rows.filter((r) => r.actorType === "EMPLOYEE" && r.actorId).map((r) => r.actorId!))];
    const [orgs, users, emps] = await Promise.all([
      this.db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, displayName: true } }),
      this.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }),
      this.db.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, displayName: true } }),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.displayName]));
    const actor = new Map<string, string>([...users.map((u) => [u.id, u.email] as const), ...emps.map((e) => [e.id, e.displayName] as const)]);
    return rows.map((r) => ({ ...r, organization: r.organizationId ? (orgName.get(r.organizationId) ?? null) : null, actor: r.actorId ? (actor.get(r.actorId) ?? null) : null }));
  }
}
