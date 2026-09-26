import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { TournamentsService } from "./tournaments.service.js";

const money = z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,7}(\.\d{1,2})?$/.test(v), "invalid amount");
const NewTournament = z
  .object({
    branchId: z.uuid(),
    name: z.string().min(3).max(80),
    gameId: z.uuid().nullish(),
    customGameName: z.string().max(60).nullish(),
    description: z.string().max(1000).nullish(),
    format: z.enum(["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN", "LEAGUE", "SWISS"]),
    teamSize: z.number().int().min(1).max(10).default(1),
    maxTeams: z.number().int().min(2).max(256),
    minTeams: z.number().int().min(2).max(256).default(2),
    entryFee: money.default("0"),
    prizePool: money.default("0"),
    prizeDistribution: z.array(z.object({ place: z.number().int().min(1).max(64), amount: z.number().min(0) }).strict()).max(16).default([]),
    rules: z.string().max(5000).nullish(),
    registrationOpensAt: z.coerce.date().nullish(),
    registrationClosesAt: z.coerce.date().nullish(),
    startsAt: z.coerce.date(),
    isPublic: z.boolean().default(true),
    swissRounds: z.number().int().min(1).max(20).nullish(),
    prizesToWallet: z.boolean().default(true),
  })
  .strict()
  .refine((x) => x.maxTeams >= x.minTeams, "maxTeams must be at least minTeams");
