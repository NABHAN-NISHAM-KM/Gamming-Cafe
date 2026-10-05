import type { PlatformClient } from "@arena/db";

/** Days before a period ends that its renewal invoice is issued. */
export const RENEW_AHEAD_DAYS = 7;

const addInterval = (d: Date, interval: string) => {
  const n = new Date(d);
  if (interval === "YEARLY") n.setUTCFullYear(n.getUTCFullYear() + 1);
  else n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
};

/**
 * An invoice was paid (card checkout confirmed, or marked paid by billing
 * staff): the invoice is closed, the subscription runs on the chosen plan
 * through the paid period, and a trial or overdue venue becomes active.
 * Idempotent: a second call for a paid invoice changes nothing.
 */
export async function applyInvoicePayment(db: PlatformClient, invoiceId: string, opts: { planId?: string | null; providerRef?: string | null } = {}) {
  return db.$transaction(async (t) => {
    const inv = await t.subscriptionInvoice.findUnique({ where: { id: invoiceId }, include: { subscription: { include: { plan: true } } } });
    if (!inv) return null;
    if (inv.status === "PAID") return { invoice: inv, changed: false };
    if (inv.status === "VOID") return null;
    const planId = opts.planId ?? inv.subscription.planId;
    const plan = planId === inv.subscription.planId ? inv.subscription.plan : await t.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) return null;
    const paid = await t.subscriptionInvoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: new Date(), providerRef: opts.providerRef ?? inv.providerRef } });
    const sub = inv.subscription;
    await t.subscription.update({
      where: { id: sub.id },
      data: { planId: plan.id, status: "ACTIVE", currentPeriodStart: inv.periodStart, currentPeriodEnd: inv.periodEnd > sub.currentPeriodEnd || sub.status !== "ACTIVE" ? inv.periodEnd : sub.currentPeriodEnd },
    });
    await t.organization.updateMany({ where: { id: inv.organizationId, status: { in: ["TRIAL", "PAST_DUE"] } }, data: { status: "ACTIVE" } });
    await rewardReferrer(t, inv.organizationId);
    return { invoice: paid, changed: true };
  });
}

/** Free time the referring venue gets when a venue it referred first pays. */
export const REFERRAL_REWARD_DAYS = 30;

/**
 * A venue that signed up through another venue's referral link has paid: the
 * referrer's current period is extended by a month. Once per referred venue
 * (the lead is stamped), and only for a referrer that's still a customer.
 */
async function rewardReferrer(t: Parameters<Parameters<PlatformClient["$transaction"]>[0]>[0], organizationId: string) {
  const lead = await t.lead.findFirst({ where: { kind: "TRIAL", trialOrgId: organizationId, referrerOrgId: { not: null }, referralRewardedAt: null } });
  if (!lead || lead.referrerOrgId === organizationId) return;
  const sub = await t.subscription.findFirst({ where: { organizationId: lead.referrerOrgId!, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, orderBy: { createdAt: "desc" } });
  if (!sub) return;
  const from = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
  await t.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(from.getTime() + REFERRAL_REWARD_DAYS * 86_400_000) } });
  await t.lead.update({ where: { id: lead.id }, data: { referralRewardedAt: new Date() } });
}

/**
 * The billing clock, run hourly by the platform service:
 *  - an ACTIVE subscription ending within a week gets its renewal invoice;
 *  - an OPEN invoice past its due date makes the subscription (and venue) PAST_DUE.
 * Suspending a venue stays a person's decision in the console.
 */
export async function billingSweep(db: PlatformClient, now = new Date()) {
  const soon = new Date(now.getTime() + RENEW_AHEAD_DAYS * 86_400_000);
  const renewing = await db.subscription.findMany({
    where: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: { lte: soon }, plan: { price: { gt: 0 } } },
    include: { plan: true, subscriptionInvoices: { where: { status: { in: ["OPEN", "PAID"] } }, orderBy: { periodEnd: "desc" }, take: 1 } },
    take: 500,
  });
  let issued = 0;
  for (const s of renewing) {
    if (s.subscriptionInvoices[0] && s.subscriptionInvoices[0].periodEnd > s.currentPeriodEnd) continue; // next period already invoiced
    await db.subscriptionInvoice.create({
      data: {
        organizationId: s.organizationId, subscriptionId: s.id, number: `INV-${now.toISOString().slice(0, 7).replace("-", "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        amount: s.plan.price, currency: s.plan.currency, status: "OPEN", periodStart: s.currentPeriodEnd, periodEnd: addInterval(s.currentPeriodEnd, s.plan.interval), dueAt: s.currentPeriodEnd,
      },
    });
    issued++;
  }
  const overdue = await db.subscriptionInvoice.findMany({ where: { status: "OPEN", dueAt: { lt: now } }, select: { subscriptionId: true, organizationId: true }, take: 500 });
  for (const o of overdue) {
    await db.subscription.updateMany({ where: { id: o.subscriptionId, status: "ACTIVE" }, data: { status: "PAST_DUE" } });
    await db.organization.updateMany({ where: { id: o.organizationId, status: "ACTIVE" }, data: { status: "PAST_DUE" } });
  }
  return { issued, overdue: overdue.length };
}
