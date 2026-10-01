"use client";

import { useEffect, useState } from "react";
import { Monitor, Package, ReceiptText, ShoppingBag, StickyNote, Truck, Utensils } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { useBranch } from "@/lib/client/branch";
import { ORDER_TYPE, money, type OrderView } from "@/lib/client/pos";
import { Badge, Empty, ErrorNote, PageHeader, Select, Spinner, cx } from "@/components/ui";

const TYPE_ICON: Record<string, typeof Utensils> = { DINE_IN: Utensils, GAMING_SEAT: Monitor, TAKEAWAY: ShoppingBag, PICKUP: ShoppingBag, DELIVERY: Truck, COUNTER: Package };
const STATUS: Record<OrderView["status"], { label: string; dot: string }> = {
  DRAFT: { label: "Draft", dot: "bg-ink-3" },
  PLACED: { label: "Order placed", dot: "bg-reserved" },
  ACCEPTED: { label: "Order placed", dot: "bg-reserved" },
  IN_PROGRESS: { label: "Cooking", dot: "bg-reserved" },
  READY: { label: "Ready", dot: "bg-accent" },
  SERVED: { label: "Delivered", dot: "bg-ok" },
  COMPLETED: { label: "Delivered", dot: "bg-ok" },
  CANCELLED: { label: "Cancelled", dot: "bg-danger" },
  REFUNDED: { label: "Refunded", dot: "bg-ink-3" },
};

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function OrdersPage() {
  const { branches, branchId, setBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  const orders = useApi<OrderView[]>(branchId ? `/branches/${branchId}/orders${open ? "?open=1" : ""}` : null);

  useEffect(() => {
    const t = setInterval(() => void orders.reload(), 30_000);
    return () => clearInterval(t);
  }, [orders.reload]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        subtitle="Every food and counter order from the last 24 hours."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            <Select value={open ? "open" : "all"} onChange={(e) => setOpen(e.target.value === "open")} className="w-auto" aria-label="Show">
              <option value="all">All orders</option>
              <option value="open">Open only</option>
            </Select>
          </div>
        }
      />
      <ErrorNote>{orders.error?.message}</ErrorNote>
      {!orders.data ? (
        <Spinner />
      ) : orders.data.length === 0 ? (
        <Empty icon={<ReceiptText className="size-8" />} title="No orders yet">Orders from the POS, tables and in-seat appear here.</Empty>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {orders.data.map((o) => <OrderCard key={o.id} o={o} />)}
        </div>
      )}
    </div>
  );
}

function OrderCard({ o }: { o: OrderView }) {
  const Icon = TYPE_ICON[o.type] ?? Utensils;
  const st = STATUS[o.status];
  const count = o.items.filter((x) => x.status !== "VOIDED").reduce((n, x) => n + x.quantity, 0);
  const cancelled = o.status === "CANCELLED" || o.status === "REFUNDED";
  const paid = o.bill?.status === "SETTLED";
  return (
    <article className="surface flex flex-col rounded-2xl p-4">
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{o.customer?.displayName ?? o.deliverTo ?? "Walk-in"}</p>
          <p className="truncate text-xs text-ink-3">Order {o.number} · {ORDER_TYPE[o.type] ?? o.type}</p>
        </div>
        {cancelled ? <Badge tone="danger">Cancelled</Badge> : paid ? <Badge tone="ok">Paid</Badge> : o.bill ? <Badge tone="warn">Unpaid</Badge> : null}
      </header>
      <div className="mt-4 flex items-center justify-between border-b border-dashed border-line pb-3 text-sm">
        <span className="text-ink-3">{when(o.createdAt)}</span>
        <span className="font-medium">{count} item{count === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className={cx("font-display text-lg font-bold tabular-nums", cancelled && "text-ink-3 line-through")}>{money(o.total, o.currency)}</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className={cx("size-2 rounded-full", st.dot)} />{st.label}</span>
      </div>
      {o.notes && <p className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-line bg-bg/40 px-3 py-2 text-xs text-ink-2"><StickyNote className="size-3.5 shrink-0" /><span><strong className="text-ink">Note:</strong> {o.notes}</span></p>}
    </article>
  );
}
