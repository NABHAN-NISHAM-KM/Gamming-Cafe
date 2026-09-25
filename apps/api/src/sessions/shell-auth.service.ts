import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Db } from "@arena/db";
import { burnVerify, verifySecret } from "../auth/crypto.js";
import { DB } from "../common/db.module.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import type { Connection } from "../devices/live.js";
import { LIVE_STATUSES, SessionsService } from "./sessions.service.js";
import { timeBalance } from "./time-balance.js";

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
  ) {}

  onModuleInit() {
    this.gateway.handleShell((conn, msg) => (msg.type === "shell_login" ? this.login(conn, msg as any) : this.logout(conn, msg as any)));
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

      if (await t.gamingSession.findFirst({ where: { deviceId: conn.deviceId, status: { in: [...LIVE_STATUSES] } }, select: { id: true } })) {
        return { ok: false, error: "station_in_use", message: "This PC is already in use." };
      }
      if (await t.gamingSession.findFirst({ where: { customerId: customer.id, status: { in: [...LIVE_STATUSES] } }, select: { id: true } })) {
        return { ok: false, error: "already_playing", message: "You're already logged in on another PC." };
      }
      const balance = await timeBalance(t, customer.id);
      if (balance <= 0) return { ok: false, error: "no_time", message: "You have no gaming time left. Buy time at the counter.", timeBalanceMinutes: 0 };

      const s = await this.sessions.start(
        t,
        { deviceId: conn.deviceId, customerId: customer.id, request: { kind: "minutes", minutes: balance }, payment: { method: "TIME_BALANCE" }, idempotencyKey: `shell:${conn.deviceId}:${msg.requestId}` },
        { type: "CUSTOMER", id: customer.id },
      );
      // A replayed requestId returns the earlier (possibly finished) session — never report that as a fresh login.
      if (!(LIVE_STATUSES as readonly string[]).includes(s.status)) return { ok: false, error: "duplicate_request", message: "Please try signing in again." };
      await t.customerSession.create({ data: { organizationId: conn.organizationId, customerId: customer.id, channel: "SHELL", deviceId: conn.deviceId, gamingSessionId: s.id } });
      await t.customer.update({ where: { id: customer.id }, data: { lastVisitAt: new Date() } });
      this.log.log(`customer ${customer.displayName} logged in on ${s.deviceName}`);
      return { ok: true, displayName: customer.displayName, timeBalanceMinutes: balance };
    });
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
