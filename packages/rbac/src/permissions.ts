// Single source of truth for permission keys. Synced into the Permission table
// on deploy; server-side guards reference these constants, never raw strings.
import type { FeatureKey } from "@arena/contracts";

interface Def {
  description: string;
  /** Sensitive actions require a written reason and are highlighted in audit. */
  sensitive?: boolean;
}

/** module → action → definition. Key = `${module}.${action}`. */
const CATALOG = {
  org: {
    view: { description: "View organization profile & settings" },
    manage: { description: "Edit organization profile, brands, tax profiles", sensitive: true },
    billing: { description: "View SaaS subscription & invoices" },
  },
  branch: {
    view: { description: "View branches" },
    manage: { description: "Create/edit branches, opening hours, IP allow-lists", sensitive: true },
  },
  zone: {
    view: { description: "View zones & floor map" },
    manage: { description: "Create/edit zones and floor layout" },
  },
  station: {
    view: { description: "View live floor & station details" },
    manage: { description: "Add/edit/retire stations, enrollment tokens" },
    start_session: { description: "Start a gaming session on a station" },
    end_session: { description: "End a customer's session early" },
    extend_session: { description: "Add time to a running session" },
    move_session: { description: "Transfer a session to another station" },
    pause_session: { description: "Pause/resume a session" },
    free_time: { description: "Grant complimentary time", sensitive: true },
    message: { description: "Send a message to a station" },
    lock: { description: "Lock / unlock a station" },
    restart: { description: "Restart a station" },
    shutdown: { description: "Shut down / wake stations" },
    mass_action: { description: "Run actions on a whole zone/branch" },
    launch_app: { description: "Remotely launch/close games & apps" },
    remote_control: { description: "Remote view/control a station", sensitive: true },
    maintenance: { description: "Enter maintenance mode on a station", sensitive: true },
    hardware: { description: "View hardware inventory & telemetry" },
    update_client: { description: "Push shell/agent updates to stations" },
  },
  shell: {
    configure: { description: "Configure shell layout, branding, allowed apps" },
    disable: { description: "Disable the locked shell on a station (unrestricted Windows)", sensitive: true },
    tools: { description: "Use privileged Windows tools in maintenance mode (cmd, PowerShell, regedit…)", sensitive: true },
  },
  diskless: {
    view: { description: "View diskless images & boot status" },
    manage: { description: "Configure diskless integrations", sensitive: true },
  },
  game: {
    view: { description: "View game library" },
    manage: { description: "Add/edit games, launchers & apps" },
    update: { description: "Schedule & run game updates" },
    license_view: { description: "View pooled game accounts" },
    license_manage: { description: "Add/edit pooled game accounts", sensitive: true },
  },
  pricing: {
    view: { description: "View rate cards & packages" },
    manage: { description: "Change prices, packages & pricing rules", sensitive: true },
  },
  customer: {
    view: { description: "View customer profiles" },
    create: { description: "Register customers" },
    edit: { description: "Edit customer profiles" },
    view_pii: { description: "See full phone/email/DOB (otherwise masked)" },
    export: { description: "Export customer data", sensitive: true },
    restrict: { description: "Ban / restrict customers", sensitive: true },
    delete: { description: "Erase customer personal data", sensitive: true },
    adjust_wallet: { description: "Manually credit/debit a wallet", sensitive: true },
    adjust_points: { description: "Manually adjust loyalty points", sensitive: true },
    reset_password: { description: "Reset a customer's password/PIN" },
  },
  wallet: {
    topup: { description: "Top up a customer's wallet (with payment)" },
    view_ledger: { description: "View wallet transaction history" },
  },
  membership: {
    view: { description: "View membership tiers" },
    sell: { description: "Sell/renew memberships" },
    manage: { description: "Configure membership tiers & benefits" },
  },
  booking: {
    view: { description: "View bookings" },
    create: { description: "Create/modify bookings" },
    cancel: { description: "Cancel bookings / mark no-show" },
    override: { description: "Override booking rules (lead time, deposits)", sensitive: true },
  },
  pos: {
    sell: { description: "Ring up sales" },
    discount: { description: "Apply manual discounts" },
    discount_override: { description: "Discount above the role limit", sensitive: true },
    void_item: { description: "Void items on an open order" },
    refund: { description: "Issue refunds", sensitive: true },
    reopen_bill: { description: "Reopen a settled bill", sensitive: true },
    price_override: { description: "Override a product's price at sale", sensitive: true },
    no_sale: { description: "Open cash drawer without a sale", sensitive: true },
  },
  shift: {
    open: { description: "Open/close own shift" },
    cash_movement: { description: "Record pay-in/pay-out/drops" },
    view_all: { description: "View all shifts at the branch" },
    approve: { description: "Approve shift variances", sensitive: true },
  },
  restaurant: {
    order: { description: "Take restaurant/table orders" },
    cancel_order: { description: "Cancel a placed order", sensitive: true },
    menu_manage: { description: "Manage menu, modifiers, recipes" },
    tables_manage: { description: "Manage tables, merge/split/move" },
  },
  kds: {
    view: { description: "View kitchen display" },
    bump: { description: "Accept/prepare/ready/serve tickets" },
  },
  inventory: {
    view: { description: "View stock" },
    adjust: { description: "Adjust stock / record waste", sensitive: true },
    transfer: { description: "Transfer stock between warehouses" },
    count: { description: "Run stock counts" },
    manage: { description: "Manage items & warehouses" },
  },
  purchasing: {
    view: { description: "View purchase orders & suppliers" },
    create: { description: "Create purchase orders" },
    approve: { description: "Approve purchase orders", sensitive: true },
    receive: { description: "Receive goods" },
    suppliers_manage: { description: "Manage suppliers & supplier invoices" },
  },
  employee: {
    view: { description: "View employees" },
    manage: { description: "Invite/edit/suspend employees", sensitive: true },
    assign_roles: { description: "Grant/revoke roles", sensitive: true },
    roles_manage: { description: "Create/edit custom roles", sensitive: true },
  },
  tournament: {
    view: { description: "View tournaments" },
    manage: { description: "Create/edit tournaments, brackets, prizes" },
    score: { description: "Report/confirm match results" },
  },
  loyalty: {
    view: { description: "View loyalty rules & rewards" },
    manage: { description: "Configure loyalty rules & rewards" },
    redeem: { description: "Redeem rewards for customers" },
  },
  promotion: {
    view: { description: "View promotions" },
    manage: { description: "Create/edit promotions & promo codes", sensitive: true },
  },
  crm: {
    view: { description: "View segments & campaigns" },
    campaign_send: { description: "Send marketing campaigns", sensitive: true },
  },
  reports: {
    operational: { description: "Operational reports (utilization, sessions, orders)" },
    financial: { description: "Financial reports (revenue, tax, cash)" },
    staff: { description: "Staff performance & action reports" },
    export: { description: "Export reports" },
  },
  accounting: {
    view: { description: "View ledger & journals" },
    post: { description: "Post manual journal entries", sensitive: true },
    expense: { description: "Record expenses" },
  },
  payment: {
    gateway_manage: { description: "Configure payment gateways", sensitive: true },
  },
  notification: {
    manage: { description: "Edit notification templates & channels" },
  },
  integration: {
    manage: { description: "Manage API keys & webhooks", sensitive: true },
  },
  audit: {
    view: { description: "View audit log" },
  },
  support: {
    handle: { description: "Handle customer help requests & tickets" },
  },
  settings: {
    manage: { description: "Branch/organization operational settings" },
  },
} as const satisfies Record<string, Record<string, Def>>;

