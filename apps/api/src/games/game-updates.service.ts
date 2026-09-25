import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Db, TenantTx } from "@arena/db";
import type { UpdateGamePayload } from "@arena/contracts";
import { DB } from "../common/db.module.js";
import { CommandsService } from "../devices/commands.service.js";
import { DeviceHub, LiveBus } from "../devices/live.js";
import { LIVE_STATUSES } from "../sessions/sessions.service.js";
import { UPDATING } from "./inventory.service.js";
import { launchSpec } from "./station-config.service.js";

const IN_FLIGHT = ["PENDING", "SENT", "RECEIVED", "EXECUTING"] as const;
/** A PC that accepted an update but never reported it finished is given up on after this. */
const STALL_MS = 2 * 60 * 60_000;
/** PCs still offline this long after the job started are reported and the job closes (re-schedule to catch them). */
const OFFLINE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Rolls a game update across a branch: only PCs that report "update
 * required", only while they are idle (no live session — a customer is never
 * interrupted), at most `maxConcurrent` at a time. The launcher on each PC
 * does the actual download; a PC counts as done when its next scan reports
 * the game up to date. Runs for all tenants in the background, like the
 * session clock.
 */
@Injectable()
export class GameUpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("GameUpdates");
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly sweepMs = Number(process.env["UPDATE_SWEEP_MS"] ?? 10_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.db.global.$queryRaw<Array<{ organization_id: string; job_id: string }>>`SELECT * FROM app.update_jobs_due()`;
      for (const row of due) {
        await this.db
          .withTenant({ organizationId: row.organization_id, actorType: "SYSTEM", actorId: null }, (t) => this.advance(t, row.job_id))
          .catch((e) => this.log.error(`job ${row.job_id}: ${e instanceof Error ? e.message : e}`));
      }
    } finally {
      this.running = false;
    }
  }

  /** One step of a job. Idempotent: safe to call as often as you like. */
  async advance(t: TenantTx, jobId: string) {
    let job = await t.gameUpdateJob.findUniqueOrThrow({ where: { id: jobId }, include: { game: { include: { launcher: { select: { key: true } } } } } });
    if (job.status !== "SCHEDULED" && job.status !== "RUNNING") return job;
    const launch = launchSpec(job.game);
    if (!launch || launch.kind === "PATH") {
      return this.finish(t, job.id, "FAILED", job.devicesDone, "This game has no launcher-managed updates (Steam or Epic); update the master image instead.");
    }

    const outstanding = await t.gameInstallation.findMany({
      where: { gameId: job.gameId, status: { in: [...UPDATING] }, device: { branchId: job.branchId, isEnabled: true } },
      select: { id: true, deviceId: true, status: true },
    });
    if (job.status === "SCHEDULED") {
      job = await t.gameUpdateJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date(), devicesTotal: outstanding.length }, include: { game: { include: { launcher: { select: { key: true } } } } } });
      this.publish(job);
    }

    // Per-PC state from this job's commands (batchId = job id).
    const cmds = await t.deviceCommand.findMany({ where: { batchId: job.id, type: "UPDATE_GAME" }, orderBy: { issuedAt: "desc" }, select: { deviceId: true, status: true, completedAt: true } });
    const last = new Map<string, (typeof cmds)[number]>();
    for (const c of cmds) if (!last.has(c.deviceId)) last.set(c.deviceId, c);

    const now = Date.now();
    const failed = new Set<string>();
    let busy = 0;
    const eligible: string[] = [];
    for (const inst of outstanding) {
      const c = last.get(inst.deviceId);
      if (c?.status === "FAILED") failed.add(inst.deviceId);
      else if (c && (IN_FLIGHT as readonly string[]).includes(c.status)) busy++;
      else if (c?.status === "SUCCEEDED") {
        if (c.completedAt && now - c.completedAt.getTime() > STALL_MS) failed.add(inst.deviceId);
        else busy++; // launcher is downloading; the PC's next scan will say when it's done
      } else eligible.push(inst.deviceId); // never tried, or the command expired while the PC was off
    }

    const remaining = outstanding.length - failed.size;
    const done = Math.max(0, job.devicesTotal - outstanding.length);
    if (remaining === 0) {
      const status = failed.size && done === 0 ? "FAILED" : "COMPLETED";
      return this.finish(t, job.id, status, done, failed.size ? `${failed.size} PC(s) could not update — check them in Computers.` : null);
    }

    // Only offline PCs left, for a whole day: close the job and say which.
    const offline = eligible.filter((d) => !this.hub.isOnline(d));
    if (busy === 0 && offline.length === remaining && job.startedAt && now - job.startedAt.getTime() > OFFLINE_WINDOW_MS) {
      return this.finish(t, job.id, done ? "COMPLETED" : "FAILED", done, `${offline.length} PC(s) stayed offline and were not updated.`);
    }

    // Start more PCs: online and idle only.
    const slots = Math.max(0, job.maxConcurrent - busy);
    if (slots > 0 && eligible.length) {
      const live = new Set((await t.gamingSession.findMany({ where: { deviceId: { in: eligible }, status: { in: [...LIVE_STATUSES] } }, select: { deviceId: true } })).map((s) => s.deviceId));
      const ready = eligible.filter((d) => this.hub.isOnline(d) && !live.has(d)).slice(0, slots);
      for (const deviceId of ready) {
        const payload: UpdateGamePayload = { jobId: job.id, gameId: job.gameId, title: job.game.title, launch };
        await this.commands.issue(t, { deviceId, type: "UPDATE_GAME", payload: payload as unknown as Record<string, unknown>, requestedBy: { type: "SYSTEM", id: null }, batchId: job.id });
        await t.gameInstallation.updateMany({ where: { deviceId, gameId: job.gameId, status: "UPDATE_REQUIRED" }, data: { status: "QUEUED" } });
      }
    }

    const progressPct = job.devicesTotal ? Math.round((done / job.devicesTotal) * 1000) / 10 : 0;
    if (progressPct !== job.progressPct || done !== job.devicesDone) {
      job = await t.gameUpdateJob.update({ where: { id: job.id }, data: { devicesDone: done, progressPct }, include: { game: { include: { launcher: { select: { key: true } } } } } });
      this.publish(job);
    }
    return job;
  }

  private async finish(t: TenantTx, jobId: string, status: "COMPLETED" | "FAILED", done: number, error: string | null) {
    const job = await t.gameUpdateJob.update({
      where: { id: jobId },
      data: { status, devicesDone: done, progressPct: status === "COMPLETED" && !error ? 100 : undefined, completedAt: new Date(), error },
      include: { game: { include: { launcher: { select: { key: true } } } } },
    });
    this.publish(job);
    this.log.log(`update job ${jobId} ${status}${error ? `: ${error}` : ""}`);
    return job;
  }

  private publish(job: { id: string; organizationId: string; branchId: string; gameId: string; status: string; progressPct: number; devicesDone: number; devicesTotal: number; error: string | null }) {
    const { id, organizationId, branchId, gameId, status, progressPct, devicesDone, devicesTotal, error } = job;
    this.bus.publish(organizationId, branchId, { type: "game_update", job: { id, gameId, status, progressPct, devicesDone, devicesTotal, error } });
  }
}
