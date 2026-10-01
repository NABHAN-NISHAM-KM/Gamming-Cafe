import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { holdsPermission } from "@arena/rbac";
import { hashSecret } from "../auth/crypto.js";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { RequirePermissionAnyScope, AnyStaff } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { csvName, toCsv } from "../common/csv.js";
import { eraseCustomer } from "./merge.js";
import { adjustTime } from "../sessions/time-balance.js";
import { moveMoney, orgCurrency, toMinor, walletView } from "../wallet/wallet.js";
import { CommerceService } from "./commerce.service.js";

const Username = z.string().regex(/^[a-zA-Z0-9._-]{3,32}$/, "3–32 letters, digits, . _ -").transform((u) => u.toLowerCase());
const Pin = z.string().regex(/^\d{4,8}$/, "PIN is 4–8 digits");
const Password = z.string().min(6).max(128);

const Create = z
  .object({
    username: Username,
    displayName: z.string().min(1).max(60),
    firstName: z.string().max(60).nullish(),
    lastName: z.string().max(60).nullish(),
    phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/).nullish(),
    email: z.email().max(254).nullish(),
    password: Password.optional(),
    pin: Pin.optional(),
    marketingConsent: z.boolean().default(false),
  })
  .strict();
const Tag = z.string().trim().min(1).max(24);
const Update = z
  .object({
    displayName: z.string().min(1).max(60), firstName: z.string().max(60).nullable(), lastName: z.string().max(60).nullable(), phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/).nullable(), email: z.email().nullable(), marketingConsent: z.boolean(),
    dateOfBirth: z.iso.date().refine((d) => d >= "1900-01-01" && new Date(d) <= new Date(), "not a real birth date").nullable().transform((d) => (d ? new Date(d) : null)),
    homeBranchId: z.uuid().nullable(),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    tags: z.array(Tag).max(20).transform((t) => [...new Set(t)]),
  })
  .partial()
  .strict();
const Filters = z
  .object({
    q: z.string().max(100).optional(),
    status: z.enum(["ACTIVE", "RESTRICTED", "BANNED", "PENDING_VERIFICATION"]).optional(),
    tag: Tag.optional(),
    sort: z.enum(["recent", "name", "spend", "lastVisit", "points"]).default("recent"),
    page: z.coerce.number().int().min(0).max(10_000).default(0),
    consented: z.enum(["1"]).optional(),
  })
  .strict();
