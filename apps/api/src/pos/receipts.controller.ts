import { Controller, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import { RequirePermission } from "../common/decorators.js";
import { tx } from "../common/request-state.js";
import { CONFIG, type AppConfig } from "../config.js";
import { receipt } from "./receipt.js";

/** Printable receipts, and the QR codes that put a branch's menu on each table. */
@Controller()
export class ReceiptsController {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  @RequirePermission("pos.sell")
  @Get("bills/:billId/receipt")
  receipt(@Param("billId") billId: string) {
    return receipt(tx(), billId);
  }

  /** Each table's link: scanning it opens the menu in the customer app, and orders land on that table's bill. */
  @RequirePermission("restaurant.tables_manage")
  @Get("branches/:branchId/table-qr")
  async tableQr(@Param("branchId") branchId: string) {
    const b = await tx().branch.findUnique({ where: { id: branchId }, select: { name: true } });
    if (!b) throw new NotFoundException({ error: "not_found" });
    const { slug } = await tx().organization.findFirstOrThrow({ select: { slug: true } });
    const tables = await tx().restaurantTable.findMany({ where: { branchId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    const app = `${this.cfg.CUSTOMER_APP_URL.replace(/\/+$/, "")}/${slug}`;
    return { branch: b.name, tables: tables.map((t) => ({ ...t, url: `${app}?table=${t.id}` })) };
  }
}
