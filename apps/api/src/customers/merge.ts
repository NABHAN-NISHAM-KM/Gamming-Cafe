import { ConflictException, NotFoundException } from "@nestjs/common";
import type { TenantTx } from "@arena/db";
import { movePoints } from "../loyalty/points.js";
import { adjustTime } from "../sessions/time-balance.js";
import { moveMoney, orgCurrency, toMinor } from "../wallet/wallet.js";
import { refreshStats } from "./stats.js";

/**
 * Right to erasure: scrub every piece of personal data and block the
 * account, but keep bills, payments, wallet and loyalty ledgers (anonymous
 * now) so the books and reports still add up. Refused while the customer
 * still has money with us or something in progress.
 */
export async function eraseCustomer(t: TenantTx, customerId: string) {
  const c = await t.customer.findUnique({ where: { id: customerId }, select: { id: true, status: true, wallets: { select: { cashBalance: true, refundBalance: true } } } });
  if (!c) throw new NotFoundException({ error: "not_found" });
  if (c.status === "DELETED") throw new ConflictException({ error: "customer_erased" });
  if (c.wallets.some((w) => w.cashBalance.add(w.refundBalance).gt(0))) throw new ConflictException({ error: "wallet_not_empty" });
  if (await t.gamingSession.count({ where: { customerId, status: { in: ["PENDING", "ACTIVE", "PAUSED", "ENDING"] } } })) throw new ConflictException({ error: "customer_in_session" });
  if (await t.bill.count({ where: { customerId, status: { in: ["OPEN", "PARTIALLY_PAID"] } } })) throw new ConflictException({ error: "customer_has_open_bill" });
  if (await t.booking.count({ where: { customerId, startsAt: { gt: new Date() }, status: { in: ["PENDING", "CONFIRMED"] } } })) throw new ConflictException({ error: "customer_has_bookings" });

  await t.customer.update({
    where: { id: customerId },
    data: {
      username: `erased-${customerId.slice(-12)}`, displayName: "Erased customer", firstName: null, lastName: null, email: null, phone: null, dateOfBirth: null,
      avatarUrl: null, passwordHash: null, pinHash: null, qrLoginSecretRef: null, referralCode: null, marketingConsent: false, emailVerifiedAt: null, phoneVerifiedAt: null,
      tags: [], status: "DELETED",
    },
  });
  // Logins, devices and profile extras go entirely; money and history stay, now anonymous.
  await t.customerSession.deleteMany({ where: { customerId } });
  await t.pushSubscription.deleteMany({ where: { customerId } });
  await t.customerFavoriteGame.deleteMany({ where: { customerId } });
  await t.customerSegmentMember.deleteMany({ where: { customerId } });
  await t.customerNote.deleteMany({ where: { customerId } });
}

/**
 * Folds a duplicate account (`fromId`) into the one the customer keeps
 * (`intoId`): balances move as ledger transfers (the ledgers themselves are
 * append-only), history rows are re-pointed, then the duplicate is erased.
 * Idempotent: a retry finds the transfers already made.
 */
