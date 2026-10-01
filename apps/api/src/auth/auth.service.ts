import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Db } from "@arena/db";
import { CONFIG, type AppConfig } from "../config.js";
import { DB } from "../common/db.module.js";
import { burnVerify, hashSecret, newTotpSecret, otpauthUrl, randomToken, seal, sha256, unseal, verifySecret, verifyTotp } from "./crypto.js";
import { TokensService } from "./tokens.service.js";

interface Membership {
  organization_id: string;
  slug: string;
  display_name: string;
  org_status: string;
  employee_id: string;
  employee_status: string;
}

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  organization: { id: string; slug: string; name: string };
  mfaSetupRequired: boolean;
}

const INVALID = () => new UnauthorizedException({ error: "invalid_credentials" });
const USABLE_ORG = new Set(["TRIAL", "ACTIVE", "PAST_DUE"]);

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async login(input: { email: string; password: string; organizationSlug?: string }, meta: ClientMeta) {
    const user = await this.db.global.user.findUnique({ where: { email: input.email.toLowerCase() } });
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
      await this.db.global.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLogins: 0, lockedUntil: new Date(Date.now() + this.cfg.LOGIN_LOCK_MINUTES * 60_000) }
          : { failedLogins: failures },
      });
      throw INVALID();
    }
    await this.db.global.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });

    const membership = await this.pickMembership(user.id, input.organizationSlug);
    const factor = await this.confirmedTotp(user.id);
    if (factor) {
      return { mfaRequired: true as const, mfaToken: await this.tokens.signMfaChallenge(user.id, membership.organization_id) };
    }
    return this.issue(user.id, membership, meta, { mfaSetupRequired: user.mfaRequired });
  }

  async verifyMfa(input: { mfaToken: string; code: string }, meta: ClientMeta): Promise<TokenPair> {
    const { userId, organizationId } = await this.tokens.verifyMfaChallenge(input.mfaToken);
    const factor = await this.confirmedTotp(userId);
    if (!factor) throw new UnauthorizedException({ error: "invalid_mfa_token" });

    const step = verifyTotp(unseal(factor.secretEnc, this.cfg.MFA_ENCRYPTION_KEY_B64), input.code);
    const lastStep = factor.lastUsedAt ? Math.floor(factor.lastUsedAt.getTime() / 30_000) : -1;
    if (step === null || step <= lastStep) throw new UnauthorizedException({ error: "invalid_mfa_code" });
    // Conditional update: two concurrent requests with the same code can't both win.
    const claimed = await this.db.global.mfaFactor.updateMany({
      where: { id: factor.id, lastUsedAt: factor.lastUsedAt },
      data: { lastUsedAt: new Date(step * 30_000) },
    });
    if (claimed.count !== 1) throw new UnauthorizedException({ error: "invalid_mfa_code" });

    const membership = await this.membershipById(userId, organizationId);
    return this.issue(userId, membership, meta, { mfaSetupRequired: false });
  }

  /** Rotation with reuse detection (OAuth 2.0 Security BCP §4.14). */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<TokenPair> {
    const row = await this.db.global.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row || row.subjectType !== "USER" || !row.userId || !row.organizationId) throw new UnauthorizedException({ error: "invalid_refresh_token" });

    if (row.revokedAt || row.rotatedAt) {
      await this.revokeFamily(row.familyId, "reuse_detected");
      throw new UnauthorizedException({ error: "refresh_token_reused" });
    }
    if (row.expiresAt <= new Date()) throw new UnauthorizedException({ error: "refresh_token_expired" });

    const rotated = await this.db.global.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (rotated.count !== 1) {
      await this.revokeFamily(row.familyId, "reuse_detected");
      throw new UnauthorizedException({ error: "refresh_token_reused" });
    }

    const membership = await this.membershipById(row.userId, row.organizationId).catch(async (e) => {
      await this.revokeFamily(row.familyId, "membership_revoked");
      throw e;
    });
    return this.issue(row.userId, membership, meta, { mfaSetupRequired: false, familyId: row.familyId });
  }

  async logout(refreshToken: string): Promise<void> {
    const row = await this.db.global.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, select: { familyId: true } });
    if (row) await this.revokeFamily(row.familyId, "logout");
  }

  // ── MFA enrolment (authenticated) ─────────────────────────────────────────

  async beginTotpEnrolment(userId: string, email: string) {
    const secret = newTotpSecret();
    await this.db.global.mfaFactor.deleteMany({ where: { userId, type: "TOTP", confirmedAt: null } });
    const factor = await this.db.global.mfaFactor.create({
      data: { userId, type: "TOTP", label: "Authenticator app", secretEnc: seal(secret, this.cfg.MFA_ENCRYPTION_KEY_B64) },
    });
    return { factorId: factor.id, secret, otpauthUrl: otpauthUrl(secret, email) };
  }

  async confirmTotpEnrolment(userId: string, code: string) {
    const pending = await this.db.global.mfaFactor.findFirst({ where: { userId, type: "TOTP", confirmedAt: null }, orderBy: { createdAt: "desc" } });
    if (!pending) throw new ConflictException({ error: "no_pending_enrolment" });
    const step = verifyTotp(unseal(pending.secretEnc, this.cfg.MFA_ENCRYPTION_KEY_B64), code);
    // 422, not 401: the caller is signed in and just mistyped. A 401 reads as
    // "session expired" to clients, and the admin would sign the user out.
    if (step === null) throw new UnprocessableEntityException({ error: "invalid_mfa_code" });
    await this.db.global.mfaFactor.deleteMany({ where: { userId, type: "TOTP", confirmedAt: { not: null } } });
    await this.db.global.mfaFactor.update({ where: { id: pending.id }, data: { confirmedAt: new Date(), lastUsedAt: new Date(step * 30_000) } });
    return { enabled: true };
  }

  // ── Password (authenticated) ──────────────────────────────────────────────

  async changePassword(userId: string, keepSessionId: string, current: string, next: string) {
    const user = await this.db.global.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    // 422, not 401: a wrong current password must not read as "session expired".
    if (!user.passwordHash || !(await verifySecret(user.passwordHash, current))) throw new UnprocessableEntityException({ error: "invalid_current_password" });
    if (current === next) throw new UnprocessableEntityException({ error: "same_password" });
    await this.db.global.user.update({ where: { id: userId }, data: { passwordHash: await hashSecret(next), failedLogins: 0, lockedUntil: null } });
    await this.db.global.refreshToken.updateMany({
      where: { userId, familyId: { not: keepSessionId }, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "password_changed" },
    });
  }

  // ── Switch staff by PIN (authenticated, shared counter PC) ────────────────

  /**
   * Hand a signed-in counter PC to a colleague with their PIN. The previous
   * person is signed out on this browser. Accounts with 2-step sign-in must
   * use their password and code instead: a PIN is never a way around MFA.
   * Wrong PINs count towards the same lock-out as wrong passwords.
   */
  async pinSwitch(employee: { userId: string; status: string; pinHash: string | null }, pin: string, current: { organizationId: string; sessionId: string }, meta: ClientMeta): Promise<TokenPair> {
    const user = await this.db.global.user.findUnique({ where: { id: employee.userId } });
    if (!user || user.isDisabled || employee.status !== "ACTIVE" || !employee.pinHash) {
      await burnVerify(pin);
      throw INVALID();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpException({ error: "account_locked", retryAfter: user.lockedUntil.toISOString() }, 423);
    if (!(await verifySecret(employee.pinHash, pin))) {
      const failures = user.failedLogins + 1;
      const lock = failures >= this.cfg.LOGIN_MAX_FAILURES;
      await this.db.global.user.update({
        where: { id: user.id },
        data: lock ? { failedLogins: 0, lockedUntil: new Date(Date.now() + this.cfg.LOGIN_LOCK_MINUTES * 60_000) } : { failedLogins: failures },
      });
      throw INVALID();
    }
    if (user.mfaRequired || (await this.confirmedTotp(user.id))) throw new ForbiddenException({ error: "full_sign_in_required" });
    await this.db.global.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const membership = await this.membershipById(user.id, current.organizationId);
    await this.revokeFamily(current.sessionId, "pin_switch");
    return this.issue(user.id, membership, meta, { mfaSetupRequired: false });
  }

  /** The signed-in user's own counter PIN; needs their password so a walk-up can't set one. */
  async setOwnPin(userId: string, password: string) {
    const user = await this.db.global.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!user.passwordHash || !(await verifySecret(user.passwordHash, password))) throw new UnprocessableEntityException({ error: "invalid_current_password" });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async memberships(userId: string): Promise<Membership[]> {
    const rows = await this.db.global.$queryRaw<Membership[]>`SELECT * FROM app.memberships_for_user(${userId}::uuid)`;
    return rows.filter((m) => m.employee_status === "ACTIVE" && USABLE_ORG.has(m.org_status));
  }

  private async pickMembership(userId: string, slug?: string): Promise<Membership> {
    const all = await this.memberships(userId);
    if (slug) {
      const m = all.find((x) => x.slug === slug);
      if (!m) throw new ForbiddenException({ error: "no_membership" });
      return m;
    }
    if (all.length === 1) return all[0]!;
    if (all.length === 0) throw new ForbiddenException({ error: "no_membership" });
    throw new ConflictException({
      error: "organization_required",
      organizations: all.map((m) => ({ slug: m.slug, name: m.display_name })),
    });
  }

  private async membershipById(userId: string, organizationId: string): Promise<Membership> {
    const m = (await this.memberships(userId)).find((x) => x.organization_id === organizationId);
    if (!m) throw new ForbiddenException({ error: "no_membership" });
    return m;
  }

  private confirmedTotp(userId: string) {
    return this.db.global.mfaFactor.findFirst({ where: { userId, type: "TOTP", confirmedAt: { not: null } } });
  }

  private async issue(
    userId: string,
    m: Membership,
    meta: ClientMeta,
    opts: { mfaSetupRequired: boolean; familyId?: string },
  ): Promise<TokenPair> {
    const familyId = opts.familyId ?? randomUUID();
    const refreshToken = randomToken();
    await this.db.global.refreshToken.create({
      data: {
        subjectType: "USER",
        userId,
        organizationId: m.organization_id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
    const accessToken = await this.tokens.signAccess({ sub: userId, org: m.organization_id, emp: m.employee_id, sid: familyId });
    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.cfg.ACCESS_TOKEN_TTL_SEC,
      organization: { id: m.organization_id, slug: m.slug, name: m.display_name },
      mfaSetupRequired: opts.mfaSetupRequired,
    };
  }

  private revokeFamily(familyId: string, reason: string) {
    return this.db.global.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  }
}
