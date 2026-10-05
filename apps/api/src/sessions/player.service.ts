import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import type { PlayerAction } from "@arena/contracts";
import { Prisma, type Db, type TenantTx } from "@arena/db";
import { burnVerify, verifySecret } from "../auth/crypto.js";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";
import { leaderboard } from "../customers/leaderboard.js";
import { activeRestrictions, minutesLeftToday } from "../customers/restrictions.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import { DeviceRuntimeService } from "../devices/device-runtime.service.js";
import { DeviceHub, type Connection } from "../devices/live.js";
import { challengesFor } from "../loyalty/challenges.js";
import { LoyaltyService } from "../loyalty/loyalty.service.js";
import { PushService } from "../push/push.service.js";
import { balances } from "../wallet/wallet.js";
import { ShellAuthService } from "./shell-auth.service.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";

const LIVE = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;
const SAVE_MAX = 20 * 1024 * 1024;
const CHUNK = 150_000; // base64 of it fits a socket message (256 KB)
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Sliding-window counter per key. */
class Limiter {
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


const Args = {
  redeem: z.object({ rewardId: z.uuid(), key: z.string().min(8).max(64) }),
  inbox_read: z.object({ id: z.uuid() }),
  favorite: z.object({ gameId: z.uuid(), on: z.boolean() }),
  prefs_set: z
    .object({ mouseSpeed: z.number().int().min(1).max(20), enhancePointerPrecision: z.boolean(), volume: z.number().int().min(0).max(100), lang: z.enum(["en", "ar"]), textScale: z.union([z.literal(100), z.literal(115), z.literal(130)]), contrast: z.boolean() })
    .partial(),
  tournament_checkin: z.object({ tournamentId: z.uuid() }),
  verify: z.object({ secret: z.string().min(1).max(256) }),
  summary: z.object({ sessionId: z.uuid() }),
  request_game: z.object({ gameId: z.uuid().nullish(), title: z.string().trim().min(2).max(80) }),
  invite: z.object({ username: z.string().trim().min(3).max(32) }),
  save_get: z.object({ gameId: z.uuid(), offset: z.number().int().min(0).max(SAVE_MAX) }),
  save_put_begin: z.object({ gameId: z.uuid(), size: z.number().int().min(1).max(SAVE_MAX) }),
  save_put_chunk: z.object({ uploadId: z.uuid(), data: z.string().max(210_000) }),
  save_put_end: z.object({ uploadId: z.uuid() }),
} satisfies Partial<Record<PlayerAction, z.ZodType>>;

/**
 * Everything the Gaming Shell (and the agent, for game saves) asks about the
 * player at this PC: wallet and points, rewards, inbox, bookings and
 * tournaments coming up, challenges, leaderboard, favourites and recently
 * played games, settings that follow them, the "away" lock, the session
 * summary, guest → member, asking staff for a game, friends here, and save
 * folders. Requests arrive over the PC's authenticated socket; the player is
 * always the customer of THIS PC's session — never an id from the message.
 */
@Injectable()
export class PlayerService implements OnModuleInit {
  private readonly verifyLimit = new Limiter(5, 60_000);
  private readonly inviteLimit = new Limiter(5, 10 * 60_000);
  private readonly askLimit = new Limiter(3, 10 * 60_000);
  // ponytail: uploads in progress live in this process (one API node per venue).
  private readonly uploads = new Map<string, { deviceId: string; organizationId: string; customerId: string; gameId: string; size: number; parts: Buffer[]; got: number; at: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
    @Inject(LoyaltyService) private readonly loyalty: LoyaltyService,
    @Inject(PushService) private readonly push: PushService,
    @Inject(ShellAuthService) private readonly shellAuth: ShellAuthService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  onModuleInit() {
    this.gateway.handleStation("player_request", (c, m) => this.handle(c, m.action, m.args ?? {}));
  }

  async handle(c: Connection, action: PlayerAction, raw: Record<string, unknown>) {
    const schema = (Args as Record<string, z.ZodType>)[action];
    const parsed = schema ? schema.safeParse(raw) : { success: true as const, data: {} };
    if (!parsed.success) return { ok: false, error: "bad_request" };
    const args = parsed.data as never;
    const afterCommit: Array<() => void | Promise<void>> = [];
    const result = await this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, (t) =>
      requestStore.run({ tx: t, afterCommit, principal: null as never, decision: null, requestId: "shell", ip: null, userAgent: null, reason: null }, async () => {
        const s = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: [...LIVE] } }, select: { id: true, customerId: true, startedAt: true, branchId: true } });
        return this.run(t, c, action, args, s);
      }),
    );
    for (const f of afterCommit) await Promise.resolve(f()).catch(() => undefined);
    return { ok: true, data: result };
  }

  private async run(t: TenantTx, c: Connection, action: PlayerAction, a: any, s: { id: string; customerId: string | null; startedAt: Date | null; branchId: string } | null) {
    const me = () => {
      if (!s?.customerId) throw new ForbiddenException({ error: "sign_in_first", message: "Sign in with an account for that." });
      return s.customerId;
    };
    switch (action) {
      case "overview":
        return this.overview(t, c, s);
      case "rewards":
        return this.loyalty.summary(t, me());
      case "redeem":
        return this.loyalty.redeem(t, me(), a.rewardId, { type: "CUSTOMER", id: me() }, `shell:${me()}:${a.key}`);
      case "inbox":
        return t.notification.findMany({ where: { customerId: me(), channel: "IN_APP", createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, title: true, body: true, data: true, readAt: true, createdAt: true } });
      case "inbox_read":
        await t.notification.updateMany({ where: { id: a.id, customerId: me(), readAt: null }, data: { readAt: new Date(), status: "READ" } });
        return { read: true };
      case "leaderboard":
        return leaderboard(t, me(), 10);
      case "favorite":
        if (a.on) {
          if (!(await t.orgGameSetting.findFirst({ where: { gameId: a.gameId, isEnabled: true }, select: { gameId: true } }))) throw new NotFoundException({ error: "game_not_found" });
          await t.customerFavoriteGame.createMany({ data: [{ organizationId: c.organizationId, customerId: me(), gameId: a.gameId }], skipDuplicates: true });
        } else await t.customerFavoriteGame.deleteMany({ where: { customerId: me(), gameId: a.gameId } });
        return { favorite: a.on };
      case "prefs_set": {
        const cur = (await t.customer.findUniqueOrThrow({ where: { id: me() }, select: { shellPrefs: true } })).shellPrefs as Record<string, unknown>;
        const prefs = { ...cur, ...a };
        await t.customer.update({ where: { id: me() }, data: { shellPrefs: prefs as Prisma.InputJsonValue } });
        return prefs;
      }
      case "verify":
        return this.verify(t, c, me(), a.secret);
      case "summary":
        return this.summary(t, c, a.sessionId);
      case "claim_code":
        if (!s) throw new ConflictException({ error: "no_session" });
        if (s.customerId) throw new ConflictException({ error: "already_member" });
        return this.shellAuth.issueCode(c, "claim");
      case "request_game":
        return this.requestGame(t, c, s, a);
      case "players":
        return this.players(t, c, me());
      case "invite":
        return this.invite(t, c, me(), a.username);
      case "save_get":
        return this.saveGet(t, c, s, a.gameId, a.offset);
      case "save_put_begin":
        return this.saveBegin(t, c, s, a.gameId, a.size);
      case "save_put_chunk":
        return this.saveChunk(c, a.uploadId, a.data);
      case "save_put_end":
        return this.saveEnd(t, c, a.uploadId);
      case "news":
        return this.news(t);
      case "tournament_checkin":
        return this.checkIn(t, me(), a.tournamentId);
    }
  }

  // ── what's on the home widget ─────────────────────────────────────────────

  private async overview(t: TenantTx, c: Connection, s: { id: string; customerId: string | null; startedAt: Date | null } | null) {
    const now = new Date();
    // This PC booked by someone soon: the player should know their session can't run past it.
    const pcBooking = await t.booking.findFirst({
      where: { status: { in: ["CONFIRMED", "PENDING"] }, startsAt: { gt: now, lt: new Date(now.getTime() + 3 * 3_600_000) }, bookingResources: { some: { deviceId: c.deviceId } }, ...(s?.customerId ? { NOT: { customerId: s.customerId } } : {}) },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    });
    const help = s?.startedAt
      ? await t.alert.findFirst({ where: { deviceId: c.deviceId, type: "HELP_REQUESTED", openedAt: { gte: s.startedAt } }, orderBy: { openedAt: "desc" }, select: { status: true, openedAt: true, acknowledgedAt: true, resolvedAt: true } })
      : null;
    const base = { pcBookedAt: pcBooking?.startsAt ?? null, help: help ? { status: help.status, at: help.openedAt } : null };
    if (!s?.customerId) return { ...base, customer: null };

    const id = s.customerId;
    const [cust, b, favs, recent, unread, myBooking, tournaments, challenges] = await Promise.all([
      t.customer.findUniqueOrThrow({ where: { id }, select: { displayName: true, loyaltyPoints: true, shellPrefs: true, showOnLeaderboard: true, membershipTier: { select: { name: true } } } }),
      balances(t, id),
      t.customerFavoriteGame.findMany({ where: { customerId: id }, select: { gameId: true } }),
      t.customerRecentGame.findMany({ where: { customerId: id }, orderBy: { lastPlayedAt: "desc" }, take: 8, select: { gameId: true } }),
      t.notification.count({ where: { customerId: id, channel: "IN_APP", readAt: null } }),
      t.booking.findFirst({ where: { customerId: id, status: "CONFIRMED", startsAt: { gt: now, lt: new Date(now.getTime() + 24 * 3_600_000) } }, orderBy: { startsAt: "asc" }, select: { reference: true, startsAt: true } }),
      t.tournamentPlayer.findMany({
        where: { customerId: id, tournament: { status: { in: ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN", "IN_PROGRESS"] }, startsAt: { lt: new Date(now.getTime() + 24 * 3_600_000) } } },
        select: { tournament: { select: { id: true, name: true, status: true, startsAt: true } } },
        take: 3,
      }),
      challengesFor(t, id, this.push),
    ]);
    const branch = await t.device.findUniqueOrThrow({ where: { id: c.deviceId }, select: { branch: { select: { timezone: true } } } });
    const left = await minutesLeftToday(t, await activeRestrictions(t, id), id, branch.branch.timezone);
    const f = (m: number) => (m / 10 ** b.unit).toFixed(b.unit);
    return {
      ...base,
      customer: {
        name: cust.displayName, tier: cust.membershipTier?.name ?? null, points: cust.loyaltyPoints,
        wallet: { currency: b.currency, total: f(b.cashMinor + b.bonusMinor), bonus: f(b.bonusMinor), frozen: b.frozen }, savedMinutes: b.timeMinutes,
        minutesLeftToday: left, prefs: cust.shellPrefs, visible: cust.showOnLeaderboard, unread,
        favorites: favs.map((x) => x.gameId), recent: recent.map((x) => x.gameId),
        booking: myBooking, tournaments: tournaments.map((x) => x.tournament),
        challenges: challenges.filter((x) => !x.earnedAt).sort((x, y) => y.progress / y.target - x.progress / x.target).slice(0, 2),
      },
    };
  }

  // ── away lock ─────────────────────────────────────────────────────────────

  private async verify(t: TenantTx, c: Connection, customerId: string, secret: string) {
    if (!this.verifyLimit.take(c.deviceId)) return { ok: false, error: "too_many_attempts", message: "Too many tries. Wait a minute or ask staff." };
    const cust = await t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { passwordHash: true, pinHash: true } });
    const ok = (!!cust.passwordHash && (await verifySecret(cust.passwordHash, secret))) || (!!cust.pinHash && (await verifySecret(cust.pinHash, secret)));
    if (!cust.passwordHash && !cust.pinHash) await burnVerify(secret);
    return { ok };
  }

  // ── after log-out ─────────────────────────────────────────────────────────

  /** Time, money and points for a session that just ended on this PC (or is still running). */
  private async summary(t: TenantTx, c: Connection, sessionId: string) {
    const s = await t.gamingSession.findFirst({
      where: { id: sessionId, deviceId: c.deviceId, OR: [{ status: { in: [...LIVE] } }, { endedAt: { gte: new Date(Date.now() - 15 * 60_000) } }] },
      select: { id: true, startedAt: true, endedAt: true, billedSeconds: true, billId: true, customerId: true, currency: true, amountDue: true, bill: { select: { total: true } } },
    });
    if (!s) throw new NotFoundException({ error: "not_found" });
    const minutes = s.billedSeconds ? Math.round(s.billedSeconds / 60) : s.startedAt ? Math.round(((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 60_000) : 0;
    const points = s.customerId
      ? (await t.loyaltyTransaction.aggregate({ where: { customerId: s.customerId, type: "EARN", referenceId: { in: [s.id, ...(s.billId ? [s.billId] : [])] } }, _sum: { points: true } }))._sum.points ?? 0
      : null;
    // What they played this session, and how close they are to their next reward.
    const games = s.customerId && s.startedAt
      ? (await t.customerRecentGame.findMany({ where: { customerId: s.customerId, lastPlayedAt: { gte: s.startedAt } }, orderBy: { lastPlayedAt: "desc" }, take: 5, select: { game: { select: { title: true } } } })).map((g) => g.game.title)
      : [];
    let nextReward: { name: string; pointsNeeded: number } | null = null;
    if (s.customerId) {
      const balance = (await t.customer.findUniqueOrThrow({ where: { id: s.customerId }, select: { loyaltyPoints: true } })).loyaltyPoints;
      const r = await t.loyaltyReward.findFirst({ where: { isActive: true, costPoints: { gt: balance } }, orderBy: { costPoints: "asc" }, select: { name: true, costPoints: true } });
      if (r) nextReward = { name: r.name, pointsNeeded: r.costPoints - balance };
    }
    return { minutes, spent: Number(s.bill?.total ?? s.amountDue).toFixed(2), currency: s.currency, points, games, nextReward };
  }

  // ── game news and tournament check-in ─────────────────────────────────────

  /** The venue's news lines for game tiles, newest first. */
  private async news(t: TenantTx) {
    const rows = await t.orgGameSetting.findMany({ where: { isEnabled: true, news: { not: null }, newsAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { newsAt: "desc" }, take: 30, select: { gameId: true, news: true, newsAt: true } });
    return rows;
  }

  /** Check my team in from the PC: my next tournament's matches and stations, once checked in. */
  private async checkIn(t: TenantTx, customerId: string, tournamentId: string) {
    const me = await t.tournamentPlayer.findFirst({ where: { customerId, tournamentId }, select: { teamId: true, team: { select: { name: true } } } });
    if (!me) throw new NotFoundException({ error: "not_registered", message: "You're not registered for that tournament." });
    await this.tournaments.checkIn(t, me.teamId, { type: "CUSTOMER", id: customerId });
    const next = await t.match.findFirst({
      where: { tournamentId, status: { in: ["PENDING", "SCHEDULED", "READY", "LIVE"] }, OR: [{ teamAId: me.teamId }, { teamBId: me.teamId }] },
      orderBy: [{ round: "asc" }, { position: "asc" }],
      select: { round: true, scheduledAt: true, stationIds: true, teamA: { select: { name: true } }, teamB: { select: { name: true } } },
    });
    const stations = next?.stationIds.length ? (await t.device.findMany({ where: { id: { in: next.stationIds } }, select: { name: true } })).map((d) => d.name) : [];
    return { checkedIn: true, team: me.team.name, next: next ? { round: next.round, at: next.scheduledAt, vs: [next.teamA?.name, next.teamB?.name].filter((n) => n && n !== me.team.name)[0] ?? "TBD", stations } : null };
  }

  // ── asking staff for a game ───────────────────────────────────────────────

  private async requestGame(t: TenantTx, c: Connection, s: { customerId: string | null } | null, a: { gameId?: string | null; title: string }) {
    if (!this.askLimit.take(c.deviceId)) return { sent: false, message: "You've asked a few times already — staff have it." };
    const d = await t.device.findUniqueOrThrow({ where: { id: c.deviceId }, select: { name: true } });
    const who = s?.customerId ? (await t.customer.findUnique({ where: { id: s.customerId }, select: { displayName: true } }))?.displayName : null;
    await this.runtime.openAlert(t, c, "GAME_REQUESTED", "INFO", `${d.name}: ${who ?? "a guest"} would like ${a.title}`, { gameId: a.gameId ?? null, title: a.title, device: d.name, customer: who ?? null }, { renotify: true });
    return { sent: true };
  }

  // ── friends here ──────────────────────────────────────────────────────────

  /** Players who chose to be seen, playing at this branch now: first name, PC and game. */
  private async players(t: TenantTx, c: Connection, customerId: string) {
    const rows = await t.gamingSession.findMany({
      where: { branchId: c.branchId, status: { in: [...LIVE] }, customer: { showOnLeaderboard: true, id: { not: customerId } } },
      select: { deviceId: true, device: { select: { name: true } }, customer: { select: { displayName: true, username: true } } },
      take: 50,
    });
    return rows.map((r) => ({ name: firstName(r.customer!.displayName), username: r.customer!.username, station: r.device.name, game: this.hub.get(r.deviceId)?.currentGame?.title ?? null }));
  }

  private async invite(t: TenantTx, c: Connection, customerId: string, username: string) {
    if (!this.inviteLimit.take(c.deviceId)) throw new ConflictException({ error: "too_many_attempts", message: "Slow down — try again in a few minutes." });
    const to = await t.customer.findFirst({ where: { username: username.toLowerCase(), status: { in: ["ACTIVE", "RESTRICTED"] }, id: { not: customerId } }, select: { id: true } });
    if (!to) throw new NotFoundException({ error: "player_not_found", message: "No player with that username." });
    const [from, d] = await Promise.all([
      t.customer.findUniqueOrThrow({ where: { id: customerId }, select: { displayName: true } }),
      t.device.findUniqueOrThrow({ where: { id: c.deviceId }, select: { name: true, branch: { select: { name: true } } } }),
    ]);
    const title = `${firstName(from.displayName)} invites you to play`;
    const body = `They're on ${d.name} at ${d.branch.name}. Come and join!`;
    const key = `invite:${customerId}:${to.id}:${new Date().toISOString().slice(0, 13)}`; // at most one an hour per pair
    await t.notification.createMany({ data: [{ organizationId: c.organizationId, recipientType: "CUSTOMER", customerId: to.id, channel: "IN_APP", event: "invite", title, body, status: "SENT", sentAt: new Date(), dedupeKey: key }], skipDuplicates: true });
    await this.push.notify(t, { customerId: to.id, event: "invite", title, body, screen: "inbox", dedupeKey: `push:${key}` });
    return { sent: true };
  }

  // ── save folders that follow the player ───────────────────────────────────

  /** The player at this PC now, or the one whose session ended here in the last 10 minutes (saves upload after the game closes). */
  private async savePlayer(t: TenantTx, c: Connection, s: { customerId: string | null } | null) {
    if (s?.customerId) return s.customerId;
    const last = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, endedAt: { gte: new Date(Date.now() - 10 * 60_000) } }, orderBy: { endedAt: "desc" }, select: { customerId: true } });
    if (!last?.customerId) throw new ForbiddenException({ error: "sign_in_first" });
    return last.customerId;
  }

  private async saveGet(t: TenantTx, c: Connection, s: { customerId: string | null } | null, gameId: string, offset: number) {
    const customerId = await this.savePlayer(t, c, s);
    const [row] = await t.$queryRaw<Array<{ size: number; updated: Date; part: Buffer }>>`
      SELECT "sizeBytes" AS size, "updatedAt" AS updated, substring("data" from ${offset + 1}::int for ${CHUNK}::int) AS part
        FROM "GameSave" WHERE "customerId" = ${customerId}::uuid AND "gameId" = ${gameId}::uuid`;
    if (!row) return { exists: false };
    return { exists: true, size: row.size, updatedAt: row.updated, offset, data: Buffer.from(row.part).toString("base64") };
  }

  private async saveBegin(t: TenantTx, c: Connection, s: { customerId: string | null } | null, gameId: string, size: number) {
    const customerId = await this.savePlayer(t, c, s);
    const setting = await t.orgGameSetting.findFirst({ where: { gameId, isEnabled: true }, select: { savePaths: true } });
    if (!setting?.savePaths.length) throw new ConflictException({ error: "saves_off" });
    for (const [k, u] of this.uploads) if (u.deviceId === c.deviceId || Date.now() - u.at > 10 * 60_000) this.uploads.delete(k);
    const uploadId = crypto.randomUUID();
    this.uploads.set(uploadId, { deviceId: c.deviceId, organizationId: c.organizationId, customerId, gameId, size, parts: [], got: 0, at: Date.now() });
    return { uploadId, chunk: CHUNK };
  }

  private saveChunk(c: Connection, uploadId: string, data: string) {
    const u = this.uploads.get(uploadId);
    if (!u || u.deviceId !== c.deviceId) throw new NotFoundException({ error: "upload_not_found" });
    const part = Buffer.from(data, "base64");
    if (u.got + part.length > u.size) {
      this.uploads.delete(uploadId);
      throw new ConflictException({ error: "too_big" });
    }
    u.parts.push(part);
    u.got += part.length;
    return { got: u.got };
  }

  private async saveEnd(t: TenantTx, c: Connection, uploadId: string) {
    const u = this.uploads.get(uploadId);
    if (!u || u.deviceId !== c.deviceId) throw new NotFoundException({ error: "upload_not_found" });
    this.uploads.delete(uploadId);
    if (u.got !== u.size) throw new ConflictException({ error: "incomplete" });
    const data = Buffer.concat(u.parts);
    if (data.subarray(0, 4).toString("hex") !== "504b0304" && data.subarray(0, 4).toString("hex") !== "504b0506") throw new ConflictException({ error: "not_a_zip" });
    await t.gameSave.upsert({
      where: { customerId_gameId: { customerId: u.customerId, gameId: u.gameId } },
      create: { organizationId: u.organizationId, customerId: u.customerId, gameId: u.gameId, data, sizeBytes: data.length },
      update: { data, sizeBytes: data.length, updatedAt: new Date() },
    });
    return { saved: true, size: data.length };
  }

}
