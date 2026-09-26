"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Receipt, ShoppingCart, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import type { FloorDevice } from "@/lib/client/floor";
import { useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { cartTotal, money, type BillView, type CartLine, type Menu, type TableRow, type Tender } from "@/lib/client/pos";
import { idem } from "@/lib/client/sessions";
import { BillPanel } from "@/components/bill";
import { CartList, CustomerPicker, MenuGrid, PayForm, toOrderLines, type PickedCustomer } from "@/components/pos";
import { ShiftPanel, useMyShift } from "@/components/shift";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx } from "@/components/ui";

type OrderType = "COUNTER" | "TAKEAWAY" | "GAMING_SEAT" | "DINE_IN";
const TYPES: Array<{ id: OrderType; label: string }> = [
  { id: "COUNTER", label: "Counter" },
  { id: "TAKEAWAY", label: "Takeaway" },
  { id: "GAMING_SEAT", label: "To a PC" },
  { id: "DINE_IN", label: "Table" },
];
type Tab = "sell" | "bills" | "shift";

export default function PosPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const [tab, setTab] = useState<Tab>("sell");
  const shift = useMyShift(branchId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Point of sale"
        subtitle="Counter sales, orders to PCs and tables, open bills and your cash shift."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            {can("shift.open", branchId ?? undefined) && (
              <button onClick={() => setTab("shift")} className="text-left">
                {shift.data ? <Badge tone="ok"><Wallet className="size-3" /> Shift open · {shift.data.drawer}</Badge> : shift.data === null ? <Badge tone="warn">No shift open — cash disabled</Badge> : null}
              </button>
            )}
          </div>
        }
      />
      <div className="flex gap-1 border-b border-line">
        {(["sell", "bills", ...(can("shift.open", branchId ?? undefined) ? ["shift"] : [])] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {t === "sell" ? "Sell" : t === "bills" ? "Open bills" : "My shift"}
          </button>
        ))}
      </div>
      {!branchId ? <Spinner /> : tab === "sell" ? <Sell branchId={branchId} shiftOpen={!!shift.data} /> : tab === "bills" ? <OpenBills branchId={branchId} /> : <ShiftPanel branchId={branchId} shift={shift} />}
    </div>
  );
}

