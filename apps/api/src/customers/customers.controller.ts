import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { holdsPermission } from "@arena/rbac";
import { hashSecret } from "../auth/crypto.js";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { RequirePermissionAnyScope, AnyStaff } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PricingError, quote } from "../sessions/pricing.js";
import { fromMinor, toPlanDef } from "../sessions/sessions.service.js";
import { adjustTime, timeBalance } from "../sessions/time-balance.js";

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
const Update = z
  .object({ displayName: z.string().min(1).max(60), firstName: z.string().max(60).nullable(), lastName: z.string().max(60).nullable(), phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/).nullable(), email: z.email().nullable(), marketingConsent: z.boolean() })
  .partial()
  .strict();
const Credentials = z.object({ password: Password.optional(), pin: Pin.optional() }).strict().refine((c) => c.password || c.pin, "password or pin required");
const SellTime = z
  .object({
    branchId: z.uuid(),
    planId: z.uuid(),
    packageId: z.uuid().optional(),
    minutes: z.number().int().min(1).max(6000).optional(),
    payment: z.object({ method: z.enum(["CASH", "CARD"]), reference: z.string().max(100).nullish() }),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict()
  .refine((s) => s.packageId || s.minutes, "packageId or minutes required");

const SELECT = {
  id: true, username: true, displayName: true, firstName: true, lastName: true, phone: true, email: true, status: true, createdAt: true, lastVisitAt: true, marketingConsent: true,
  membershipTier: { select: { id: true, name: true, code: true } },
  wallets: { select: { timeBalanceMin: true } },
} as const;

/** Phone/email are personal data: shown in full only with customer.view_pii. */
function present(c: any) {
  const pii = holdsPermission(principal(), "customer.view_pii", { organizationId: orgId() }) || principal().grants.some((g) => g.permissions.has("customer.view_pii"));
  const mask = (v: string | null, keep: number) => (!v || pii ? v : `${"•".repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}`);
  const { wallets, passwordHash, pinHash, ...rest } = c;
  return { ...rest, phone: mask(c.phone, 3), email: c.email && !pii ? c.email.replace(/^(.).*(@.*)$/, "$1•••$2") : c.email, timeBalanceMinutes: (wallets ?? []).reduce((s: number, w: any) => s + w.timeBalanceMin, 0) };
}

@Controller("customers")
export class CustomersController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @RequirePermissionAnyScope("customer.view")
  @Get()
  async list(@Query("q") q?: string) {
    const term = q?.trim();
    const rows = await tx().customer.findMany({
      where: {
        status: { not: "DELETED" },
        ...(term
          ? { OR: [{ username: { contains: term, mode: "insensitive" } }, { displayName: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }, { email: { contains: term, mode: "insensitive" } }] }
          : {}),
      },
      select: SELECT,
      orderBy: term ? { displayName: "asc" } : { createdAt: "desc" },
      take: 50,
    });
    return rows.map(present);
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
    const after = await tx().customer.update({ where: { id: customerId }, data: { ...body, email: body.email?.toLowerCase() ?? body.email }, select: SELECT });
    await this.audit.record({ action: "customer.update", entityType: "Customer", entityId: customerId, before, after });
    return present(after);
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
    const branch = await tx().branch.findUnique({ where: { id: body.branchId }, select: { id: true, brandId: true, code: true, currency: true, timezone: true } });
    if (!branch) throw new NotFoundException({ error: "branch_not_found" });
    authorizeFor("wallet.topup", { organizationId: orgId(), brandId: branch.brandId, branchId: branch.id });

    const done = await tx().payment.findFirst({ where: { idempotencyKey: `${body.idempotencyKey}:pay` }, select: { id: true } });
    if (done) return { customerId, timeBalanceMinutes: await timeBalance(tx(), customerId), duplicate: true };

    const customer = await tx().customer.findUnique({ where: { id: customerId }, select: { id: true, displayName: true, membershipTier: { select: { gamingDiscountPct: true } } } });
    if (!customer) throw new NotFoundException({ error: "not_found" });
    const unit = (await tx().currency.findUnique({ where: { code: branch.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
    const row = await tx().pricingPlan.findUnique({ where: { id: body.planId }, include: { pricingPackages: true } });
    if (!row || !row.isActive || (row.branchId && row.branchId !== branch.id)) throw new NotFoundException({ error: "plan_not_found" });
    const plan = toPlanDef(row, unit);
    const now = new Date();
    let q;
    try {
      q = quote(plan, body.packageId ? { kind: "package", packageId: body.packageId } : { kind: "minutes", minutes: body.minutes! }, { branchId: branch.id, zoneId: row.zoneId ?? "", stationClass: plan.stationClass, membershipTierId: null, timezone: branch.timezone, now }, { membershipDiscountPct: Number(customer.membershipTier?.gamingDiscountPct ?? 0) });
    } catch (e) {
      if (e instanceof PricingError) throw new ConflictException({ error: e.code, message: e.message });
      throw e;
    }

    const stamp = `${now.toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const bill = await tx().bill.create({ data: { organizationId: orgId(), branchId: branch.id, number: `${branch.code}-${stamp}`, customerId, currency: branch.currency, openedById: principal().employeeId } });
    const product =
      (await tx().product.findFirst({ where: { sku: "SYS-PREPAID-TIME" }, select: { id: true } })) ??
      (await tx().product.create({
        data: {
          organizationId: orgId(), sku: "SYS-PREPAID-TIME", name: "Prepaid gaming time", type: "GAMING_TIME", price: 0, currency: branch.currency, availableInShell: false,
          categoryId: ((await tx().productCategory.findFirst({ where: { name: "Gaming" }, select: { id: true } })) ?? (await tx().productCategory.create({ data: { organizationId: orgId(), name: "Gaming", showInShell: false } }))).id,
        },
        select: { id: true },
      }));
    const amount = fromMinor(q.totalMinor, unit);
    const order = await tx().order.create({
      data: { organizationId: orgId(), branchId: branch.id, number: `T-${stamp}`, channel: "POS", type: "COUNTER", status: "COMPLETED", paymentState: "PAID", billId: bill.id, customerId, employeeId: principal().employeeId, subtotal: fromMinor(q.grossMinor, unit), discountTotal: fromMinor(q.membershipDiscountMinor, unit), total: amount, currency: branch.currency, placedAt: now, completedAt: now },
    });
    await tx().orderItem.create({ data: { organizationId: orgId(), orderId: order.id, productId: product.id, nameSnapshot: `Prepaid time — ${q.lines[0]}`, productType: "GAMING_TIME", quantity: q.minutes!, unitPrice: fromMinor(Math.round(q.grossMinor / q.minutes!), unit), discountAmount: fromMinor(q.membershipDiscountMinor, unit), lineTotal: amount, status: "SERVED" } });
    const pay = await tx().payment.create({
      data: { organizationId: orgId(), branchId: branch.id, billId: bill.id, customerId, employeeId: principal().employeeId, method: body.payment.method, provider: "MANUAL", providerRef: body.payment.reference ?? null, status: "CAPTURED", amount, currency: branch.currency, idempotencyKey: `${body.idempotencyKey}:pay`, capturedAt: now },
    });
    await tx().bill.update({ where: { id: bill.id }, data: { subtotal: order.subtotal, discountTotal: order.discountTotal, total: amount, paidTotal: amount, status: "SETTLED", closedAt: now } });
    const org = await tx().organization.findFirstOrThrow({ select: { defaultCurrency: true } });
    const r = await adjustTime(tx(), { organizationId: orgId(), customerId, branchId: branch.id, currency: org.defaultCurrency, deltaMinutes: q.minutes!, type: "TOPUP", reason: q.lines[0]!, referenceType: "BILL", referenceId: bill.id, paymentId: pay.id, employeeId: principal().employeeId, idempotencyKey: `${body.idempotencyKey}:time` });
    await this.audit.record({ action: "customer.time.sell", entityType: "Customer", entityId: customerId, branchId: branch.id, after: { minutes: q.minutes, amount, method: body.payment.method, billId: bill.id } });
    return { customerId, minutesAdded: q.minutes, amount, currency: branch.currency, billNumber: bill.number, timeBalanceMinutes: r.balanceAfter };
  }
}
