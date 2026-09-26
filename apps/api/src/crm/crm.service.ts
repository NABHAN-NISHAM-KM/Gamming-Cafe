import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type Db, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { CONFIG, type AppConfig } from "../config.js";
import { CommandsService } from "../devices/commands.service.js";
import { DeviceHub } from "../devices/live.js";
import { PromotionsService } from "../promotions/promotions.service.js";
import { ageOn } from "../sessions/sessions.service.js";
import { BUILT_IN, inSegment, personalize, SegmentRules, type CustomerMetrics } from "./segments.js";

const DAY = 86_400_000;
const MARKETING = ["IN_APP", "SHELL", "PUSH", "EMAIL", "SMS", "WHATSAPP"] as const;
type Channel = (typeof MARKETING)[number];

/**
 * CRM: segments (built-in and custom, re-evaluated from what customers
 * actually do) and campaigns to a segment — only to customers who agreed to
 * marketing. In-app messages land in the customer app's inbox; Shell messages
 * pop up on the customer's PC at their next login; email/SMS/WhatsApp go
 * through a provider (in development they're written to an outbox).
 */
@Injectable()
export class CrmService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("CRM");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(PromotionsService) private readonly promotions: PromotionsService,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
  ) {}

  onModuleInit() {
    // Scheduled campaigns every minute; segments refresh once a day (and on demand).
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private lastSegmentsRun = 0;
  private async tick() {
    const orgs = await this.db.global.$queryRaw<Array<{ organization_id: string }>>`SELECT * FROM app.live_organizations()`;
    const segments = Date.now() - this.lastSegmentsRun > DAY;
    if (segments) this.lastSegmentsRun = Date.now();
    for (const { organization_id } of orgs) {
      try {
        await this.db.withTenant({ organizationId: organization_id, actorType: "SYSTEM", actorId: null }, async (t) => {
          if (segments) await this.evaluateAll(t);
          const due = await t.campaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, select: { id: true } });
          for (const c of due) await this.send(t, c.id, { type: "SYSTEM", id: null });
        });
      } catch (e) {
        this.log.warn(`crm tick ${organization_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ── segments ─────────────────────────────────────────────────────────────

  async ensureBuiltIns(t: TenantTx) {
    const org = await t.organization.findFirstOrThrow({ select: { id: true } });
    for (const b of BUILT_IN) {
      if (!(await t.customerSegment.findFirst({ where: { key: b.key }, select: { id: true } }))) {
        await t.customerSegment.create({ data: { organizationId: org.id, key: b.key, name: b.name, kind: "DYNAMIC", rules: b.rules as Prisma.InputJsonValue } });
      }
    }
  }

  /** What each customer has been doing lately (visits, minutes, spend by kind, tournaments). */
  async metrics(t: TenantTx, now = new Date()): Promise<CustomerMetrics[]> {
    const d30 = new Date(now.getTime() - 30 * DAY);
    const d90 = new Date(now.getTime() - 90 * DAY);
    const d180 = new Date(now.getTime() - 180 * DAY);
    const [customers, visits, last, spend, trn] = await Promise.all([
      t.customer.findMany({ where: { status: "ACTIVE" }, select: { id: true, createdAt: true, marketingConsent: true, dateOfBirth: true, membershipTier: { select: { code: true, rank: true } } } }),
      t.gamingSession.groupBy({ by: ["customerId"], where: { customerId: { not: null }, startedAt: { gte: d30 } }, _count: { _all: true }, _sum: { billedSeconds: true } }),
      t.gamingSession.groupBy({ by: ["customerId"], where: { customerId: { not: null } }, _max: { startedAt: true } }),
      t.orderItem.findMany({ where: { order: { customerId: { not: null }, createdAt: { gte: d90 }, status: { not: "CANCELLED" }, paymentState: "PAID" }, status: { notIn: ["VOIDED", "REFUNDED"] } }, select: { productType: true, lineTotal: true, order: { select: { customerId: true } } } }),
      t.tournamentPlayer.groupBy({ by: ["customerId"], where: { tournament: { startsAt: { gte: d180 } } }, _count: { _all: true } }),
    ]);
    const spendBy = new Map<string, { gaming: number; food: number; all: number }>();
    for (const it of spend) {
      const id = it.order.customerId!;
      const s = spendBy.get(id) ?? { gaming: 0, food: 0, all: 0 };
      const v = Number(it.lineTotal);
      s.all += v;
      if (it.productType === "GAMING_TIME") s.gaming += v;
      else if (["STOCK_ITEM", "RECIPE_ITEM", "COMBO"].includes(it.productType)) s.food += v;
      spendBy.set(id, s);
    }
    return customers.map((c) => {
      const v = visits.find((x) => x.customerId === c.id);
      const s = spendBy.get(c.id);
      return {
        id: c.id, createdAt: c.createdAt, lastVisitAt: last.find((x) => x.customerId === c.id)?._max.startedAt ?? null,
        visits30d: v?._count._all ?? 0, minutes30d: Math.floor((v?._sum.billedSeconds ?? 0) / 60), spend90d: s?.all ?? 0, gamingSpend90d: s?.gaming ?? 0, restaurantSpend90d: s?.food ?? 0,
        tournaments180d: trn.find((x) => x.customerId === c.id)?._count._all ?? 0, tierCode: c.membershipTier?.code ?? null, tierRank: c.membershipTier?.rank ?? 0,
        marketingConsent: c.marketingConsent, age: ageOn(c.dateOfBirth, now),
      };
    });
  }

  /** Recompute every dynamic segment's members. */
  async evaluateAll(t: TenantTx, now = new Date()) {
    await this.ensureBuiltIns(t);
    const segs = await t.customerSegment.findMany({ where: { kind: "DYNAMIC" } });
    const people = await this.metrics(t, now);
    const out: Record<string, number> = {};
    for (const s of segs) {
      const rules = SegmentRules.safeParse(s.rules);
      if (!rules.success) continue;
      const want = new Set(people.filter((p) => inSegment(p, rules.data, now)).map((p) => p.id));
      const have = new Set((await t.customerSegmentMember.findMany({ where: { segmentId: s.id }, select: { customerId: true } })).map((m) => m.customerId));
      const gone = [...have].filter((id) => !want.has(id));
      const fresh = [...want].filter((id) => !have.has(id));
      if (gone.length) await t.customerSegmentMember.deleteMany({ where: { segmentId: s.id, customerId: { in: gone } } });
      if (fresh.length) await t.customerSegmentMember.createMany({ data: fresh.map((customerId) => ({ organizationId: s.organizationId, segmentId: s.id, customerId })) });
      await t.customerSegment.update({ where: { id: s.id }, data: { memberCount: want.size, lastEvaluatedAt: now } });
      out[s.key ?? s.id] = want.size;
    }
    return out;
  }

  async setStaticMembers(t: TenantTx, segmentId: string, add: string[], remove: string[]) {
    const s = await t.customerSegment.findUnique({ where: { id: segmentId } });
    if (!s) throw new NotFoundException({ error: "segment_not_found" });
    if (s.kind !== "STATIC") throw new ConflictException({ error: "segment_is_dynamic", hint: "Dynamic segments are filled by their rules." });
    if (remove.length) await t.customerSegmentMember.deleteMany({ where: { segmentId, customerId: { in: remove } } });
    const known = await t.customer.findMany({ where: { id: { in: add } }, select: { id: true } });
    if (known.length) await t.customerSegmentMember.createMany({ data: known.map((c) => ({ organizationId: s.organizationId, segmentId, customerId: c.id })), skipDuplicates: true });
    const count = await t.customerSegmentMember.count({ where: { segmentId } });
    await t.customerSegment.update({ where: { id: segmentId }, data: { memberCount: count, lastEvaluatedAt: new Date() } });
    return { members: count };
  }

  // ── campaigns ────────────────────────────────────────────────────────────

  /** Who a campaign would reach: the segment (or everyone), only those who agreed to marketing. */
  async audience(t: TenantTx, segmentId: string | null) {
    const where: Prisma.CustomerWhereInput = { status: "ACTIVE", ...(segmentId ? { customerSegmentMembers: { some: { segmentId } } } : {}) };
    const [total, consenting] = await Promise.all([t.customer.count({ where }), t.customer.count({ where: { ...where, marketingConsent: true } })]);
    return { total, consenting, withoutConsent: total - consenting };
  }

  /**
   * Send now. Each consenting member gets one notification (idempotent: a
   * re-send never messages anyone twice); with a promotion attached, each
   * gets their own one-time code.
   */
  async send(t: TenantTx, campaignId: string, actor: { type: "EMPLOYEE" | "SYSTEM"; id: string | null }) {
    const c = await t.campaign.findUnique({ where: { id: campaignId } });
    if (!c) throw new NotFoundException({ error: "campaign_not_found" });
    if (!["DRAFT", "SCHEDULED", "SENDING"].includes(c.status)) throw new ConflictException({ error: "campaign_not_sendable", status: c.status });
    if (!(MARKETING as readonly string[]).includes(c.channel)) throw new ConflictException({ error: "channel_not_supported" });
    await t.campaign.update({ where: { id: c.id }, data: { status: "SENDING" } });
    const org = await t.organization.findFirstOrThrow({ select: { displayName: true } });
    const people = await t.customer.findMany({
      where: { status: "ACTIVE", marketingConsent: true, ...(c.segmentId ? { customerSegmentMembers: { some: { segmentId: c.segmentId } } } : {}) },
      select: { id: true, displayName: true, firstName: true, loyaltyPoints: true, email: true, phone: true },
    });
    const outbox = this.cfg.NODE_ENV !== "production"; // no email/SMS provider yet: development writes to an outbox
    const stats = { targeted: people.length, sent: 0, queued: 0, failed: 0, skipped: 0 };
    for (const p of people) {
      const dedupeKey = `campaign:${c.id}:${p.id}`;
      if (await t.notification.findFirst({ where: { dedupeKey }, select: { id: true } })) {
        stats.skipped++;
        continue;
      }
      let code: string | null = null;
      if (c.promotionId) code = (await this.promotions.generateCodes(t, c.promotionId, { count: 1, prefix: "", maxUses: 1, customerId: p.id, expiresAt: new Date(Date.now() + 30 * DAY) }))[0] ?? null;
      const vars = { firstName: p.firstName ?? p.displayName.split(" ")[0], name: p.displayName, points: p.loyaltyPoints, code, venue: org.displayName };
      const channel = c.channel as Channel;
      const reachable = channel === "EMAIL" ? !!p.email : channel === "SMS" || channel === "WHATSAPP" ? !!p.phone : true;
      const status = !reachable ? "FAILED" : channel === "IN_APP" ? "SENT" : channel === "SHELL" ? "QUEUED" : outbox ? "SENT" : "FAILED";
      await t.notification.create({
        data: {
          organizationId: c.organizationId, recipientType: "CUSTOMER", customerId: p.id, channel, event: "campaign", title: c.subject ? personalize(c.subject, vars) : null, body: personalize(c.body, vars),
          data: { campaignId: c.id, code } as Prisma.InputJsonValue, status, providerRef: status === "SENT" && !["IN_APP", "SHELL"].includes(channel) ? "dev-outbox" : null,
          error: status === "FAILED" ? (reachable ? "No provider configured for this channel" : `No ${channel === "EMAIL" ? "email" : "phone number"} on file`) : null, dedupeKey, sentAt: status === "SENT" ? new Date() : null,
        },
      });
      if (status === "SENT") stats.sent++;
      else if (status === "QUEUED") stats.queued++;
      else stats.failed++;
    }
    const audience = await this.audience(t, c.segmentId);
    await t.campaign.update({ where: { id: c.id }, data: { status: "SENT", sentAt: new Date(), stats: { ...stats, withoutConsent: audience.withoutConsent } as Prisma.InputJsonValue } });
    await auditAs(t, actor, { action: "campaign.send", entityType: "Campaign", entityId: c.id, after: stats });
    return { ...stats, withoutConsent: audience.withoutConsent };
  }

  async campaignView(t: TenantTx, id: string) {
    const c = await t.campaign.findUnique({ where: { id }, include: { segment: { select: { name: true } }, promotion: { select: { name: true } } } });
    if (!c) throw new NotFoundException({ error: "campaign_not_found" });
    const byStatus = await t.notification.groupBy({ by: ["status"], where: { dedupeKey: { startsWith: `campaign:${id}:` } }, _count: { _all: true } });
    const read = await t.notification.count({ where: { dedupeKey: { startsWith: `campaign:${id}:` }, readAt: { not: null } } });
    // Conversions: the personal codes from this campaign that were used.
    const converted = c.promotionId ? await t.promotionRedemption.count({ where: { promotionId: c.promotionId, promoCode: { customerId: { not: null } }, createdAt: { gte: c.sentAt ?? c.createdAt } } }) : 0;
    return { ...c, delivery: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])), read, converted };
  }

  /**
   * At a customer's PC login: Shell messages waiting for them pop up on the
   * screen (the Shell shows staff messages), then count as sent.
   */
  async deliverShell(t: TenantTx, customerId: string, deviceId: string) {
    if (!this.hub.isOnline(deviceId)) return;
    const waiting = await t.notification.findMany({ where: { customerId, channel: "SHELL", status: "QUEUED", createdAt: { gte: new Date(Date.now() - 14 * DAY) } }, orderBy: { createdAt: "asc" }, take: 3 });
    for (const n of waiting) {
      await this.commands.issue(t, { deviceId, type: "SEND_MESSAGE", payload: { title: n.title ?? "Message", message: n.body.slice(0, 500), timeoutSeconds: 60 }, requestedBy: { type: "SYSTEM", id: null } });
      await t.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), deviceId } });
    }
  }
}
