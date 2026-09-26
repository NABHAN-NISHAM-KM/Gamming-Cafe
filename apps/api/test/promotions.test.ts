// Phase 10 unit tests: the promotions rules engine — conditions (branch, time
// windows in the branch time zone, tier, segments, spend, products), effects
// (percent/amount off with caps, bonus minutes, free item), stacking — pure.
import { describe, expect, it } from "vitest";
import { Conditions, Effects, choose, isBirthday, matches, value, type PromoContext, type PromotionDef } from "../src/promotions/engine.js";

// Friday 2026-09-25 15:30 in Dubai (UTC+4) = 11:30Z
const NOW = new Date("2026-09-25T11:30:00Z");
const ctx = (over: Partial<PromoContext> = {}): PromoContext => ({
  now: NOW, timezone: "Asia/Dubai", minorUnit: 2, branchId: "dxb1", zoneId: "vip", stationClass: "PC",
  customer: { tierCode: "GOLD", segmentIds: ["seg-regular"], firstVisit: false, birthday: false },
  gaming: { amountMinor: 3000, minutes: 120 }, order: null, ...over,
});
const promo = (over: Partial<PromotionDef> = {}): PromotionDef => ({ id: "p", name: "Promo", priority: 0, isStackable: false, conditions: {}, effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 10 }], ...over });

describe("conditions", () => {
  it("time windows use the branch's clock, and can cross midnight", () => {
    expect(matches(promo({ conditions: { all: [{ timeBetween: ["14:00", "18:00"] }] } }), ctx())).toBe(true);
    expect(matches(promo({ conditions: { all: [{ timeBetween: ["22:00", "06:00"] }] } }), ctx())).toBe(false);
    expect(matches(promo({ conditions: { all: [{ timeBetween: ["22:00", "06:00"] }] } }), ctx({ now: new Date("2026-09-25T21:00:00Z") }))).toBe(true); // 01:00 Dubai
  });

  it("weekdays, tiers, segments, zones", () => {
    expect(matches(promo({ conditions: { all: [{ dayOfWeekIn: ["fri", "sat"] }, { tierIn: ["GOLD"] }] } }), ctx())).toBe(true);
    expect(matches(promo({ conditions: { all: [{ tierIn: ["GOLD"] }] } }), ctx({ customer: null }))).toBe(false);
    expect(matches(promo({ conditions: { all: [{ segmentIn: ["seg-vip"] }] } }), ctx())).toBe(false);
    expect(matches(promo({ conditions: { any: [{ segmentIn: ["seg-vip"] }, { zoneIn: ["vip"] }] } }), ctx())).toBe(true);
  });

  it("minimum spend is in major units", () => {
    expect(matches(promo({ conditions: { all: [{ minSpend: 30 }] } }), ctx())).toBe(true);
    expect(matches(promo({ conditions: { all: [{ minSpend: 30.01 }] } }), ctx())).toBe(false);
  });

  it("schemas reject unknown conditions and silly effects", () => {
    expect(Conditions.safeParse({ all: [{ hackerMode: true }] }).success).toBe(false);
    expect(Effects.safeParse([{ type: "PERCENT_OFF", target: "ORDER", value: 150 }]).success).toBe(false);
    expect(Effects.safeParse([{ type: "BONUS_MINUTES", minutes: 30 }]).success).toBe(true);
  });
});

describe("effects", () => {
  it("percent off with a cap; amount off never more than the price", () => {
    expect(value(promo({ effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 50, maxAmount: 10 }] }), ctx()).discountMinor).toBe(1000);
    expect(value(promo({ effects: [{ type: "AMOUNT_OFF", target: "GAMING_TIME", value: 100 }] }), ctx()).discountMinor).toBe(3000);
  });

  it("bonus minutes only for timed gaming", () => {
    expect(value(promo({ effects: [{ type: "BONUS_MINUTES", minutes: 30 }] }), ctx()).bonusMinutes).toBe(30);
    expect(value(promo({ effects: [{ type: "BONUS_MINUTES", minutes: 30 }] }), ctx({ gaming: { amountMinor: 0, minutes: null } })).bonusMinutes).toBe(0);
  });

  it("products: percent off selected products, or the cheapest matching item free", () => {
    const order = { lines: [{ productId: "burger", categoryId: "food", quantity: 2, unitMinor: 3200 }, { productId: "cola", categoryId: "drinks", quantity: 3, unitMinor: 800 }] };
    const c = ctx({ gaming: null, order });
    expect(value(promo({ effects: [{ type: "PERCENT_OFF", target: "PRODUCTS", value: 50, categoryIds: ["drinks"] }] }), c).discountMinor).toBe(1200);
    expect(value(promo({ effects: [{ type: "FREE_ITEM", categoryIds: ["drinks"], quantity: 1 }] }), c).discountMinor).toBe(800);
    expect(value(promo({ effects: [{ type: "PERCENT_OFF", target: "ORDER", value: 10 }] }), c).discountMinor).toBe(880);
  });
});

describe("choosing", () => {
  it("the best non-stackable wins; stackables add on; the total never exceeds the price", () => {
    const happy = promo({ id: "happy", name: "Happy hour", effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 20 }] });
    const gold = promo({ id: "gold", name: "Gold", effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 10 }] });
    const bonus = promo({ id: "bonus", name: "Weekend bonus", isStackable: true, effects: [{ type: "BONUS_MINUTES", minutes: 30 }] });
    const r = choose([happy, gold, bonus], ctx());
    expect(r.applied.map((a) => a.promotionId)).toEqual(["happy", "bonus"]);
    expect(r.discountMinor).toBe(600);
    expect(r.bonusMinutes).toBe(30);
    const huge = promo({ id: "huge", isStackable: true, effects: [{ type: "AMOUNT_OFF", target: "GAMING_TIME", value: 50 }] });
    expect(choose([happy, huge], ctx()).discountMinor).toBe(3000);
  });

  it("promotions that don't match, or are worth nothing here, are left out", () => {
    const food = promo({ id: "food", effects: [{ type: "PERCENT_OFF", target: "ORDER", value: 10 }] });
    expect(choose([food], ctx()).applied).toEqual([]);
  });
});

describe("birthdays", () => {
  it("within three days either side, across the new year", () => {
    expect(isBirthday(new Date("1998-09-27"), NOW, "Asia/Dubai")).toBe(true);
    expect(isBirthday(new Date("1998-10-05"), NOW, "Asia/Dubai")).toBe(false);
    expect(isBirthday(new Date("2001-01-01"), new Date("2026-12-30T12:00:00Z"), "Asia/Dubai")).toBe(true);
    expect(isBirthday(null, NOW, "Asia/Dubai")).toBe(false);
  });
});
