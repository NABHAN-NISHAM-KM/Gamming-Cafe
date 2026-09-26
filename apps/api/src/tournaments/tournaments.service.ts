import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import { Prisma, type TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { earnEvent } from "../loyalty/points.js";
import { minorUnit } from "../pos/bills.js";
import { OrdersService } from "../pos/orders.service.js";
import { moveMoney, toMinor } from "../wallet/wallet.js";
import { BracketError, materialize, pairSwiss, placements, planBracket, report, settle, standings, swissRoundsFor, type Format, type LiveMatch, type Played } from "./brackets.js";

type Actor = { type: "EMPLOYEE"; id: string } | { type: "CUSTOMER"; id: string };
const ACTIVE_ENTRY = ["REGISTERED", "PAYMENT_PENDING", "CONFIRMED", "CHECKED_IN"] as const;
const slug = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${randomBytes(2).toString("hex")}`;

export interface NewTournament {
  branchId: string;
  name: string;
  gameId?: string | null;
  customGameName?: string | null;
  description?: string | null;
  format: Format;
  teamSize: number;
  maxTeams: number;
  minTeams: number;
  entryFee: string;
  prizePool: string;
  prizeDistribution: Array<{ place: number; amount: number }>;
  rules?: string | null;
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  startsAt: Date;
  isPublic: boolean;
  swissRounds?: number | null;
  prizesToWallet: boolean;
}

/**
 * Tournaments: registration (with the entry fee charged through the POS, so
 * it's on a bill with VAT and can be refunded), check-in, seeding, the
 * bracket (single/double elimination, round robin, league, Swiss), results
 * that move teams through it, and — at the end — placements, prize money to
 * the winners' wallets and loyalty points for everyone who played.
 */
@Injectable()
export class TournamentsService {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  // ── setup ────────────────────────────────────────────────────────────────

  async create(t: TenantTx, x: NewTournament, actor: { id: string }) {
    const branch = await t.branch.findUnique({ where: { id: x.branchId }, select: { id: true, organizationId: true, currency: true } });
    if (!branch) throw new NotFoundException({ error: "branch_not_found" });
    if (x.format === "DOUBLE_ELIMINATION" && x.minTeams < 4) throw new ConflictException({ error: "too_few_teams", hint: "Double elimination needs at least four teams." });
    this.checkPrizes(x.prizeDistribution, x.prizePool);
    let entryFeeProductId: string | null = null;
    if (Number(x.entryFee) > 0) entryFeeProductId = await this.feeProduct(t, branch.organizationId, x.name, x.entryFee, branch.currency);
    const tr = await t.tournament.create({
      data: {
        organizationId: branch.organizationId, branchId: branch.id, gameId: x.gameId ?? null, customGameName: x.customGameName ?? null, name: x.name, slug: slug(x.name), description: x.description ?? null,
        format: x.format, teamSize: x.teamSize, maxTeams: x.maxTeams, minTeams: x.minTeams, entryFee: x.entryFee, entryFeeProductId, prizePool: x.prizePool,
        prizeDistribution: x.prizeDistribution as unknown as Prisma.InputJsonValue, currency: branch.currency, rules: x.rules ?? null, registrationOpensAt: x.registrationOpensAt ?? null,
        registrationClosesAt: x.registrationClosesAt ?? null, startsAt: x.startsAt, isPublic: x.isPublic, swissRounds: x.swissRounds ?? null, prizesToWallet: x.prizesToWallet, createdById: actor.id,
      },
    });
    await auditAs(t, { type: "EMPLOYEE", id: actor.id }, { action: "tournament.create", entityType: "Tournament", entityId: tr.id, branchId: branch.id, after: { name: x.name, format: x.format, entryFee: x.entryFee, prizePool: x.prizePool } });
    return this.view(t, tr.id);
  }

  private checkPrizes(d: Array<{ place: number; amount: number }>, pool: string) {
    const places = new Set(d.map((p) => p.place));
    if (places.size !== d.length) throw new HttpException({ error: "bad_prizes", hint: "Each place once." }, 400);
    const total = d.reduce((a, p) => a + p.amount, 0);
    if (total > Number(pool) + 1e-9) throw new HttpException({ error: "bad_prizes", hint: "Prizes add up to more than the prize pool." }, 400);
  }

  /** The entry fee is a hidden service product, so it's charged, taxed and refunded like any sale. */
  private async feeProduct(t: TenantTx, organizationId: string, name: string, fee: string, currency: string) {
    const cat = (await t.productCategory.findFirst({ where: { name: "Services" }, select: { id: true } })) ?? (await t.productCategory.create({ data: { organizationId, name: "Services", sortOrder: 90, showInShell: false } }));
    const p = await t.product.create({
      data: { organizationId, categoryId: cat.id, sku: `TRN-${randomBytes(3).toString("hex").toUpperCase()}`, name: `Tournament entry — ${name}`.slice(0, 80), type: "SERVICE", price: fee, currency, taxAppliesTo: "SERVICE", availableInShell: false, availableOnline: false },
    });
    return p.id;
  }

  async setStatus(t: TenantTx, id: string, to: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED" | "CHECK_IN" | "CANCELLED", actor: { id: string }, reason?: string | null) {
    const tr = await t.tournament.findUnique({ where: { id } });
    if (!tr) throw new NotFoundException({ error: "tournament_not_found" });
    const allowed: Record<string, string[]> = {
      REGISTRATION_OPEN: ["DRAFT", "REGISTRATION_CLOSED"],
      REGISTRATION_CLOSED: ["REGISTRATION_OPEN", "CHECK_IN"],
      CHECK_IN: ["REGISTRATION_OPEN", "REGISTRATION_CLOSED"],
      CANCELLED: ["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN", "IN_PROGRESS"],
    };
    if (!allowed[to]!.includes(tr.status)) throw new ConflictException({ error: "bad_tournament_status", status: tr.status });
    await t.tournament.update({ where: { id }, data: { status: to, ...(to === "CANCELLED" ? { endsAt: new Date() } : {}) } });
    if (to === "CANCELLED") {
      // Everyone who paid gets the entry fee back in their wallet.
      const paid = await t.team.findMany({ where: { tournamentId: id, paymentId: { not: null }, status: { in: [...ACTIVE_ENTRY] } }, select: { id: true } });
      for (const team of paid) await this.refundEntry(t, team.id, `Tournament cancelled${reason ? `: ${reason}` : ""}`, actor);
      await t.match.updateMany({ where: { tournamentId: id, status: { notIn: ["COMPLETED", "WALKOVER"] } }, data: { status: "CANCELLED" } });
    }
    await auditAs(t, { type: "EMPLOYEE", id: actor.id }, { action: `tournament.${to.toLowerCase()}`, entityType: "Tournament", entityId: id, branchId: tr.branchId, after: { reason: reason ?? null } });
    return this.view(t, id);
  }

  // ── registration ─────────────────────────────────────────────────────────

  /**
   * Register a team (a solo player is a team of one). Every player must have
   * an account; nobody can be in two teams. A fee is paid up front — by staff
   * at the counter (cash/card/wallet) or from the captain's wallet in the app.
   */
  async register(t: TenantTx, id: string, x: { teamName: string; tag?: string | null; captainId: string; playerIds: string[]; payment?: { method: "CASH" | "CARD" | "WALLET" } | null; idempotencyKey: string }, actor: Actor) {
    const tr = await t.tournament.findUnique({ where: { id } });
    if (!tr) throw new NotFoundException({ error: "tournament_not_found" });
    if (tr.status !== "REGISTRATION_OPEN") throw new ConflictException({ error: "registration_closed" });
    const now = new Date();
    if ((tr.registrationOpensAt && tr.registrationOpensAt > now) || (tr.registrationClosesAt && tr.registrationClosesAt < now)) throw new ConflictException({ error: "registration_closed" });
    const players = [...new Set([x.captainId, ...x.playerIds])];
    if (players.length !== tr.teamSize) throw new ConflictException({ error: "wrong_team_size", teamSize: tr.teamSize });
    const found = await t.customer.findMany({ where: { id: { in: players }, status: "ACTIVE" }, select: { id: true } });
    if (found.length !== players.length) throw new NotFoundException({ error: "player_not_found" });
    const taken = await t.tournamentPlayer.findFirst({ where: { tournamentId: id, customerId: { in: players }, team: { status: { in: [...ACTIVE_ENTRY] } } }, include: { customer: { select: { displayName: true } } } });
    if (taken) throw new ConflictException({ error: "already_registered", player: taken.customer.displayName });
    // Serialise registrations for this tournament so the last places can't be oversold.
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tournament:${id}`}))`;
    const entered = await t.team.count({ where: { tournamentId: id, status: { in: [...ACTIVE_ENTRY] } } });
    if (entered >= tr.maxTeams) throw new ConflictException({ error: "tournament_full" });
    if (await t.team.findFirst({ where: { tournamentId: id, name: x.teamName } })) throw new ConflictException({ error: "team_name_taken" });

    const fee = Number(tr.entryFee) > 0;
    if (fee && !x.payment) throw new ConflictException({ error: "payment_required", entryFee: tr.entryFee.toFixed(2) });
    if (actor.type === "CUSTOMER" && x.payment && x.payment.method !== "WALLET") throw new ConflictException({ error: "pay_from_wallet" });
    let paymentId: string | null = null;
    if (fee) {
      const o = await this.orders.place(
        t,
        { branchId: tr.branchId, channel: actor.type === "CUSTOMER" ? "WEB" : "POS", type: "COUNTER", internal: true, customerId: x.captainId, lines: [{ productId: tr.entryFeeProductId!, quantity: 1, notes: `Team ${x.teamName}` }], payments: [{ method: x.payment!.method }], idempotencyKey: `trn:${id}:${x.idempotencyKey}` },
        actor,
      );
      paymentId = (await t.payment.findFirst({ where: { orderId: o.id, status: "CAPTURED" }, select: { id: true } }))?.id ?? null;
    }
    const team = await t.team.create({
      data: {
        organizationId: tr.organizationId, tournamentId: id, name: x.teamName, tag: x.tag ?? null, captainId: x.captainId, status: "CONFIRMED", paymentId,
        tournamentPlayers: { create: players.map((customerId) => ({ tournamentId: id, customerId })) },
      },
    });
    await auditAs(t, actor, { action: "tournament.register", entityType: "Tournament", entityId: id, branchId: tr.branchId, after: { team: x.teamName, players: players.length, paid: fee } });
    return { teamId: team.id, status: team.status };
  }

  async withdraw(t: TenantTx, teamId: string, reason: string, actor: { id: string }) {
    const team = await t.team.findUnique({ where: { id: teamId }, include: { tournament: { select: { status: true, branchId: true } } } });
    if (!team) throw new NotFoundException({ error: "team_not_found" });
    if (["IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(team.tournament.status)) throw new ConflictException({ error: "tournament_started" });
    if (!(ACTIVE_ENTRY as readonly string[]).includes(team.status)) throw new ConflictException({ error: "not_entered" });
    if (team.paymentId) await this.refundEntry(t, team.id, `Withdrawn: ${reason}`, actor);
    await t.team.update({ where: { id: teamId }, data: { status: "WITHDRAWN" } });
    await auditAs(t, { type: "EMPLOYEE", id: actor.id }, { action: "tournament.withdraw", entityType: "Team", entityId: teamId, branchId: team.tournament.branchId, after: { reason } });
  }

  private async refundEntry(t: TenantTx, teamId: string, reason: string, actor: { id: string }) {
    const team = await t.team.findUniqueOrThrow({ where: { id: teamId }, select: { paymentId: true } });
    if (!team.paymentId) return;
    const p = await t.payment.findUniqueOrThrow({ where: { id: team.paymentId }, select: { amount: true, refundedAmount: true } });
    const left = p.amount.sub(p.refundedAmount);
    if (left.lte(0)) return;
    await this.orders.refund(t, team.paymentId, { amount: left.toFixed(2), destination: "WALLET", reason: reason.slice(0, 200), idempotencyKey: `trn-refund:${teamId}` }, { type: "EMPLOYEE", id: actor.id });
  }

  async checkIn(t: TenantTx, teamId: string, actor: Actor) {
    const team = await t.team.findUnique({ where: { id: teamId }, include: { tournament: { select: { status: true, branchId: true } } } });
    if (!team) throw new NotFoundException({ error: "team_not_found" });
    if (!["CHECK_IN", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(team.tournament.status)) throw new ConflictException({ error: "check_in_closed" });
    if (team.status !== "CONFIRMED" && team.status !== "CHECKED_IN") throw new ConflictException({ error: "not_confirmed" });
    await t.team.update({ where: { id: teamId }, data: { status: "CHECKED_IN" } });
    await t.tournamentPlayer.updateMany({ where: { teamId }, data: { checkedInAt: new Date() } });
    await auditAs(t, actor, { action: "tournament.check_in", entityType: "Team", entityId: teamId, branchId: team.tournament.branchId });
  }

  // ── bracket ──────────────────────────────────────────────────────────────

  /**
   * Seed and build the bracket. If anyone checked in, only checked-in teams
   * play (the rest are marked withdrawn). Seeds come from `seed` where staff
   * set one, then a fair random draw.
   */
  async start(t: TenantTx, id: string, actor: { id: string }) {
    const tr = await t.tournament.findUnique({ where: { id } });
    if (!tr) throw new NotFoundException({ error: "tournament_not_found" });
    if (!["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN"].includes(tr.status)) throw new ConflictException({ error: "bad_tournament_status", status: tr.status });
    let teams = await t.team.findMany({ where: { tournamentId: id, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, select: { id: true, seed: true, status: true } });
    if (teams.some((x) => x.status === "CHECKED_IN")) {
      const absent = teams.filter((x) => x.status !== "CHECKED_IN").map((x) => x.id);
      if (absent.length) await t.team.updateMany({ where: { id: { in: absent } }, data: { status: "WITHDRAWN" } });
      teams = teams.filter((x) => x.status === "CHECKED_IN");
    }
    if (teams.length < tr.minTeams) throw new ConflictException({ error: "too_few_teams", teams: teams.length, minTeams: tr.minTeams });
    const seeded = teams.filter((x) => x.seed !== null).sort((a, b) => a.seed! - b.seed!);
    const rest = teams.filter((x) => x.seed === null);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    const order = [...seeded, ...rest].map((x) => x.id);
    let plan;
    try {
      plan = planBracket(tr.format, order.length, { swissRounds: tr.swissRounds ?? undefined });
    } catch (e) {
      if (e instanceof BracketError) throw new ConflictException({ error: e.code, hint: e.message });
      throw e;
    }
    for (const [i, teamId] of order.entries()) await t.team.update({ where: { id: teamId }, data: { seed: i + 1 } });
    const live = materialize(plan, order);
    settle(live);
    await this.persist(t, tr.organizationId, id, live, true);
    await t.tournament.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    await auditAs(t, { type: "EMPLOYEE", id: actor.id }, { action: "tournament.start", entityType: "Tournament", entityId: id, branchId: tr.branchId, after: { teams: order.length, matches: live.length } });
    await this.maybeFinish(t, id, actor);
    return this.view(t, id);
  }

  /** Write matches: new ones are created (then linked by key), existing ones updated. */
  private async persist(t: TenantTx, organizationId: string, tournamentId: string, live: LiveMatch[], create: boolean) {
    const ids = new Map<string, string>();
    if (create) {
      for (const m of live) {
        const row = await t.match.create({
          data: {
            organizationId, tournamentId, bracket: m.bracket, round: m.round, position: m.position, teamAId: m.teamA, teamBId: m.teamB, winnerTeamId: m.winner, status: m.status,
            byeA: !!m.byeA, byeB: !!m.byeB, nextSlot: m.next?.slot ?? null, loserNextSlot: m.loserNext?.slot ?? null, completedAt: m.status === "WALKOVER" ? new Date() : null,
          },
          select: { id: true },
        });
        ids.set(m.key, row.id);
      }
      for (const m of live) {
        if (m.next || m.loserNext) await t.match.update({ where: { id: ids.get(m.key)! }, data: { nextMatchId: m.next ? ids.get(m.next.key)! : null, loserNextMatchId: m.loserNext ? ids.get(m.loserNext.key)! : null } });
      }
      return;
    }
    const rows = await t.match.findMany({ where: { tournamentId }, select: { id: true, bracket: true, round: true, position: true } });
    for (const m of live) {
      const row = rows.find((r) => keyOf(r) === m.key);
      if (!row) continue;
      await t.match.update({ where: { id: row.id }, data: { teamAId: m.teamA, teamBId: m.teamB, winnerTeamId: m.winner, status: m.status, ...(m.status === "WALKOVER" || m.status === "COMPLETED" ? { completedAt: new Date() } : {}) } });
    }
  }

  private async load(t: TenantTx, tournamentId: string): Promise<LiveMatch[]> {
    const rows = await t.match.findMany({ where: { tournamentId }, orderBy: [{ bracket: "asc" }, { round: "asc" }, { position: "asc" }] });
    const keyById = new Map(rows.map((r) => [r.id, keyOf(r)]));
    return rows.map((r) => ({
      key: keyOf(r), bracket: r.bracket, round: r.round, position: r.position, teamA: r.teamAId, teamB: r.teamBId, winner: r.winnerTeamId, status: r.status as LiveMatch["status"],
      next: r.nextMatchId ? { key: keyById.get(r.nextMatchId)!, slot: (r.nextSlot ?? "A") as "A" | "B" } : null,
      loserNext: r.loserNextMatchId ? { key: keyById.get(r.loserNextMatchId)!, slot: (r.loserNextSlot ?? "A") as "A" | "B" } : null,
      byeA: r.byeA, byeB: r.byeB,
    }));
  }

  /**
   * Record a result. Elimination brackets need a winner; group, league and
   * Swiss matches may be a draw. The bracket moves on by itself; when every
   * match is decided, the tournament finishes.
   */
  async reportResult(t: TenantTx, matchId: string, r: { scoreA: number; scoreB: number; winnerTeamId?: string | null; games?: unknown[] }, actor: { id: string }) {
    const m = await t.match.findUnique({ where: { id: matchId }, include: { tournament: { select: { id: true, status: true, organizationId: true, branchId: true } } } });
    if (!m) throw new NotFoundException({ error: "match_not_found" });
    if (m.tournament.status !== "IN_PROGRESS") throw new ConflictException({ error: "tournament_not_running" });
    if (!m.teamAId || !m.teamBId) throw new ConflictException({ error: "match_not_ready" });
    if (["COMPLETED", "WALKOVER", "CANCELLED"].includes(m.status)) throw new ConflictException({ error: "match_decided" });
    const group = m.bracket === "GROUP" || m.bracket === "LEAGUE";
    const winner = r.winnerTeamId ?? (r.scoreA > r.scoreB ? m.teamAId : r.scoreB > r.scoreA ? m.teamBId : null);
    if (winner && winner !== m.teamAId && winner !== m.teamBId) throw new ConflictException({ error: "not_in_match" });
    if (!winner && !group) throw new ConflictException({ error: "winner_required", hint: "Knockout matches can't end in a draw." });
    if (winner && ((winner === m.teamAId && r.scoreA < r.scoreB) || (winner === m.teamBId && r.scoreB < r.scoreA))) throw new ConflictException({ error: "score_contradicts_winner" });
    await t.match.update({ where: { id: matchId }, data: { scoreA: r.scoreA, scoreB: r.scoreB, games: (r.games ?? []) as Prisma.InputJsonValue, reportedById: actor.id, confirmedById: actor.id } });
    if (group) {
      await t.match.update({ where: { id: matchId }, data: { winnerTeamId: winner, status: "COMPLETED", completedAt: new Date() } });
    } else {
      const live = await this.load(t, m.tournamentId);
      try {
        const changed = report(live, keyOf(m), winner!);
        await this.persist(t, m.tournament.organizationId, m.tournamentId, changed, false);
      } catch (e) {
        if (e instanceof BracketError) throw new ConflictException({ error: e.code, hint: e.message });
        throw e;
      }
    }
    await auditAs(t, { type: "EMPLOYEE", id: actor.id }, { action: "tournament.result", entityType: "Match", entityId: matchId, branchId: m.tournament.branchId, after: { scoreA: r.scoreA, scoreB: r.scoreB, winner } });
    await this.nextSwissRound(t, m.tournamentId);
    await this.maybeFinish(t, m.tournamentId, actor);
    return this.view(t, m.tournamentId);
  }

  /** Swiss: when a round is complete and rounds remain, pair the next one. */
  private async nextSwissRound(t: TenantTx, tournamentId: string) {
    const tr = await t.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { format: true, swissRounds: true, organizationId: true } });
    if (tr.format !== "SWISS") return;
    const matches = await t.match.findMany({ where: { tournamentId } });
    if (matches.some((x) => !["COMPLETED", "WALKOVER", "CANCELLED"].includes(x.status))) return;
    const teams = (await t.team.findMany({ where: { tournamentId, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, select: { id: true } })).map((x) => x.id);
    const rounds = tr.swissRounds ?? swissRoundsFor(teams.length);
    const current = Math.max(...matches.map((x) => x.round));
    if (current >= rounds) return;
    const table = standings(teams, playedOf(matches), matches.filter((x) => x.status === "WALKOVER" && x.teamAId && !x.teamBId).map((x) => x.teamAId!));
    const { pairs, bye } = pairSwiss(table, matches.filter((x) => x.teamAId && x.teamBId).map((x) => [x.teamAId!, x.teamBId!] as [string, string]));
    const round = current + 1;
    for (const [i, [a, b]] of pairs.entries()) await t.match.create({ data: { organizationId: tr.organizationId, tournamentId, bracket: "GROUP", round, position: i, teamAId: a, teamBId: b, status: "READY" } });
    if (bye) await t.match.create({ data: { organizationId: tr.organizationId, tournamentId, bracket: "GROUP", round, position: pairs.length, teamAId: bye, winnerTeamId: bye, byeB: true, status: "WALKOVER", completedAt: new Date() } });
  }

  /** Every match decided → placements, prizes to wallets, points for all players. */
  private async maybeFinish(t: TenantTx, tournamentId: string, actor: { id: string }) {
    const tr = await t.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (tr.status !== "IN_PROGRESS") return;
    const matches = await t.match.findMany({ where: { tournamentId } });
    if (!matches.length || matches.some((x) => !["COMPLETED", "WALKOVER", "CANCELLED"].includes(x.status))) return;
    const teams = (await t.team.findMany({ where: { tournamentId, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, select: { id: true } })).map((x) => x.id);
    if (tr.format === "SWISS" && Math.max(...matches.map((x) => x.round)) < (tr.swissRounds ?? swissRoundsFor(teams.length))) return;
    let place: Map<string, number>;
    if (["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION"].includes(tr.format)) {
      place = placements(await this.load(t, tournamentId), teams);
    } else {
      const table = standings(teams, playedOf(matches), matches.filter((x) => x.status === "WALKOVER" && x.teamAId && !x.teamBId).map((x) => x.teamAId!));
      place = new Map(table.map((s, i) => [s.team, i + 1]));
    }
    for (const [teamId, p] of place) await t.team.update({ where: { id: teamId }, data: { finalPlacement: p, status: p === 1 ? "WINNER" : "ELIMINATED" } });
    await t.tournament.update({ where: { id: tournamentId }, data: { status: "COMPLETED", endsAt: new Date() } });

    const unit = await minorUnit(t, tr.currency);
    const prizes = (tr.prizeDistribution as Array<{ place: number; amount: number }>) ?? [];
    if (tr.prizesToWallet) {
      for (const prize of prizes) {
        const winners = [...place].filter(([, p]) => p === prize.place).map(([id]) => id);
        if (!winners.length || prize.amount <= 0) continue;
        const share = Math.floor(toMinor(prize.amount, unit) / winners.length); // tied places split the prize
        for (const teamId of winners) {
          const team = await t.team.findUniqueOrThrow({ where: { id: teamId }, select: { captainId: true, name: true } });
          if (!team.captainId || share <= 0) continue;
          await moveMoney(t, { customerId: team.captainId, bucket: "CASH", deltaMinor: share, type: "ADJUSTMENT", reason: `Prize: ${tr.name} — place ${prize.place}`, branchId: tr.branchId, referenceType: "TOURNAMENT", referenceId: tr.id, employeeId: actor.id, idempotencyKey: `trn-prize:${tr.id}:${teamId}:${prize.place}` });
        }
      }
    }
    const players = await t.tournamentPlayer.findMany({ where: { tournamentId, team: { id: { in: teams } } }, select: { customerId: true } });
    for (const pl of players) await earnEvent(t, pl.customerId, "TOURNAMENT", tr.branchId, { type: "TOURNAMENT", id: tr.id }, `pts:tournament:${tr.id}:${pl.customerId}`, `Played ${tr.name}`);
    await auditAs(t, { type: "EMPLOYEE", id: actor.id }, { action: "tournament.complete", entityType: "Tournament", entityId: tr.id, branchId: tr.branchId, after: { placements: Object.fromEntries(place) } });
  }

  async assignStations(t: TenantTx, matchId: string, deviceIds: string[], actor: { id: string }) {
    const m = await t.match.findUnique({ where: { id: matchId }, include: { tournament: { select: { branchId: true } } } });
    if (!m) throw new NotFoundException({ error: "match_not_found" });
    const found = await t.device.count({ where: { id: { in: deviceIds }, branchId: m.tournament.branchId, isEnabled: true } });
    if (found !== deviceIds.length) throw new NotFoundException({ error: "device_not_found" });
    await t.match.update({ where: { id: matchId }, data: { stationIds: deviceIds, ...(m.status === "READY" ? { status: "SCHEDULED" } : {}) } });
    await auditAs(t, { type: "EMPLOYEE", id: actor.id }, { action: "tournament.stations", entityType: "Match", entityId: matchId, branchId: m.tournament.branchId, after: { deviceIds } });
  }

  // ── views ────────────────────────────────────────────────────────────────

  async view(t: TenantTx, id: string, opts: { publicOnly?: boolean } = {}) {
    const tr = await t.tournament.findUnique({
      where: { id },
      include: {
        branch: { select: { name: true, code: true } }, game: { select: { title: true, coverUrl: true } },
        teams: { orderBy: [{ seed: "asc" }, { createdAt: "asc" }], include: { captain: { select: { id: true, displayName: true } }, tournamentPlayers: { include: { customer: { select: { id: true, displayName: true, username: true } } } } } },
        matches: { orderBy: [{ bracket: "asc" }, { round: "asc" }, { position: "asc" }] },
      },
    });
    if (!tr) throw new NotFoundException({ error: "tournament_not_found" });
    if (opts.publicOnly && (!tr.isPublic || tr.status === "DRAFT")) throw new NotFoundException({ error: "tournament_not_found" });
    const unit = await minorUnit(t, tr.currency);
    const teamName = new Map(tr.teams.map((x) => [x.id, x.name]));
    const playing = tr.teams.filter((x) => !["WITHDRAWN", "DISQUALIFIED"].includes(x.status));
    const table = ["ROUND_ROBIN", "LEAGUE", "SWISS"].includes(tr.format)
      ? standings(playing.map((x) => x.id), playedOf(tr.matches), tr.matches.filter((x) => x.status === "WALKOVER" && x.teamAId && !x.teamBId).map((x) => x.teamAId!)).map((s) => ({ ...s, name: teamName.get(s.team) ?? "?" }))
      : null;
    return {
      id: tr.id, name: tr.name, slug: tr.slug, status: tr.status, format: tr.format, game: tr.game?.title ?? tr.customGameName, coverUrl: tr.game?.coverUrl ?? tr.bannerUrl, description: tr.description, rules: tr.rules,
      branch: tr.branch, teamSize: tr.teamSize, maxTeams: tr.maxTeams, minTeams: tr.minTeams, entryFee: tr.entryFee.toFixed(unit), prizePool: tr.prizePool.toFixed(unit), currency: tr.currency,
      prizeDistribution: tr.prizeDistribution, startsAt: tr.startsAt, endsAt: tr.endsAt, registrationClosesAt: tr.registrationClosesAt, isPublic: tr.isPublic, swissRounds: tr.swissRounds, prizesToWallet: tr.prizesToWallet,
      entered: playing.length,
      teams: tr.teams.map((x) => ({
        id: x.id, name: x.name, tag: x.tag, seed: x.seed, status: x.status, finalPlacement: x.finalPlacement, paid: !!x.paymentId,
        captain: opts.publicOnly ? (x.captain ? { displayName: x.captain.displayName } : null) : x.captain,
        players: x.tournamentPlayers.map((p) => (opts.publicOnly ? { displayName: p.customer.displayName, checkedIn: !!p.checkedInAt } : { id: p.customer.id, displayName: p.customer.displayName, username: p.customer.username, checkedIn: !!p.checkedInAt })),
      })),
      matches: tr.matches.map((m) => ({
        id: m.id, bracket: m.bracket, round: m.round, position: m.position, status: m.status, bestOf: m.bestOf, teamA: m.teamAId ? { id: m.teamAId, name: teamName.get(m.teamAId) } : null,
        teamB: m.teamBId ? { id: m.teamBId, name: teamName.get(m.teamBId) } : null, scoreA: m.scoreA, scoreB: m.scoreB, winnerTeamId: m.winnerTeamId, scheduledAt: m.scheduledAt, stationIds: opts.publicOnly ? undefined : m.stationIds, byeA: m.byeA, byeB: m.byeB,
      })),
      standings: table,
    };
  }
}

function keyOf(r: { bracket: string; round: number; position: number }) {
  if (r.bracket === "GRAND_FINAL") return "GF";
  return `${r.bracket === "WINNERS" ? "W" : r.bracket === "LOSERS" ? "L" : "R"}${r.round}-${r.position}`;
}

function playedOf(matches: Array<{ teamAId: string | null; teamBId: string | null; scoreA: number | null; scoreB: number | null; winnerTeamId: string | null; status: string; bracket: string }>): Played[] {
  return matches
    .filter((m) => m.status === "COMPLETED" && m.teamAId && m.teamBId)
    .map((m) => ({ teamA: m.teamAId!, teamB: m.teamBId!, scoreA: m.scoreA ?? 0, scoreB: m.scoreB ?? 0, winner: m.winnerTeamId }));
}
