"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Monitor, Package, Printer, ReceiptText, ShoppingBag, StickyNote, Truck, Utensils, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useBranch } from "@/lib/client/branch";
import type { FloorDevice } from "@/lib/client/floor";
import { useCan, useMe } from "@/lib/client/me";
import { ORDER_TYPE, money, type OrderView } from "@/lib/client/pos";
import { BillPanel } from "@/components/bill";
import { LIVE_EVENT } from "@/components/live-notices";
import { Badge, Button, Empty, ErrorNote, Modal, PageHeader, Select, Spinner, askText, cx, toast } from "@/components/ui";

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
const DEAD = new Set(["VOIDED", "REFUNDED"]);

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const lines = (o: OrderView) => o.items.filter((x) => !DEAD.has(x.status));
// A bill with a live session stays OPEN even when fully paid, so "paid" means nothing left to pay.
const isPaid = (o: OrderView) => !!o.bill && (o.bill.status === "SETTLED" || Number(o.bill.due) <= 0);
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function OrdersPage() {
  const { branches, branchId, setBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  // "Take a payment" on the Counter links here with ?open=1: start on what's still to pay.
  useEffect(() => setOpen(new URLSearchParams(window.location.search).get("open") === "1"), []);
  const [selected, setSelected] = useState<string | null>(null);
  const orders = useApi<OrderView[]>(branchId ? `/branches/${branchId}/orders${open ? "?open=1" : ""}` : null);
  const current = orders.data?.find((o) => o.id === selected) ?? null;

  // Live: any order or kitchen change at this branch → refresh (the poll is only a fallback).
  useEffect(() => {
    let soon: ReturnType<typeof setTimeout>;
    const onLive = (e: Event) => {
      const t = (e as CustomEvent<{ type: string }>).detail.type;
      if (t !== "order" && t !== "kitchen") return;
      clearTimeout(soon);
      soon = setTimeout(() => void orders.reload(), 400); // let the change commit, and batch bursts
    };
    window.addEventListener(LIVE_EVENT, onLive);
    const poll = setInterval(() => void orders.reload(), 60_000);
    return () => {
      window.removeEventListener(LIVE_EVENT, onLive);
      clearTimeout(soon);
      clearInterval(poll);
    };
  }, [orders.reload]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        subtitle="Every food and counter order from the last 24 hours. Tap one to print, take payment or move it to a PC's bill."
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
          {orders.data.map((o) => <OrderCard key={o.id} o={o} onOpen={() => setSelected(o.id)} />)}
        </div>
      )}
      <Modal open={!!current} onClose={() => setSelected(null)} title={current ? `Order ${current.number}` : ""} wide>
        {current && branchId && <OrderDetail o={current} branchId={branchId} onChanged={() => void orders.reload()} />}
      </Modal>
    </div>
  );
}

function payBadge(o: OrderView) {
  if (o.status === "CANCELLED" || o.status === "REFUNDED") return <Badge tone="danger">Cancelled</Badge>;
  if (isPaid(o)) return <Badge tone="ok">Paid</Badge>;
  return o.bill ? <Badge tone="warn">Unpaid</Badge> : null;
}

function OrderCard({ o, onOpen }: { o: OrderView; onOpen: () => void }) {
  const Icon = TYPE_ICON[o.type] ?? Utensils;
  const st = STATUS[o.status] ?? STATUS.PLACED;
  const count = lines(o).length;
  const cancelled = o.status === "CANCELLED" || o.status === "REFUNDED";
  return (
    <button onClick={onOpen} className="surface press flex flex-col rounded-2xl p-4 text-left transition-[border-color] hover:border-line-strong">
      <span className="flex w-full items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{o.customer?.displayName ?? o.deliverTo ?? "Walk-in"}</span>
          <span className="block truncate text-xs text-ink-3">Order {o.number} · {ORDER_TYPE[o.type] ?? o.type}</span>
        </span>
        {payBadge(o)}
      </span>
      <span className="mt-4 flex w-full items-center justify-between border-b border-dashed border-line pb-3 text-sm">
        <span className="text-ink-3">{when(o.createdAt)}</span>
        <span className="font-medium">{count} item{count === 1 ? "" : "s"}</span>
      </span>
      <span className="mt-3 flex w-full items-center justify-between">
        <span className={cx("font-display text-lg font-bold tabular-nums", cancelled && "text-ink-3 line-through")}>{money(o.total, o.currency)}</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><span className={cx("size-2 rounded-full", st.dot)} />{st.label}</span>
      </span>
      {o.notes && <span className="mt-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-line bg-bg/40 px-3 py-2 text-xs text-ink-2"><StickyNote className="size-3.5 shrink-0" /><span><strong className="text-ink">Note:</strong> {o.notes}</span></span>}
    </button>
  );
}

