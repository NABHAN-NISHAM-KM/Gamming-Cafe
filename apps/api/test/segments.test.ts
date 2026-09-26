// Phase 10 unit tests: segment rules and message personalization — pure.
import { describe, expect, it } from "vitest";
import { BUILT_IN, inSegment, personalize, SegmentRules, type CustomerMetrics } from "../src/crm/segments.js";

const NOW = new Date("2026-09-26T12:00:00Z");
const DAY = 86_400_000;
const who = (over: Partial<CustomerMetrics> = {}): CustomerMetrics => ({
  id: "c", createdAt: new Date(NOW.getTime() - 200 * DAY), lastVisitAt: new Date(NOW.getTime() - 2 * DAY), visits30d: 1, minutes30d: 60, spend90d: 100,
  gamingSpend90d: 80, restaurantSpend90d: 20, tournaments180d: 0, tierCode: null, tierRank: 0, marketingConsent: true, age: 25, ...over,
});
const rules = (key: string) => BUILT_IN.find((b) => b.key === key)!.rules;

describe("segments", () => {
  it("built-ins: new, regular, lapsed, gamers, foodies, competitive", () => {
    expect(inSegment(who({ createdAt: new Date(NOW.getTime() - 5 * DAY) }), rules("NEW"), NOW)).toBe(true);
    expect(inSegment(who(), rules("NEW"), NOW)).toBe(false);
    expect(inSegment(who({ visits30d: 4 }), rules("REGULAR"), NOW)).toBe(true);
    expect(inSegment(who({ lastVisitAt: new Date(NOW.getTime() - 45 * DAY) }), rules("INACTIVE"), NOW)).toBe(true);
    expect(inSegment(who({ lastVisitAt: null }), rules("INACTIVE"), NOW)).toBe(false); // never came: not "lapsed"
    expect(inSegment(who({ minutes30d: 700 }), rules("GAMING_HEAVY"), NOW)).toBe(true);
    expect(inSegment(who({ restaurantSpend90d: 120, gamingSpend90d: 60 }), rules("RESTAURANT_HEAVY"), NOW)).toBe(true);
    expect(inSegment(who({ tournaments180d: 1 }), rules("COMPETITIVE"), NOW)).toBe(true);
  });

  it("custom rules combine (all must hold)", () => {
    const r = SegmentRules.parse({ minSpend90d: 50, minAge: 18, marketingConsent: true });
    expect(inSegment(who(), r, NOW)).toBe(true);
    expect(inSegment(who({ age: 16 }), r, NOW)).toBe(false);
    expect(inSegment(who({ age: null }), r, NOW)).toBe(false);
    expect(inSegment(who({ marketingConsent: false }), r, NOW)).toBe(false);
    expect(SegmentRules.safeParse({ spendLots: true }).success).toBe(false);
  });

  it("personalize fills known tokens and drops unknown ones", () => {
    expect(personalize("Hi {{firstName}}, {{points}} pts {{ nope }}", { firstName: "Sara", points: 120 })).toBe("Hi Sara, 120 pts ");
  });
});
