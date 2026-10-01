import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Db } from "@arena/db";
import { DB } from "../common/db.module.js";
import { CommandsService } from "../devices/commands.service.js";
import { DeviceRuntimeService } from "../devices/device-runtime.service.js";
import type { Connection } from "../devices/live.js";
import { LiveBus } from "../devices/live.js";
import { activeRestrictions, playerLimits } from "../customers/restrictions.js";
import { ageOn, ENDING_SOON_MINUTES, LIVE_STATUSES, SessionsService, WARNING_MINUTES } from "./sessions.service.js";

const SYSTEM = { type: "SYSTEM" as const, id: null };

/**
 * The server-authoritative session clock. Every SWEEP_MS it asks the database
 * which live sessions expire within 31 minutes (one indexed query across all
 * tenants via a definer function), then per session:
 *   · records crossed warning thresholds (30/15/10/5/1 min) and streams them,
 *   · marks the station "Ending soon" at ≤ 5 min,
 *   · ends the session at expiry — whether or not the PC is connected.
 * Because the truth is `expiresAt` in the database, restarting the API, the
 * agent or the shell never loses or extends time. Ending is idempotent, so two
 * API instances sweeping at once cannot double-bill.
 */
@Injectable()
export class SessionTimerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("SessionTimer");
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly sweepMs = Number(process.env["SESSION_SWEEP_MS"] ?? 2000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref();
    void this.sweep(); // catch up immediately after a restart
    this.runtime.onConnected((c, hello) => this.syncDevice(c, hello.activeSessionId ?? null));
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.db.global.$queryRaw<Array<{ organization_id: string; session_id: string; device_id: string; expires_at: Date; warnings_sent: number[] }>>`
        SELECT * FROM app.session_timers(interval '31 minutes')`;
      const now = Date.now();
      for (const row of due) {
        const remainingMs = row.expires_at.getTime() - now;
        try {
          if (remainingMs <= 0) {
            await this.db.withTenant({ organizationId: row.organization_id, actorType: "SYSTEM", actorId: null }, (t) => this.sessions.end(t, row.session_id, "EXPIRED", SYSTEM));
            this.log.log(`session ${row.session_id} expired`);
            continue;
          }
          const crossed = WARNING_MINUTES.filter((m) => remainingMs <= m * 60_000 && !row.warnings_sent.includes(m));
          const endingSoon = remainingMs <= ENDING_SOON_MINUTES * 60_000;
          if (!crossed.length && !endingSoon) continue;
          await this.db.withTenant({ organizationId: row.organization_id, actorType: "SYSTEM", actorId: null }, async (t) => {
            if (crossed.length) {
              await t.gamingSession.updateMany({ where: { id: row.session_id, status: { in: [...LIVE_STATUSES] } }, data: { warningsSent: { push: crossed } } });
            }
            if (endingSoon) {
              const moved = await t.device.updateMany({ where: { id: row.device_id, status: "OCCUPIED" }, data: { status: "SESSION_ENDING" } });
              if (moved.count) await this.sessions.publishDevice(t, row.device_id);
            }
          });
        } catch (e) {
          this.log.error(`timer for session ${row.session_id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      this.log.error(`sweep failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * On (re)connect the agent reports which session it believes is running.
   * If that disagrees with the server, the server re-sends a signed START or
   * END — so a restarted shell/agent can never keep a PC unlocked for free.
   */
  private async syncDevice(c: Connection, agentSessionId: string | null) {
    await this.db.withTenant({ organizationId: c.organizationId, actorType: "SYSTEM", actorId: null }, async (t) => {
      const live = await t.gamingSession.findFirst({
        where: { deviceId: c.deviceId, status: { in: [...LIVE_STATUSES] } },
        include: { customer: { select: { displayName: true, dateOfBirth: true, membershipTier: { select: { name: true } } } } },
      });
      if (live && live.id !== agentSessionId) {
        await this.commands.issue(t, {
          deviceId: c.deviceId,
          type: "START_SESSION",
          payload: await (async () => {
            const limits = live.customerId ? playerLimits(await activeRestrictions(t, live.customerId), ageOn(live.customer?.dateOfBirth)) : { age: null, blockedGameIds: [] };
            return this.sessions.startPayload(live, live.customer?.displayName ?? live.guestLabel ?? "Guest", live.customer?.membershipTier?.name ?? null, limits.age, limits.blockedGameIds);
          })(),
          requestedBy: { type: "SYSTEM", id: null },
        });
      } else if (!live && agentSessionId) {
        const device = await t.device.findUniqueOrThrow({ where: { id: c.deviceId }, select: { postSessionAction: true } });
        await this.commands.issue(t, {
          deviceId: c.deviceId,
          type: "END_SESSION",
          payload: { sessionId: agentSessionId, reason: "SYNC", postSessionAction: device.postSessionAction, serverTime: new Date().toISOString() },
          requestedBy: { type: "SYSTEM", id: null },
        });
      }
    });
  }
}
