import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { TenantTx } from "@arena/db";
import { auditAs } from "../common/audit.service.js";
import { DeviceHub, LiveBus } from "../devices/live.js";
import { requestStore } from "../common/request-state.js";
import { PushService } from "../push/push.service.js";

type TicketStatus = "NEW" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED";
const NEXT: Record<string, TicketStatus[]> = { NEW: ["ACCEPTED", "PREPARING"], ACCEPTED: ["PREPARING"], PREPARING: ["READY"], READY: ["SERVED"] };

/** What the customer sees on their PC as the order moves along. */
const SHELL_TEXT: Record<string, string> = { PREPARING: "Your order is being prepared", READY: "Your order is ready — it's on its way to you", SERVED: "Enjoy your meal!" };

/**
 * Kitchen display: tickets per station, bumped NEW → PREPARING → READY →
 * SERVED. The order follows its tickets; a gaming PC hears about its order
 * (in the Shell) as it moves.
 */
@Injectable()
export class KitchenService {
  constructor(
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  async board(t: TenantTx, branchId: string, stationId?: string | null) {
    const since = new Date(Date.now() - 20 * 60_000);
    const tickets = await t.kitchenTicket.findMany({
      where: { branchId, ...(stationId ? { stationId } : {}), OR: [{ status: { in: ["NEW", "ACCEPTED", "PREPARING", "READY"] } }, { status: "SERVED", servedAt: { gte: since } }] },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        station: { select: { id: true, name: true } },
        order: { select: { id: true, number: true, type: true, channel: true, notes: true, customer: { select: { displayName: true } } } },
        orderItems: { where: { status: { notIn: ["VOIDED", "REFUNDED"] } }, select: { id: true, nameSnapshot: true, quantity: true, modifiers: true, notes: true, status: true } },
      },
    });
    const stations = await t.kitchenStation.findMany({ where: { branchId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    return {
      stations,
      serverTime: new Date().toISOString(),
      tickets: tickets
        .filter((tk) => tk.orderItems.length > 0)
        .map((tk) => ({
          id: tk.id, status: tk.status, station: tk.station, deliverTo: tk.deliverTo, notes: tk.notes, createdAt: tk.createdAt, startedAt: tk.startedAt, readyAt: tk.readyAt, servedAt: tk.servedAt,
          order: { id: tk.order.id, number: tk.order.number, type: tk.order.type, channel: tk.order.channel, notes: tk.order.notes, customer: tk.order.customer?.displayName ?? null },
          items: tk.orderItems.map((x) => ({ ...x, quantity: Number(x.quantity) })),
        })),
    };
  }

  async bump(t: TenantTx, ticketId: string, to: TicketStatus, actor: { type: "EMPLOYEE"; id: string }) {
    const tk = await t.kitchenTicket.findUnique({ where: { id: ticketId }, include: { order: { select: { id: true, number: true, deviceId: true, organizationId: true, branchId: true, status: true, customerId: true } } } });
    if (!tk) throw new NotFoundException({ error: "not_found" });
    if (!(NEXT[tk.status] ?? []).includes(to)) throw new ConflictException({ error: "bad_transition", from: tk.status, to });
    const now = new Date();
    await t.kitchenTicket.update({
      where: { id: ticketId },
      data: {
        status: to, bumpedById: actor.id,
        ...(to === "ACCEPTED" ? { acceptedAt: now } : {}), ...(to === "PREPARING" ? { startedAt: now, acceptedAt: tk.acceptedAt ?? now } : {}),
        ...(to === "READY" ? { readyAt: now } : {}), ...(to === "SERVED" ? { servedAt: now } : {}),
      },
    });
    const itemStatus = to === "PREPARING" ? "PREPARING" : to === "READY" ? "READY" : to === "SERVED" ? "SERVED" : null;
    if (itemStatus) await t.orderItem.updateMany({ where: { kitchenTicketId: ticketId, status: { notIn: ["VOIDED", "REFUNDED"] } }, data: { status: itemStatus } });

    // The order is as far along as its slowest ticket.
    const all = await t.kitchenTicket.findMany({ where: { orderId: tk.orderId, status: { not: "CANCELLED" } }, select: { status: true } });
    const rank = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];
    const slowest = all.reduce((m, x) => Math.min(m, rank.indexOf(x.status)), 4);
    const started = all.some((x) => rank.indexOf(x.status) >= 2); // any station has begun
    const orderStatus = slowest >= 4 ? "SERVED" : slowest >= 3 ? "READY" : started ? "IN_PROGRESS" : "ACCEPTED";
    if (orderStatus !== tk.order.status) {
      await t.order.update({ where: { id: tk.orderId }, data: { status: orderStatus, ...(orderStatus === "SERVED" ? { completedAt: now } : {}) } });
    }
    await auditAs(t, actor, { action: `kitchen.${to.toLowerCase()}`, entityType: "KitchenTicket", entityId: ticketId, branchId: tk.branchId, after: { order: tk.order.number } });
    if (orderStatus === "READY" && tk.order.status !== "READY" && tk.order.customerId) {
      await this.push.notify(t, { customerId: tk.order.customerId, event: "order.ready", title: `Order ${tk.order.number} is ready`, body: tk.order.deviceId ? "It's on its way to your seat." : "Pick it up at the counter.", screen: "orders", dedupeKey: `order-ready:${tk.orderId}`, branchId: tk.order.branchId });
    }

    const publish = () => {
      this.bus.publish(tk.order.organizationId, tk.order.branchId, { type: "kitchen", ticket: { id: ticketId, stationId: tk.stationId, status: to, orderId: tk.orderId } });
      if (tk.order.deviceId && orderStatus !== tk.order.status && SHELL_TEXT[orderStatus === "IN_PROGRESS" ? "PREPARING" : orderStatus]) {
        const key = (orderStatus === "IN_PROGRESS" ? "PREPARING" : orderStatus) as "PREPARING" | "READY" | "SERVED";
        this.hub.send(tk.order.deviceId, { type: "order_status", orderId: tk.orderId, number: tk.order.number, status: key, message: SHELL_TEXT[key]! });
      }
    };
    const req = requestStore.getStore();
    if (req) req.afterCommit.push(publish);
    else publish();
    return { id: ticketId, status: to, orderStatus };
  }
}
