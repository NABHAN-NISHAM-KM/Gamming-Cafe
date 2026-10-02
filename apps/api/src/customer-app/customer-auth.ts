import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Db, TenantTx } from "@arena/db";
import { TokensService } from "../auth/tokens.service.js";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";

export interface Me {
  customerId: string;
  organizationId: string;
  sid: string;
}

/** Sliding-window attempt counter (per IP, per account). */
export class Throttle {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
  clear(key: string) {
    this.hits.delete(key);
  }
}

/**
 * Runs a customer-app request: verifies the customer token (its own audience,
 * revocable per login), then works in the customer's own tenant as the
 * CUSTOMER actor. Work queued for after the commit (live updates, pushes)
 * runs once the transaction has committed.
 */
@Injectable()
export class CustomerAuth {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TokensService) private readonly tokens: TokensService,
  ) {}

  async as<T>(req: Request, fn: (t: TenantTx, me: Me) => Promise<T>): Promise<T> {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException({ error: "missing_token" });
    const claims = await this.tokens.verifyCustomer(token);
    const me: Me = { customerId: claims.customerId, organizationId: claims.org, sid: claims.sid };
    const afterCommit: Array<() => void | Promise<void>> = [];
    const result = await this.db.withTenant({ organizationId: me.organizationId, actorType: "CUSTOMER", actorId: me.customerId }, (t) =>
      requestStore.run({ tx: t, afterCommit, principal: null as never, decision: null, requestId: "app", ip: req.ip ?? null, userAgent: null, reason: null }, async () => {
        const s = await t.customerSession.findFirst({ where: { id: me.sid, customerId: me.customerId, endedAt: null }, select: { lastActiveAt: true, customer: { select: { status: true } } } });
        if (!s || s.customer.status === "BANNED" || s.customer.status === "DELETED") throw new UnauthorizedException({ error: "session_ended" });
        if (Date.now() - s.lastActiveAt.getTime() > 5 * 60_000) await t.customerSession.update({ where: { id: me.sid }, data: { lastActiveAt: new Date() } });
        return fn(t, me);
      }),
    );
    for (const f of afterCommit) await Promise.resolve(f()).catch(() => undefined);
    return result;
  }
}
