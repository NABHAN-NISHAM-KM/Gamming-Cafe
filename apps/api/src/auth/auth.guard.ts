import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Db } from "@arena/db";
import { DB } from "../common/db.module.js";
import { LONG_LIVED_KEY, PUBLIC_KEY } from "../common/decorators.js";
import { RequestAuthorizer } from "../common/request-authorizer.js";
import type { RequestState } from "../common/request-state.js";
import { TokensService, type AccessClaims } from "./tokens.service.js";

export type AuthedRequest = Request & { auth?: AccessClaims; requestId?: string; arenaState?: RequestState };

/**
 * Global guard: every route requires a valid access token unless @Public().
 * Streaming routes are also fully authorized here, so a denied request gets a
 * proper 403/404 status instead of an already-open 200 event stream.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(RequestAuthorizer) private readonly authz: RequestAuthorizer,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException({ error: "missing_token" });
    req.auth = await this.tokens.verifyAccess(token);

    if (this.reflector.getAllAndOverride<boolean>(LONG_LIVED_KEY, targets)) {
      const s = await this.authz.authorizeStandalone(this.db, ctx);
      req.arenaState = { ...s, tx: null, afterCommit: [] };
    }
    return true;
  }
}
