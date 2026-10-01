import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { PERMISSIONS } from "@arena/rbac";
import { AnyStaff, Public } from "../common/decorators.js";
import { principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AuthService, type ClientMeta } from "./auth.service.js";

const Login = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
  organizationSlug: z.string().min(1).max(64).optional(),
});
const MfaVerify = z.object({ mfaToken: z.string().min(1), code: z.string().regex(/^\d{6}$/) });
const Refresh = z.object({ refreshToken: z.string().min(20).max(200) });
const Code = z.object({ code: z.string().regex(/^\d{6}$/) });
const ChangePassword = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) });

const meta = (req: Request): ClientMeta => ({ ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodPipe(Login)) body: z.infer<typeof Login>, @Req() req: Request) {
    return this.auth.login(body, meta(req));
  }

  @Public()
  @Post("mfa/verify")
  @HttpCode(200)
  verifyMfa(@Body(new ZodPipe(MfaVerify)) body: z.infer<typeof MfaVerify>, @Req() req: Request) {
    return this.auth.verifyMfa(body, meta(req));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(new ZodPipe(Refresh)) body: z.infer<typeof Refresh>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Body(new ZodPipe(Refresh)) body: z.infer<typeof Refresh>) {
    await this.auth.logout(body.refreshToken);
  }

  @AnyStaff()
  @Get("me")
  async me() {
    const p = principal();
    const org = await tx().organization.findFirst({ select: { id: true, slug: true, displayName: true, status: true, defaultCurrency: true, defaultTimezone: true, defaultLocale: true } });
    const user = await tx().user.findUnique({ where: { id: p.userId }, select: { email: true, displayName: true, locale: true, mfaRequired: true } });
    const mfaEnabled = !!(await tx().mfaFactor.findFirst({ where: { userId: p.userId, type: "TOTP", confirmedAt: { not: null } }, select: { id: true } }));
    return {
      user: { id: p.userId, ...user, mfaEnabled },
      employee: { id: p.employeeId, displayName: p.displayName },
      organization: org,
      impersonatedBy: p.impersonatorId ?? null,
      features: [...p.features].sort(),
      limits: p.limits,
      grants: p.grants.map((g) => ({
        role: g.roleKey,
        scope: g.scope,
        brandId: g.brandId ?? null,
        branchId: g.branchId ?? null,
        expiresAt: g.expiresAt ?? null,
        permissions: [...g.permissions].sort(),
      })),
    };
  }

  @AnyStaff()
  @Post("mfa/totp/setup")
  async setupTotp() {
    const p = principal();
    const user = await tx().user.findUniqueOrThrow({ where: { id: p.userId }, select: { email: true } });
    return this.auth.beginTotpEnrolment(p.userId, user.email);
  }

  @AnyStaff()
  @Post("mfa/totp/confirm")
  @HttpCode(200)
  confirmTotp(@Body(new ZodPipe(Code)) body: z.infer<typeof Code>) {
    return this.auth.confirmTotpEnrolment(principal().userId, body.code);
  }

  /** The signed-in user's own password. Other devices are signed out; this one stays. */
  @AnyStaff()
  @Post("password")
  @HttpCode(204)
  async changePassword(@Body(new ZodPipe(ChangePassword)) body: z.infer<typeof ChangePassword>) {
    const p = principal();
    if (p.impersonatorId) throw new ForbiddenException({ error: "impersonating" });
    await this.auth.changePassword(p.userId, p.sessionId, body.currentPassword, body.newPassword);
  }
}

@Controller("permissions")
export class PermissionsController {
  @AnyStaff()
  @Get()
  list() {
    return PERMISSIONS;
  }
}
