// System role templates (organizationId = NULL in the Role table). Orgs can
// clone and customise them. Patterns: "module.*" or exact keys; "*" = all.
import { PERMISSIONS, type PermissionKey } from "./permissions.js";

export type RoleScopeType = "ORGANIZATION" | "BRAND" | "BRANCH";

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  /** Narrowest scope this role is normally assigned at. */
  defaultScope: RoleScopeType;
  grants: readonly string[];
  /** Explicitly removed even if matched by a wildcard. */
  denies?: readonly PermissionKey[];
}

// Platform Super Admin is NOT an org role: it is a PlatformRole with its own
// guard (platform.*) and reaches tenant data only via audited impersonation.

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: "org_owner",
    name: "Organization Owner",
    description: "Full control of the business, all branches.",
    defaultScope: "ORGANIZATION",
    grants: ["*"],
  },
  {
    key: "org_admin",
    name: "Organization Admin",
    description: "Runs the organization day-to-day; cannot change billing or payment gateways.",
    defaultScope: "ORGANIZATION",
    grants: ["*"],
    denies: ["payment.gateway_manage", "integration.manage", "customer.delete", "shell.disable"],
  },
  {
    key: "branch_manager",
    name: "Branch Manager",
    description: "Controls the venue: floor, staff shifts, approvals, local reports.",
    defaultScope: "BRANCH",
    grants: [
      "branch.view", "zone.*", "station.*", "shell.configure", "diskless.view", "game.*",
      "pricing.*", "customer.*", "wallet.*", "membership.*", "booking.*", "pos.*", "shift.*",
      "restaurant.*", "kds.*", "inventory.*", "purchasing.*", "employee.view", "employee.manage",
      "employee.assign_roles", "tournament.*", "loyalty.*", "promotion.view", "crm.view", "reports.*", "accounting.view",
      "accounting.expense", "audit.view", "support.handle", "settings.manage",
    ],
    denies: ["customer.delete", "customer.export", "station.remote_control"],
  },
  {
    key: "gaming_manager",
    name: "Gaming Manager",
    description: "Owns the gaming floor, stations, games and bookings.",
    defaultScope: "BRANCH",
    grants: [
      "zone.view", "station.*", "shell.configure", "game.*", "pricing.view", "customer.view",
      "customer.create", "customer.edit", "customer.restrict", "wallet.*", "membership.view",
      "membership.sell", "booking.*", "pos.sell", "pos.discount", "shift.open", "shift.cash_movement",
      "tournament.*", "reports.operational", "support.handle",
    ],
    denies: ["station.remote_control"],
  },
  {
    key: "system_admin",
    name: "System Administrator",
    description: "IT: stations, shell, diskless, updates, integrations. No money handling.",
    defaultScope: "ORGANIZATION",
    grants: [
      "branch.view", "zone.*", "station.*", "shell.*", "diskless.*", "game.*", "integration.manage",
      "notification.manage", "audit.view", "support.handle",
    ],
    denies: ["station.start_session", "station.end_session", "station.extend_session", "station.free_time"],
  },
  {
    key: "cashier",
    name: "Cashier",
    description: "Runs the front desk: sessions and sales.",
    defaultScope: "BRANCH",
    grants: [
      "zone.view", "station.view", "station.start_session", "station.end_session", "station.extend_session",
      "station.move_session", "station.pause_session", "station.message", "station.lock", "game.view",
      "pricing.view", "customer.view", "customer.create", "customer.edit", "customer.reset_password",
      "wallet.topup", "wallet.view_ledger", "membership.view", "membership.sell", "booking.view",
      "booking.create", "booking.cancel", "pos.sell", "pos.discount", "pos.void_item", "shift.open",
      "shift.cash_movement", "restaurant.order", "kds.view", "loyalty.redeem", "tournament.view",
      "support.handle",
    ],
  },
  {
    key: "receptionist",
    name: "Receptionist",
    description: "Check-ins, bookings, customer registration.",
    defaultScope: "BRANCH",
    grants: [
      "zone.view", "station.view", "station.start_session", "station.message", "customer.view",
      "customer.create", "customer.edit", "membership.view", "booking.*", "tournament.view",
      "support.handle",
    ],
    denies: ["booking.override"],
  },
  {
    key: "restaurant_manager",
    name: "Restaurant Manager",
    description: "Menu, kitchen, tables, restaurant stock.",
    defaultScope: "BRANCH",
    grants: [
      "restaurant.*", "kds.*", "pos.sell", "pos.discount", "pos.void_item", "pos.refund", "shift.*",
      "inventory.*", "purchasing.view", "purchasing.create", "purchasing.receive", "customer.view",
      "reports.operational", "promotion.view",
    ],
  },
  {
    key: "waiter",
    name: "Waiter",
    description: "Takes and serves orders at tables and gaming seats.",
    defaultScope: "BRANCH",
    grants: ["restaurant.order", "kds.view", "pos.sell", "customer.view", "station.view", "zone.view"],
  },
  {
    key: "kitchen_staff",
    name: "Kitchen Staff",
    description: "Prepares orders on the KDS.",
    defaultScope: "BRANCH",
    grants: ["kds.view", "kds.bump", "inventory.view"],
  },
  {
    key: "inventory_manager",
    name: "Inventory Manager",
    description: "Stock, warehouses, purchasing and suppliers.",
    defaultScope: "ORGANIZATION",
    grants: ["inventory.*", "purchasing.*", "reports.operational", "branch.view"],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Finance: ledgers, reports, reconciliation. Read-mostly.",
    defaultScope: "ORGANIZATION",
    grants: [
      "accounting.*", "reports.*", "shift.view_all", "wallet.view_ledger", "purchasing.view",
      "inventory.view", "branch.view", "org.billing", "audit.view",
    ],
  },
  {
    key: "technician",
    name: "Technician",
    description: "Hardware & station maintenance; no sessions, no money.",
    defaultScope: "BRANCH",
    grants: [
      "zone.view", "station.view", "station.hardware", "station.lock", "station.restart",
      "station.shutdown", "station.maintenance", "station.launch_app", "station.message",
      "station.update_client", "diskless.view", "game.view", "game.update", "support.handle",
      "inventory.view",
    ],
  },
  {
    key: "tournament_manager",
    name: "Tournament Manager",
    description: "Runs tournaments and esports events.",
    defaultScope: "BRANCH",
    grants: ["tournament.*", "customer.view", "station.view", "station.message", "zone.view", "booking.view", "booking.create", "game.view"],
  },
] as const;

function matches(pattern: string, key: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return key.startsWith(pattern.slice(0, -1));
  return pattern === key;
}

/** Expands wildcards to concrete keys. Throws on patterns that match nothing (typos). */
export function expandGrants(grants: readonly string[], denies: readonly string[] = []): Set<PermissionKey> {
  const out = new Set<PermissionKey>();
  for (const g of grants) {
    const hit = PERMISSIONS.filter((p) => matches(g, p.key));
    if (hit.length === 0) throw new Error(`Role grant "${g}" matches no permission`);
    hit.forEach((p) => out.add(p.key));
  }
  for (const d of denies) {
    if (!out.delete(d as PermissionKey) && !PERMISSIONS.some((p) => p.key === d)) {
      throw new Error(`Role deny "${d}" is not a permission`);
    }
  }
  return out;
}

export function roleTemplate(key: string): RoleTemplate {
  const r = ROLE_TEMPLATES.find((t) => t.key === key);
  if (!r) throw new Error(`Unknown role template ${key}`);
  return r;
}

export function templatePermissions(key: string): Set<PermissionKey> {
  const r = roleTemplate(key);
  return expandGrants(r.grants, r.denies);
}
