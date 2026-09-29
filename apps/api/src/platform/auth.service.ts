import { ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PlatformClient, PlatformRole } from "@arena/db";
import { burnVerify, newTotpSecret, otpauthUrl, randomToken, seal, sha256, unseal, verifySecret, verifyTotp } from "../auth/crypto.js";
import { PDB, PLATFORM_CONFIG, type PlatformConfig } from "./config.js";
import { PlatformTokens } from "./tokens.js";

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

const INVALID = () => new UnauthorizedException({ error: "invalid_credentials" });

/**
 * Super Admin sign-in. Two-step verification is mandatory: an admin without a
 * confirmed authenticator is walked through enrolment before any token is issued.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    @Inject(PDB) private readonly db: PlatformClient,
    @Inject(PlatformTokens) private readonly tokens: PlatformTokens,
    @Inject(PLATFORM_CONFIG) private readonly cfg: PlatformConfig,
  ) {}

  async login(input: { email: string; password: string }) {
    const user = await this.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || user.isDisabled || !user.passwordHash) {
      await burnVerify(input.password);
      throw INVALID();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException({ error: "account_locked", retryAfter: user.lockedUntil.toISOString() }, 423);
    }
    if (!(await verifySecret(user.passwordHash, input.password))) {
      const failures = user.failedLogins + 1;
      const lock = failures >= this.cfg.LOGIN_MAX_FAILURES;
      await this.db.user.update({
        where: { id: user.id },
        data: lock ? { failedLogins: 0, lockedUntil: new Date(Date.now() + this.cfg.LOGIN_LOCK_MINUTES * 60_000) } : { failedLogins: failures },
      });
      throw INVALID();
    }
    await this.db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    if ((await this.roles(user.id)).length === 0) throw new ForbiddenException({ error: "not_platform_admin" });

    const mfaToken = await this.tokens.signChallenge(user.id);
    if (await this.confirmedTotp(user.id)) return { mfaRequired: true as const, mfaToken };

    // First sign-in: enrol an authenticator before anything else.
    const secret = newTotpSecret();
    await this.db.mfaFactor.deleteMany({ where: { userId: user.id, type: "TOTP", confirmedAt: null } });
    await this.db.mfaFactor.create({ data: { userId: user.id, type: "TOTP", label: "Authenticator app", secretEnc: seal(secret, this.cfg.MFA_ENCRYPTION_KEY_B64) } });
    return { mfaSetupRequired: true as const, mfaToken, secret, otpauthUrl: otpauthUrl(secret, user.email, "ArenaOS Platform") };
  }

  async verifyMfa(input: { mfaToken: string; code: string }, meta: ClientMeta) {
    const userId = await this.tokens.verifyChallenge(input.mfaToken);
    const confirmed = await this.confirmedTotp(userId);
    const factor = confirmed ?? (await this.db.mfaFactor.findFirst({ where: { userId, type: "TOTP", confirmedAt: null }, orderBy: { createdAt: "desc" } }));
    if (!factor) throw new UnauthorizedException({ error: "invalid_mfa_token" });

    const step = verifyTotp(unseal(factor.secretEnc, this.cfg.MFA_ENCRYPTION_KEY_B64), input.code);
    const lastStep = factor.lastUsedAt ? Math.floor(factor.lastUsedAt.getTime() / 30_000) : -1;
    if (step === null || step <= lastStep) throw new UnauthorizedException({ error: "invalid_mfa_code" });
    // Conditional update: the same code can't be spent twice by concurrent requests.
    const claimed = await this.db.mfaFactor.updateMany({
      where: { id: factor.id, lastUsedAt: factor.lastUsedAt },
      data: { lastUsedAt: new Date(step * 30_000), ...(confirmed ? {} : { confirmedAt: new Date() }) },
    });
    if (claimed.count !== 1) throw new UnauthorizedException({ error: "invalid_mfa_code" });
    if (!confirmed) await this.db.mfaFactor.deleteMany({ where: { userId, type: "TOTP", confirmedAt: { not: null }, id: { not: factor.id } } });

    const roles = await this.roles(userId);
    if (roles.length === 0) throw new ForbiddenException({ error: "not_platform_admin" });
    await this.db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const pair = await this.issue(userId, meta);
    await this.audit(userId, roles[0]!, meta, { action: "platform.login", entityType: "User", entityId: userId });
    return pair;
  }

  /** Rotation with reuse detection, same rules as staff sessions. Platform rows have no organization. */
  async refresh(refreshToken: string, meta: ClientMeta) {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row || row.subjectType !== "USER" || !row.userId || row.organizationId !== null) throw new UnauthorizedException({ error: "invalid_refresh_token" });
    if (row.revokedAt || row.rotatedAt) {
      await this.revokeFamily(row.familyId, "reuse_detected");
      throw new UnauthorizedException({ error: "refresh_token_reused" });
    }
    if (row.expiresAt <= new Date()) throw new UnauthorizedException({ error: "refresh_token_expired" });
    const rotated = await this.db.refreshToken.updateMany({ where: { id: row.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: new Date() } });
    if (rotated.count !== 1) {
      await this.revokeFamily(row.familyId, "reuse_detected");
      throw new UnauthorizedException({ error: "refresh_token_reused" });
    }
    if ((await this.roles(row.userId)).length === 0) {
      await this.revokeFamily(row.familyId, "role_revoked");
      throw new ForbiddenException({ error: "not_platform_admin" });
    }
    return this.issue(row.userId, meta, row.familyId);
  }

  async logout(refreshToken: string) {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, select: { familyId: true, organizationId: true } });
    if (row && row.organizationId === null) await this.revokeFamily(row.familyId, "logout");
  }

  roles(userId: string): Promise<PlatformRole[]> {
    return this.db.platformRoleAssignment.findMany({ where: { userId, user: { isDisabled: false } }, select: { role: true } }).then((r) => r.map((x) => x.role));
  }

  async audit(actorId: string, actorRole: string, meta: ClientMeta & { requestId?: string | null; reason?: string | null }, e: { action: string; entityType: string; entityId?: string | null; organizationId?: string | null; before?: unknown; after?: unknown }) {
    await this.db.auditLog.create({
      data: {
        organizationId: e.organizationId ?? null,
        actorType: "PLATFORM_ADMIN",
        actorId,
        actorRole,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        before: toJson(e.before),
        after: toJson(e.after),
        reason: meta.reason ?? null,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        requestId: meta.requestId ?? null,
        hash: "", // set by the audit_hash_chain trigger
      },
    });
  }

  private confirmedTotp(userId: string) {
    return this.db.mfaFactor.findFirst({ where: { userId, type: "TOTP", confirmedAt: { not: null } } });
  }

  private async issue(userId: string, meta: ClientMeta, familyId: string = randomUUID()) {
    const refreshToken = randomToken();
    await this.db.refreshToken.create({
      data: {
        subjectType: "USER",
        userId,
        organizationId: null,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.cfg.PLATFORM_REFRESH_TTL_HOURS * 3_600_000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
    return { accessToken: await this.tokens.signAccess({ sub: userId, sid: familyId }), refreshToken, tokenType: "Bearer" as const, expiresIn: this.cfg.PLATFORM_ACCESS_TTL_SEC };
  }

  private revokeFamily(familyId: string, reason: string) {
    return this.db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  }
}

const REDACT = new Set(["passwordHash", "pinHash", "secretEnc", "tokenHash"]);
function toJson(v: unknown): any {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (REDACT.has(k) ? "[redacted]" : typeof val === "bigint" ? val.toString() : val)));
}
