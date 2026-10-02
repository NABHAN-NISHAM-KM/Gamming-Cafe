import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Db, TenantTx } from "@arena/db";
import { CONFIG, type AppConfig } from "../config.js";
import { auditAs } from "../common/audit.service.js";
import { activeRestrictions, assertMayPlay, playerLimits } from "../customers/restrictions.js";
import { CommandsService } from "../devices/commands.service.js";
import { burnVerify, verifySecret } from "../auth/crypto.js";
import { DB } from "../common/db.module.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import type { Connection } from "../devices/live.js";
import { ageOn, LIVE_STATUSES, SessionsService } from "./sessions.service.js";
import { timeBalance } from "./time-balance.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const QR_TTL_MS = 3 * 60_000;

/** Sliding-window attempt counter (per PC and per account) against password guessing at the kiosk. */
class Throttle {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  blocked(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, recent);
    return recent.length >= this.max;
  }
  hit(key: string) {
    this.hits.set(key, [...(this.hits.get(key) ?? []), Date.now()]);
  }
  clear(key: string) {
    this.hits.delete(key);
  }
}

/**
 * Customer self-service at the station (the Gaming Shell's login screen).
 * Requests arrive over the agent's authenticated WebSocket, so the device —
 * and therefore the organization and branch — is already proven; the customer
 * then proves themselves with username + password (or PIN).
 */
@Injectable()
export class ShellAuthService implements OnModuleInit {
  private readonly log = new Logger("ShellAuth");
  private readonly perDevice = new Throttle(8, 60_000);
  private readonly perAccount = new Throttle(10, 15 * 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(CommandsService) private readonly commands: CommandsService,
  ) {}

  onModuleInit() {
    this.gateway.handleShell((conn, msg) => (msg.type === "shell_login" ? this.login(conn, msg as any) : this.logout(conn, msg as any)));
    this.gateway.handleStation("qr_login", (conn) => this.issueCode(conn));
  }

  private async login(conn: Connection, msg: { requestId: string; username: string; secret: string }) {
    const username = msg.username.trim().toLowerCase();
    const accountKey = `${conn.organizationId}:${username}`;
    if (this.perDevice.blocked(conn.deviceId) || this.perAccount.blocked(accountKey)) {
      return { ok: false, error: "too_many_attempts", message: "Too many attempts. Please wait a minute or ask staff." };
    }

    return this.db.withTenant({ organizationId: conn.organizationId, actorType: "DEVICE", actorId: conn.deviceId }, async (t) => {
      const customer = await t.customer.findFirst({
        where: { OR: [{ username: { equals: username, mode: "insensitive" } }, { email: { equals: username, mode: "insensitive" } }, { phone: msg.username.trim() }] },
        select: { id: true, displayName: true, status: true, passwordHash: true, pinHash: true },
      });
      const ok =
        !!customer &&
        ((!!customer.passwordHash && (await verifySecret(customer.passwordHash, msg.secret))) || (!!customer.pinHash && (await verifySecret(customer.pinHash, msg.secret))));
      if (!customer) await burnVerify(msg.secret);
      if (!ok) {
        this.perDevice.hit(conn.deviceId);
        this.perAccount.hit(accountKey);
        return { ok: false, error: "invalid_credentials", message: "Wrong username or password." };
      }
      this.perAccount.clear(accountKey);
      if (customer.status === "BANNED" || customer.status === "DELETED") return { ok: false, error: "account_blocked", message: "This account can't be used. Please see staff." };
      return this.startFor(t, conn.organizationId, conn.deviceId, customer, `shell:${conn.deviceId}:${msg.requestId}`, "SHELL");
    });
  }

  /** Starts a prepaid-balance session for an already-authenticated customer on a PC. */
  private async startFor(t: TenantTx, organizationId: string, deviceId: string, customer: { id: string; displayName: string }, idempotencyKey: string, channel: "SHELL" | "MOBILE") {
    {
      if (await t.gamingSession.findFirst({ where: { deviceId, status: { in: [...LIVE_STATUSES] } }, select: { id: true } })) {
        return { ok: false, error: "station_in_use", message: "This PC is already in use." };
      }
      if (await t.gamingSession.findFirst({ where: { customerId: customer.id, status: { in: [...LIVE_STATUSES] } }, select: { id: true } })) {
        return { ok: false, error: "already_playing", message: "You're already logged in on another PC." };
      }
      const balance = await timeBalance(t, customer.id);
      if (balance <= 0) return { ok: false, error: "no_time", message: "You have no gaming time left. Buy time at the counter.", timeBalanceMinutes: 0 };

      const s = await this.sessions.start(
        t,
        { deviceId, customerId: customer.id, request: { kind: "minutes", minutes: balance }, payment: { method: "TIME_BALANCE" }, idempotencyKey },
        { type: "CUSTOMER", id: customer.id },
      );
      // A replayed requestId returns the earlier (possibly finished) session — never report that as a fresh login.
      if (!(LIVE_STATUSES as readonly string[]).includes(s.status)) return { ok: false, error: "duplicate_request", message: "Please try signing in again." };
      await t.customerSession.create({ data: { organizationId, customerId: customer.id, channel, deviceId, gamingSessionId: s.id } });
      await t.customer.update({ where: { id: customer.id }, data: { lastVisitAt: new Date() } });
      this.log.log(`customer ${customer.displayName} logged in on ${s.deviceName}`);
      return { ok: true as const, displayName: customer.displayName, timeBalanceMinutes: balance, station: s.deviceName };
    }
  }

  // -- "Sign in with your phone": the PC shows a one-time code as a QR --

