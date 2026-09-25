import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { RequirePermission } from "../common/decorators.js";
import { orgId, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";

const ZONE_TYPES = ["PC_STANDARD", "PC_VIP", "BOOTCAMP", "STREAMING", "CONSOLE", "VR", "SIMULATOR", "INTERNET", "RESTAURANT", "PRIVATE_ROOM", "OTHER"] as const;

const Zone = z
  .object({
    name: z.string().min(1).max(80),
    type: z.enum(ZONE_TYPES),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    minAge: z.number().int().min(0).max(99).nullish(),
    openingHours: z.record(z.string(), z.unknown()).nullish(),
    bookingRules: z
      .object({
        leadTimeMinutes: z.number().int().min(0),
        minDurationMinutes: z.number().int().min(15),
        maxDurationMinutes: z.number().int().min(15),
        depositPercent: z.number().min(0).max(100),
        cancellationWindowMinutes: z.number().int().min(0),
      })
      .partial()
      .default({}),
    floorMap: z
      .object({ width: z.number().int().min(1).max(200), height: z.number().int().min(1).max(200), background: z.string().max(500).optional() })
      .partial()
      .default({}),
  })
  .strict();

@Controller()
export class ZonesController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @RequirePermission("zone.view")
  @Get("branches/:branchId/zones")
  list(@Param("branchId") branchId: string) {
    return tx().zone.findMany({
      where: { branchId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { devices: true } } },
    });
  }

  @RequirePermission("zone.manage")
  @Post("branches/:branchId/zones")
  async create(@Param("branchId") branchId: string, @Body(new ZodPipe(Zone)) body: z.infer<typeof Zone>) {
    const zone = await tx().zone.create({ data: { ...body, openingHours: body.openingHours ?? undefined, branchId, organizationId: orgId() } as any });
    await this.audit.record({ action: "zone.create", entityType: "Zone", entityId: zone.id, branchId, after: zone });
    return zone;
  }

  @RequirePermission("zone.view")
  @Get("zones/:zoneId")
  get(@Param("zoneId") zoneId: string) {
    return tx().zone.findUniqueOrThrow({ where: { id: zoneId } });
  }

  @RequirePermission("zone.manage")
  @Patch("zones/:zoneId")
  async update(@Param("zoneId") zoneId: string, @Body(new ZodPipe(Zone.partial().strict())) body: Partial<z.infer<typeof Zone>>) {
    const before = await tx().zone.findUniqueOrThrow({ where: { id: zoneId } });
    const after = await tx().zone.update({ where: { id: zoneId }, data: body as any });
    await this.audit.record({ action: "zone.update", entityType: "Zone", entityId: zoneId, branchId: after.branchId, before, after });
    return after;
  }

  /** Soft delete: stations and history keep their zone reference. */
  @RequirePermission("zone.manage")
  @Delete("zones/:zoneId")
  @HttpCode(204)
  async archive(@Param("zoneId") zoneId: string) {
    const before = await tx().zone.findUniqueOrThrow({ where: { id: zoneId } });
    await tx().zone.update({ where: { id: zoneId }, data: { isActive: false } });
    await this.audit.record({ action: "zone.archive", entityType: "Zone", entityId: zoneId, branchId: before.branchId, before });
  }
}
