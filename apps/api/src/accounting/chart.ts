import type { TenantTx } from "@arena/db";

/**
 * The default chart of accounts every organization starts with. Each account
 * the automatic poster books to has a `systemKey`; organizations may rename
 * them, add their own (e.g. more expense accounts) and deactivate unused ones,
 * but can't change a system account's type or delete it.
 *
 * Headers (codes ending in 000) group accounts for the statements and are
 * never posted to.
 */
export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
interface ChartRow {
  key: string;
  code: string;
  name: string;
  type: AccountType;
  parent?: string;
}

export const DEFAULT_CHART: readonly ChartRow[] = [
  { key: "H_ASSETS", code: "1000", name: "Assets", type: "ASSET" },
  { key: "CASH_DRAWER", code: "1010", name: "Cash in drawers", type: "ASSET", parent: "H_ASSETS" },
  { key: "CASH_SAFE", code: "1020", name: "Cash in safe", type: "ASSET", parent: "H_ASSETS" },
  { key: "BANK", code: "1030", name: "Bank", type: "ASSET", parent: "H_ASSETS" },
  { key: "CARD_CLEARING", code: "1040", name: "Card payments clearing", type: "ASSET", parent: "H_ASSETS" },
  { key: "ONLINE_CLEARING", code: "1050", name: "Online payments clearing", type: "ASSET", parent: "H_ASSETS" },
  { key: "RECEIVABLE", code: "1100", name: "Customer tabs", type: "ASSET", parent: "H_ASSETS" },
  { key: "INPUT_VAT", code: "1150", name: "VAT recoverable (input)", type: "ASSET", parent: "H_ASSETS" },
  { key: "INVENTORY", code: "1200", name: "Inventory", type: "ASSET", parent: "H_ASSETS" },

  { key: "H_LIABILITIES", code: "2000", name: "Liabilities", type: "LIABILITY" },
  { key: "AP", code: "2010", name: "Accounts payable (suppliers)", type: "LIABILITY", parent: "H_LIABILITIES" },
  { key: "GRNI", code: "2020", name: "Goods received, not invoiced", type: "LIABILITY", parent: "H_LIABILITIES" },
  { key: "WALLET_LIABILITY", code: "2100", name: "Customer wallets", type: "LIABILITY", parent: "H_LIABILITIES" },
  { key: "GIFT_CARD_LIABILITY", code: "2110", name: "Gift cards outstanding", type: "LIABILITY", parent: "H_LIABILITIES" },
  { key: "VAT_PAYABLE", code: "2200", name: "VAT payable (output)", type: "LIABILITY", parent: "H_LIABILITIES" },

  { key: "H_EQUITY", code: "3000", name: "Equity", type: "EQUITY" },
  { key: "OWNER_EQUITY", code: "3010", name: "Owner's equity", type: "EQUITY", parent: "H_EQUITY" },
  { key: "RETAINED_EARNINGS", code: "3100", name: "Retained earnings", type: "EQUITY", parent: "H_EQUITY" },

  { key: "H_REVENUE", code: "4000", name: "Revenue", type: "REVENUE" },
  { key: "GAMING_REVENUE", code: "4010", name: "Gaming time", type: "REVENUE", parent: "H_REVENUE" },
  { key: "FOOD_REVENUE", code: "4020", name: "Food & drinks", type: "REVENUE", parent: "H_REVENUE" },
  { key: "MERCH_REVENUE", code: "4030", name: "Merchandise & services", type: "REVENUE", parent: "H_REVENUE" },
  { key: "MEMBERSHIP_REVENUE", code: "4040", name: "Memberships", type: "REVENUE", parent: "H_REVENUE" },
  { key: "PRINTING_REVENUE", code: "4050", name: "Printing", type: "REVENUE", parent: "H_REVENUE" },
  { key: "EVENTS_REVENUE", code: "4060", name: "Tournaments & bookings", type: "REVENUE", parent: "H_REVENUE" },
  { key: "SALES_RETURNS", code: "4900", name: "Refunds & returns", type: "REVENUE", parent: "H_REVENUE" },

  { key: "H_COST_OF_SALES", code: "5000", name: "Cost of sales", type: "EXPENSE" },
  { key: "COGS", code: "5010", name: "Cost of goods sold", type: "EXPENSE", parent: "H_COST_OF_SALES" },
  { key: "STOCK_LOSS", code: "5020", name: "Stock waste & count differences", type: "EXPENSE", parent: "H_COST_OF_SALES" },

  { key: "H_EXPENSES", code: "6000", name: "Operating expenses", type: "EXPENSE" },
  { key: "PROMO_EXPENSE", code: "6010", name: "Promotions, bonus & rewards", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "PRIZES_EXPENSE", code: "6020", name: "Tournament prizes", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "GOODWILL_EXPENSE", code: "6030", name: "Wallet adjustments & goodwill", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "CASH_OVER_SHORT", code: "6040", name: "Cash over / short", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "EQUIPMENT_EXPENSE", code: "6050", name: "Equipment & consumables issued", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "RENT", code: "6100", name: "Rent", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "UTILITIES", code: "6110", name: "Utilities & internet", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "SALARIES", code: "6120", name: "Salaries & wages", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "MAINTENANCE", code: "6130", name: "Repairs & maintenance", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "MARKETING", code: "6140", name: "Marketing", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "SOFTWARE", code: "6150", name: "Software & licences", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "OTHER_EXPENSE", code: "6900", name: "Other expenses", type: "EXPENSE", parent: "H_EXPENSES" },
  { key: "ROUNDING", code: "6990", name: "Rounding differences", type: "EXPENSE", parent: "H_EXPENSES" },
];

