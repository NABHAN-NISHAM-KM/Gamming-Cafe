import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@arena/rbac";

export const PUBLIC_KEY = "arena:public";
export const PERMISSION_KEY = "arena:permission";
export const ANY_SCOPE_KEY = "arena:any-scope";
export const ANY_STAFF_KEY = "arena:any-staff";
export const LONG_LIVED_KEY = "arena:long-lived";

/** No authentication (login, refresh, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Required on every authenticated route. The target (org / brand / branch) is
 * derived from the *resource* named in the route params — see TargetResolver.
 */
export const RequirePermission = (permission: PermissionKey) => SetMetadata(PERMISSION_KEY, permission);

/**
 * For list endpoints: the permission must be held at *some* scope; the handler
 * must then filter results to what the caller covers (branchesWith).
 */
export const RequirePermissionAnyScope = (permission: PermissionKey) =>
  applyDecorators(SetMetadata(PERMISSION_KEY, permission), SetMetadata(ANY_SCOPE_KEY, true));

/**
 * Streaming routes (SSE): authorization runs in a short transaction, then the
 * handler runs WITHOUT one (a stream must never pin a DB connection).
 */
export const LongLived = () => SetMetadata(LONG_LIVED_KEY, true);

/** Authenticated staff, no specific permission (e.g. GET /auth/me). */
export const AnyStaff = () => SetMetadata(ANY_STAFF_KEY, true);
