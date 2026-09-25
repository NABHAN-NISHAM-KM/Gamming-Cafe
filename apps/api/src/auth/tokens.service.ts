import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from "jose";
import { CONFIG, type AppConfig } from "../config.js";

/** Claims on a staff access token. The org is fixed per token: switching orgs issues a new one. */
export interface AccessClaims {
  sub: string; // User.id
  org: string; // Organization.id
  emp: string; // Employee.id
  sid: string; // refresh-token family (session) id — lets logout kill access too
  imp?: string; // platform user id when impersonating
}

const ALG = "EdDSA"; // Ed25519: small, fast; verifiable by edge servers with the public key only

@Injectable()
export class TokensService {
  private privateKey!: Promise<CryptoKey>;
  private publicKey!: Promise<CryptoKey>;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.privateKey = importPKCS8(cfg.JWT_PRIVATE_KEY_B64, ALG);
    this.publicKey = importSPKI(cfg.JWT_PUBLIC_KEY_B64, ALG);
  }

  async signAccess(c: AccessClaims): Promise<string> {
    return new SignJWT({ org: c.org, emp: c.emp, sid: c.sid, ...(c.imp ? { imp: c.imp } : {}) })
      .setProtectedHeader({ alg: ALG, typ: "at+jwt" })
      .setSubject(c.sub)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience("arena:staff")
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.ACCESS_TOKEN_TTL_SEC}s`)
      .sign(await this.privateKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, await this.publicKey, {
        issuer: this.cfg.JWT_ISSUER,
        audience: "arena:staff",
        algorithms: [ALG],
        typ: "at+jwt",
      });
      const { sub, org, emp, sid, imp } = payload as Record<string, unknown>;
      if (typeof sub !== "string" || typeof org !== "string" || typeof emp !== "string" || typeof sid !== "string") throw new Error("claims");
      return { sub, org, emp, sid, ...(typeof imp === "string" ? { imp } : {}) };
    } catch {
      throw new UnauthorizedException({ error: "invalid_token" });
    }
  }

  /**
   * Customer-app token. A different audience from staff tokens, so neither can
   * be used as the other. `sid` is the CustomerSession row: logging out (or a
   * staff ban) ends it and the token stops working immediately.
   */
  async signCustomer(c: { customerId: string; org: string; sid: string }, ttlSec = 12 * 3600): Promise<string> {
    return new SignJWT({ org: c.org, sid: c.sid })
      .setProtectedHeader({ alg: ALG, typ: "ct+jwt" })
      .setSubject(c.customerId)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience("arena:customer")
      .setIssuedAt()
      .setExpirationTime(`${ttlSec}s`)
      .sign(await this.privateKey);
  }

  async verifyCustomer(token: string): Promise<{ customerId: string; org: string; sid: string }> {
    try {
      const { payload } = await jwtVerify(token, await this.publicKey, { issuer: this.cfg.JWT_ISSUER, audience: "arena:customer", algorithms: [ALG], typ: "ct+jwt" });
      const { sub, org, sid } = payload as Record<string, unknown>;
      if (typeof sub !== "string" || typeof org !== "string" || typeof sid !== "string") throw new Error("claims");
      return { customerId: sub, org, sid };
    } catch {
      throw new UnauthorizedException({ error: "invalid_token" });
    }
  }

  /** Short-lived proof that the password step passed; exchanged for tokens after TOTP. */
  async signMfaChallenge(userId: string, organizationId: string): Promise<string> {
    return new SignJWT({ org: organizationId })
      .setProtectedHeader({ alg: ALG, typ: "mfa+jwt" })
      .setSubject(userId)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setAudience("arena:mfa")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(await this.privateKey);
  }

  async verifyMfaChallenge(token: string): Promise<{ userId: string; organizationId: string }> {
    try {
      const { payload } = await jwtVerify(token, await this.publicKey, {
        issuer: this.cfg.JWT_ISSUER,
        audience: "arena:mfa",
        algorithms: [ALG],
        typ: "mfa+jwt",
      });
      if (typeof payload.sub !== "string" || typeof payload["org"] !== "string") throw new Error("claims");
      return { userId: payload.sub, organizationId: payload["org"] as string };
    } catch {
      throw new UnauthorizedException({ error: "invalid_mfa_token" });
    }
  }
}
