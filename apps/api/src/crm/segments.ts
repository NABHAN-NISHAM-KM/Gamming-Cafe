import { z } from "zod";

/**
 * Customer segments — pure matching of a customer's activity against rules
 * (unit-tested in test/segments.test.ts). Every rule present must hold.
 */

export const SegmentRules = z
  .object({
    newWithinDays: z.number().int().min(1).max(365),
    minVisits30d: z.number().int().min(1).max(100),
    maxVisits30d: z.number().int().min(0).max(100),
    minMinutes30d: z.number().int().min(1).max(50_000),
    minSpend90d: z.number().min(0).max(1_000_000),
    inactiveDays: z.number().int().min(7).max(730),
    tierIn: z.array(z.string().min(1).max(32)).min(1),
    minTierRank: z.number().int().min(0).max(1000),
    tournamentPlayer: z.literal(true),
    restaurantHeavy: z.literal(true),
    gamingHeavy: z.literal(true),
    marketingConsent: z.literal(true),
    minAge: z.number().int().min(0).max(120),
    maxAge: z.number().int().min(0).max(120),
  })
  .partial()
  .strict();
export type SegmentRules = z.infer<typeof SegmentRules>;

export interface CustomerMetrics {
  id: string;
  createdAt: Date;
  lastVisitAt: Date | null;
  visits30d: number;
  minutes30d: number;
  spend90d: number; // major units
  gamingSpend90d: number;
  restaurantSpend90d: number;
  tournaments180d: number;
  tierCode: string | null;
  tierRank: number;
  marketingConsent: boolean;
  age: number | null;
}

const DAY = 86_400_000;

export function inSegment(m: CustomerMetrics, r: SegmentRules, now = new Date()): boolean {
  if (r.newWithinDays !== undefined && now.getTime() - m.createdAt.getTime() > r.newWithinDays * DAY) return false;
  if (r.minVisits30d !== undefined && m.visits30d < r.minVisits30d) return false;
  if (r.maxVisits30d !== undefined && m.visits30d > r.maxVisits30d) return false;
  if (r.minMinutes30d !== undefined && m.minutes30d < r.minMinutes30d) return false;
  if (r.minSpend90d !== undefined && m.spend90d < r.minSpend90d) return false;
  // Inactive: has been here before, but not for a while.
  if (r.inactiveDays !== undefined && (!m.lastVisitAt || now.getTime() - m.lastVisitAt.getTime() < r.inactiveDays * DAY)) return false;
  if (r.tierIn && (!m.tierCode || !r.tierIn.includes(m.tierCode))) return false;
  if (r.minTierRank !== undefined && m.tierRank < r.minTierRank) return false;
  if (r.tournamentPlayer && m.tournaments180d === 0) return false;
  if (r.restaurantHeavy && !(m.restaurantSpend90d >= 50 && m.restaurantSpend90d > m.gamingSpend90d)) return false;
  if (r.gamingHeavy && !(m.gamingSpend90d >= 50 && m.gamingSpend90d > 2 * m.restaurantSpend90d)) return false;
  if (r.marketingConsent && !m.marketingConsent) return false;
  if (r.minAge !== undefined && (m.age === null || m.age < r.minAge)) return false;
  if (r.maxAge !== undefined && (m.age === null || m.age > r.maxAge)) return false;
  return true;
}

/** Built-in segments every organization gets (re-evaluated daily). */
export const BUILT_IN: Array<{ key: string; name: string; rules: SegmentRules }> = [
  { key: "NEW", name: "New (joined in the last 30 days)", rules: { newWithinDays: 30 } },
  { key: "REGULAR", name: "Regulars (4+ visits in 30 days)", rules: { minVisits30d: 4 } },
  { key: "VIP", name: "VIP (Gold tier and above)", rules: { minTierRank: 20 } },
  { key: "INACTIVE", name: "Lapsed (no visit for 30+ days)", rules: { inactiveDays: 30 } },
  { key: "HIGH_SPENDER", name: "High spenders (500+ in 90 days)", rules: { minSpend90d: 500 } },
  { key: "COMPETITIVE", name: "Competitive (played a tournament)", rules: { tournamentPlayer: true } },
  { key: "RESTAURANT_HEAVY", name: "Foodies (spend more on food than gaming)", rules: { restaurantHeavy: true } },
  { key: "GAMING_HEAVY", name: "Gamers (10+ hours in 30 days)", rules: { minMinutes30d: 600 } },
];

/** "Hi {{firstName}}, you have {{points}} points" — unknown tokens are left out. */
export function personalize(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars[k] === null || vars[k] === undefined ? "" : String(vars[k])));
}
