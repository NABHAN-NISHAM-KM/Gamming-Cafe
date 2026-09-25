import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { defaultIfEmpty, from, lastValueFrom, type Observable } from "rxjs";
import type { Db } from "@arena/db";
import type { AuthedRequest } from "../auth/auth.guard.js";
import { PUBLIC_KEY } from "./decorators.js";
import { DB } from "./db.module.js";
import { RequestAuthorizer } from "./request-authorizer.js";
import { requestStore, type RequestState } from "./request-state.js";

/**
 * For every authenticated request:
 *   1. open ONE tenant transaction (RLS bound to the token's org),
 *   2. load the principal and authorize() — deny by default: a route without
 *      @RequirePermission / @AnyStaff is a 500,
 *   3. run the handler with the transaction in AsyncLocalStorage,
 *   4. commit (or roll back on error) — audit rows commit atomically with data,
 *   5. run after-commit side effects (e.g. pushing a command to a PC).
 *
 * Streaming (@LongLived) routes were already authorized by the AuthGuard and
 * run without a transaction.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
    @Inject(RequestAuthorizer) private readonly authz: RequestAuthorizer,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    if (req.arenaState) return requestStore.run(req.arenaState, () => next.handle());

    this.authz.meta(ctx); // deny-by-default check before opening a transaction
    const afterCommit: RequestState["afterCommit"] = [];
    const run = this.db
      .withTenant(this.authz.tenantContext(req), async (tx) => {
        const s = await this.authz.authorize(tx, ctx);
        return requestStore.run({ ...s, tx, afterCommit }, () => lastValueFrom(next.handle().pipe(defaultIfEmpty(undefined))));
      })
      .then(async (result) => {
        for (const fn of afterCommit) await Promise.resolve(fn()).catch(() => undefined);
        return result;
      });
    return from(run);
  }
}