type Filters = z.infer<typeof Filters>;
const PAGE = 50;
const Credentials = z.object({ password: Password.optional(), pin: Pin.optional() }).strict().refine((c) => c.password || c.pin, "password or pin required");
const SellTime = z
  .object({
    branchId: z.uuid(),
    planId: z.uuid(),
    packageId: z.uuid().optional(),
    minutes: z.number().int().min(1).max(6000).optional(),
    payment: z.object({ method: z.enum(["CASH", "CARD", "WALLET"]), reference: z.string().max(100).nullish() }),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict()
  .refine((s) => s.packageId || s.minutes, "packageId or minutes required");
const money = z.union([z.number(), z.string()]).transform((v) => String(v)).refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v), "invalid amount");
const TopUp = z
  .object({
    branchId: z.uuid(),
    amount: money,
    bonus: money.nullish(),
    payment: z.object({ method: z.enum(["CASH", "CARD"]), reference: z.string().max(100).nullish() }),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const Adjust = z
  .object({
    branchId: z.uuid(),
    bucket: z.enum(["CASH", "BONUS", "TIME"]),
    amount: z.union([z.number(), z.string()]).transform((v) => String(v)).refine((v) => /^-?\d{1,9}(\.\d{1,3})?$/.test(v) && Number(v) !== 0, "non-zero amount (minutes for TIME)"),
    reason: z.string().min(3).max(200),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
const Freeze = z.object({ frozen: z.boolean() }).strict();
const SellMembership = z
  .object({
    branchId: z.uuid(),
    tierId: z.uuid(),
    payment: z.object({ method: z.enum(["CASH", "CARD", "WALLET"]), reference: z.string().max(100).nullish() }),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();

const SELECT = {
  id: true, username: true, displayName: true, firstName: true, lastName: true, phone: true, email: true, status: true, createdAt: true, lastVisitAt: true, marketingConsent: true,
  dateOfBirth: true, homeBranchId: true, locale: true, tags: true, loyaltyPoints: true, totalSpend: true, totalGamingMinutes: true, referralCode: true, emailVerifiedAt: true, phoneVerifiedAt: true,
  membershipTier: { select: { id: true, name: true, code: true, color: true } },
  wallets: { select: { timeBalanceMin: true, cashBalance: true, bonusBalance: true } },
} as const;

const seesPii = () => holdsPermission(principal(), "customer.view_pii", { organizationId: orgId() }) || principal().grants.some((g) => g.permissions.has("customer.view_pii"));

/** Phone/email/birth date are personal data: shown in full only with customer.view_pii. */
function present(c: any) {
  const pii = seesPii();
  const mask = (v: string | null, keep: number) => (!v || pii ? v : `${"•".repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}`);
  const { wallets, passwordHash, pinHash, ...rest } = c;
  return { ...rest, phone: mask(c.phone, 3), email: c.email && !pii ? c.email.replace(/^(.).*(@.*)$/, "$1•••$2") : c.email, dateOfBirth: pii ? (c.dateOfBirth?.toISOString().slice(0, 10) ?? null) : null, totalSpend: c.totalSpend === undefined ? undefined : Number(c.totalSpend).toFixed(2), timeBalanceMinutes: (wallets ?? []).reduce((s: number, w: any) => s + w.timeBalanceMin, 0), walletBalance: (wallets ?? []).reduce((s: number, w: any) => s + Number(w.cashBalance) + Number(w.bonusBalance), 0).toFixed(2) };
}

@Controller("customers")
export class CustomersController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  @RequirePermissionAnyScope("customer.view")
  @Get()
  async list(@Query(new ZodPipe(Filters)) f: Filters) {
    const rows = await tx().customer.findMany({ where: await where(f), select: SELECT, orderBy: ORDER[f.q?.trim() && f.sort === "recent" ? "name" : f.sort], skip: f.page * PAGE, take: PAGE });
    return rows.map(present);
  }

  /** The filtered list as a spreadsheet (personal data — needs customer.export, and is audited). */
  @RequirePermissionAnyScope("customer.export")
  @Get("export")
  async export(@Query(new ZodPipe(Filters)) f: Filters, @Res({ passthrough: true }) res: Response) {
    const rows = await tx().customer.findMany({ where: await where(f), select: { ...SELECT, membershipTier: { select: { name: true } } }, orderBy: ORDER[f.sort], take: 10_000 });
    await this.audit.record({ action: "customer.export", entityType: "Customer", after: { filters: f, rows: rows.length } });
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${csvName(`customers-${new Date().toISOString().slice(0, 10)}`)}"`);
    return toCsv(
      ["username", "name", "first_name", "last_name", "phone", "email", "birth_date", "status", "tier", "tags", "points", "total_spend", "gaming_hours", "last_visit", "joined", "marketing_consent"],
      rows.map((c) => [c.username, c.displayName, c.firstName, c.lastName, c.phone, c.email, c.dateOfBirth?.toISOString().slice(0, 10), c.status, c.membershipTier?.name, c.tags.join("; "), c.loyaltyPoints, Number(c.totalSpend).toFixed(2), (c.totalGamingMinutes / 60).toFixed(1), c.lastVisitAt, c.createdAt, c.marketingConsent ? "yes" : "no"]),
    );
  }

  @RequirePermissionAnyScope("customer.view")
  @Get(":customerId")
  async get(@Param("customerId") customerId: string) {
    const c = await tx().customer.findUnique({ where: { id: customerId }, select: SELECT });
    if (!c) throw new NotFoundException({ error: "not_found" });
    const sessions = await tx().gamingSession.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, startedAt: true, endedAt: true, expiresAt: true, amountDue: true, currency: true, device: { select: { name: true } }, endReason: true },
    });
    const ledger = await tx().walletTransaction.findMany({ where: { bucket: "TIME", wallet: { customerId } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, type: true, amount: true, balanceAfter: true, reason: true, createdAt: true } });
    return { ...present(c), sessions, timeLedger: ledger.map((l) => ({ ...l, amount: Number(l.amount), balanceAfter: Number(l.balanceAfter) })) };
  }

  @RequirePermissionAnyScope("customer.create")
  @Post()
  async create(@Body(new ZodPipe(Create)) body: z.infer<typeof Create>) {
    if (await tx().customer.findFirst({ where: { username: body.username }, select: { id: true } })) throw new ConflictException({ error: "username_taken" });
    const { password, pin, ...rest } = body;
    const c = await tx().customer.create({
      data: {
        ...rest,
        email: rest.email?.toLowerCase() ?? null,
        organizationId: orgId(),
        passwordHash: password ? await hashSecret(password) : null,
        pinHash: pin ? await hashSecret(pin) : null,
        referralCode: randomBytes(4).toString("hex").toUpperCase(),
      },
      select: SELECT,
    });
    await this.audit.record({ action: "customer.create", entityType: "Customer", entityId: c.id, after: { username: c.username, displayName: c.displayName } });
    return present(c);
  }

  @RequirePermissionAnyScope("customer.edit")
  @Patch(":customerId")
  async update(@Param("customerId") customerId: string, @Body(new ZodPipe(Update)) body: z.infer<typeof Update>) {
    const before = await tx().customer.findUniqueOrThrow({ where: { id: customerId }, select: SELECT });
    if (body.homeBranchId && !(await tx().branch.findUnique({ where: { id: body.homeBranchId }, select: { id: true } }))) throw new NotFoundException({ error: "branch_not_found" });
    const after = await tx().customer.update({ where: { id: customerId }, data: { ...body, email: body.email?.toLowerCase() ?? body.email }, select: SELECT });
    await this.audit.record({ action: "customer.update", entityType: "Customer", entityId: customerId, before, after });
    return present(after);
  }

  /** Right to erasure — see eraseCustomer(). */
  @RequirePermissionAnyScope("customer.delete")
  @Post(":customerId/erase")
  @HttpCode(200)
  async erase(@Param("customerId") customerId: string) {
    await eraseCustomer(tx(), customerId);
    await this.audit.record({ action: "customer.erase", entityType: "Customer", entityId: customerId });
    return { erased: true };
  }

  @RequirePermissionAnyScope("customer.reset_password")
  @Post(":customerId/credentials")
  @HttpCode(204)
  async credentials(@Param("customerId") customerId: string, @Body(new ZodPipe(Credentials)) body: z.infer<typeof Credentials>) {
    await tx().customer.update({
      where: { id: customerId },
      data: { ...(body.password ? { passwordHash: await hashSecret(body.password) } : {}), ...(body.pin ? { pinHash: await hashSecret(body.pin) } : {}) },
    });
    await this.audit.record({ action: "customer.reset_credentials", entityType: "Customer", entityId: customerId, after: { password: !!body.password, pin: !!body.pin } });
  }

  /**
   * Sell prepaid gaming time to an account (e.g. "5 hours for AED 60"). The
   * customer then logs in at any PC and spends it. Payment + bill + time
   * ledger are written together; retries with the same key are no-ops.
   */
  @AnyStaff()
  @Post(":customerId/time")
  async sellTime(@Param("customerId") customerId: string, @Body(new ZodPipe(SellTime)) body: z.infer<typeof SellTime>) {
    authorizeFor("wallet.topup", await branchTarget(body.branchId));
    return this.commerce.sellTime(tx(), { customerId, ...body }, { type: "EMPLOYEE", id: principal().employeeId });
  }

  // ── wallet ───────────────────────────────────────────────────────────────

  @RequirePermissionAnyScope("wallet.view_ledger")
  @Get(":customerId/wallet")
  async wallet(@Param("customerId") customerId: string) {
    if (!(await tx().customer.findUnique({ where: { id: customerId }, select: { id: true } }))) throw new NotFoundException({ error: "not_found" });
    return walletView(tx(), customerId);
  }

  /** Money in at the counter (cash/card), optionally with bonus credit. */
  @AnyStaff()
  @Post(":customerId/wallet/topup")
  async topUp(@Param("customerId") customerId: string, @Body(new ZodPipe(TopUp)) body: z.infer<typeof TopUp>) {
    authorizeFor("wallet.topup", await branchTarget(body.branchId));
    if (body.bonus && Number(body.bonus) > 0) authorizeFor("customer.adjust_wallet", await branchTarget(body.branchId));
    return this.commerce.topUp(tx(), { customerId, ...body }, { type: "EMPLOYEE", id: principal().employeeId });
  }

  /** Manual correction (goodwill credit, fixing a mistake). Sensitive: needs a reason. */
  @AnyStaff()
  @Post(":customerId/wallet/adjust")
  async adjust(@Param("customerId") customerId: string, @Body(new ZodPipe(Adjust)) body: z.infer<typeof Adjust>) {
    authorizeFor("customer.adjust_wallet", await branchTarget(body.branchId));
    if (!(await tx().customer.findUnique({ where: { id: customerId }, select: { id: true } }))) throw new NotFoundException({ error: "not_found" });
    const common = { customerId, branchId: body.branchId, reason: body.reason, employeeId: principal().employeeId, idempotencyKey: body.idempotencyKey };
    if (body.bucket === "TIME") {
      const { currency, organizationId } = await orgCurrency(tx());
      await adjustTime(tx(), { ...common, organizationId, currency, deltaMinutes: Math.round(Number(body.amount)), type: "ADJUSTMENT" });
    } else {
      const { unit } = await orgCurrency(tx());
      await moveMoney(tx(), { ...common, bucket: body.bucket, deltaMinor: toMinor(body.amount, unit), type: "ADJUSTMENT", ...(body.bucket === "BONUS" && Number(body.amount) > 0 ? { expiresAt: new Date(Date.now() + 90 * 86_400_000) } : {}) });
    }
    await this.audit.record({ action: "wallet.adjust", entityType: "Customer", entityId: customerId, branchId: body.branchId, after: { bucket: body.bucket, amount: body.amount, reason: body.reason } });
    return walletView(tx(), customerId);
  }

  @RequirePermissionAnyScope("customer.restrict")
  @Post(":customerId/wallet/freeze")
  @HttpCode(200)
  async freeze(@Param("customerId") customerId: string, @Body(new ZodPipe(Freeze)) body: z.infer<typeof Freeze>) {
    const { currency, organizationId } = await orgCurrency(tx());
    const w = await tx().wallet.upsert({ where: { customerId_currency: { customerId, currency } }, create: { organizationId, customerId, currency, isFrozen: body.frozen }, update: { isFrozen: body.frozen } });
    await this.audit.record({ action: body.frozen ? "wallet.freeze" : "wallet.unfreeze", entityType: "Customer", entityId: customerId, after: { frozen: w.isFrozen } });
    return walletView(tx(), customerId);
  }

  // ── memberships ─────────────────────────────────────────────────────────

  @AnyStaff()
  @Post(":customerId/memberships")
  async sellMembership(@Param("customerId") customerId: string, @Body(new ZodPipe(SellMembership)) body: z.infer<typeof SellMembership>) {
    authorizeFor("membership.sell", await branchTarget(body.branchId));
    return this.commerce.sellMembership(tx(), { customerId, ...body }, { type: "EMPLOYEE", id: principal().employeeId });
  }

  @RequirePermissionAnyScope("customer.view")
  @Get(":customerId/memberships")
  memberships(@Param("customerId") customerId: string) {
    return tx().membership.findMany({ where: { customerId }, include: { tier: { select: { id: true, name: true, code: true, color: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
  }

  @RequirePermissionAnyScope("membership.sell")
  @Post(":customerId/memberships/:membershipId/cancel")
  @HttpCode(200)
  async cancelMembership(@Param("customerId") customerId: string, @Param("membershipId") membershipId: string) {
    const m = await tx().membership.findFirst({ where: { id: membershipId, customerId } });
    if (!m) throw new NotFoundException({ error: "not_found" });
    if (m.status !== "ACTIVE") throw new ConflictException({ error: "not_active" });
    const after = await tx().membership.update({ where: { id: m.id }, data: { status: "CANCELLED", expiresAt: new Date() } });
    await this.commerce.recomputeTier(tx(), customerId);
    await this.audit.record({ action: "membership.cancel", entityType: "Membership", entityId: m.id, before: m, after });
    return after;
  }
}

const ORDER = {
  recent: { createdAt: "desc" },
  name: { displayName: "asc" },
  spend: { totalSpend: "desc" },
  lastVisit: { lastVisitAt: { sort: "desc", nulls: "last" } },
  points: { loyaltyPoints: "desc" },
} as const;

/** The list's filters as a Prisma where. Erased accounts never show. */
async function where(f: Filters) {
  const term = f.q?.trim();
  // Phones are stored as typed ("+971 50 123 4567"): match on digits only, and
  // drop a leading trunk 0 so a local "050 123…" still finds it.
  const digits = term && /^[+0-9 ()-]+$/.test(term) ? term.replace(/\D/g, "").replace(/^0+/, "") : "";
  const byPhone = digits.length >= 4
    ? (await tx().$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Customer" WHERE regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`} LIMIT 50`).map((r) => r.id)
    : [];
  return {
    status: f.status ?? { not: "DELETED" as const },
    ...(f.tag ? { tags: { has: f.tag } } : {}),
    ...(f.consented ? { marketingConsent: true } : {}),
    ...(term
      ? { OR: [{ username: { contains: term, mode: "insensitive" as const } }, { displayName: { contains: term, mode: "insensitive" as const } }, { phone: { contains: term } }, { email: { contains: term, mode: "insensitive" as const } }, ...(byPhone.length ? [{ id: { in: byPhone } }] : [])] }
      : {}),
  };
}

/** Branch-scoped permission target from a branch id in the body. */
async function branchTarget(branchId: string) {
  const b = await tx().branch.findUnique({ where: { id: branchId }, select: { id: true, brandId: true } });
  if (!b) throw new NotFoundException({ error: "branch_not_found" });
  return { organizationId: orgId(), brandId: b.brandId, branchId: b.id };
}