type Catalog = typeof CATALOG;
export type PermissionModule = keyof Catalog;
export type PermissionKey = { [M in PermissionModule]: `${M}.${Extract<keyof Catalog[M], string>}` }[PermissionModule];

export interface PermissionDef extends Def {
  key: PermissionKey;
  module: PermissionModule;
}

export const PERMISSIONS: readonly PermissionDef[] = Object.freeze(
  Object.entries(CATALOG).flatMap(([module, actions]) =>
    Object.entries(actions).map(([action, def]) => ({
      key: `${module}.${action}` as PermissionKey,
      module: module as PermissionModule,
      ...(def as Def),
    })),
  ),
);

export const PERMISSION_KEYS: ReadonlySet<PermissionKey> = new Set(PERMISSIONS.map((p) => p.key));
const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

export function permissionDef(key: PermissionKey): PermissionDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown permission ${key}`);
  return def;
}

export function isPermissionKey(key: string): key is PermissionKey {
  return PERMISSION_KEYS.has(key as PermissionKey);
}

/**
 * A permission is usable only if its module's feature is enabled for the org.
 * Modules not listed are core and always available.
 */
export const MODULE_FEATURE: Partial<Record<PermissionModule, FeatureKey>> = {
  diskless: "DISKLESS",
  membership: "MEMBERSHIP",
  booking: "BOOKINGS",
  restaurant: "RESTAURANT",
  kds: "KDS",
  inventory: "INVENTORY",
  purchasing: "PURCHASING",
  tournament: "TOURNAMENTS",
  loyalty: "LOYALTY",
  promotion: "PROMOTIONS",
  crm: "CRM",
  accounting: "ACCOUNTING",
  integration: "PUBLIC_API",
  wallet: "WALLET",
};

/** Finer-grained feature gates for specific keys. */
export const PERMISSION_FEATURE: Partial<Record<PermissionKey, FeatureKey>> = {
  "game.update": "GAME_UPDATES",
  "game.license_view": "LICENSE_POOL",
  "game.license_manage": "LICENSE_POOL",
  "restaurant.tables_manage": "TABLES",
  "station.remote_control": "REMOTE_SUPPORT",
};
