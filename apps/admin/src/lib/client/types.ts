// Shared API shapes used by several admin pages.

export interface Branch {
  id: string;
  code: string;
  name: string;
  status: "SETUP" | "OPEN" | "TEMPORARILY_CLOSED" | "CLOSED";
  city: string | null;
  timezone: string;
  currency: string;
  countryCode: string;
  brandId: string;
  brand?: { name: string };
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  latitude?: string | null;
  longitude?: string | null;
}

export const STATUS_TONE = { OPEN: "ok", SETUP: "accent", TEMPORARILY_CLOSED: "warn", CLOSED: "danger" } as const;
export const statusLabel = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  organizationId: string | null;
  permissions: string[];
}

export interface RoleAssignment {
  id: string;
  scope: "ORGANIZATION" | "BRAND" | "BRANCH";
  brandId: string | null;
  branchId: string | null;
  expiresAt: string | null;
  role: { id: string; key: string; name: string };
}

export interface Employee {
  id: string;
  employeeCode: string;
  displayName: string;
  jobTitle: string | null;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "TERMINATED";
  homeBranchId: string | null;
  hiredAt: string | null;
  user: { email: string };
  employeeRoleAssignments: RoleAssignment[];
}

export const EMP_TONE = { ACTIVE: "ok", INVITED: "accent", SUSPENDED: "warn", TERMINATED: "danger" } as const;

export interface PermissionDef {
  key: string;
  module: string;
  description: string;
  sensitive?: boolean;
}

export const roleLabel = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
