import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { RequirePermission } from "../common/decorators.js";
import { orgId, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const ORG_FIELDS = {
  id: true, slug: true, legalName: true, displayName: true, status: true, countryCode: true,
  defaultCurrency: true, defaultTimezone: true, defaultLocale: true, supportedLocales: true,
  taxNumber: true, billingEmail: true, settings: true, createdAt: true,
} as const;

const UpdateOrg = z
  .object({
    legalName: z.string().min(2).max(200),
    displayName: z.string().min(2).max(120),
    defaultTimezone: z.string().min(3).max(64),
    defaultLocale: z.string().min(2).max(10),
    supportedLocales: z.array(z.string().min(2).max(10)).min(1).max(20),
    taxNumber: z.string().max(64).nullable(),
    billingEmail: z.email(),
    settings: z.record(z.string(), z.unknown()),
  })
  .partial()
  .strict(); // status, slug, currency are platform-managed

const Brand = z.object({
  name: z.string().min(2).max(120),
  logoUrl: z.url().max(500).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  shellTheme: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

@Controller()
export class OrganizationsController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @RequirePermission("org.view")
  @Get("organization")
  get() {
    return tx().organization.findFirstOrThrow({ select: ORG_FIELDS });
  }

  @RequirePermission("org.manage")
  @Patch("organization")
  async update(@Body(new ZodPipe(UpdateOrg)) body: z.infer<typeof UpdateOrg>) {
    const before = await tx().organization.findFirstOrThrow({ select: ORG_FIELDS });
    const after = await tx().organization.update({ where: { id: before.id }, data: body as any, select: ORG_FIELDS });
    await this.audit.record({ action: "org.update", entityType: "Organization", entityId: after.id, before, after });
    return after;
  }

  @RequirePermission("org.view")
  @Get("brands")
  brands() {
    return tx().brand.findMany({ orderBy: { name: "asc" } });
  }

  @RequirePermission("org.manage")
  @Post("brands")
  async createBrand(@Body(new ZodPipe(Brand)) body: z.infer<typeof Brand>) {
    const brand = await tx().brand.create({ data: { ...body, organizationId: orgId() } as any });
    await this.audit.record({ action: "brand.create", entityType: "Brand", entityId: brand.id, after: brand });
    return brand;
  }

  @RequirePermission("org.manage")
  @Patch("brands/:brandId")
  async updateBrand(@Param("brandId") brandId: string, @Body(new ZodPipe(Brand.partial().strict())) body: Partial<z.infer<typeof Brand>>) {
    const before = await tx().brand.findUniqueOrThrow({ where: { id: brandId } });
    const after = await tx().brand.update({ where: { id: brandId }, data: body as any });
    await this.audit.record({ action: "brand.update", entityType: "Brand", entityId: brandId, before, after });
    return after;
  }
}
