import { NotFoundException } from "@nestjs/common";
import type { TenantTx } from "@arena/db";

/**
 * Everything a printed or downloaded receipt shows: the venue (legal name,
 * address, tax number), each item, discounts and tax, payments, and the
 * gaming time on the bill. Voided and refunded lines are left out.
 */
export async function receipt(t: TenantTx, billId: string, where: { customerId?: string } = {}) {
  const b = await t.bill.findFirst({
    where: { id: billId, ...where },
    include: {
      customer: { select: { displayName: true, username: true } },
      table: { select: { name: true } },
      orders: { where: { status: { not: "CANCELLED" } }, select: { number: true, orderItems: { where: { status: { notIn: ["VOIDED", "REFUNDED"] } }, select: { nameSnapshot: true, quantity: true, unitPrice: true, discountAmount: true, taxAmount: true, lineTotal: true } } } },
      payments: { where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] } }, select: { method: true, amount: true, capturedAt: true, status: true } },
      gamingSessions: { select: { startedAt: true, endedAt: true, billedSeconds: true, device: { select: { name: true } } } },
    },
  });
  if (!b) throw new NotFoundException({ error: "not_found" });
  const branch = await t.branch.findUniqueOrThrow({ where: { id: b.branchId }, select: { name: true, addressLine1: true, addressLine2: true, city: true, phone: true, timezone: true } });
  const org = await t.organization.findFirstOrThrow({ select: { displayName: true, legalName: true, taxNumber: true } });
  const unit = (await t.currency.findUnique({ where: { code: b.currency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
  const m = (d: { toFixed: (n: number) => string }) => d.toFixed(unit);
  return {
    venue: { name: org.displayName, legalName: org.legalName, taxNumber: org.taxNumber, branch: branch.name, address: [branch.addressLine1, branch.addressLine2, branch.city].filter(Boolean).join(", ") || null, phone: branch.phone, timezone: branch.timezone },
    bill: { id: b.id, number: b.number, status: b.status, openedAt: b.openedAt, closedAt: b.closedAt, table: b.table?.name ?? null, customer: b.customer?.displayName ?? null, currency: b.currency },
    items: b.orders.flatMap((o) => o.orderItems.map((i) => ({ order: o.number, name: i.nameSnapshot, quantity: Number(i.quantity), unitPrice: m(i.unitPrice), discount: m(i.discountAmount), tax: m(i.taxAmount), total: m(i.lineTotal) }))),
    play: b.gamingSessions.map((s) => ({ station: s.device?.name ?? null, startedAt: s.startedAt, endedAt: s.endedAt, minutes: Math.round(s.billedSeconds / 60) })),
    totals: { subtotal: m(b.subtotal), discount: m(b.discountTotal), tax: m(b.taxTotal), tip: m(b.tipTotal), total: m(b.total), paid: m(b.paidTotal), due: m(b.total.minus(b.paidTotal)) },
    payments: b.payments.map((p) => ({ method: p.method, amount: m(p.amount), at: p.capturedAt, refunded: p.status !== "CAPTURED" })),
  };
}