const Status = z.object({ status: z.enum(["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN", "CANCELLED"]), reason: z.string().max(200).nullish() }).strict();
const Register = z
  .object({
    teamName: z.string().min(1).max(40), tag: z.string().max(8).nullish(), captainId: z.uuid(), playerIds: z.array(z.uuid()).max(9).default([]),
    payment: z.object({ method: z.enum(["CASH", "CARD", "WALLET"]) }).strict().nullish(), idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const Result = z.object({ scoreA: z.number().int().min(0).max(999), scoreB: z.number().int().min(0).max(999), winnerTeamId: z.uuid().nullish(), games: z.array(z.record(z.string(), z.unknown())).max(9).optional() }).strict();
const Seed = z.object({ seeds: z.array(z.object({ teamId: z.uuid(), seed: z.number().int().min(1).max(256).nullable() }).strict()).max(256) }).strict();

const me = () => ({ id: principal().employeeId });

async function target(tournamentId: string) {
  const tr = await tx().tournament.findUnique({ where: { id: tournamentId }, select: { branchId: true, branch: { select: { brandId: true } } } });
  if (!tr) throw new NotFoundException({ error: "tournament_not_found" });
  return { organizationId: orgId(), brandId: tr.branch.brandId, branchId: tr.branchId };
}
const teamTournament = async (teamId: string) => (await tx().team.findUnique({ where: { id: teamId }, select: { tournamentId: true } }))?.tournamentId ?? "";
const matchTournament = async (matchId: string) => (await tx().match.findUnique({ where: { id: matchId }, select: { tournamentId: true } }))?.tournamentId ?? "";

/** Tournaments, checked against the hosting branch. */
@Controller()
export class TournamentsController {
  constructor(@Inject(TournamentsService) private readonly svc: TournamentsService) {}

  @RequirePermissionAnyScope("tournament.view")
  @Get("tournaments")
  async list(@Query("status") status?: string) {
    const rows = await tx().tournament.findMany({
      where: status === "active" ? { status: { in: ["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN", "IN_PROGRESS"] } } : {},
      orderBy: { startsAt: "desc" },
      take: 100,
      include: { branch: { select: { code: true } }, game: { select: { title: true } }, _count: { select: { teams: { where: { status: { notIn: ["WITHDRAWN", "DISQUALIFIED"] } } } } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, format: r.format, game: r.game?.title ?? r.customGameName, branch: r.branch.code, startsAt: r.startsAt, teamSize: r.teamSize, maxTeams: r.maxTeams, entered: r._count.teams, entryFee: r.entryFee.toFixed(2), prizePool: r.prizePool.toFixed(2), currency: r.currency }));
  }

  @AnyStaff()
  @Get("tournaments/:id")
  async get(@Param("id") id: string) {
    authorizeFor("tournament.view", await target(id));
    return this.svc.view(tx(), id);
  }

  @AnyStaff()
  @Post("tournaments")
  async create(@Body(new ZodPipe(NewTournament)) body: z.infer<typeof NewTournament>) {
    const b = await tx().branch.findUnique({ where: { id: body.branchId }, select: { brandId: true } });
    if (!b) throw new NotFoundException({ error: "branch_not_found" });
    authorizeFor("tournament.manage", { organizationId: orgId(), brandId: b.brandId, branchId: body.branchId });
    return this.svc.create(tx(), { ...body, registrationOpensAt: body.registrationOpensAt ?? null, registrationClosesAt: body.registrationClosesAt ?? null }, me());
  }

  @AnyStaff()
  @Post("tournaments/:id/status")
  @HttpCode(200)
  async status(@Param("id") id: string, @Body(new ZodPipe(Status)) body: z.infer<typeof Status>) {
    authorizeFor("tournament.manage", await target(id));
    return this.svc.setStatus(tx(), id, body.status, me(), body.reason ?? null);
  }

  @AnyStaff()
  @Post("tournaments/:id/teams")
  async register(@Param("id") id: string, @Body(new ZodPipe(Register)) body: z.infer<typeof Register>) {
    authorizeFor("tournament.manage", await target(id));
    return this.svc.register(tx(), id, body, { type: "EMPLOYEE", id: principal().employeeId });
  }

  @AnyStaff()
  @Patch("tournaments/:id/seeds")
  async seeds(@Param("id") id: string, @Body(new ZodPipe(Seed)) body: z.infer<typeof Seed>) {
    authorizeFor("tournament.manage", await target(id));
    for (const s of body.seeds) await tx().team.updateMany({ where: { id: s.teamId, tournamentId: id }, data: { seed: s.seed } });
    return this.svc.view(tx(), id);
  }

  @AnyStaff()
  @Post("tournaments/:id/start")
  @HttpCode(200)
  async start(@Param("id") id: string) {
    authorizeFor("tournament.manage", await target(id));
    return this.svc.start(tx(), id, me());
  }

  @AnyStaff()
  @Post("teams/:id/check-in")
  @HttpCode(200)
  async checkIn(@Param("id") id: string) {
    authorizeFor("tournament.manage", await target(await teamTournament(id)));
    await this.svc.checkIn(tx(), id, { type: "EMPLOYEE", id: principal().employeeId });
    return { checkedIn: true };
  }

  @AnyStaff()
  @Post("teams/:id/withdraw")
  @HttpCode(200)
  async withdraw(@Param("id") id: string, @Body(new ZodPipe(z.object({ reason: z.string().min(3).max(200) }).strict())) body: { reason: string }) {
    authorizeFor("tournament.manage", await target(await teamTournament(id)));
    await this.svc.withdraw(tx(), id, body.reason, me());
    return { withdrawn: true };
  }

  @AnyStaff()
  @Post("matches/:id/result")
  @HttpCode(200)
  async result(@Param("id") id: string, @Body(new ZodPipe(Result)) body: z.infer<typeof Result>) {
    authorizeFor("tournament.score", await target(await matchTournament(id)));
    return this.svc.reportResult(tx(), id, body, me());
  }

  @AnyStaff()
  @Post("matches/:id/stations")
  @HttpCode(200)
  async stations(@Param("id") id: string, @Body(new ZodPipe(z.object({ deviceIds: z.array(z.uuid()).max(20) }).strict())) body: { deviceIds: string[] }) {
    authorizeFor("tournament.manage", await target(await matchTournament(id)));
    await this.svc.assignStations(tx(), id, body.deviceIds, me());
    return { assigned: body.deviceIds.length };
  }
}
