// Pure order maths — no database. Integer MINOR units throughout; rounding
// happens once per line (half away from zero), so totals always add up to the
// sum of what's printed on the receipt.

export type TaxClass = "ALL" | "GAMING" | "FOOD" | "BEVERAGE" | "MERCHANDISE" | "SERVICE";

export interface TaxRateDef {
  name: string;
  ratePercent: number;
  appliesTo: TaxClass;
}

export interface TaxProfileDef {
  /** true: menu prices already include tax (UAE/EU style); false: tax is added on top (US style). */
  pricesIncludeTax: boolean;
  rates: TaxRateDef[];
}

export interface LineInput {
  /** unit price before modifiers, minor units */
  unitMinor: number;
  quantity: number;
  modifiers: Array<{ name: string; priceDeltaMinor: number }>;
  taxClass: TaxClass;
  /** fixed discount on this line, minor units */
  discountMinor?: number;
}

export type OrderDiscount = { kind: "PERCENT"; value: number } | { kind: "AMOUNT"; valueMinor: number } | null;

export interface PricedLine {
  unitMinor: number;
  modifiersMinor: number; // per unit
  grossMinor: number; // (unit + modifiers) × qty
  discountMinor: number; // line discount + share of the order discount
  netMinor: number; // what the customer pays for this line (tax-inclusive when prices include tax)
  taxMinor: number;
  taxes: Array<{ name: string; ratePercent: number; amountMinor: number }>;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalMinor: number; // Σ gross
  discountMinor: number; // Σ discounts
  taxMinor: number; // Σ tax
  totalMinor: number; // amount due
}

export class OrderPricingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const round = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

function ratesFor(profile: TaxProfileDef | null, cls: TaxClass) {
  return (profile?.rates ?? []).filter((r) => r.appliesTo === "ALL" || r.appliesTo === cls);
}

/**
 * Prices an order. The order discount is spread over lines in proportion to
 * their value (largest-remainder, so the shares sum exactly), then tax is
 * worked out per line on what the customer actually pays.
 */
export function priceOrder(lines: LineInput[], profile: TaxProfileDef | null, discount: OrderDiscount = null): PricedOrder {
  if (lines.length === 0) throw new OrderPricingError("empty_order", "An order needs at least one item");
  const base = lines.map((l) => {
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new OrderPricingError("bad_quantity", "Quantity must be positive");
    if (!Number.isInteger(l.unitMinor) || l.unitMinor < 0) throw new OrderPricingError("bad_price", "Price must be a non-negative whole number of minor units");
    const modifiersMinor = l.modifiers.reduce((a, m) => a + m.priceDeltaMinor, 0);
    const grossMinor = round((l.unitMinor + modifiersMinor) * l.quantity);
    if (grossMinor < 0) throw new OrderPricingError("bad_price", "Modifiers can't make a line negative");
    const lineDiscount = Math.min(grossMinor, Math.max(0, l.discountMinor ?? 0));
    return { l, modifiersMinor, grossMinor, lineDiscount };
  });

  // Order-level discount, spread by value.
  const afterLine = base.map((b) => b.grossMinor - b.lineDiscount);
  const pool = afterLine.reduce((a, b) => a + b, 0);
  let orderDiscount = 0;
  if (discount?.kind === "PERCENT") {
    if (discount.value < 0 || discount.value > 100) throw new OrderPricingError("bad_discount", "Discount must be 0–100 %");
    orderDiscount = round((pool * discount.value) / 100);
  } else if (discount?.kind === "AMOUNT") {
    if (!Number.isInteger(discount.valueMinor) || discount.valueMinor < 0) throw new OrderPricingError("bad_discount", "Discount must be a positive amount");
    orderDiscount = Math.min(pool, discount.valueMinor);
  }
  const shares = afterLine.map((v) => (pool > 0 ? (orderDiscount * v) / pool : 0));
  const floors = shares.map(Math.floor);
  let left = orderDiscount - floors.reduce((a, b) => a + b, 0);
  shares
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (left > 0 && floors[i]! < afterLine[i]!) {
        floors[i]!++;
        left--;
      }
    });

  const priced: PricedLine[] = base.map((b, i) => {
    const discountMinor = b.lineDiscount + floors[i]!;
    const payable = b.grossMinor - discountMinor;
    const rates = ratesFor(profile, b.l.taxClass);
    const pct = rates.reduce((a, r) => a + r.ratePercent, 0);
    let netMinor: number;
    let taxMinor: number;
    if (profile?.pricesIncludeTax ?? true) {
      netMinor = payable;
      taxMinor = pct > 0 ? round(payable - payable / (1 + pct / 100)) : 0;
    } else {
      taxMinor = round((payable * pct) / 100);
      netMinor = payable + taxMinor;
    }
    // Split the line's tax across its rates (largest share gets the rounding remainder).
    const taxes = rates.map((r) => ({ name: r.name, ratePercent: r.ratePercent, amountMinor: pct > 0 ? Math.floor((taxMinor * r.ratePercent) / pct) : 0 }));
    const rem = taxMinor - taxes.reduce((a, t) => a + t.amountMinor, 0);
    if (taxes.length && rem) taxes.sort((a, b) => b.ratePercent - a.ratePercent)[0]!.amountMinor += rem;
    return { unitMinor: b.l.unitMinor, modifiersMinor: b.modifiersMinor, grossMinor: b.grossMinor, discountMinor, netMinor, taxMinor, taxes };
  });

  const sum = (f: (l: PricedLine) => number) => priced.reduce((a, l) => a + f(l), 0);
  return { lines: priced, subtotalMinor: sum((l) => l.grossMinor), discountMinor: sum((l) => l.discountMinor), taxMinor: sum((l) => l.taxMinor), totalMinor: sum((l) => l.netMinor) };
}

/**
 * Checks a line's chosen modifiers against the product's groups (min/max per
 * group, modifiers must belong to the product).
 */
export function validateModifiers(
  groups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; modifierIds: string[] }>,
  chosen: string[],
) {
  const all = new Set(groups.flatMap((g) => g.modifierIds));
  for (const id of chosen) if (!all.has(id)) throw new OrderPricingError("bad_modifier", "That option doesn't belong to this item");
  if (new Set(chosen).size !== chosen.length) throw new OrderPricingError("bad_modifier", "Each option can be chosen once");
  for (const g of groups) {
    const n = chosen.filter((c) => g.modifierIds.includes(c)).length;
    if (n < g.minSelect) throw new OrderPricingError("modifier_required", `Choose ${g.minSelect === 1 ? "an option" : `at least ${g.minSelect}`} for “${g.name}”`);
    if (n > g.maxSelect) throw new OrderPricingError("too_many_modifiers", `Choose at most ${g.maxSelect} for “${g.name}”`);
  }
}

/** Change for a cash payment; refuses to under-tender. */
export function cashChange(dueMinor: number, tenderedMinor: number) {
  if (!Number.isInteger(tenderedMinor) || tenderedMinor < dueMinor) throw new OrderPricingError("insufficient_cash", "Cash given is less than the amount due");
  return tenderedMinor - dueMinor;
}