function Sell({ branchId, shiftOpen }: { branchId: string; shiftOpen: boolean }) {
  const can = useCan();
  const menu = useApi<Menu>(`/branches/${branchId}/menu`);
  const floor = useApi<{ devices: FloorDevice[] }>(`/branches/${branchId}/floor`);
  const tables = useApi<TableRow[]>(can("restaurant.order", branchId) ? `/branches/${branchId}/tables` : null);
  const [type, setType] = useState<OrderType>("COUNTER");
  const [target, setTarget] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [discount, setDiscount] = useState({ kind: "PERCENT" as "PERCENT" | "AMOUNT", value: "" });
  const [notes, setNotes] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [paying, setPaying] = useState(false);
  const [key, setKey] = useState(idem);
  const [done, setDone] = useState<{ number: string; total: string; change: string | null; onBill: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => setTarget(""), [type]);
  const seats = useMemo(() => (floor.data?.devices ?? []).filter((d) => d.session && ["ACTIVE", "PAUSED", "PENDING"].includes(d.session.status)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [floor.data]);
  const subtotal = cartTotal(lines);
  const disc = Number(discount.value) || 0;
  const estimate = Math.max(0, discount.kind === "PERCENT" ? subtotal * (1 - Math.min(disc, 100) / 100) : subtotal - disc);
  const needsTarget = type === "GAMING_SEAT" || type === "DINE_IN";
  const ready = lines.length > 0 && (!needsTarget || target);

  const place = async (payments?: Tender[]) => {
    setPending(true);
    setError(null);
    try {
      const o = await api<{ number: string; total: string; bill: { id: string } | null }>(`/branches/${branchId}/orders`, {
        method: "POST",
        action: "Place order",
        body: {
          type, lines: toOrderLines(lines), customerId: customer?.id ?? null,
          deviceId: type === "GAMING_SEAT" ? target : null, tableId: type === "DINE_IN" ? target : null,
          discount: disc > 0 && can("pos.discount", branchId) ? (discount.kind === "PERCENT" ? { kind: "PERCENT", value: disc } : { kind: "AMOUNT", value: disc.toFixed(2) }) : null,
          notes: notes.trim() || null, promoCode: promoCode.trim() || null, ...(payments ? { payments } : {}), idempotencyKey: key,
        },
      });
      // Change comes from the server's record of the payment, not from our estimate.
      let change: string | null = null;
      if (payments && o.bill) {
        const b = await api<BillView>(`/bills/${o.bill.id}`);
        const c = b.payments.reduce((a, p) => a + Number(p.changeGiven ?? 0), 0);
        change = c > 0 ? c.toFixed(2) : null;
      }
      setDone({ number: o.number, total: o.total, change, onBill: !payments });
      setLines([]);
      setCustomer(null);
      setDiscount({ kind: "PERCENT", value: "" });
      setNotes("");
      setPromoCode("");
      setPaying(false);
      setKey(idem());
      void menu.reload();
      if (type === "DINE_IN") void tables.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't place the order.");
      if (payments) throw e;
    } finally {
      setPending(false);
    }
  };

  if (menu.error) return <ErrorNote>{menu.error.message}</ErrorNote>;
  if (!menu.data) return <Spinner />;
  if (!menu.data.categories.length) return <Empty icon={<ShoppingCart className="size-8" />} title="The menu is empty">Add categories and products under Restaurant → Menu.</Empty>;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
      <MenuGrid menu={menu.data} onAdd={(l) => { setLines((all) => [...all, l]); setDone(null); }} />
      <Card className="grid gap-3 p-4 lg:sticky lg:top-20">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-panel-2 p-1">
          {TYPES.filter((t) => t.id !== "DINE_IN" || can("restaurant.order", branchId)).map((t) => (
            <button key={t.id} onClick={() => setType(t.id)} className={cx("rounded-md py-1.5 text-xs", type === t.id ? "bg-panel text-ink shadow" : "text-ink-3")}>{t.label}</button>
          ))}
        </div>
        {type === "GAMING_SEAT" && (
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="PC">
            <option value="">{seats.length ? "Pick the PC…" : "No one is playing right now"}</option>
            {seats.map((d) => <option key={d.id} value={d.id}>{d.name}{d.session?.customer ? ` · ${d.session.customer.displayName}` : ""}</option>)}
          </Select>
        )}
        {type === "DINE_IN" && (
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Table">
            <option value="">Pick the table…</option>
            {(tables.data ?? []).filter((t) => t.status !== "OUT_OF_SERVICE").map((t) => <option key={t.id} value={t.id}>Table {t.name} · {t.status.replace("_", " ").toLowerCase()}{t.bill ? ` · due ${t.bill.due}` : ""}</option>)}
          </Select>
        )}
        {(type === "COUNTER" || type === "TAKEAWAY") && <CustomerPicker value={customer} onChange={setCustomer} />}

        <div className="max-h-[40vh] overflow-y-auto"><CartList lines={lines} setLines={setLines} /></div>

        {lines.length > 0 && (
          <>
            {can("pos.discount", branchId) && (
              <div className="flex items-end gap-2">
                <Field label="Discount" className="flex-1"><Input inputMode="decimal" value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} placeholder="0" /></Field>
                <Select value={discount.kind} onChange={(e) => setDiscount({ ...discount, kind: e.target.value as "PERCENT" | "AMOUNT" })} className="w-24"><option value="PERCENT">%</option><option value="AMOUNT">{menu.data.currency}</option></Select>
              </div>
            )}
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order note (optional)" maxLength={300} />
            <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Promo code (optional)" maxLength={40} aria-label="Promo code" />
            <p className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-sm text-ink-3">Total <span className="text-xs">(incl. VAT{promoCode ? ", before promotions" : ""})</span></span>
              <span className="text-xl font-semibold tabular-nums">{money(estimate, menu.data.currency)}</span>
            </p>
          </>
        )}
        <ErrorNote>{!paying ? error : null}</ErrorNote>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!ready || pending} pending={pending && !paying} onClick={() => void place()} title={type === "COUNTER" || type === "TAKEAWAY" ? "Opens a bill to pay later" : "Adds it to their bill"}>
            <Receipt className="size-4" /> {needsTarget ? "Add to bill" : "Pay later"}
          </Button>
          <Button variant="primary" disabled={!ready || pending} onClick={() => { setError(null); setPaying(true); }}>Charge</Button>
        </div>
        {done && (
          <div className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4" /> Order {done.number} · {money(done.total, menu.data.currency)} {done.onBill ? "added to the bill" : "paid"}</p>
            {done.change && <p className="mt-1 text-base">Give change: <strong>{money(done.change, menu.data.currency)}</strong></p>}
          </div>
        )}
      </Card>

      <Modal open={paying} onClose={() => setPaying(false)} title="Take payment">
        {paying && (
          <>
            {!shiftOpen && <p className="mb-3 rounded-lg border border-reserved/40 bg-reserved/10 px-3 py-2 text-sm text-reserved">No cash shift open — card and wallet only. Open one under “My shift” to take cash.</p>}
            <PayForm due={Number(estimate.toFixed(2))} currency={menu.data.currency} walletOk={!!customer || type === "GAMING_SEAT"} onPay={(t) => place(t)} submitLabel="Charge & send" />
          </>
        )}
      </Modal>
    </div>
  );
}

function OpenBills({ branchId }: { branchId: string }) {
  const bills = useApi<BillView[]>(`/branches/${branchId}/bills?open=1`);
  const [open, setOpen] = useState<string | null>(null);
  if (!bills.data) return bills.error ? <ErrorNote>{bills.error.message}</ErrorNote> : <Spinner />;
  if (!bills.data.length) return <Empty icon={<Receipt className="size-8" />} title="No open bills">Everything's paid.</Empty>;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bills.data.map((b) => (
          <button key={b.id} onClick={() => setOpen(b.id)} className="rounded-xl border border-line bg-panel p-4 text-left transition hover:border-accent">
            <p className="flex items-center justify-between">
              <span className="font-medium">{b.table ? `Table ${b.table.name}` : b.sessions[0] ? b.sessions[0].device.name : `Bill ${b.number}`}</span>
              <span className="text-lg font-semibold tabular-nums">{b.due}</span>
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {b.customer?.displayName ?? "Walk-in"} · {b.orders.length} order{b.orders.length === 1 ? "" : "s"} · since {new Date(b.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => { setOpen(null); void bills.reload(); }} title="Bill" wide>
        {open && <BillPanel billId={open} branchId={branchId} onChanged={() => void bills.reload()} />}
      </Modal>
    </>
  );
}
