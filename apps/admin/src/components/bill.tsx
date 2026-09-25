"use client";

import { useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { money, type BillView } from "@/lib/client/pos";
import { idem } from "@/lib/client/sessions";
import { PayForm } from "@/components/pos";
import { Badge, Button, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui";

const STATUS_TONE: Record<string, "accent" | "ok" | "warn" | "neutral" | "danger"> = { OPEN: "accent", PARTIALLY_PAID: "warn", SETTLED: "ok", VOID: "neutral" };

/** One bill: what's on it, what's paid, and taking the rest. */
export function BillPanel({ billId, branchId, onChanged }: { billId: string; branchId: string; onChanged?: () => void }) {
  const can = useCan();
  const bill = useApi<BillView>(`/bills/${billId}`);
  const [change, setChange] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  // One key per attempt: a double-click or retry can never charge twice.
  const [payKey, setPayKey] = useState(idem);
  const voidItem = useAction(async (id: string, name: string) => {
    const reason = prompt(`Why is “${name}” voided?`);
    if (!reason || reason.trim().length < 3) return;
    await api(`/order-items/${id}/void`, { method: "POST", body: { reason: reason.trim() }, reason: reason.trim(), action: `Void ${name}` });
    await bill.reload();
    onChanged?.();
  });

  if (!bill.data) return bill.error ? <ErrorNote>{bill.error.message}</ErrorNote> : <Spinner />;
  const b = bill.data;
  const due = Number(b.due);
  const live = b.sessions.some((s) => ["PENDING", "ACTIVE", "PAUSED", "ENDING"].includes(s.status));

  return (
    <div className="grid gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status.replace("_", " ").toLowerCase()}</Badge>
        <span className="text-ink-3">Bill {b.number}</span>
        {b.table && <span className="text-ink-3">· Table {b.table.name}</span>}
        {b.customer && <span className="text-ink-3">· {b.customer.displayName}</span>}
        {b.sessions.map((s) => <span key={s.id} className="text-ink-3">· {s.device.name} ({s.status.toLowerCase()})</span>)}
      </div>

      {b.orders.map((o) => (
        <div key={o.id} className="rounded-lg border border-line">
          <p className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-ink-3">
            <span>Order {o.number} · {o.type.replace("_", " ").toLowerCase()}{o.deliverTo ? ` → ${o.deliverTo}` : ""}</span>
            <span>{o.status.replace("_", " ").toLowerCase()}</span>
          </p>
          <ul className="divide-y divide-line/60">
            {o.orderItems.map((x) => (
              <li key={x.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="tabular-nums text-ink-3">{x.quantity}×</span>
                <span className="flex-1">{x.nameSnapshot}{x.modifiers?.length ? <span className="text-ink-3"> · {x.modifiers.map((m) => m.name).join(", ")}</span> : null}</span>
                <span className="tabular-nums">{x.lineTotal}</span>
                {b.status !== "SETTLED" && can("pos.void_item", branchId) && (
                  <button onClick={() => void voidItem.run(x.id, x.nameSnapshot)} className="p-1 text-ink-3 hover:text-danger" title="Void item" aria-label={`Void ${x.nameSnapshot}`}><Ban className="size-3.5" /></button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <ErrorNote>{voidItem.error}</ErrorNote>

      <dl className="grid grid-cols-2 gap-y-1">
        <dt className="text-ink-3">Total (incl. {b.taxTotal} tax)</dt><dd className="text-right tabular-nums">{money(b.total ?? 0, b.currency)}</dd>
        {Number(b.discountTotal) > 0 && <><dt className="text-ink-3">Discount</dt><dd className="text-right tabular-nums">−{b.discountTotal}</dd></>}
        <dt className="text-ink-3">Paid</dt><dd className="text-right tabular-nums">{b.paidTotal}</dd>
        <dt className="font-medium">Due</dt><dd className="text-right font-semibold tabular-nums">{money(due, b.currency)}</dd>
      </dl>

      {b.payments.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wider text-ink-3">Payments</p>
          <ul className="grid gap-1">
            {b.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="w-14">{p.method.toLowerCase()}</span>
                <span className="tabular-nums">{p.amount}</span>
                {Number(p.refundedAmount) > 0 && <span className="text-xs text-danger">refunded {p.refundedAmount}</span>}
                {p.changeGiven && Number(p.changeGiven) > 0 && <span className="text-xs text-ink-3">change {p.changeGiven}</span>}
                <span className="ml-auto text-xs text-ink-3">{new Date(p.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                {can("pos.refund", branchId) && Number(p.refundedAmount) < Number(p.amount) && (
                  <Button size="sm" variant="ghost" onClick={() => setRefunding(refunding === p.id ? null : p.id)}><RotateCcw className="size-3.5" /> Refund</Button>
                )}
              </li>
            ))}
          </ul>
          {refunding && (
            <RefundForm
              payment={b.payments.find((p) => p.id === refunding)!}
              hasCustomer={!!b.customer}
              onDone={() => { setRefunding(null); void bill.reload(); onChanged?.(); }}
            />
          )}
        </div>
      )}

      {change && <p className="rounded-lg bg-ok/10 px-3 py-2 text-ok">Give change: <strong>{money(change, b.currency)}</strong></p>}

      {due > 0 && b.status !== "VOID" && can("pos.sell", branchId) && (
        <>
          {live && <p className="rounded-lg border border-line px-3 py-2 text-ink-3">A gaming session is still running on this bill — its play time is added when it ends. You can take payment for what's here now.</p>}
          <PayForm
            key={b.paidTotal}
            due={due}
            currency={b.currency}
            walletOk={!!b.customer}
            onPay={async (payments) => {
              const r = await api<BillView>(`/bills/${b.id}/pay`, { method: "POST", body: { payments, idempotencyKey: payKey } });
              setPayKey(idem());
              setChange(r.change && Number(r.change) > 0 ? r.change : null);
              bill.setData(r);
              onChanged?.();
            }}
          />
        </>
      )}
    </div>
  );
}

function RefundForm({ payment, hasCustomer, onDone }: { payment: BillView["payments"][number]; hasCustomer: boolean; onDone: () => void }) {
  const left = Number(payment.amount) - Number(payment.refundedAmount);
  const [f, setF] = useState({ amount: left.toFixed(2), destination: "ORIGINAL_METHOD", reason: "" });
  const [key] = useState(idem);
  const go = useAction(async () => {
    await api(`/payments/${payment.id}/refund`, { method: "POST", action: "Refund", reason: f.reason, body: { ...f, idempotencyKey: key } });
    onDone();
  });
  return (
    <form className="mt-2 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void go.run(); }}>
      <Field label={`Amount (max ${left.toFixed(2)})`}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="Refund to">
        <Select value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>
          <option value="ORIGINAL_METHOD">Original method ({payment.method.toLowerCase()})</option>
          <option value="CASH">Cash from drawer</option>
          {hasCustomer && <option value="WALLET">Customer wallet</option>}
        </Select>
      </Field>
      <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} minLength={3} required placeholder="Wrong item…" /></Field>
      <div className="sm:col-span-3"><ErrorNote>{go.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-3"><Button type="submit" variant="danger" pending={go.pending}><RotateCcw className="size-4" /> Refund</Button></div>
    </form>
  );
}
