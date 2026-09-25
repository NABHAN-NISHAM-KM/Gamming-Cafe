import { describe, expect, it } from "vitest";
import { cashChange, OrderPricingError, priceOrder, validateModifiers, type TaxProfileDef } from "../src/pos/order-pricing.js";

const UAE: TaxProfileDef = { pricesIncludeTax: true, rates: [{ name: "VAT", ratePercent: 5, appliesTo: "ALL" }] };
const US: TaxProfileDef = { pricesIncludeTax: false, rates: [{ name: "State", ratePercent: 6, appliesTo: "ALL" }, { name: "City", ratePercent: 2.5, appliesTo: "FOOD" }] };
const line = (unitMinor: number, quantity = 1, o: Partial<Parameters<typeof priceOrder>[0][number]> = {}) => ({ unitMinor, quantity, modifiers: [], taxClass: "FOOD" as const, ...o });

describe("priceOrder", () => {
  it("tax-inclusive prices: the menu price is what you pay; VAT is inside it", () => {
    const o = priceOrder([line(2500), line(1200, 2)], UAE); // burger 25 + 2 × cola 12
    expect(o).toMatchObject({ subtotalMinor: 4900, discountMinor: 0, totalMinor: 4900 });
    expect(o.lines[0]!.taxMinor).toBe(119); // 25.00 − 25.00/1.05 = 1.19
    expect(o.taxMinor).toBe(o.lines.reduce((a, l) => a + l.taxMinor, 0));
  });

  it("tax-exclusive prices: tax is added, per class", () => {
    const o = priceOrder([line(1000, 1, { taxClass: "FOOD" }), line(1000, 1, { taxClass: "MERCHANDISE" })], US);
    expect(o.lines[0]).toMatchObject({ taxMinor: 85, netMinor: 1085 }); // 6 % + 2.5 %
    expect(o.lines[0]!.taxes).toEqual([{ name: "State", ratePercent: 6, amountMinor: 60 }, { name: "City", ratePercent: 2.5, amountMinor: 25 }]);
    expect(o.lines[1]).toMatchObject({ taxMinor: 60, netMinor: 1060 }); // city tax is food-only
    expect(o.totalMinor).toBe(2145);
  });

  it("modifiers change the unit price", () => {
    const o = priceOrder([line(2500, 2, { modifiers: [{ name: "Large", priceDeltaMinor: 500 }, { name: "Extra cheese", priceDeltaMinor: 300 }] })], UAE);
    expect(o.lines[0]).toMatchObject({ modifiersMinor: 800, grossMinor: 6600 });
  });

  it("an order discount is spread so the shares add up exactly", () => {
    const o = priceOrder([line(1000), line(1000), line(1000)], UAE, { kind: "AMOUNT", valueMinor: 100 });
    expect(o.lines.map((l) => l.discountMinor).sort()).toEqual([33, 33, 34]);
    expect(o.totalMinor).toBe(2900);
    const p = priceOrder([line(999), line(1)], UAE, { kind: "PERCENT", value: 10 });
    expect(p.discountMinor).toBe(100);
    expect(p.totalMinor).toBe(900);
  });

  it("a discount never makes anything negative", () => {
    const o = priceOrder([line(500)], UAE, { kind: "AMOUNT", valueMinor: 99_999 });
    expect(o.totalMinor).toBe(0);
    expect(o.lines[0]!.taxMinor).toBe(0);
  });

  it("refuses nonsense", () => {
    expect(() => priceOrder([], UAE)).toThrow(OrderPricingError);
    expect(() => priceOrder([line(100, 0)], UAE)).toThrow(/Quantity/);
    expect(() => priceOrder([line(100)], UAE, { kind: "PERCENT", value: 150 })).toThrow(/0–100/);
    expect(() => priceOrder([line(100, 1, { modifiers: [{ name: "x", priceDeltaMinor: -500 }] })], UAE)).toThrow(/negative/);
  });
});

describe("validateModifiers", () => {
  const groups = [
    { id: "size", name: "Size", minSelect: 1, maxSelect: 1, modifierIds: ["s", "l"] },
    { id: "extras", name: "Extras", minSelect: 0, maxSelect: 2, modifierIds: ["cheese", "bacon", "egg"] },
  ];
  it("enforces required, maximum, ownership and duplicates", () => {
    expect(() => validateModifiers(groups, ["l", "cheese"])).not.toThrow();
    expect(() => validateModifiers(groups, ["cheese"])).toThrow(/Size/);
    expect(() => validateModifiers(groups, ["s", "l"])).toThrow(/at most 1/);
    expect(() => validateModifiers(groups, ["s", "cheese", "bacon", "egg"])).toThrow(/at most 2/);
    expect(() => validateModifiers(groups, ["s", "anchovies"])).toThrow(/belong/);
    expect(() => validateModifiers(groups, ["s", "cheese", "cheese"])).toThrow(/once/);
  });
});

describe("cashChange", () => {
  it("gives change and refuses short payment", () => {
    expect(cashChange(4750, 5000)).toBe(250);
    expect(cashChange(4750, 4750)).toBe(0);
    expect(() => cashChange(4750, 4700)).toThrow(/less/);
  });
});
