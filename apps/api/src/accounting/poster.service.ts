import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Db } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { DB } from "../common/db.module.js";
import { postPending } from "./posting.js";
import { reconcile } from "./reconcile.js";

/**
 * Keeps the books current: every few seconds each live organization's new or
 * changed documents are posted to the general ledger (in that tenant's own
 * transaction, a bounded batch at a time so a large backfill never holds one
 * long transaction). Once a day it also reconciles the ledger against the
 * operational balances and records any difference in the audit log.
 */
@Injectable()
export class AccountingPosterService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Accounting");
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly sweepMs = Number(process.env["ACCOUNTING_SWEEP_MS"] ?? 15_000);
  private lastReconciledDay = "";

  constructor(@Inject(DB) private readonly db: Db) {}

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
      const orgs = await this.db.global.$queryRaw<Array<{ organization_id: string }>>`SELECT * FROM app.live_organizations()`;
      for (const { organization_id: organizationId } of orgs) {
        // A few batches per transaction; loop while there's a backlog.
        for (let round = 0; round < 200; round++) {
          const r = await this.db
            .withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, (t) => postPending(t, organizationId, { maxBatches: 20, budgetMs: 4_000 }))
            .catch((e) => {
              this.log.error(`posting for ${organizationId}: ${e instanceof Error ? e.message : e}`);
              return null;
            });
          if (!r?.more) break;
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      if (today !== this.lastReconciledDay) {
        this.lastReconciledDay = today;
        for (const { organization_id: organizationId } of orgs) await this.reconcileOne(organizationId);
      }
    } finally {
      this.running = false;
    }
  }

  private async reconcileOne(organizationId: string) {
    await this.db
      .withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (t) => {
        const r = await reconcile(t);
        const off = r.checks.filter((c) => !c.ok);
        if (off.length) {
          await auditAs(t, { type: "SYSTEM", id: null }, { action: "accounting.reconciliation_difference", entityType: "Organization", entityId: organizationId, after: { checks: off } });
        }
      })
      .catch((e) => this.log.error(`reconciliation for ${organizationId}: ${e instanceof Error ? e.message : e}`));
  }
}
