import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantTx } from "@arena/db";
import type { Decision, Principal } from "@arena/rbac";
import type { LimitKey } from "@arena/contracts";

/** The authenticated staff member behind a request. */
export interface StaffPrincipal extends Principal {
  userId: string;
  employeeId: string;
  displayName: string;
  limits: Partial<Record<LimitKey, number>>;
}

/**
 * Per-request state for authenticated routes. Everything a service needs to
 * act safely lives here, so services never take tenant ids as parameters.
 */
export interface RequestState {
  /** null for long-lived (streaming) routes, which must not hold a transaction. */
  tx: TenantTx | null;
  principal: StaffPrincipal;
  decision: Extract<Decision, { allowed: true }> | null;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  /** Side effects to run only once the request transaction has committed (e.g. pushing a command to a PC). */
  afterCommit: Array<() => Promise<void> | void>;
}

export const requestStore = new AsyncLocalStorage<RequestState>();

export function state(): RequestState {
  const s = requestStore.getStore();
  if (!s) throw new Error("No request state — this code must run inside an authenticated request");
  return s;
}

/** The request's tenant-bound transaction (RLS + scoped Prisma). */
export const tx = (): TenantTx => {
  const t = state().tx;
  if (!t) throw new Error("No transaction on a long-lived route — use db.withTenant() for each unit of work");
  return t;
};
export const principal = (): StaffPrincipal => state().principal;
/** Current organization id (from the verified token, never from input). */
export const orgId = (): string => state().principal.organizationId;
