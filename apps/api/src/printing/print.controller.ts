import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Put, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PRINT_SKU, PrintService } from "./print.service.js";

const Release = z.object({ payWith: z.enum(["BILL", "WALLET"]).optional() }).strict();
const Cancel = z.object({ reason: z.string().min(3).max(200) }).strict();
const Settings = z.object({ requireApproval: z.boolean(), maxPages: z.number().int().min(1).max(2000) }).partial().strict();

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });

async function jobTarget(id: string) {
  const j = await tx().printJob.findUnique({ where: { id }, select: { branchId: true, branch: { select: { brandId: true } } } });
  if (!j) throw new NotFoundException({ error: "print_job_not_found" });
  return { organizationId: orgId(), brandId: j.branch.brandId, branchId: j.branchId };
}

/** The front desk's print queue: what's waiting, releasing held jobs, cancelling, and the branch's print rules. */
@Controller()
export class PrintController {
  constructor(
    @Inject(PrintService) private readonly print: PrintService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @RequirePermission("print.view")
  @Get("branches/:branchId/print-jobs")
  list(@Param("branchId") branchId: string, @Query("open") open?: string) {
    return this.print.list(tx(), branchId, !!open);
  }

  @AnyStaff()
  @Post("print-jobs/:id/release")
  @HttpCode(200)
  async release(@Param("id") id: string, @Body(new ZodPipe(Release)) body: z.infer<typeof Release>) {
    authorizeFor("print.release", await jobTarget(id));
    const result = await this.print.staffRelease(tx(), id, body.payWith, me());
    return { result };
  }

  @AnyStaff()
  @Post("print-jobs/:id/cancel")
  @HttpCode(200)
  async cancel(@Param("id") id: string, @Body(new ZodPipe(Cancel)) body: z.infer<typeof Cancel>) {
    authorizeFor("print.release", await jobTarget(id));
    await this.print.cancel(tx(), id, `staff: ${body.reason}`, "Staff cancelled the print.", me());
    return { cancelled: true };
  }

  @RequirePermission("print.view")
  @Get("branches/:branchId/print-settings")
  async settings(@Param("branchId") branchId: string) {
    const b = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { settings: true } });
    const products = await tx().product.findMany({ where: { sku: { in: [PRINT_SKU.bw, PRINT_SKU.color] } }, select: { id: true, sku: true, price: true, isActive: true, productBranchPrices: { where: { branchId }, select: { price: true, isAvailable: true } } } });
    const priceOf = (sku: string) => {
      const p = products.find((x) => x.sku === sku);
      return p ? { productId: p.id, price: (p.productBranchPrices[0]?.price ?? p.price).toFixed(2), available: p.isActive && p.productBranchPrices[0]?.isAvailable !== false } : null;
    };
    const print = ((b.settings as { print?: { requireApproval?: boolean; maxPages?: number } } | null)?.print ?? {});
    return { requireApproval: !!print.requireApproval, maxPages: print.maxPages ?? 100, bw: priceOf(PRINT_SKU.bw), color: priceOf(PRINT_SKU.color) };
  }

  /** Per-page prices are the PRINT-BW / PRINT-COLOR products (Restaurant → Menu, or a branch price there). */
  @RequirePermission("settings.manage")
  @Put("branches/:branchId/print-settings")
  async saveSettings(@Param("branchId") branchId: string, @Body(new ZodPipe(Settings)) body: z.infer<typeof Settings>) {
    const b = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { settings: true } });
    const current = (b.settings as Record<string, unknown> | null) ?? {};
    const print = { ...((current["print"] as object) ?? {}), ...body };
    await tx().branch.update({ where: { id: branchId }, data: { settings: { ...current, print } as Prisma.InputJsonValue } });
    await this.audit.record({ action: "branch.print_settings", entityType: "Branch", entityId: branchId, branchId, after: print });
    return this.settings(branchId);
  }
}
