import { ConflictException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Db, TenantTx } from "@arena/db";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import type { Connection } from "../devices/live.js";
import { walletView } from "../wallet/wallet.js";
import type { PlanDef } from "./pricing.js";
import { SessionsService } from "./sessions.service.js";

/** Saved (prepaid) minutes the customer may move into the running session in one go. */
export const SAVED_TIME_STEPS = [30, 60, 120] as const;

/**
 * "Add time" on the Gaming Shell: the signed-in customer extends their own
 * running session, with a package of the session's rate paid from their
 * wallet, or with their saved (prepaid) minutes. Guests can't (no wallet);
 * they ask at the counter. The extension itself is SessionsService.extend,
 * the same path staff use, recorded as source CUSTOMER_SHELL.
 */
@Injectable()
export class ShellTimeService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  onModuleInit() {
    this.gateway.handleStation("time_offers", (c) => this.offers(c));
    this.gateway.handleStation("buy_time", (c, m) => this.buy(c, m.requestId, m.packageId ?? null, m.savedMinutes ?? null));
  }

  offers(c: Connection) {
    return this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, (t) => this.offersFor(t, { deviceId: c.deviceId }));
  }

  /** What the running session (found by its PC, or by its customer from the app) can be extended with. */
  async offersFor(t: TenantTx, where: { deviceId: string } | { customerId: string }) {
    {
      const s = await t.gamingSession.findFirst({ where: { ...where, status: { in: ["ACTIVE", "ENDING"] } }, select: { customerId: true, expiresAt: true, currency: true, rateSnapshot: true } });
      if (!s?.expiresAt) return { ok: false, error: "not_extendable", message: "This session can't be extended here." };
      if (!s.customerId) return { ok: false, error: "guest", message: "Guest sessions are extended at the counter." };
      const plan = (s.rateSnapshot as { plan: PlanDef | null; minorUnit?: number }).plan;
      const unit = (s.rateSnapshot as { minorUnit?: number }).minorUnit ?? 2;
      const wallet = await walletView(t, s.customerId, 0);
      return {
        ok: true,
        currency: wallet.currency,
        wallet: wallet.frozen ? null : wallet.total,
        savedMinutes: wallet.timeMinutes,
        savedSteps: SAVED_TIME_STEPS.filter((m) => m <= wallet.timeMinutes),
        packages: (plan?.packages ?? [])
          .filter((p) => p.isActive)
          .map((p) => ({ id: p.id, name: p.name, minutes: p.durationMinutes + p.bonusMinutes, bonusMinutes: p.bonusMinutes, price: (p.priceMinor / 10 ** unit).toFixed(unit) })),
      };
    }
  }

  async buy(c: Connection, requestId: string, packageId: string | null, savedMinutes: number | null) {
    const afterCommit: Array<() => void | Promise<void>> = [];
    const result = await this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, (t) =>
      requestStore.run({ tx: t, afterCommit, principal: null as never, decision: null, requestId, ip: null, userAgent: null, reason: null }, () =>
        this.buyFor(t, { deviceId: c.deviceId }, packageId, savedMinutes, `shell:${c.deviceId}:${requestId}`),
      ),
    );
    for (const fn of afterCommit) await Promise.resolve(fn()).catch(() => undefined);
    return result;
  }

  /** Extends the running session with a package (paid from the wallet) or saved minutes. Must run inside a request store. */
  async buyFor(t: TenantTx, where: { deviceId: string } | { customerId: string }, packageId: string | null, savedMinutes: number | null, idempotencyKey: string) {
    const s = await t.gamingSession.findFirst({ where: { ...where, status: { in: ["ACTIVE", "ENDING"] } }, select: { id: true, customerId: true } });
    if (!s) throw new ConflictException({ error: "no_session", message: "There's no session to add time to." });
    if (!s.customerId) throw new ConflictException({ error: "guest", message: "Guest sessions are extended at the counter." });
    if (savedMinutes !== null && !(SAVED_TIME_STEPS as readonly number[]).includes(savedMinutes)) throw new ConflictException({ error: "bad_minutes" });
    if (savedMinutes === null && !packageId) throw new ConflictException({ error: "package_required" });
    const actor = { type: "CUSTOMER" as const, id: s.customerId };
    const v = savedMinutes !== null
      ? await this.sessions.extend(t, s.id, { minutes: savedMinutes, payment: { method: "TIME_BALANCE" }, idempotencyKey }, actor)
      : await this.sessions.extend(t, s.id, { packageId: packageId!, payment: { method: "WALLET" }, idempotencyKey }, actor);
    return { ok: true, expiresAt: v.expiresAt };
  }
}

