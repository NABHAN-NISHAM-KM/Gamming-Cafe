import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { orgCurrency } from "../wallet/wallet.js";

const Tier = z.object({ xp: z.number().int().min(1).max(1_000_000), reward: z.object({ type: z.enum(["BONUS", "MINUTES", "POINTS"]), amount: z.number().positive().max(100_000) }).strict() }).strict();
const SeasonBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    price: z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,5}(\.\d{1,2})?$/.test(v), "a price").default("0"),
    tiers: z.array(Tier).min(1).max(50).refine((ts) => ts.every((x, i) => i === 0 || x.xp > ts[i - 1]!.xp), "each level needs more XP than the one before"),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((s) => s.startsAt < s.endsAt, "ends before it starts");

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });

/**
 * Season passes: a time-boxed ladder of rewards. Players earn 1 XP per minute
 * played and 100 XP per challenge finished during the season, and claim each
 * level's reward (bonus money, free minutes or points) in the app.
 */
@Controller()
export class SeasonsController {
  @RequirePermission("loyalty.view")
  @Get("seasons")
  async list() {
    const rows = await tx().season.findMany({ orderBy: { startsAt: "desc" }, take: 50, include: { _count: { select: { passes: true } } } });
    return rows.map(({ _count, ...s }) => ({ ...s, price: s.price.toFixed(2), players: _count.passes }));
  }

  @RequirePermission("loyalty.manage")
  @Post("seasons")
  async create(@Body(new ZodPipe(SeasonBody)) body: z.infer<typeof SeasonBody>) {
    const { currency } = await orgCurrency(tx());
    const s = await tx().season.create({ data: { organizationId: orgId(), name: body.name, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), price: new Prisma.Decimal(body.price), currency, tiers: body.tiers, isActive: body.isActive } });
    await auditAs(tx(), me(), { action: "season.create", entityType: "Season", entityId: s.id, after: { name: s.name, tiers: body.tiers.length } });
    return s;
  }

  @RequirePermission("loyalty.manage")
  @Patch("seasons/:seasonId")
  async update(@Param("seasonId") seasonId: string, @Body(new ZodPipe(SeasonBody)) body: z.infer<typeof SeasonBody>) {
    const before = await tx().season.findUnique({ where: { id: seasonId } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    const after = await tx().season.update({ where: { id: seasonId }, data: { name: body.name, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), price: new Prisma.Decimal(body.price), tiers: body.tiers, isActive: body.isActive } });
    await auditAs(tx(), me(), { action: "season.update", entityType: "Season", entityId: seasonId, before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive } });
    return after;
  }

  @RequirePermission("loyalty.manage")
  @Delete("seasons/:seasonId")
  @HttpCode(204)
  async remove(@Param("seasonId") seasonId: string) {
    const s = await tx().season.findUnique({ where: { id: seasonId }, include: { _count: { select: { passes: true } } } });
    if (!s) throw new NotFoundException({ error: "not_found" });
    // A season people joined is switched off, not deleted: their claimed rewards stay explained.
    if (s._count.passes) await tx().season.update({ where: { id: seasonId }, data: { isActive: false } });
    else await tx().season.delete({ where: { id: seasonId } });
    await auditAs(tx(), me(), { action: "season.remove", entityType: "Season", entityId: seasonId, before: { name: s.name } });
  }
}
