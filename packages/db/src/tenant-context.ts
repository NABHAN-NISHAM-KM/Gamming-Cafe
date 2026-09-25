import { AsyncLocalStorage } from "node:async_hooks";
import type { ActorType } from "./generated/prisma/enums.js";

/**
 * Who is acting, for which tenant. Established once per request (HTTP guard,
 * WebSocket handshake, queue job) from a *verified* credential — never from a
 * client-supplied header or body field.
 */
export interface TenantContext {
  organizationId: string;
  actorType: ActorType;
  actorId: string | null;
  /** Branch the request is operating in, when the credential is branch-bound (devices, POS). */
  branchId?: string | null;
  /** Platform user id when a Super Admin is impersonating. Always audited. */
  impersonatorId?: string | null;
  requestId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export class TenantContextMissingError extends Error {
  constructor(model?: string) {
    super(
      `No tenant context${model ? ` while querying ${model}` : ""}. ` +
        "Tenant-owned data can only be accessed inside db.withTenant().",
    );
    this.name = "TenantContextMissingError";
  }
}

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantViolationError";
  }
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

export function requireTenant(model?: string): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) throw new TenantContextMissingError(model);
  return ctx;
}

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(Object.freeze({ ...ctx }), fn);
}
