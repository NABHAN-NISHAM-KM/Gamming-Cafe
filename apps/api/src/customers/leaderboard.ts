import type { TenantTx } from "@arena/db";

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/**
 * Hours played this month. Only players who opted in are listed (first
 * names); the asking player always gets their own place.
 */
export async function leaderboard(t: TenantTx, customerId: string, top = 20) {
  const rows = await t.$queryRaw<Array<{ id: string; name: string; minutes: number; opted: boolean }>>`
    SELECT c."id", c."displayName" AS name, (SUM(s."billedSeconds") / 60)::int AS minutes, c."showOnLeaderboard" AS opted
      FROM "GamingSession" s JOIN "Customer" c ON c."id" = s."customerId"
     WHERE s."status" = 'ENDED' AND s."startedAt" >= date_trunc('month', now()) AND c."status" <> 'DELETED'
     GROUP BY c."id" HAVING SUM(s."billedSeconds") >= 60
     ORDER BY minutes DESC`;
  const rank = rows.findIndex((r) => r.id === customerId);
  const opted = (await t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { showOnLeaderboard: true } })).showOnLeaderboard;
  return {
    top: rows.filter((r) => r.opted).slice(0, top).map((r, i) => ({ place: i + 1, name: firstName(r.name), minutes: r.minutes, me: r.id === customerId })),
    me: { minutes: rank >= 0 ? rows[rank]!.minutes : 0, place: rank >= 0 ? rank + 1 : null, of: rows.length, shown: opted },
  };
}
