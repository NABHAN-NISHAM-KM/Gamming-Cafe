import { ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import type { TenantTx } from "@arena/db";

/**
 * Staff-imposed limits on one customer (CustomerRestriction). A row is active
 * from startsAt until endsAt (null = until lifted). BAN keeps them off every PC
 * and app; the others narrow what they may do:
 *  ZONE_BLOCK        scope.zoneIds           can't play in those zones
 *  GAME_BLOCK        scope.gameIds           those games are locked on the PC
 *  AGE_LIMIT         scope.maxAge            treated as this age for game ratings
 *  TIME_LIMIT        scope.maxMinutesPerDay  gaming minutes per branch-local day
 *  RESTAURANT_BLOCK  —                       no food & drink orders
 */
export const RestrictionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BAN"), scope: z.object({}).strict().default({}) }),
  z.object({ type: z.literal("ZONE_BLOCK"), scope: z.object({ zoneIds: z.array(z.uuid()).min(1).max(50) }).strict() }),
  z.object({ type: z.literal("GAME_BLOCK"), scope: z.object({ gameIds: z.array(z.uuid()).min(1).max(200) }).strict() }),
  z.object({ type: z.literal("AGE_LIMIT"), scope: z.object({ maxAge: z.number().int().min(3).max(21) }).strict() }),
  z.object({ type: z.literal("TIME_LIMIT"), scope: z.object({ maxMinutesPerDay: z.number().int().min(15).max(1440) }).strict() }),
  z.object({ type: z.literal("RESTAURANT_BLOCK"), scope: z.object({}).strict().default({}) }),
]);

export interface Scope { zoneIds?: string[]; gameIds?: string[]; maxAge?: number; maxMinutesPerDay?: number }

export async function activeRestrictions(t: TenantTx, customerId: string, now = new Date()) {
  const rows = await t.customerRestriction.findMany({
    where: { customerId, liftedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    select: { id: true, type: true, scope: true, reason: true, endsAt: true },
  });
  return rows.map((r) => ({ ...r, scope: (r.scope ?? {}) as Scope }));
}

/**
 * Customer.status follows the active restrictions (BAN → BANNED, anything else
 * → RESTRICTED, none → ACTIVE), so every login check that reads the status
 * agrees. Pending and erased accounts are left alone.
 */
export async function syncStatus(t: TenantTx, customerId: string) {
  const c = await t.customer.findUnique({ where: { id: customerId }, select: { status: true } });
  if (!c || !["ACTIVE", "BANNED", "RESTRICTED"].includes(c.status)) return c?.status ?? null;
  const active = await activeRestrictions(t, customerId);
  const status = active.some((r) => r.type === "BAN") ? "BANNED" : active.length ? "RESTRICTED" : "ACTIVE";
  if (status !== c.status) await t.customer.update({ where: { id: customerId }, data: { status } });
  return status;
}

/** What the PC needs to know: the age to rate games by, and games locked for them. */
export function playerLimits(active: Awaited<ReturnType<typeof activeRestrictions>>, realAge: number | null) {
  const caps = active.filter((r) => r.type === "AGE_LIMIT").map((r) => r.scope.maxAge!);
  const age = caps.length ? Math.min(realAge ?? Infinity, ...caps) : realAge;
  return { age, blockedGameIds: [...new Set(active.filter((r) => r.type === "GAME_BLOCK").flatMap((r) => r.scope.gameIds ?? []))] };
}

/** Gaming minutes the customer has left today at this branch, or null when unlimited. */
export async function minutesLeftToday(t: TenantTx, active: Awaited<ReturnType<typeof activeRestrictions>>, customerId: string, timezone: string) {
  const caps = active.filter((r) => r.type === "TIME_LIMIT").map((r) => r.scope.maxMinutesPerDay!);
  if (!caps.length) return null;
  const [row] = await t.$queryRaw<Array<{ used: number }>>`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE("endedAt", now()) - "startedAt")) / 60), 0)::float AS used
      FROM "GamingSession"
     WHERE "customerId" = ${customerId}::uuid AND "startedAt" IS NOT NULL
       AND "startedAt" >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})`;
  return Math.max(0, Math.min(...caps) - Math.ceil(row?.used ?? 0));
}

/** Refuses a session the restrictions don't allow (zone block, daily limit used up). */
export async function assertMayPlay(t: TenantTx, customerId: string, at: { zoneId: string; timezone: string }) {
  const active = await activeRestrictions(t, customerId);
  const ban = active.find((r) => r.type === "BAN");
  if (ban) throw new ForbiddenException({ error: "customer_banned", reason: ban.reason });
  if (active.some((r) => r.type === "ZONE_BLOCK" && r.scope.zoneIds?.includes(at.zoneId))) throw new ForbiddenException({ error: "customer_zone_blocked" });
  const left = await minutesLeftToday(t, active, customerId, at.timezone);
  if (left === 0) throw new ForbiddenException({ error: "daily_limit_reached" });
  return { active, minutesLeftToday: left };
}

export async function assertMayOrderFood(t: TenantTx, customerId: string | null) {
  if (!customerId) return;
  if ((await activeRestrictions(t, customerId)).some((r) => r.type === "RESTAURANT_BLOCK")) throw new ForbiddenException({ error: "customer_restaurant_blocked" });
}