export const isHeader = (code: string) => /000$/.test(code);

/** Debit-normal types: a positive (debit − credit) balance is the natural side. */
export const debitNormal = (type: AccountType) => type === "ASSET" || type === "EXPENSE";

export interface Chart {
  /** account id by system key */
  byKey: Map<string, string>;
  /** every account by id */
  byId: Map<string, { id: string; code: string; name: string; type: AccountType; systemKey: string | null; parentId: string | null; isActive: boolean }>;
}

/** Creates any missing default accounts (idempotent) and returns the chart. */
export async function ensureChart(t: TenantTx, organizationId: string): Promise<Chart> {
  let rows = await t.ledgerAccount.findMany({ select: { id: true, code: true, name: true, type: true, systemKey: true, parentId: true, isActive: true } });
  const haveKey = new Set(rows.map((r) => r.systemKey).filter(Boolean));
  const haveCode = new Set(rows.map((r) => r.code));
  const missing = DEFAULT_CHART.filter((r) => !haveKey.has(r.key));
  if (missing.length) {
    // Parents first (headers have no parent), so children can point at them.
    for (const pass of [missing.filter((r) => !r.parent), missing.filter((r) => r.parent)]) {
      for (const r of pass) {
        const parentId = r.parent ? (rows.find((x) => x.systemKey === r.parent)?.id ?? null) : null;
        // A custom account already took the code: fall back to the next free one.
        let code = r.code;
        while (haveCode.has(code)) code = String(Number(code) + 1);
        await t.$executeRaw`
          INSERT INTO "LedgerAccount" ("id", "organizationId", "code", "name", "type", "parentId", "systemKey", "updatedAt")
          VALUES (gen_random_uuid(), ${organizationId}::uuid, ${code}, ${r.name}, ${r.type}::"AccountType", ${parentId}::uuid, ${r.key}, now())
          ON CONFLICT DO NOTHING`;
        haveCode.add(code);
      }
      rows = await t.ledgerAccount.findMany({ select: { id: true, code: true, name: true, type: true, systemKey: true, parentId: true, isActive: true } });
    }
  }
  return {
    byKey: new Map(rows.filter((r) => r.systemKey).map((r) => [r.systemKey!, r.id])),
    byId: new Map(rows.map((r) => [r.id, { ...r, type: r.type as AccountType }])),
  };
}
