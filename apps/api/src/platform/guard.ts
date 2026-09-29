import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import type { PlatformClient, PlatformRole } from "@arena/db";
import { PDB } from "./config.js";
import { PlatformAuthService, type ClientMeta } from "./auth.service.js";
import { PlatformTokens } from "./tokens.js";

const PUBLIC = "platform:public";
const ROLES = "platform:roles";

/** No authentication (login, MFA, refresh, logout, health). */
export const PlatformPublic = () => SetMetadata(PUBLIC, true);

/**
 * Roles allowed on a route. Every authenticated route must declare one:
 * a route without it is refused (deny by default).
 */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(ROLES, roles);
export const READ_ROLES: PlatformRole[] = ["SUPER_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_BILLING", "PLATFORM_READONLY"];

export interface PlatformPrincipal {
  userId: string;
  sid: string;
  roles: PlatformRole[];
  /** The role that allowed this request, recorded in the audit row. */
  viaRole: PlatformRole;
}

export type PlatformRequest = Request & { platform?: PlatformPrincipal; requestId?: string };

export const clientMeta = (req: PlatformRequest): ClientMeta & { requestId: string; reason: string | null } => {
  const raw = req.headers["x-action-reason"];
  const reason = typeof raw === "string" && raw.trim() ? decodeURIComponent(raw).slice(0, 500) : null;
  return { ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null, requestId: (req.requestId ??= randomUUID()), reason };
};

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PlatformTokens) private readonly tokens: PlatformTokens,
    @Inject(PlatformAuthService) private readonly auth: PlatformAuthService,
    @Inject(PDB) private readonly db: PlatformClient,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const allowed = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(ROLES, targets);
    if (!allowed?.length) throw new Error("Platform route without @PlatformRoles — refusing (deny by default)");

    const req = ctx.switchToHttp().getRequest<PlatformRequest>();
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException({ error: "missing_token" });
    const claims = await this.tokens.verifyAccess(token);

    // Logout (or reuse detection) kills the session immediately, not at token expiry.
    const live = await this.db.refreshToken.findFirst({ where: { familyId: claims.sid, userId: claims.sub, organizationId: null, revokedAt: null }, select: { id: true } });
    if (!live) throw new UnauthorizedException({ error: "session_ended" });

    // Roles are read fresh on every request, so revoking one takes effect at once.
    const roles = await this.auth.roles(claims.sub);
    if (roles.length === 0) throw new UnauthorizedException({ error: "not_platform_admin" });
    const viaRole = allowed.find((r) => roles.includes(r));
    if (!viaRole) throw new ForbiddenException({ error: "forbidden", reason: "NOT_GRANTED" });
    req.platform = { userId: claims.sub, sid: claims.sid, roles, viaRole };
    return true;
  }
}