function OrderDetail({ o, branchId, onChanged }: { o: OrderView; branchId: string; onChanged: () => void }) {
  const can = useCan();
  const me = useMe();
  const [paying, setPaying] = useState(false);
  const [moving, setMoving] = useState(false);
  const [seat, setSeat] = useState("");
  const live = o.status !== "CANCELLED" && o.status !== "REFUNDED";
  const unpaid = live && !!o.bill && !isPaid(o);
  const canMove = unpaid && can("station.view", branchId);
  const floor = useApi<{ devices: FloorDevice[] }>(moving ? `/branches/${branchId}/floor` : null);
  const seats = useMemo(
    () => (floor.data?.devices ?? []).filter((d) => d.session && ["ACTIVE", "PAUSED", "PENDING"].includes(d.session.status)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [floor.data],
  );

  const move = useAction(async () => {
    await api(`/orders/${o.id}/move-to-seat`, { method: "POST", body: { deviceId: seat }, action: `Move order ${o.number} to ${seats.find((d) => d.id === seat)?.name ?? "a PC"}'s bill` });
    setMoving(false);
    onChanged();
  });
  const cancel = useAction(async () => {
    const reason = await askText(`Cancel order ${o.number}? Items not yet started go back to stock; the kitchen stops working on it.`);
    if (!reason) return;
    await api(`/orders/${o.id}/cancel`, { method: "POST", body: { reason }, reason, action: `Cancel order ${o.number}` });
    onChanged();
  });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <Badge>{ORDER_TYPE[o.type] ?? o.type}</Badge>
        {payBadge(o)}
        <span>{o.customer?.displayName ?? "Walk-in"}</span>
        {o.deliverTo && <span>· {o.deliverTo}</span>}
        <span className="ml-auto text-ink-3">{when(o.createdAt)}</span>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-bg/40">
        {o.items.map((x) => (
          <li key={x.id} className={cx("flex gap-3 px-4 py-2.5", DEAD.has(x.status) && "text-ink-3 line-through")}>
            <span className="w-10 shrink-0 font-semibold tabular-nums text-accent">{qty(x.quantity)}×</span>
            <span className="min-w-0 flex-1">
              {x.nameSnapshot}
              {x.modifiers?.length ? <span className="block text-xs text-ink-3">+ {x.modifiers.map((m) => m.name).join(" · ")}</span> : null}
              {x.notes && <span className="block text-xs text-reserved">“{x.notes}”</span>}
            </span>
            <span className="tabular-nums">{money(x.lineTotal, o.currency)}</span>
          </li>
        ))}
      </ul>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm">
        <dt className="text-ink-3">Subtotal</dt><dd className="text-right tabular-nums">{money(o.subtotal, o.currency)}</dd>
        {Number(o.discountTotal) > 0 && <><dt className="text-ink-3">Discount</dt><dd className="text-right tabular-nums">−{money(o.discountTotal, o.currency)}</dd></>}
        <dt className="text-ink-3">Tax</dt><dd className="text-right tabular-nums">{money(o.taxTotal, o.currency)}</dd>
        <dt className="font-semibold">Total</dt><dd className="text-right font-display text-lg font-bold tabular-nums">{money(o.total, o.currency)}</dd>
        {o.bill && <><dt className="text-ink-3">Bill {o.bill.number}</dt><dd className="text-right tabular-nums text-ink-2">{Number(o.bill.due) > 0 ? `${money(o.bill.due, o.currency)} due` : "paid"}</dd></>}
      </dl>

      {o.notes && <p className="rounded-lg bg-reserved/10 px-3 py-2 text-sm text-reserved">{o.notes}</p>}
      {o.cancelReason && <p className="text-sm text-danger">Cancelled: {o.cancelReason}</p>}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button onClick={() => printReceipt(o, me.organization.displayName)}><Printer className="size-4" />Print</Button>
        {o.bill && <a href={`/receipt?bill=${o.bill.id}`} target="_blank" rel="noreferrer" className="press inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink"><ReceiptText className="size-4" />Full receipt</a>}
        {unpaid && o.bill && can("pos.sell", branchId) && <Button variant={paying ? "secondary" : "primary"} onClick={() => setPaying(!paying)}><Wallet className="size-4" />{paying ? "Hide payment" : "Pay"}</Button>}
        {canMove && <Button onClick={() => setMoving(!moving)}><Monitor className="size-4" />Move to PC bill</Button>}
        {live && o.status !== "COMPLETED" && can("restaurant.cancel_order", branchId) && (
          <Button variant="danger" className="ml-auto" pending={cancel.pending} onClick={() => void cancel.run()}><Ban className="size-4" />Cancel order</Button>
        )}
      </div>
      <ErrorNote>{cancel.error}</ErrorNote>

      {moving && (
        <div className="grid gap-3 rounded-xl border border-line p-4">
          <p className="text-sm text-ink-2">Put this order on the bill of someone playing now. They pay for it with their session.</p>
          {!floor.data ? <Spinner /> : seats.length === 0 ? (
            <p className="text-sm text-ink-3">Nobody is playing right now.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Select value={seat} onChange={(e) => setSeat(e.target.value)} className="w-auto min-w-56" aria-label="PC">
                <option value="">Choose a PC…</option>
                {seats.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.session?.customer?.displayName ?? d.session?.guestLabel ?? "Guest"}</option>)}
              </Select>
              <Button variant="primary" disabled={!seat} pending={move.pending} onClick={() => void move.run()}>Move</Button>
            </div>
          )}
          <ErrorNote>{move.error}</ErrorNote>
        </div>
      )}

      {paying && o.bill && <BillPanel billId={o.bill.id} branchId={branchId} onChanged={onChanged} />}
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** An 80 mm receipt in its own window, so the browser's print dialog shows only the receipt. */
function printReceipt(o: OrderView, venue: string) {
  const w = window.open("", "_blank", "width=420,height=640");
  if (!w) return toast("Allow pop-ups for this site to print.", "warn");
  const row = (l: string, r: string, cls = "") => `<tr class="${cls}"><td>${l}</td><td class="r">${r}</td></tr>`;
  const items = lines(o).map((x) => row(`${qty(x.quantity)} × ${esc(x.nameSnapshot)}${x.modifiers?.length ? `<div class="m">+ ${esc(x.modifiers.map((m) => m.name).join(", "))}</div>` : ""}`, money(x.lineTotal, o.currency))).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Order ${esc(o.number)}</title><style>
    body{font:13px/1.4 ui-monospace,Consolas,monospace;width:72mm;margin:4mm auto;color:#000}
    h1{font-size:16px;text-align:center;margin:0 0 2px}.c{text-align:center}.m{font-size:11px;color:#444}
    table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}
    .t td{border-top:1px dashed #000;padding-top:6px;font-weight:bold;font-size:15px}hr{border:0;border-top:1px dashed #000}
  </style></head><body>
    <h1>${esc(venue)}</h1>
    <div class="c">Order ${esc(o.number)} · ${esc(ORDER_TYPE[o.type] ?? o.type)}</div>
    <div class="c">${esc(when(o.createdAt))}</div>
    ${o.customer || o.deliverTo ? `<div class="c">${esc([o.customer?.displayName, o.deliverTo].filter(Boolean).join(" · "))}</div>` : ""}
    <hr><table>${items}
    ${row("Subtotal", money(o.subtotal, o.currency))}
    ${Number(o.discountTotal) > 0 ? row("Discount", `−${money(o.discountTotal, o.currency)}`) : ""}
    ${row("Tax", money(o.taxTotal, o.currency))}
    ${row("Total", money(o.total, o.currency), "t")}
    ${o.bill ? (isPaid(o) ? row("Paid", money(o.total, o.currency)) : row("Due", money(o.bill.due, o.currency))) : ""}
    </table>${o.notes ? `<hr><div>Note: ${esc(o.notes)}</div>` : ""}<hr><div class="c">Thank you!</div>
  </body></html>`);
  w.document.close();
  w.focus();
  w.print();
  w.onafterprint = () => w.close();
}
