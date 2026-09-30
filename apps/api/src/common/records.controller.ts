import { ConflictException, Controller, Delete, ForbiddenException, HttpCode, Inject, NotFoundException, Param } from "@nestjs/common";
import { Prisma } from "@arena/db";
import { AuditService } from "./audit.service.js";
import { RequirePermission } from "./decorators.js";
import { orgId, tx } from "./request-state.js";

type Row = Record<string, unknown> & { id: string; organizationId?: string | null };
interface Kind {
  model: string;
  entityType: string;
  /** What "delete" leaves behind when other records still point at the row. Omit = refuse. */
  archive?: Record<string, unknown>;
  /** Never hard-delete (cascades would wipe history); always archive. */
  archiveOnly?: boolean;
  /** Returns an error code when this row must not be deleted at all. */
  protect?: (r: Row) => string | null;
}

const ARCHIVE = { isActive: false };
const KINDS: Record<string, Kind> = {
  supplier: { model: "supplier", entityType: "Supplier", archive: ARCHIVE },
  "inventory-item": { model: "inventoryItem", entityType: "InventoryItem", archive: ARCHIVE },
  warehouse: { model: "warehouse", entityType: "Warehouse", archive: ARCHIVE },
  product: { model: "product", entityType: "Product", archive: ARCHIVE },
  "product-category": { model: "productCategory", entityType: "ProductCategory", archive: ARCHIVE },
  table: { model: "restaurantTable", entityType: "RestaurantTable", archive: ARCHIVE },
  "kitchen-station": { model: "kitchenStation", entityType: "KitchenStation", archive: ARCHIVE },
  zone: { model: "zone", entityType: "Zone", archive: ARCHIVE },
  game: { model: "game", entityType: "Game", archive: ARCHIVE },
  "shell-app": { model: "shellApp", entityType: "ShellApp", archive: ARCHIVE },
  "pricing-plan": { model: "pricingPlan", entityType: "PricingPlan", archive: ARCHIVE },
  "pricing-package": { model: "pricingPackage", entityType: "PricingPackage", archive: ARCHIVE },
  "membership-tier": { model: "membershipTier", entityType: "MembershipTier", archive: ARCHIVE },
  "loyalty-rule": { model: "loyaltyRule", entityType: "LoyaltyRule", archive: ARCHIVE },
  "loyalty-reward": { model: "loyaltyReward", entityType: "LoyaltyReward", archive: ARCHIVE },
  "ledger-account": { model: "ledgerAccount", entityType: "LedgerAccount", archive: ARCHIVE, protect: (r) => (r["systemKey"] ? "system_account" : null) },
  promotion: { model: "promotion", entityType: "Promotion", archive: { status: "ARCHIVED" } },
  segment: { model: "customerSegment", entityType: "CustomerSegment", protect: (r) => (r["key"] ? "segment_built_in" : null) },
  campaign: { model: "campaign", entityType: "Campaign", protect: (r) => (r["status"] === "DRAFT" ? null : "campaign_sent") },
  tournament: { model: "tournament", entityType: "Tournament", protect: (r) => (r["status"] === "DRAFT" ? null : "tournament_started") },
  role: { model: "role", entityType: "Role", protect: (r) => (r["isSystem"] ? "system_role" : null) },
  "purchase-order": { model: "purchaseOrder", entityType: "PurchaseOrder", protect: (r) => (r["status"] === "DRAFT" ? null : "po_not_draft") },
  branch: { model: "branch", entityType: "Branch", archive: { status: "CLOSED" }, archiveOnly: true },
};

/**
 * One owner/admin-only "delete" for the organization's setup data. It removes
 * the row when nothing references it; when history does (orders, stock,
 * sessions…) it archives instead, so reports and ledgers stay intact.
 * Transactions (orders, payments, journals, stock movements) are never deleted
 * here — they have their own void/cancel flows.
 */
@Controller("records")
export class RecordsController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @RequirePermission("org.records_manage")
  @Delete(":kind/:id")
  @HttpCode(200)
  async remove(@Param("kind") kindKey: string, @Param("id") id: string): Promise<{ result: "deleted" | "archived" }> {
    const kind = KINDS[kindKey];
    if (!kind) throw new NotFoundException({ error: "unknown_kind" });
    const t = tx() as unknown as Record<string, { findUnique: (a: unknown) => Promise<Row | null>; delete: (a: unknown) => Promise<unknown>; update: (a: unknown) => Promise<unknown> }> & { $executeRawUnsafe: (q: string) => Promise<number> };
    const model = t[kind.model]!;
    const before = await model.findUnique({ where: { id } });
    // Platform catalog rows (organizationId = null) are readable by tenants but never theirs to delete.
    if (!before || ("organizationId" in before && before.organizationId !== orgId())) throw new NotFoundException({ error: "not_found" });
    const blocked = kind.protect?.(before);
    if (blocked) throw new ForbiddenException({ error: blocked });

    const archive = async () => {
      if (!kind.archive) throw new ConflictException({ error: "in_use", hint: "Other records still use this, so it can't be deleted." });
      await model.update({ where: { id }, data: kind.archive });
      await this.audit.record({ action: `${kind.entityType.toLowerCase()}.archive`, entityType: kind.entityType, entityId: id, before, after: kind.archive });
      return { result: "archived" as const };
    };
    if (kind.archiveOnly) return archive();

    // A failed DELETE aborts the Postgres transaction; the savepoint lets us fall back to archiving.
    await t.$executeRawUnsafe("SAVEPOINT record_delete");
    try {
      await model.delete({ where: { id } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || !["P2003", "P2014"].includes(e.code)) throw e;
      await t.$executeRawUnsafe("ROLLBACK TO SAVEPOINT record_delete");
      return archive();
    }
    await t.$executeRawUnsafe("RELEASE SAVEPOINT record_delete");
    await this.audit.record({ action: `${kind.entityType.toLowerCase()}.delete`, entityType: kind.entityType, entityId: id, before });
    return { result: "deleted" };
  }
}
