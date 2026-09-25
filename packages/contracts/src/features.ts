// Feature flags (modules) that Super Admin toggles per plan or per organization.
// Resolution: OrganizationFeature override → PlanFeature default → catalog default.

export const FEATURES = {
  PC_GAMING: { label: "PC gaming & gaming shell", default: true },
  CONSOLE: { label: "Console stations", default: true },
  VR_SIMULATOR: { label: "VR & simulators", default: false },
  INTERNET_CAFE: { label: "Internet café (browsing, printing, office)", default: true },
  DISKLESS: { label: "Diskless integration", default: false },
  GAME_UPDATES: { label: "Central game update orchestration", default: true },
  LICENSE_POOL: { label: "Game account / license pool", default: false },
  BOOKINGS: { label: "Bookings", default: true },
  MEMBERSHIP: { label: "Memberships", default: true },
  WALLET: { label: "Customer wallet", default: true },
  RESTAURANT: { label: "Restaurant POS", default: false },
  KDS: { label: "Kitchen display system", default: false },
  TABLES: { label: "Restaurant table management", default: false },
  INVENTORY: { label: "Inventory & warehouses", default: true },
  PURCHASING: { label: "Purchasing & suppliers", default: false },
  TOURNAMENTS: { label: "Tournaments & esports", default: false },
  LOYALTY: { label: "Loyalty", default: true },
  PROMOTIONS: { label: "Promotions engine", default: true },
  CRM: { label: "CRM & campaigns", default: false },
  ACCOUNTING: { label: "Accounting (general ledger)", default: false },
  ADVANCED_REPORTS: { label: "Advanced analytics", default: false },
  CUSTOMER_APP: { label: "Customer web / mobile app", default: true },
  REMOTE_SUPPORT: { label: "Remote support", default: true },
  PUBLIC_API: { label: "Public API & webhooks", default: false },
  OFFLINE_EDGE: { label: "Branch edge server (offline mode)", default: true },
  MULTI_BRAND: { label: "Multiple brands", default: false },
} as const satisfies Record<string, { label: string; default: boolean }>;

export type FeatureKey = keyof typeof FEATURES;

/** Numeric limits that live next to the flags. */
export const LIMITS = ["MAX_BRANCHES", "MAX_DEVICES", "MAX_EMPLOYEES"] as const;
export type LimitKey = (typeof LIMITS)[number];

export interface FeatureRow {
  featureKey: string;
  enabled: boolean;
  limitValue?: number | null;
}

export interface ResolvedFeatures {
  enabled: ReadonlySet<FeatureKey>;
  limits: Partial<Record<LimitKey, number>>;
}

/** Org override wins over plan; plan wins over catalog default. Unknown keys are ignored. */
export function resolveFeatures(planRows: FeatureRow[], orgOverrides: FeatureRow[]): ResolvedFeatures {
  const state = new Map<string, FeatureRow>();
  for (const key of Object.keys(FEATURES) as FeatureKey[]) state.set(key, { featureKey: key, enabled: FEATURES[key].default });
  for (const row of planRows) state.set(row.featureKey, row);
  for (const row of orgOverrides) state.set(row.featureKey, row);

  const enabled = new Set<FeatureKey>();
  const limits: Partial<Record<LimitKey, number>> = {};
  for (const [key, row] of state) {
    if (key in FEATURES && row.enabled) enabled.add(key as FeatureKey);
    if ((LIMITS as readonly string[]).includes(key) && row.limitValue != null) limits[key as LimitKey] = row.limitValue;
  }
  return { enabled, limits };
}
