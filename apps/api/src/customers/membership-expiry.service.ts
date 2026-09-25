import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Db } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { CommerceService } from "./commerce.service.js";

/**
 * Ends memberships whose period is over and drops the customer to their next
 * best tier (or none), so discounts and booking windows stop at the right
 * time. Runs for all tenants; each change happens in its own tenant.
 */
@Injectable()
export class MembershipExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Memberships");
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly sweepMs = Number(process.env["MEMBERSHIP_SWEEP_MS"] ?? 60_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.db.global.$queryRaw<Array<{ organization_id: string; membership_id: string; customer_id: string }>>`SELECT * FROM app.memberships_due()`;
      for (const row of due) {
        await this.db
          .withTenant({ organizationId: row.organization_id, actorType: "SYSTEM", actorId: null }, async (t) => {
            const m = await t.membership.updateMany({ where: { id: row.membership_id, status: "ACTIVE", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
            if (!m.count) return;
            const tier = await this.commerce.recomputeTier(t, row.customer_id);
            await auditAs(t, { type: "SYSTEM", id: null }, { action: "membership.expire", entityType: "Membership", entityId: row.membership_id, after: { customerId: row.customer_id, tierNow: tier } });
          })
          .catch((e) => this.log.error(`membership ${row.membership_id}: ${e instanceof Error ? e.message : e}`));
      }
    } finally {
      this.running = false;
    }
  }
}
