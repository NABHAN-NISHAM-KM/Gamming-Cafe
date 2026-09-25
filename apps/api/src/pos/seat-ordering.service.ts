import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import type { Db } from "@arena/db";
import type { SeatMenu, SeatOrderLine } from "@arena/contracts";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import type { Connection } from "../devices/live.js";
import { OrdersService } from "./orders.service.js";

const LIVE = ["PENDING", "ACTIVE", "PAUSED", "ENDING"] as const;

/**
 * Food & drinks from the gaming seat. The PC asks for the menu and places
 * orders over its authenticated socket; the order is always for THIS device's
 * live session (never an id from the message), priced server-side, and either
 * added to the session's bill or paid from the customer's wallet.
 */
@Injectable()
export class SeatOrderingService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    this.gateway.handleStation("menu_request", (c) => this.menu(c));
    this.gateway.handleStation("place_order", (c, m) => this.place(c, m.requestId, m.lines, m.notes ?? null, m.payWith));
  }

  async menu(c: Connection): Promise<{ menu: SeatMenu | null; error?: string }> {
    return this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, async (t) => {
      const m = await this.orders.menu(t, c.branchId, { shellOnly: true });
      const s = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: [...LIVE] } }, select: { customerId: true } });
      return {
        menu: {
          currency: m.currency,
          canPayWithWallet: !!s?.customerId,
          categories: m.categories.map((cat) => ({
            id: cat.id, name: cat.name,
            products: cat.products.map((p) => ({ id: p.id, name: p.name, description: p.description, price: p.price, available: p.available, modifierGroups: p.modifierGroups })),
          })),
        },
      };
    });
  }

  async place(c: Connection, requestId: string, lines: SeatOrderLine[], notes: string | null, payWith: "BILL" | "WALLET") {
    // Background request (no HTTP request state): collect after-commit work and run it ourselves.
    const afterCommit: Array<() => void | Promise<void>> = [];
    const result = await this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, (t) =>
      requestStore.run({ tx: t, afterCommit, principal: null as never, decision: null, requestId, ip: null, userAgent: null, reason: null }, async () => {
        const s = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: [...LIVE] } }, select: { id: true, customerId: true } });
        if (!s) throw new ConflictException({ error: "no_session", message: "Sign in to order." });
        if (payWith === "WALLET" && !s.customerId) throw new ConflictException({ error: "wallet_needs_customer", message: "Guests pay at the counter — choose “Add to my bill”." });
        const o = await this.orders.place(
          t,
          {
            branchId: c.branchId, channel: "SHELL", type: "GAMING_SEAT", deviceId: c.deviceId, lines, notes,
            payments: payWith === "WALLET" ? [{ method: "WALLET" }] : undefined, idempotencyKey: `seat:${c.deviceId}:${requestId}`,
          },
          { type: "DEVICE", id: c.deviceId },
        );
        return { ok: true, orderId: o.id, number: o.number, total: o.total, currency: o.currency };
      }),
    );
    for (const fn of afterCommit) await Promise.resolve(fn()).catch(() => undefined);
    return result;
  }
}
