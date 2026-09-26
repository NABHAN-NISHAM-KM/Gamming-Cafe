import { Body, Controller, Get, Headers, HttpCode, HttpException, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { Public } from "../common/decorators.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { hashDisplayToken, hashPairCode } from "./stations.controller.js";

const Pair = z.object({ code: z.string().min(6).max(12) }).strict();
const LIVE = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;

/** Sliding-window attempts per IP (pairing codes are short). */
class Throttle {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  take(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** "Ahmed Al Mansoori" → "Ahmed" — the TV is on the floor for everyone to see. */
const firstName = (name: string | null | undefined) => (name ?? "Guest").trim().split(/\s+/)[0]!.slice(0, 20);

/**
 * TV station displays: a browser on the TV next to a console (or a VR bay's
 * screen) shows who's playing, the countdown and "time's up". The TV pairs
 * once with a one-time code from staff and then holds its own token — it can
 * read only its own linked stations, first names and times. Nothing else.
 */
@Public()
@Controller("display")
export class DisplayController {
  private readonly pairByIp = new Throttle(10, 10 * 60_000);

  constructor(@Inject(DB) private readonly db: Db) {}

  @Post("pair")
  @HttpCode(200)
  async pair(@Body(new ZodPipe(Pair)) body: z.infer<typeof Pair>, @Req() req: Request) {
    if (!this.pairByIp.take(req.ip ?? "?")) throw new HttpException({ error: "too_many_attempts" }, 429);
    const rows = await this.db.global.$queryRaw<Array<{ organization_id: string; device_id: string }>>`SELECT * FROM app.display_by_pair_code(${hashPairCode(body.code)})`;
    const hit = rows[0];
    if (!hit) throw new UnauthorizedException({ error: "invalid_code" });
    const token = randomBytes(32).toString("base64url");
    return this.db.withTenant({ organizationId: hit.organization_id, actorType: "DEVICE", actorId: hit.device_id }, async (t) => {
      // One use: the code is cleared as the token is set.
      const done = await t.device.updateMany({ where: { id: hit.device_id, displayPairCodeHash: hashPairCode(body.code) }, data: { displayTokenHash: hashDisplayToken(token), displayPairCodeHash: null, displayPairExpiresAt: null } });
      if (done.count !== 1) throw new UnauthorizedException({ error: "invalid_code" });
      const d = await t.device.findUniqueOrThrow({ where: { id: hit.device_id }, select: { name: true } });
      await auditAs(t, { type: "DEVICE", id: hit.device_id }, { action: "station.display.paired", entityType: "Device", entityId: hit.device_id });
      return { token, name: d.name };
    });
  }

  @Get("state")
  async state(@Headers("authorization") auth?: string) {
    const token = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(auth ?? "")?.[1];
    if (!token) throw new UnauthorizedException({ error: "display_token_required" });
    const rows = await this.db.global.$queryRaw<Array<{ organization_id: string; device_id: string; branch_id: string }>>`SELECT * FROM app.display_by_token(${hashDisplayToken(token)})`;
    const hit = rows[0];
    if (!hit) throw new UnauthorizedException({ error: "display_unpaired" });
    return this.db.withTenant({ organizationId: hit.organization_id, actorType: "DEVICE", actorId: hit.device_id }, async (t) => {
      const tv = await t.device.findUniqueOrThrow({
        where: { id: hit.device_id },
        select: { name: true, branch: { select: { name: true, brand: { select: { name: true, logoUrl: true } } } } },
      });
      const org = await t.organization.findFirstOrThrow({ select: { displayName: true } });
      const stations = await t.device.findMany({ where: { linkedDisplayId: hit.device_id, isEnabled: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, platform: true, status: true, controllerCount: true } });
      const sessions = await t.gamingSession.findMany({
        where: { deviceId: { in: stations.map((s) => s.id) }, status: { in: [...LIVE] } },
        select: { deviceId: true, status: true, startedAt: true, expiresAt: true, pausedAt: true, paymentTiming: true, players: true, guestLabel: true, customer: { select: { displayName: true } } },
      });
      // Just finished (last 2 minutes): the TV keeps showing "time's up" while the power-off grace runs.
      const ended = await t.gamingSession.findMany({
        where: { deviceId: { in: stations.map((s) => s.id) }, status: "ENDED", endedAt: { gte: new Date(Date.now() - 2 * 60_000) } },
        orderBy: { endedAt: "desc" },
        select: { deviceId: true, endedAt: true, endReason: true },
      });
      return {
        display: tv.name,
        venue: tv.branch.brand?.name ?? org.displayName,
        branch: tv.branch.name,
        logoUrl: tv.branch.brand?.logoUrl ?? null,
        serverTime: new Date().toISOString(),
        stations: stations.map((s) => {
          const live = sessions.find((x) => x.deviceId === s.id);
          return {
            name: s.name, kind: s.kind, platform: s.platform, status: s.status,
            justEnded: !live && ended.find((x) => x.deviceId === s.id) ? { at: ended.find((x) => x.deviceId === s.id)!.endedAt, reason: ended.find((x) => x.deviceId === s.id)!.endReason } : null,
            session: live ? { player: firstName(live.customer?.displayName ?? live.guestLabel), status: live.status, startedAt: live.startedAt, expiresAt: live.expiresAt, paused: !!live.pausedAt, open: live.paymentTiming === "POSTPAID" && !live.expiresAt, players: live.players } : null,
          };
        }),
      };
    });
  }
}
