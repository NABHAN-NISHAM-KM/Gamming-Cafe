import { Body, Controller, Get, HttpCode, HttpException, Inject, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { PlatformClient } from "@arena/db";
import { ZodPipe } from "../common/zod.pipe.js";
import { Throttle } from "../customer-app/customer-auth.js";
import { PDB } from "./config.js";
import { PlatformAuthService } from "./auth.service.js";
import { clientMeta, PlatformPublic, PlatformRoles, READ_ROLES, type PlatformRequest } from "./guard.js";

const Login = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });
const MfaVerify = z.object({ mfaToken: z.string().min(1), code: z.string().regex(/^\d{6}$/) });
const Refresh = z.object({ refreshToken: z.string().min(20).max(200) });

@Controller("platform/auth")
export class PlatformAuthController {
  // Failed attempts per IP, on top of the per-account lockout. ponytail: in-memory, per instance; Redis if the platform service is scaled out.
  private readonly byIp = new Throttle(10, 15 * 60_000);

  constructor(
    @Inject(PlatformAuthService) private readonly auth: PlatformAuthService,
    @Inject(PDB) private readonly db: PlatformClient,
  ) {}

  /** Refuses an address with too many recent failures; counts this attempt only if it fails. */
  private async throttled<T>(req: PlatformRequest, attempt: () => Promise<T>): Promise<T> {
    const ip = req.ip ?? "?";
    if (this.byIp.full(ip)) throw new HttpException({ error: "too_many_attempts" }, 429);
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof HttpException && [401, 423].includes(e.getStatus())) this.byIp.hit(ip);
      throw e;
    }
  }

  @PlatformPublic()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodPipe(Login)) body: z.infer<typeof Login>, @Req() req: PlatformRequest) {
    return this.throttled(req, () => this.auth.login(body));
  }

  @PlatformPublic()
  @Post("mfa/verify")
  @HttpCode(200)
  verify(@Body(new ZodPipe(MfaVerify)) body: z.infer<typeof MfaVerify>, @Req() req: PlatformRequest) {
    return this.throttled(req, () => this.auth.verifyMfa(body, clientMeta(req)));
  }

  @PlatformPublic()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(new ZodPipe(Refresh)) body: z.infer<typeof Refresh>, @Req() req: PlatformRequest) {
    return this.auth.refresh(body.refreshToken, clientMeta(req));
  }

  @PlatformPublic()
  @Post("logout")
  @HttpCode(204)
  async logout(@Body(new ZodPipe(Refresh)) body: z.infer<typeof Refresh>) {
    await this.auth.logout(body.refreshToken);
  }

  @PlatformRoles(...READ_ROLES)
  @Get("me")
  async me(@Req() req: PlatformRequest) {
    const p = req.platform!;
    const user = await this.db.user.findUniqueOrThrow({ where: { id: p.userId }, select: { id: true, email: true, displayName: true, lastLoginAt: true } });
    return { user, roles: p.roles };
  }
}