export async function mergeCustomers(t: TenantTx, intoId: string, fromId: string, employeeId: string, branchId: string) {
  if (intoId === fromId) throw new ConflictException({ error: "same_customer" });
  const [into, from] = await Promise.all([intoId, fromId].map((id) => t.customer.findUnique({ where: { id }, select: { id: true, status: true, username: true, loyaltyPoints: true, lastVisitAt: true, tags: true, referredById: true } })));
  if (!into || !from) throw new NotFoundException({ error: "not_found" });
  if (into.status === "DELETED" || from.status === "DELETED") throw new ConflictException({ error: "customer_erased" });

  const { currency, unit, organizationId } = await orgCurrency(t);
  const w = await t.wallet.findFirst({ where: { customerId: fromId, currency } });
  if (w?.isFrozen) throw new ConflictException({ error: "wallet_frozen" });
  if (w && (w.refundBalance.gt(0) || w.promoBalance.gt(0))) throw new ConflictException({ error: "wallet_has_refund_balance" });
  const time = (await t.wallet.findMany({ where: { customerId: fromId }, select: { timeBalanceMin: true } })).reduce((s, x) => s + x.timeBalanceMin, 0);

  const reason = (dir: "to" | "from", who: string) => `Account merge ${dir} @${who}`;
  const key = (k: string) => `merge:${fromId}:${intoId}:${k}`;
  for (const bucket of ["CASH", "BONUS"] as const) {
    const minor = w ? toMinor(bucket === "CASH" ? w.cashBalance : w.bonusBalance, unit) : 0;
    if (!minor) continue;
    await moveMoney(t, { customerId: fromId, bucket, deltaMinor: -minor, type: "TRANSFER_OUT", reason: reason("to", into.username), branchId, employeeId, referenceType: "CUSTOMER", referenceId: intoId, idempotencyKey: key(`${bucket}:out`) });
    // ponytail: bonus credit restarts its 90 days in the kept account; per-grant expiry isn't carried over.
    await moveMoney(t, { customerId: intoId, bucket, deltaMinor: minor, type: "TRANSFER_IN", reason: reason("from", from.username), branchId, employeeId, referenceType: "CUSTOMER", referenceId: fromId, idempotencyKey: key(`${bucket}:in`), ...(bucket === "BONUS" ? { expiresAt: new Date(Date.now() + 90 * 86_400_000) } : {}) });
  }
  if (time > 0) {
    const common = { organizationId, currency, branchId, employeeId };
    await adjustTime(t, { ...common, customerId: fromId, deltaMinutes: -time, type: "TRANSFER_OUT", reason: reason("to", into.username), referenceType: "CUSTOMER", referenceId: intoId, idempotencyKey: key("TIME:out") });
    await adjustTime(t, { ...common, customerId: intoId, deltaMinutes: time, type: "TRANSFER_IN", reason: reason("from", from.username), referenceType: "CUSTOMER", referenceId: fromId, idempotencyKey: key("TIME:in") });
  }
  if (from.loyaltyPoints > 0) {
    await movePoints(t, { customerId: fromId, delta: -from.loyaltyPoints, type: "ADJUST", source: "MANUAL", reason: reason("to", into.username), employeeId, idempotencyKey: key("POINTS:out") });
    await movePoints(t, { customerId: intoId, delta: from.loyaltyPoints, type: "ADJUST", source: "MANUAL", reason: reason("from", from.username), employeeId, idempotencyKey: key("POINTS:in") });
  }

  // History follows the person. Ledgers (wallet, points) stay where they were written.
  const move = { where: { customerId: fromId }, data: { customerId: intoId } };
  await t.gamingSession.updateMany(move);
  await t.order.updateMany(move);
  await t.bill.updateMany(move);
  await t.payment.updateMany(move);
  await t.invoice.updateMany(move);
  await t.booking.updateMany(move);
  await t.membership.updateMany(move);
  await t.printJob.updateMany(move);
  await t.screenshot.updateMany(move);
  await t.supportTicket.updateMany(move);
  await t.notification.updateMany(move);
  await t.promoCode.updateMany(move);
  await t.promotionRedemption.updateMany(move);
  await t.sessionFeedback.updateMany(move);
  await t.customerRestriction.updateMany(move);
  await t.customerNote.updateMany(move);
  await t.customer.updateMany({ where: { referredById: fromId, id: { not: intoId } }, data: { referredById: intoId } });
  // One team per tournament: entries the kept account doesn't already have.
  const inTournaments = (await t.tournamentPlayer.findMany({ where: { customerId: intoId }, select: { tournamentId: true } })).map((x) => x.tournamentId);
  await t.tournamentPlayer.updateMany({ where: { customerId: fromId, tournamentId: { notIn: inTournaments } }, data: { customerId: intoId } });
  for (const f of await t.customerFavoriteGame.findMany({ where: { customerId: fromId } })) {
    await t.customerFavoriteGame.upsert({ where: { customerId_gameId: { customerId: intoId, gameId: f.gameId } }, create: { organizationId, customerId: intoId, gameId: f.gameId }, update: {} });
  }
  for (const a of await t.customerAchievement.findMany({ where: { customerId: fromId } })) {
    await t.customerAchievement.upsert({ where: { customerId_achievementId: { customerId: intoId, achievementId: a.achievementId } }, create: { organizationId, customerId: intoId, achievementId: a.achievementId, earnedAt: a.earnedAt }, update: {} });
  }
  await t.customer.update({
    where: { id: intoId },
    data: {
      tags: [...new Set([...into.tags, ...from.tags])].slice(0, 20),
      lastVisitAt: [into.lastVisitAt, from.lastVisitAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      ...(!into.referredById && from.referredById && from.referredById !== intoId ? { referredById: from.referredById } : {}),
    },
  });
  await refreshStats(t, intoId); // spend and minutes now include the moved history
  await eraseCustomer(t, fromId);
}
