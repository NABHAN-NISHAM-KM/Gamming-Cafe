import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from "jose";
import { PLATFORM_CONFIG, type PlatformConfig } from "./config.js";

const ALG = "EdDSA";

/** Claims on a platform access token. Roles are NOT in the token: the guard re-reads them each request. */
export interface PlatformClaims {
  sub: string; // User.id
  sid: string; // refresh-token family
}

/**
 * Platform tokens use their own audience and `typ`, so a staff token can never
 * be replayed here and a platform token is rejected by the tenant API.
 */
@Injectable()
export class PlatformTokens {
  private privateKey: Promise<CryptoKey>;
  private publicKey: Promise<CryptoKey>;

  constructor(@Inject(PLATFORM_CONFIG) private readonly cfg: PlatformConfig) {
    this.privateKey = importPKCS8(cfg.JWT_PRIVATE_KEY_B64, ALG);
    this.publicKey = importSPKI(cfg.JWT_PUBLIC_KEY_B64, ALG);
  }

  async signAccess(c: PlatformClaims): Promise<string> {
    return new SignJWT({ sid: c.sid })
      .setProtectedHeader({ alg: ALG, typ: "pt+jwt" })
      .setSubject(c.sub)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience("arena:platform")
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.PLATFORM_ACCESS_TTL_SEC}s`)
      .sign(await this.privateKey);
  }

  async verifyAccess(token: string): Promise<PlatformClaims> {
    try {
      const { payload } = await jwtVerify(token, await this.publicKey, { issuer: this.cfg.JWT_ISSUER, audience: "arena:platform", algorithms: [ALG], typ: "pt+jwt" });
      if (typeof payload.sub !== "string" || typeof payload["sid"] !== "string") throw new Error("claims");
      return { sub: payload.sub, sid: payload["sid"] as string };
    } catch {
      throw new UnauthorizedException({ error: "invalid_token" });
    }
  }

  /** Proof that the password step passed; exchanged for tokens after the TOTP step (5 minutes). */
  async signChallenge(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: ALG, typ: "pmfa+jwt" })
      .setSubject(userId)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience("arena:platform-mfa")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(await this.privateKey);
  }

  async verifyChallenge(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, await this.publicKey, { issuer: this.cfg.JWT_ISSUER, audience: "arena:platform-mfa", algorithms: [ALG], typ: "pmfa+jwt" });
      if (typeof payload.sub !== "string") throw new Error("claims");
      return payload.sub;
    } catch {
      throw new UnauthorizedException({ error: "invalid_mfa_token" });
    }
  }
}
