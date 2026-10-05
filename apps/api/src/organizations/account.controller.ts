import { Body, ConflictException, Controller, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { auditAs } from "../common/audit.service.js";
import { AnyStaff, RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CONFIG, type AppConfig } from "../config.js";
import { createCheckout, resolveSecret } from "../payments/stripe.js";

/** Share of a plan limit at which the venue is warned. */
const WARN_AT = 0.8;
const UpgradeAsk = z.object({ plan: z.string().trim().max(20).nullish(), note: z.string().trim().max(1000).nullish() }).strict();
const ChoosePlan = z.object({ planId: z.uuid() }).strict();
const Gateway = z
  .object({
    provider: z.literal("STRIPE"),
    mode: z.enum(["TEST", "LIVE"]),
    credentialsRef: z.string().regex(/^env:[A-Z0-9_]{1,100}$/, 'Where the secret key is, e.g. "env:STRIPE_SECRET_PIXEL"'),
    webhookSecretRef: z.string().regex(/^env:[A-Z0-9_]{1,100}$/),
    isActive: z.boolean(),
  })
  .strict();

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });

/**
 * The venue's own account with ArenaOS: how close it is to its plan limits
 * (and asking for a bigger plan), paying the plan by card, messages from the
 * platform, and the card gateway its customers top up through.
 */
@Controller()
export class AccountController {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  /** Plan limits against what the venue uses now; `near` once it reaches 80%. */
  @AnyStaff()
  @Get("organization/usage")
  async usage() {
    const sub = await tx().subscription.findFirst({ orderBy: { createdAt: "desc" }, include: { plan: true } });
    const [branches, stations, staff] = await Promise.all([
      tx().branch.count({ where: { status: { not: "CLOSED" } } }),
      tx().device.count({ where: { isEnabled: true } }),
      tx().employee.count({ where: { status: "ACTIVE" } }),
    ]);
    const limit = (own: number | null | undefined, plan: number | null | undefined) => own ?? plan ?? null;
    const row = (used: number, max: number | null) => ({ used, max, pct: max ? Math.round((used / max) * 100) : null, near: !!max && used >= max * WARN_AT, full: !!max && used >= max });
    return {
      plan: sub ? { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name } : null,
      status: sub?.status ?? null,
      periodEnd: sub?.currentPeriodEnd ?? null,
      branches: row(branches, limit(sub?.maxBranches, sub?.plan.maxBranches)),
      stations: row(stations, limit(sub?.maxDevices, sub?.plan.maxDevices)),
      staff: row(staff, limit(sub?.maxEmployees, sub?.plan.maxEmployees)),
    };
  }

  /** Links a venue shares: its public page, its app, and its referral link (also used on printable posters). */
  @AnyStaff()
  @Get("organization/links")
  async links() {
    const { slug, displayName: name } = await tx().organization.findFirstOrThrow({ select: { slug: true, displayName: true } });
    const site = this.cfg.WEBSITE_URL.replace(/\/+$/, "");
    return { slug, name, venuePage: `${site}/v/${slug}`, app: `${this.cfg.CUSTOMER_APP_URL.replace(/\/+$/, "")}/${slug}`, referral: `${site}/signup.html?ref=${slug}` };
  }

  /** Venues that signed up through this venue's referral link, and how many earned it a free month. */
  @RequirePermission("org.billing")
  @Get("organization/referrals")
  async referrals() {
    const [r] = await tx().$queryRaw<Array<{ signed_up: bigint; paying: bigint; rewarded: bigint }>>`SELECT * FROM app.my_referrals()`;
    return { signedUp: Number(r?.signed_up ?? 0), paying: Number(r?.paying ?? 0), rewarded: Number(r?.rewarded ?? 0), rewardDays: 30 };
  }

  /** "We need a bigger plan": a lead for the ArenaOS sales team. */
  @RequirePermission("org.billing")
  @Post("organization/upgrade-request")
  @HttpCode(200)
  async askUpgrade(@Body(new ZodPipe(UpgradeAsk)) body: z.infer<typeof UpgradeAsk>) {
    const user = await tx().user.findUniqueOrThrow({ where: { id: principal().userId }, select: { email: true, displayName: true } });
    const [row] = await tx().$queryRaw<Array<{ id: string }>>`SELECT app.request_upgrade(${user.displayName}, ${user.email}, ${body.plan ?? ""}, ${body.note ?? ""}) AS id`;
    await auditAs(tx(), me(), { action: "org.upgrade_request", entityType: "Organization", entityId: orgId(), after: { plan: body.plan ?? null } });
    return { ok: true, leadId: row?.id ?? null };
  }

  // ── paying for ArenaOS ────────────────────────────────────────────────────

