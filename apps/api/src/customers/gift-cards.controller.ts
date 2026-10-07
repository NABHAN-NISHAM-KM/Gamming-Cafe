import { Body, Controller, Get, Inject, NotFoundException, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { orgCurrency } from "../wallet/wallet.js";
import { CommerceService } from "./commerce.service.js";

const Sell = z
  .object({
    branchId: z.uuid(),
    amount: z.union([z.number(), z.string()]).transform(String).refine((v) => /^\d{1,6}(\.\d{1,3})?$/.test(v) && Number(v) > 0 && Number(v) <= 5000, "0–5000"),
    customerId: z.uuid().nullish(),
    payment: z.object({ method: z.enum(["CASH", "CARD"]), reference: z.string().max(100).nullish() }),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const List = z.object({ status: z.enum(["ACTIVE", "REDEEMED"]).optional(), hint: z.string().max(4).optional() }).strict();

/** Gift cards sold at the counter. The code is returned once, by the sale; only its hash is kept. */
@Controller("gift-cards")
export class GiftCardsController {
  constructor(@Inject(CommerceService) private readonly commerce: CommerceService) {}

  @AnyStaff()
  @Post()
  async sell(@Body(new ZodPipe(Sell)) body: z.infer<typeof Sell>) {
    const b = await tx().branch.findUnique({ where: { id: body.branchId }, select: { id: true, brandId: true } });
    if (!b) throw new NotFoundException({ error: "branch_not_found" });
    authorizeFor("wallet.topup", { organizationId: orgId(), brandId: b.brandId, branchId: b.id });
    return this.commerce.sellGiftCard(tx(), body, { type: "EMPLOYEE", id: principal().employeeId });
  }

  /** Cards sold, newest first, with how much is still owed on the active ones. */
  @RequirePermissionAnyScope("wallet.view_ledger")
  @Get()
  async list(@Query(new ZodPipe(List)) q: z.infer<typeof List>) {
    const { unit } = await orgCurrency(tx());
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.hint ? { codeHint: q.hint.toUpperCase() } : {}) };
    const [rows, owed] = await Promise.all([
      tx().giftCard.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, codeHint: true, amount: true, currency: true, status: true, branchId: true, createdAt: true, redeemedAt: true, redeemedBy: { select: { displayName: true, username: true } } } }),
      tx().giftCard.aggregate({ where: { status: "ACTIVE" }, _sum: { amount: true }, _count: true }),
    ]);
    return { outstanding: { count: owed._count, amount: (owed._sum.amount ?? new Prisma.Decimal(0)).toFixed(unit) }, cards: rows.map((r) => ({ ...r, amount: r.amount.toFixed(unit) })) };
  }
}
