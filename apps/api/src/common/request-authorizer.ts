import { type ExecutionContext, Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import type { Db, TenantTx } from "@arena/db";
import { assertAuthorized, authorizeAnywhere, ForbiddenError, type PermissionKey } from "@arena/rbac";
import type { AuthedRequest } from "../auth/auth.guard.js";
import { PrincipalService } from "../auth/principal.service.js";
import { ANY_SCOPE_KEY, ANY_STAFF_KEY, LONG_LIVED_KEY, PERMISSION_KEY } from "./decorators.js";
import type { RequestState } from "./request-state.js";
import { TargetResolver } from "./target.resolver.js";

export type AuthorizedState = Omit<RequestState, "tx" | "afterCommit">;

/**
 * Loads the principal and runs authorize() for a request. Shared by the
 * TenantInterceptor (normal routes, inside the request transaction) and the
 * AuthGuard (streaming routes — they must be rejected before any response
 * headers are written, which for SSE happens before interceptors finish).
 */
@Injectable()
export class RequestAuthorizer {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrincipalService) private readonly principals: PrincipalService,
    @Inject(TargetResolver) private readonly targets: TargetResolver,
  ) {}

  meta(ctx: ExecutionContext) {
    const t = [ctx.getHandler(), ctx.getClass()];
    const permission = this.reflector.getAllAndOverride<PermissionKey | undefined>(PERMISSION_KEY, t);
    const anyStaff = this.reflector.getAllAndOverride<boolean>(ANY_STAFF_KEY, t);
    if (!permission && !anyStaff) {
      throw new InternalServerErrorException({ error: "route_not_protected", route: `${ctx.getClass().name}.${ctx.getHandler().name}` });
    }
    return {
      permission,
      anyScope: !!this.reflector.getAllAndOverride<boolean>(ANY_SCOPE_KEY, t),
      longLived: !!this.reflector.getAllAndOverride<boolean>(LONG_LIVED_KEY, t),
    };
  }

  tenantContext(req: AuthedRequest) {
    const claims = req.auth!;
    req.requestId ??= (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
    return { organizationId: claims.org, actorType: "EMPLOYEE" as const, actorId: claims.emp, impersonatorId: claims.imp ?? null, requestId: req.requestId };
  }

  async authorize(tx: TenantTx, ctx: ExecutionContext): Promise<AuthorizedState> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const { permission, anyScope } = this.meta(ctx);
    const claims = req.auth!;
    const reasonHeader = req.headers["x-action-reason"];
    const reason = typeof reasonHeader === "string" ? decodeURIComponent(reasonHeader).slice(0, 500) : null;

    const principal = await this.principals.load(tx, claims);
    let decision = null;
    if (permission && anyScope) {
      const d = authorizeAnywhere(principal, permission, { reason });
      if (!d.allowed) throw new ForbiddenError(permission, d.reason);
      decision = d;
    } else if (permission) {
      const target = await this.targets.resolve(tx, claims.org, req.params as Record<string, string>);
      decision = assertAuthorized(principal, permission, target, { reason });
    }
    return { principal, decision, requestId: req.requestId!, reason, ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
  }

  /** Streaming routes: authorize in a short transaction of its own. */
  authorizeStandalone(db: Db, ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return db.withTenant(this.tenantContext(req), (tx) => this.authorize(tx, ctx));
  }
}