  // ponytail: codes live in this process (one API node per venue, like the live bus); move to Redis with several nodes.
  // "login" codes sign a player in at a locked PC; "claim" codes move a running guest session onto an account.
  private readonly codes = new Map<string, { organizationId: string; deviceId: string; expiresAt: number; kind: "login" | "claim" }>();

  async issueCode(conn: { organizationId: string; deviceId: string }, kind: "login" | "claim" = "login") {
    for (const [k, v] of this.codes) if ((v.deviceId === conn.deviceId && v.kind === kind) || v.expiresAt < Date.now()) this.codes.delete(k);
    const code = Array.from(randomBytes(10), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    const expiresAt = Date.now() + QR_TTL_MS;
    this.codes.set(code, { organizationId: conn.organizationId, deviceId: conn.deviceId, expiresAt, kind });
    const org = await this.db.withTenant({ organizationId: conn.organizationId, actorType: "DEVICE", actorId: conn.deviceId }, (t) => t.organization.findFirstOrThrow({ select: { slug: true } }));
    const param = kind === "login" ? "pc" : "claim";
    return { ok: true, code, url: `${this.cfg.CUSTOMER_APP_URL.replace(/\/+$/, "")}/${org.slug}?${param}=${code}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  private codeFor(organizationId: string, code: string, kind: "login" | "claim" = "login") {
    const c = this.codes.get(code.toUpperCase());
    if (!c || c.organizationId !== organizationId || c.kind !== kind || c.expiresAt < Date.now()) throw new NotFoundException({ error: "pc_code_expired" });
    return c;
  }

  /**
   * Guest → member: the guest playing on a PC signs up (or in) on their phone
   * and scans the PC's code; the running session, its bill and orders become
   * theirs, so the time counts for points and stats. The PC shows their name.
   */
  async claimGuest(t: TenantTx, organizationId: string, customerId: string, code: string) {
    const c = this.codeFor(organizationId, code, "claim");
    const s = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: [...LIVE_STATUSES] } }, select: { id: true, customerId: true, billId: true, startedAt: true, expiresAt: true, postSessionAction: true, device: { select: { zoneId: true, name: true, branch: { select: { timezone: true } } } } } });
    if (!s || s.customerId) throw new ConflictException({ error: "pc_code_expired" });
    if (await t.gamingSession.findFirst({ where: { customerId, status: { in: [...LIVE_STATUSES] } }, select: { id: true } })) throw new ConflictException({ error: "already_playing" });
    const { active } = await assertMayPlay(t, customerId, { zoneId: s.device.zoneId, timezone: s.device.branch.timezone });
    const customer = await t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { displayName: true, dateOfBirth: true, membershipTier: { select: { name: true } } } });
    await t.gamingSession.update({ where: { id: s.id }, data: { customerId } });
    if (s.billId) {
      await t.bill.updateMany({ where: { id: s.billId, customerId: null }, data: { customerId } });
      await t.order.updateMany({ where: { billId: s.billId, customerId: null }, data: { customerId } });
    }
    await t.customerSession.create({ data: { organizationId, customerId, channel: "MOBILE", deviceId: c.deviceId, gamingSessionId: s.id } });
    await t.customer.update({ where: { id: customerId }, data: { lastVisitAt: new Date() } });
    const limits = playerLimits(active, ageOn(customer.dateOfBirth));
    await this.commands.issue(t, {
      deviceId: c.deviceId, type: "START_SESSION",
      payload: this.sessions.startPayload({ id: s.id, startedAt: s.startedAt, expiresAt: s.expiresAt, postSessionAction: s.postSessionAction, customerId }, customer.displayName, customer.membershipTier?.name ?? null, limits.age, limits.blockedGameIds),
      requestedBy: { type: "SYSTEM", id: null },
    });
    await auditAs(t, { type: "CUSTOMER", id: customerId }, { action: "session.claim", entityType: "GamingSession", entityId: s.id, after: { device: s.device.name } });
    await this.sessions.publishDevice(t, c.deviceId);
    this.codes.delete(code.toUpperCase());
    return { station: s.device.name };
  }

  /** Which PC a code belongs to, so the phone can ask "Sign in on PC-07?". */
  async codePreview(t: TenantTx, organizationId: string, code: string) {
    const c = this.codeFor(organizationId, code);
    const d = await t.device.findUnique({ where: { id: c.deviceId }, select: { name: true, branch: { select: { name: true } } } });
    if (!d) throw new NotFoundException({ error: "pc_code_expired" });
    return { station: d.name, branch: d.branch.name };
  }

  /** The signed-in app customer redeems a PC's code: the PC unlocks with their saved time. */
  async loginWithCode(t: TenantTx, organizationId: string, customerId: string, code: string) {
    const c = this.codeFor(organizationId, code);
    const customer = await t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { id: true, displayName: true } });
    const r = await this.startFor(t, organizationId, c.deviceId, customer, `qr:${code.toUpperCase()}`, "MOBILE");
    if (!r.ok) throw new ConflictException({ error: r.error, message: r.message });
    this.codes.delete(code.toUpperCase());
    return r;
  }

  private async logout(conn: Connection, msg: { requestId: string; sessionId: string }) {
    return this.db.withTenant({ organizationId: conn.organizationId, actorType: "DEVICE", actorId: conn.deviceId }, async (t) => {
      const s = await t.gamingSession.findFirst({ where: { id: msg.sessionId, deviceId: conn.deviceId }, select: { id: true, customerId: true } });
      if (!s) return { ok: false, error: "not_found" };
      await this.sessions.end(t, s.id, "CUSTOMER_LOGOUT", { type: "CUSTOMER", id: s.customerId });
      return { ok: true, timeBalanceMinutes: s.customerId ? await timeBalance(t, s.customerId) : undefined };
    });
  }
}