  @RequirePermission("org.billing")
  @Get("billing")
  async billing() {
    const sub = await tx().subscription.findFirst({ orderBy: { createdAt: "desc" }, include: { plan: true } });
    const plans = await tx().subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { price: "asc" }, select: { id: true, code: true, name: true, price: true, currency: true, interval: true, maxBranches: true, maxDevices: true, maxEmployees: true } });
    const invoices = await tx().subscriptionInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 24, select: { id: true, number: true, amount: true, currency: true, status: true, periodStart: true, periodEnd: true, dueAt: true, paidAt: true } });
    return {
      subscription: sub ? { status: sub.status, plan: { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name, price: sub.plan.price.toFixed(2), currency: sub.plan.currency, interval: sub.plan.interval }, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd } : null,
      plans: plans.map((p) => ({ ...p, price: p.price.toFixed(2) })),
      invoices: invoices.map((i) => ({ ...i, amount: i.amount.toFixed(2) })),
      cardPayments: !!this.cfg.BILLING_STRIPE_SECRET_KEY,
    };
  }

  /** Choose a plan (a trial converting, or a change): an invoice for its first period, paid by card. */
  @RequirePermission("org.billing")
  @Post("billing/plan")
  @HttpCode(200)
  async choosePlan(@Body(new ZodPipe(ChoosePlan)) body: z.infer<typeof ChoosePlan>) {
    let id: string;
    try {
      [{ id }] = (await tx().$queryRaw<Array<{ id: string }>>`SELECT app.billing_open_invoice(${body.planId}::uuid) AS id`) as [{ id: string }];
    } catch (e) {
      if (String(e).includes("plan_not_found")) throw new NotFoundException({ error: "plan_not_found" });
      throw e;
    }
    await auditAs(tx(), me(), { action: "billing.choose_plan", entityType: "SubscriptionInvoice", entityId: id, after: { planId: body.planId } });
    return this.checkout(id, body.planId);
  }

  @RequirePermission("org.billing")
  @Post("billing/invoices/:invoiceId/pay")
  @HttpCode(200)
  async pay(@Param("invoiceId") invoiceId: string) {
    return this.checkout(invoiceId, null);
  }

  private async checkout(invoiceId: string, planId: string | null) {
    const key = this.cfg.BILLING_STRIPE_SECRET_KEY;
    if (!key) throw new HttpException({ error: "online_payment_unavailable", hint: "Card payment isn't set up yet — ArenaOS will send payment details." }, 503);
    const inv = await tx().subscriptionInvoice.findUnique({ where: { id: invoiceId }, include: { subscription: { select: { planId: true } } } });
    if (!inv) throw new NotFoundException({ error: "not_found" });
    if (inv.status !== "OPEN") throw new ConflictException({ error: "invoice_not_open" });
    const unit = (await tx().currency.findUnique({ where: { code: inv.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    const org = await tx().organization.findFirstOrThrow({ select: { displayName: true, billingEmail: true } });
    const admin = this.cfg.ADMIN_URL.replace(/\/+$/, "");
    const s = await createCheckout(key, {
      amountMinor: Math.round(Number(inv.amount) * 10 ** unit), currency: inv.currency, name: `ArenaOS — ${org.displayName} (${inv.number})`,
      successUrl: `${admin}/billing?paid=${inv.id}`, cancelUrl: `${admin}/billing`, customerEmail: org.billingEmail,
      metadata: { kind: "subscription_invoice", invoiceId: inv.id, organizationId: orgId(), planId: planId ?? inv.subscription.planId },
    });
    await tx().$executeRaw`SELECT app.billing_checkout_ref(${inv.id}::uuid, ${s.id})`;
    return { url: s.url };
  }

  // ── messages from the platform ────────────────────────────────────────────

  /** Current announcements I haven't dismissed. */
  @AnyStaff()
  @Get("announcements")
  async announcements() {
    const now = new Date();
    const read = new Set((await tx().announcementRead.findMany({ where: { employeeId: principal().employeeId }, select: { announcementId: true } })).map((r) => r.announcementId));
    const rows = await tx().platformAnnouncement.findMany({ where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, orderBy: { startsAt: "desc" }, take: 10, select: { id: true, title: true, body: true, severity: true, startsAt: true } });
    return rows.filter((r) => !read.has(r.id));
  }

  @AnyStaff()
  @Post("announcements/:announcementId/read")
  @HttpCode(204)
  async dismiss(@Param("announcementId") announcementId: string) {
    if (!(await tx().platformAnnouncement.findUnique({ where: { id: announcementId }, select: { id: true } }))) throw new NotFoundException({ error: "not_found" });
    await tx().announcementRead.createMany({ data: [{ organizationId: orgId(), announcementId, employeeId: principal().employeeId }], skipDuplicates: true });
  }

  // ── the card gateway customers top up through ─────────────────────────────

  // Reading shows only where the secrets are, never the secrets; changing it is the sensitive part.
  @RequirePermission("org.manage")
  @Get("payments/gateway")
  async gateway() {
    const g = await tx().paymentGatewayConfig.findFirst({ where: { branchId: null, provider: "STRIPE" } });
    const slug = (await tx().organization.findFirstOrThrow({ select: { slug: true } })).slug;
    return {
      gateway: g ? { provider: g.provider, mode: g.mode, credentialsRef: g.credentialsRef, webhookSecretRef: g.webhookSecretRef, isActive: g.isActive, secretFound: !!resolveSecret(g.credentialsRef), webhookSecretFound: !!resolveSecret(g.webhookSecretRef) } : null,
      webhookPath: `/v1/app/${slug}/stripe-webhook`,
    };
  }

  @RequirePermission("payment.gateway_manage")
  @Put("payments/gateway")
  async setGateway(@Body(new ZodPipe(Gateway)) body: z.infer<typeof Gateway>) {
    const g = await tx().paymentGatewayConfig.findFirst({ where: { branchId: null, provider: "STRIPE" } });
    const data = { mode: body.mode, credentialsRef: body.credentialsRef, webhookSecretRef: body.webhookSecretRef, isActive: body.isActive };
    const saved = g ? await tx().paymentGatewayConfig.update({ where: { id: g.id }, data }) : await tx().paymentGatewayConfig.create({ data: { ...data, organizationId: orgId(), provider: "STRIPE" } });
    await auditAs(tx(), me(), { action: "payment.gateway_set", entityType: "PaymentGatewayConfig", entityId: saved.id, before: g ? { mode: g.mode, isActive: g.isActive } : null, after: { mode: saved.mode, isActive: saved.isActive } });
    return this.gateway();
  }
}
