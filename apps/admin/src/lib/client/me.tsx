"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface Me {
  user: { id: string; email: string; displayName: string; mfaEnabled: boolean; mfaRequired: boolean };
  employee: { id: string; displayName: string };
  organization: { id: string; slug: string; displayName: string; status: string; defaultCurrency: string; defaultTimezone: string };
  features: string[];
  limits: Partial<Record<"MAX_BRANCHES" | "MAX_DEVICES" | "MAX_EMPLOYEES", number>>;
  grants: Array<{ role: string; scope: "ORGANIZATION" | "BRAND" | "BRANCH"; brandId: string | null; branchId: string | null; permissions: string[] }>;
}

const Ctx = createContext<Me | null>(null);
export const MeProvider = ({ me, children }: { me: Me; children: ReactNode }) => <Ctx.Provider value={me}>{children}</Ctx.Provider>;

export function useMe(): Me {
  const me = useContext(Ctx);
  if (!me) throw new Error("useMe outside MeProvider");
  return me;
}

/**
 * UI hint only — hides controls the user can't use. The API re-checks every
 * action with the real scope; never rely on this for security.
 */
export function useCan() {
  const me = useMe();
  return (permission: string, branchId?: string) =>
    me.grants.some((g) => g.permissions.includes(permission) && (g.scope !== "BRANCH" || !branchId || g.branchId === branchId));
}

/** For organization-wide records (menu, games, suppliers, tiers…): a branch-level grant isn't enough. */
export function useCanOrg() {
  const me = useMe();
  return (permission: string) => me.grants.some((g) => g.scope === "ORGANIZATION" && g.permissions.includes(permission));
}
