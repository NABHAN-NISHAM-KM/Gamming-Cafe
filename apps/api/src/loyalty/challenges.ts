import { z } from "zod";
import type { TenantTx } from "@arena/db";
import type { PushService } from "../push/push.service.js";
import { movePoints } from "./points.js";

/**
 * Challenges are the Achievement rows: a milestone ("play 10 hours", "come 5
 * times") worth points once. `criteria` says what is counted; progress is
 * read from the customer's own history, so nothing extra is tracked.
 */
export const Criteria = z
  .object({
    type: z.enum(["PLAY_MINUTES", "VISITS", "BOOKINGS", "TOURNAMENTS"]),
    target: z.number().int().min(1).max(1_000_000),
  })
  .strict();
export type Criteria = z.infer<typeof Criteria>;

async function measure(t: TenantTx, customerId: string, types: Set<Criteria["type"]>) {
  const m: Record<Criteria["type"], number> = { PLAY_MINUTES: 0, VISITS: 0, BOOKINGS: 0, TOURNAMENTS: 0 };
  if (types.has("PLAY_MINUTES")) m.PLAY_MINUTES = (await t.customer.findUnique({ where: { id: customerId }, select: { totalGamingMinutes: true } }))?.totalGamingMinutes ?? 0;
  if (types.has("VISITS")) {
    const [r] = await t.$queryRaw<Array<{ days: number }>>`SELECT COUNT(DISTINCT ("startedAt" AT TIME ZONE 'UTC')::date)::int AS days FROM "GamingSession" WHERE "customerId" = ${customerId}::uuid AND "startedAt" IS NOT NULL`;
    m.VISITS = r?.days ?? 0;
  }
  if (types.has("BOOKINGS")) m.BOOKINGS = await t.booking.count({ where: { customerId, status: { in: ["CHECKED_IN", "COMPLETED"] } } });
  if (types.has("TOURNAMENTS")) m.TOURNAMENTS = await t.tournamentPlayer.count({ where: { customerId } });
  return m;
}

/** Every active challenge with the customer's progress; anything newly reached is awarded on the way. */
export async function challengesFor(t: TenantTx, customerId: string, push?: PushService) {
  const all = await t.achievement.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  const parsed = all.flatMap((a) => {
    const c = Criteria.safeParse(a.criteria);
    return c.success ? [{ a, c: c.data }] : [];
  });
  const earned = new Map((await t.customerAchievement.findMany({ where: { customerId }, select: { achievementId: true, earnedAt: true } })).map((e) => [e.achievementId, e.earnedAt]));
  const m = await measure(t, customerId, new Set(parsed.filter((p) => !earned.has(p.a.id)).map((p) => p.c.type)));
  const out = [];
  for (const { a, c } of parsed) {
    let earnedAt = earned.get(a.id) ?? null;
    if (!earnedAt && m[c.type] >= c.target) {
      earnedAt = new Date();
      await t.customerAchievement.createMany({ data: [{ organizationId: a.organizationId, customerId, achievementId: a.id, earnedAt }], skipDuplicates: true });
      if (a.rewardPoints > 0) await movePoints(t, { customerId, delta: a.rewardPoints, type: "EARN", source: "ACHIEVEMENT", reason: a.name, referenceType: "ACHIEVEMENT", referenceId: a.id, idempotencyKey: `pts:ach:${a.id}:${customerId}` });
      await push?.notify(t, { customerId, event: "challenge.done", title: `Challenge complete: ${a.name}`, body: a.rewardPoints > 0 ? `+${a.rewardPoints} points` : "Nice one!", screen: "rewards", dedupeKey: `challenge:${a.id}:${customerId}` });
    }
    out.push({ id: a.id, name: a.name, description: a.description, rewardPoints: a.rewardPoints, type: c.type, target: c.target, progress: earnedAt ? c.target : Math.min(m[c.type], c.target), earnedAt });
  }
  return out;
}
