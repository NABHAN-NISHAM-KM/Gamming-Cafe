// Phase 8 unit tests: moving-average cost, recipe consumption, reorder
// quantities and PO line money — pure functions, no database.
import { describe, expect, it } from "vitest";
import { consumption, lineMoney, movingAverage, reorderQuantity, unitCost } from "../src/inventory/costing.js";

describe("inventory costing", () => {
  it("moving average weights old stock and the new delivery", () => {
    // 144 cans at 2.20 + 240 at 2.10 → 2.1375
    expect(movingAverage(144, "2.2", 240, "2.1").toString()).toBe("2.1375");
    // Empty shelf: the average is simply the new cost.
    expect(movingAverage(0, "9.99", 10, "3").toString()).toBe("3");
  });

  it("negative stock (sold before it arrived) doesn't drag the average", () => {
    expect(movingAverage(-5, "100", 10, "4").toString()).toBe("4");
  });

  it("rejects receiving nothing", () => {
    expect(() => movingAverage(10, "1", 0, "1")).toThrow();
  });

  it("consumption: stock item, recipe with planned waste, and options — times quantity, summed per item", () => {
    const used = consumption({
      quantity: 2,
      stockItemId: null,
      recipe: [
        { itemId: "bun", quantity: 1, wastePct: 0 },
        { itemId: "patty", quantity: 2, wastePct: 0 },
        { itemId: "fries", quantity: 200, wastePct: 5 },
      ],
      modifiers: [
        { itemId: "patty", quantity: 1 }, // "extra patty" adds to the recipe's patties
        { itemId: null, quantity: null }, // an option with no stock effect
      ],
    });
    expect(used.get("bun")!.quantity.toString()).toBe("2");
    expect(used.get("patty")!.quantity.toString()).toBe("6");
    expect(used.get("fries")!.quantity.toString()).toBe("420");
    expect(used.get("bun")!.direct).toBe(false);
  });

  it("a stock item product sells one base unit per unit sold, marked as a direct sale", () => {
    const used = consumption({ quantity: 3, stockItemId: "cola", recipe: [], modifiers: [] });
    expect(used.get("cola")).toMatchObject({ direct: true });
    expect(used.get("cola")!.quantity.toString()).toBe("3");
  });

  it("unit cost = ingredients at average cost", () => {
    const cost = unitCost(
      { stockItemId: null, recipe: [{ itemId: "bun", quantity: 1, wastePct: 0 }, { itemId: "patty", quantity: 2, wastePct: 0 }, { itemId: "cheese", quantity: 1, wastePct: 10 }], modifiers: [] },
      (id) => ({ bun: "0.8", patty: "4.5", cheese: "0.35" })[id] ?? 0,
    );
    expect(cost.toString()).toBe("10.185"); // 0.8 + 9 + 0.385
  });

  it("reorder: nothing while above the minimum, then up to twice the minimum in whole cases, less what's on order", () => {
    expect(reorderQuantity({ onHand: 50, onOrder: 0, minStock: 48, reorderQty: null, purchaseUnitQty: 24 }).toString()).toBe("0");
    // 12 on hand, min 24 → target 48 → need 36 → 2 cases = 48
    expect(reorderQuantity({ onHand: 12, onOrder: 0, minStock: 24, reorderQty: null, purchaseUnitQty: 24 }).toString()).toBe("48");
    // 24 already on order covers it
    expect(reorderQuantity({ onHand: 12, onOrder: 24, minStock: 24, reorderQty: null, purchaseUnitQty: 24 }).toString()).toBe("0");
    // explicit reorder quantity wins
    expect(reorderQuantity({ onHand: 3000, onOrder: 0, minStock: 4000, reorderQty: 8000, purchaseUnitQty: 1000 }).toString()).toBe("8000");
    // no minimum → never suggested
    expect(reorderQuantity({ onHand: -5, onOrder: 0, minStock: 0, reorderQty: null, purchaseUnitQty: null }).toString()).toBe("0");
  });

  it("PO line money rounds net and tax to the currency", () => {
    const m = lineMoney("12000", "0.006", "5", 2);
    expect(m.net.toFixed(2)).toBe("72.00");
    expect(m.tax.toFixed(2)).toBe("3.60");
    const odd = lineMoney("3", "0.3333", "5", 2);
    expect(odd.net.toFixed(2)).toBe("1.00");
    expect(odd.tax.toFixed(2)).toBe("0.05");
  });
});
