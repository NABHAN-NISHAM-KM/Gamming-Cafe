"use client";

import { useMemo, useState } from "react";
import { Ban, Check, CheckCircle2, FileText, PackageCheck, Pencil, Plus, Send, ShoppingBasket, Trash2, Truck, Undo2, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import {
  PO_STATUS_LABEL, PO_TONE, qtyLabel,
  type Invoice, type Item, type PoRow, type PoStatus, type PoView, type Suggestion, type Supplier, type WarehouseSummary,
} from "@/lib/client/inventory";
import { useCan, useMe } from "@/lib/client/me";
import { idem } from "@/lib/client/sessions";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

type Tab = "orders" | "reorder" | "suppliers" | "invoices";
const whLabel = (w: { name: string; branch: { code: string } | null }) => `${w.branch?.code ?? "Central"} · ${w.name}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—");
const OPEN: PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"];

export default function PurchasingPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>("orders");
  const warehouses = useApi<WarehouseSummary[]>("/warehouses");
  const suppliers = useApi<Supplier[]>("/suppliers");
  const tabs: Tab[] = ["orders", "reorder", "suppliers", ...(can("purchasing.view") ? (["invoices"] as Tab[]) : [])];
  return (
    <div className="space-y-5">
      <PageHeader title="Purchasing" subtitle="Order from suppliers, approve big orders, receive deliveries into stock, and match supplier invoices to what arrived." />
      <div className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm capitalize", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>{t === "reorder" ? "Reorder" : t}</button>
        ))}
      </div>
      {warehouses.error ? <ErrorNote>{warehouses.error.message}</ErrorNote> : !warehouses.data || !suppliers.data ? <Spinner /> : tab === "orders" ? (
        <Orders warehouses={warehouses.data} suppliers={suppliers.data} />
      ) : tab === "reorder" ? (
        <Reorder warehouses={warehouses.data} onDrafted={() => setTab("orders")} />
      ) : tab === "suppliers" ? (
        <Suppliers suppliers={suppliers.data} reload={() => void suppliers.reload()} />
      ) : (
        <Invoices suppliers={suppliers.data} />
      )}
    </div>
  );
}

// ── orders ──────────────────────────────────────────────────────────────────

function Orders({ warehouses, suppliers }: { warehouses: WarehouseSummary[]; suppliers: Supplier[] }) {
  const can = useCan();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const list = useApi<PoRow[]>(`/purchase-orders${filter === "open" ? `?status=${OPEN.join(",")}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value as "open" | "all")} className="w-auto"><option value="open">Open orders</option><option value="all">All orders</option></Select>
        {can("purchasing.create") && <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> Purchase order</Button>}
      </div>
      <Card>
        {!list.data ? <Spinner /> : list.data.length === 0 ? <Empty icon={<Truck className="size-8" />} title="No orders">Raise a purchase order, or draft them from Reorder.</Empty> : (
          <Table head={["Order", "Supplier", "Deliver to", "Status", "Expected", "Total", "Raised by"]}>
            {list.data.map((p) => (
              <tr key={p.id} className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={() => setOpen(p.id)}>
                <td className="px-4 py-2 font-mono text-xs">{p.number}</td>
                <td className="px-4 py-2">{p.supplier}</td>
                <td className="px-4 py-2 text-ink-2">{p.branch} · {p.warehouse}</td>
                <td className="px-4 py-2"><Badge tone={PO_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Badge></td>
                <td className="px-4 py-2 text-ink-2">{day(p.expectedAt)}</td>
                <td className="px-4 py-2 tabular-nums">{p.currency} {p.total}</td>
                <td className="px-4 py-2 text-ink-3">{p.createdBy}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!open} onClose={() => { setOpen(null); void list.reload(); }} title="Purchase order" wide>
        {open && <PoDetail id={open} onChanged={() => void list.reload()} />}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="New purchase order" wide>
        {creating && <PoForm warehouses={warehouses} suppliers={suppliers} onDone={(id) => { setCreating(false); void list.reload(); setOpen(id); }} />}
      </Modal>
    </div>
  );
}

type Draft = { key: string; itemId: string; packs: string; unitCost: string; tax: string };

/** Quantities are entered in packs (cases) when the item has one, and sent in base units. */
function PoForm({ warehouses, suppliers, po, onDone }: { warehouses: WarehouseSummary[]; suppliers: Supplier[]; po?: PoView; onDone: (id: string) => void }) {
  const items = useApi<Item[]>("/inventory/items");
  const [supplierId, setSupplierId] = useState(po?.supplier.id ?? suppliers.find((s) => s.isActive)?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(po?.warehouse.id ?? warehouses[0]?.id ?? "");
  const [expectedAt, setExpectedAt] = useState(po?.expectedAt?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(po?.notes ?? "");
  const [lines, setLines] = useState<Draft[]>(
    po ? po.lines.map((l) => ({ key: l.id, itemId: l.item.id, packs: String(Number(l.quantityOrdered) / (Number(l.item.purchaseUnitQty) || 1)), unitCost: String(Number(l.unitCost) * (Number(l.item.purchaseUnitQty) || 1)), tax: String(Number(l.taxRatePercent)) })) : [],
  );
  const byId = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const pack = (id: string) => Number(byId.get(id)?.purchaseUnitQty ?? 0) || 1;
  const add = (itemId: string) => {
    const i = byId.get(itemId);
    if (!i || lines.some((l) => l.itemId === itemId)) return;
    const perPack = Number(i.lastPurchaseCost ?? i.averageCost) * pack(itemId);
    setLines([...lines, { key: idem(), itemId, packs: "1", unitCost: perPack ? perPack.toFixed(2) : "", tax: "5" }]);
    if (!po && i.defaultSupplierId && !lines.length) setSupplierId(i.defaultSupplierId);
  };
  const total = lines.reduce((a, l) => a + (Number(l.packs) || 0) * (Number(l.unitCost) || 0) * (1 + (Number(l.tax) || 0) / 100), 0);
  const save = useAction(async () => {
    const body = {
      expectedAt: expectedAt || null, notes: notes || null,
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: String(Number(l.packs) * pack(l.itemId)), unitCost: (Number(l.unitCost) / pack(l.itemId)).toFixed(4), taxRatePercent: l.tax || "0" })),
    };
    const r = po ? await api<PoView>(`/purchase-orders/${po.id}`, { method: "PATCH", body }) : await api<PoView>("/purchase-orders", { method: "POST", body: { ...body, supplierId, warehouseId } });
    onDone(r.id);
  });
  const available = (items.data ?? []).filter((i) => i.isActive && !lines.some((l) => l.itemId === i.id)).sort((a, b) => Number(b.defaultSupplierId === supplierId) - Number(a.defaultSupplierId === supplierId) || a.name.localeCompare(b.name));
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!!po} required>{suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Deliver to"><Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={!!po} required>{warehouses.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}</Select></Field>
        <Field label="Expected"><Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
      </div>
      <div className="rounded-lg border border-line">
        <div className="grid grid-cols-[1fr_90px_110px_70px_90px_32px] gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-3">
          <span>Item</span><span>Qty</span><span>Cost each</span><span>Tax %</span><span className="text-right">Line</span><span />
        </div>
        {lines.map((l) => {
          const i = byId.get(l.itemId);
          const unit = i?.purchaseUnit && pack(l.itemId) > 1 ? i.purchaseUnit : i?.baseUnit;
          return (
            <div key={l.key} className="grid grid-cols-[1fr_90px_110px_70px_90px_32px] items-center gap-2 border-b border-line/60 px-3 py-1.5 text-sm">
              <span>{i?.name ?? "…"}<span className="block text-[11px] text-ink-3">per {unit}{pack(l.itemId) > 1 ? ` of ${pack(l.itemId)} ${i?.baseUnit}` : ""}</span></span>
              <Input inputMode="decimal" value={l.packs} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, packs: e.target.value } : x)))} aria-label="Quantity" />
              <Input inputMode="decimal" value={l.unitCost} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, unitCost: e.target.value } : x)))} aria-label="Cost" />
              <Input inputMode="decimal" value={l.tax} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, tax: e.target.value } : x)))} aria-label="Tax" />
              <span className="text-right tabular-nums">{((Number(l.packs) || 0) * (Number(l.unitCost) || 0)).toFixed(2)}</span>
              <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="text-ink-3 hover:text-danger" aria-label="Remove line"><Trash2 className="size-4" /></button>
            </div>
          );
        })}
        <div className="px-3 py-2">
          <Select value="" onChange={(e) => add(e.target.value)} aria-label="Add item">
            <option value="">+ Add an item…</option>
            {available.map((i) => <option key={i.id} value={i.id}>{i.name}{i.defaultSupplierId === supplierId ? " ★" : ""}</option>)}
          </Select>
        </div>
      </div>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex items-center justify-end gap-3">
        <span className="text-sm text-ink-3">Total incl. tax <strong className="tabular-nums text-ink">{total.toFixed(2)}</strong></span>
        <Button type="submit" variant="primary" pending={save.pending} disabled={!lines.length || !supplierId || !warehouseId}>{po ? "Save" : "Create draft"}</Button>
      </div>
    </form>
  );
}

function PoDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const can = useCan();
  const me = useMe();
  const po = useApi<PoView>(`/purchase-orders/${id}`);
  const warehouses = useApi<WarehouseSummary[]>("/warehouses");
  const suppliers = useApi<Supplier[]>("/suppliers");
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const act = useAction(async (path: string, body?: unknown, reason?: string) => {
    const r = await api<PoView>(`/purchase-orders/${id}/${path}`, { method: "POST", body: body ?? {}, reason, action: path === "approve" ? "Approve purchase order" : undefined });
    po.setData(r);
    onChanged();
  });
  if (!po.data) return po.error ? <ErrorNote>{po.error.message}</ErrorNote> : <Spinner />;
  const p = po.data;
  const b = p.branchId ?? undefined;
  const mine = p.createdBy.id === me.employee.id;
  const ask = (q: string) => {
    const r = prompt(q);
    return r && r.trim().length >= 3 ? r.trim() : null;
  };

  if (editing && warehouses.data && suppliers.data) return <PoForm po={p} warehouses={warehouses.data} suppliers={suppliers.data} onDone={() => { setEditing(false); void po.reload(); onChanged(); }} />;
  if (receiving) return <ReceiveForm po={p} onDone={(r) => { setReceiving(false); po.setData(r); onChanged(); }} onCancel={() => setReceiving(false)} />;

  return (
    <div className="grid gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base">{p.number}</span>
        <Badge tone={PO_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Badge>
        <span className="text-ink-3">{p.supplier.name} → {p.warehouse.branch?.code ?? "Central"} · {p.warehouse.name}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <div><dt className="text-xs text-ink-3">Raised</dt><dd>{p.createdBy.displayName} · {day(p.createdAt)}</dd></div>
        <div><dt className="text-xs text-ink-3">Approved</dt><dd>{p.approvedBy ?? (p.approvedAt ? "Under the limit" : "—")}</dd></div>
        <div><dt className="text-xs text-ink-3">Expected</dt><dd>{day(p.expectedAt)}</dd></div>
        <div><dt className="text-xs text-ink-3">Supplier contact</dt><dd>{p.supplier.phone ?? p.supplier.email ?? "—"}</dd></div>
      </dl>
      <Table head={["Item", "Ordered", "Received", "Cost each", "Line"]}>
        {p.lines.map((l) => (
          <tr key={l.id} className="border-t border-line">
            <td className="px-4 py-2">{l.item.name}</td>
            <td className="px-4 py-2 tabular-nums">{qtyLabel(l.quantityOrdered, l.item.baseUnit, l.item.purchaseUnitQty, l.item.purchaseUnit)}</td>
            <td className={cx("px-4 py-2 tabular-nums", Number(l.outstanding) === 0 ? "text-ok" : Number(l.quantityReceived) > 0 ? "text-reserved" : "text-ink-3")}>{Number(l.quantityReceived)}</td>
            <td className="px-4 py-2 tabular-nums text-ink-2">{Number(l.unitCost).toFixed(4)}</td>
            <td className="px-4 py-2 tabular-nums">{l.lineTotal}</td>
          </tr>
        ))}
      </Table>
      <p className="text-right">Subtotal {p.subtotal} · tax {p.taxTotal} · <strong>total {p.currency} {p.total}</strong>{Number(p.receivedValue) > 0 && <span className="text-ink-3"> · received so far {p.receivedValue}</span>}</p>
      {p.notes && <p className="whitespace-pre-line rounded-lg bg-panel-2 px-3 py-2 text-ink-2">{p.notes}</p>}
      {p.invoices.length > 0 && <p className="text-ink-2">Invoices: {p.invoices.map((i) => `${i.invoiceNumber} (${i.status.toLowerCase().replace("_", " ")})`).join(", ")}</p>}
      <ErrorNote>{act.error}</ErrorNote>
      <div className="flex flex-wrap justify-end gap-2">
        {p.status === "DRAFT" && can("purchasing.create", b) && (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
            <Button variant="primary" pending={act.pending} onClick={() => void act.run("submit")}><Send className="size-4" /> Submit</Button>
          </>
        )}
        {p.status === "PENDING_APPROVAL" && can("purchasing.approve", b) && !mine && (
          <>
            <Button variant="ghost" pending={act.pending} onClick={() => { const r = ask("Why is it sent back?"); if (r) void act.run("approve", { approve: false, note: r }, r); }}><Undo2 className="size-4" /> Send back</Button>
            <Button variant="primary" pending={act.pending} onClick={() => { const r = ask(`Approve ${p.currency} ${p.total}? Reason:`); if (r) void act.run("approve", { approve: true, note: r }, r); }}><Check className="size-4" /> Approve</Button>
          </>
        )}
        {p.status === "PENDING_APPROVAL" && mine && <span className="self-center text-ink-3">Waiting for another manager to approve.</span>}
        {p.status === "APPROVED" && can("purchasing.create", b) && <Button variant="primary" pending={act.pending} onClick={() => void act.run("ordered")}><Send className="size-4" /> Mark as sent to supplier</Button>}
        {["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"].includes(p.status) && can("purchasing.receive", b) && <Button variant="primary" onClick={() => setReceiving(true)}><PackageCheck className="size-4" /> Receive delivery</Button>}
        {p.status === "PARTIALLY_RECEIVED" && can("purchasing.receive", b) && <Button variant="ghost" pending={act.pending} onClick={() => { const r = ask("Why won't the rest arrive?"); if (r) void act.run("close", { reason: r }); }}>Close short</Button>}
        {["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED"].includes(p.status) && can("purchasing.create", b) && (
          <Button variant="danger" pending={act.pending} onClick={() => { const r = ask("Why is it cancelled?"); if (r) void act.run("cancel", { reason: r }); }}><Ban className="size-4" /> Cancel</Button>
        )}
      </div>
    </div>
  );
}

function ReceiveForm({ po, onDone, onCancel }: { po: PoView; onDone: (r: PoView) => void; onCancel: () => void }) {
  const open = po.lines.filter((l) => Number(l.outstanding) > 0);
  const [rows, setRows] = useState(() => Object.fromEntries(open.map((l) => [l.id, { quantity: String(Number(l.outstanding)), unitCost: "", lotCode: "", expiresAt: "", serials: "" }])));
  const [note, setNote] = useState("");
  const [key] = useState(idem);
  const save = useAction(async () => {
    const lines = open
      .map((l) => ({ l, r: rows[l.id]! }))
      .filter(({ r }) => Number(r.quantity) > 0)
      .map(({ l, r }) => ({
        lineId: l.id, quantity: r.quantity, unitCost: r.unitCost ? (Number(r.unitCost) / (Number(l.item.purchaseUnitQty) || 1)).toFixed(4) : null,
        lotCode: r.lotCode || null, expiresAt: r.expiresAt || null, serialNumbers: l.item.trackSerial && r.serials.trim() ? r.serials.split(/[\s,]+/).filter(Boolean) : null,
      }));
    onDone(await api<PoView>(`/purchase-orders/${po.id}/receive`, { method: "POST", body: { lines, note: note || null, idempotencyKey: key } }));
  });
  const set = (id: string, k: string, v: string) => setRows({ ...rows, [id]: { ...rows[id]!, [k]: v } });
  return (
    <form className="grid gap-4 text-sm" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <p className="text-ink-3">Count what arrived. Anything short stays on order; the rest goes into <strong className="text-ink">{po.warehouse.name}</strong> at the order's cost (or the invoiced cost if it changed).</p>
      {open.map((l) => {
        const r = rows[l.id]!;
        return (
          <div key={l.id} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-4">
            <p className="font-medium sm:col-span-4">{l.item.name} <span className="font-normal text-ink-3">· {Number(l.outstanding)} {l.item.baseUnit} outstanding</span></p>
            <Field label={`Received (${l.item.baseUnit})`}><Input inputMode="decimal" value={r.quantity} onChange={(e) => set(l.id, "quantity", e.target.value)} /></Field>
            <Field label={`Invoiced cost per ${l.item.purchaseUnit && Number(l.item.purchaseUnitQty) > 1 ? l.item.purchaseUnit : l.item.baseUnit}`} hint="Blank = as ordered"><Input inputMode="decimal" value={r.unitCost} onChange={(e) => set(l.id, "unitCost", e.target.value)} /></Field>
            {l.item.trackExpiry && (
              <>
                <Field label="Batch"><Input value={r.lotCode} onChange={(e) => set(l.id, "lotCode", e.target.value)} maxLength={40} /></Field>
                <Field label="Expires"><Input type="date" value={r.expiresAt} onChange={(e) => set(l.id, "expiresAt", e.target.value)} /></Field>
              </>
            )}
            {l.item.trackSerial && <Field label="Serial numbers" hint="One per unit, separated by spaces or commas" className="sm:col-span-2"><Input value={r.serials} onChange={(e) => set(l.id, "serials", e.target.value)} /></Field>}
          </div>
        );
      })}
      <Field label="Delivery note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="DN 4471, 2 boxes dented" /></Field>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Back</Button>
        <Button type="submit" variant="primary" pending={save.pending}><PackageCheck className="size-4" /> Receive into stock</Button>
      </div>
    </form>
  );
}

// ── reorder ─────────────────────────────────────────────────────────────────

function Reorder({ warehouses, onDrafted }: { warehouses: WarehouseSummary[]; onDrafted: () => void }) {
  const can = useCan();
  const [wh, setWh] = useState(warehouses[0]?.id ?? "");
  const list = useApi<Suggestion[]>(wh ? `/warehouses/${wh}/reorder` : null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set((list.data ?? []).filter((s) => s.supplier).map((s) => s.itemId));
  const draft = useAction(async () => {
    const r = await api<{ created: Array<{ number: string; supplier: string }>; skipped: string[] }>("/purchasing/reorder", { method: "POST", body: { warehouseId: wh, itemIds: [...chosen] } });
    alert(`Drafted ${r.created.map((c) => `${c.number} (${c.supplier})`).join(", ") || "nothing"}.${r.skipped.length ? ` No supplier set for: ${r.skipped.join(", ")}.` : ""}`);
    onDrafted();
  });
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Select value={wh} onChange={(e) => { setWh(e.target.value); setPicked(null); }} className="w-auto">{warehouses.map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}</Select>
        {can("purchasing.create") && <Button variant="primary" className="ml-auto" disabled={!chosen.size} pending={draft.pending} onClick={() => void draft.run()}><ShoppingBasket className="size-4" /> Draft orders ({chosen.size})</Button>}
      </div>
      <ErrorNote>{draft.error}</ErrorNote>
      <Card>
        {!list.data ? <Spinner /> : list.data.length === 0 ? <Empty icon={<CheckCircle2 className="size-8" />} title="Nothing to reorder">Everything here is above its minimum (counting what's already on order).</Empty> : (
          <Table head={["", "Item", "On hand", "On order", "Min", "Suggested", "Supplier"]}>
            {list.data.map((s) => (
              <tr key={s.itemId} className="border-t border-line">
                <td className="px-4 py-2"><input type="checkbox" disabled={!s.supplier} checked={chosen.has(s.itemId)} onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(s.itemId); else n.delete(s.itemId); setPicked(n); }} aria-label={`Order ${s.name}`} /></td>
                <td className="px-4 py-2">{s.name}</td>
                <td className="px-4 py-2 tabular-nums">{Number(s.onHand)} {s.baseUnit}</td>
                <td className="px-4 py-2 tabular-nums text-ink-2">{Number(s.onOrder)}</td>
                <td className="px-4 py-2 tabular-nums text-ink-3">{Number(s.minStock)}</td>
                <td className="px-4 py-2 font-medium tabular-nums">{qtyLabel(s.suggested, s.baseUnit, s.purchaseUnitQty, s.purchaseUnit)}</td>
                <td className="px-4 py-2">{s.supplier?.name ?? <span className="text-reserved">no supplier set</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

// ── suppliers ───────────────────────────────────────────────────────────────

function Suppliers({ suppliers, reload }: { suppliers: Supplier[]; reload: () => void }) {
  const can = useCan();
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  return (
    <div className="grid gap-4">
      {can("purchasing.suppliers_manage") && <div className="flex justify-end"><Button variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> Supplier</Button></div>}
      <Card>
        <Table head={["Supplier", "Contact", "Terms", "Items", "Orders", "Owed", ""]}>
          {suppliers.map((s) => (
            <tr key={s.id} className={cx("border-t border-line", !s.isActive && "opacity-50")}>
              <td className="px-4 py-2 font-medium">{s.name}</td>
              <td className="px-4 py-2 text-ink-2">{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-4 py-2 text-ink-2">{s.paymentTermsDays} days</td>
              <td className="px-4 py-2 tabular-nums">{s.items}</td>
              <td className="px-4 py-2 tabular-nums">{s.orders}</td>
              <td className={cx("px-4 py-2 tabular-nums", Number(s.owed) > 0 && "text-reserved")}>{s.currency} {s.owed}</td>
              <td className="px-4 py-2 text-right">{can("purchasing.suppliers_manage") && <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}><Pencil className="size-3.5" /></Button>}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New supplier" : editing ? `Edit ${editing.name}` : ""}>
        {editing && <SupplierForm s={editing === "new" ? null : editing} onDone={() => { setEditing(null); reload(); }} />}
      </Modal>
    </div>
  );
}

function SupplierForm({ s, onDone }: { s: Supplier | null; onDone: () => void }) {
  const [f, setF] = useState({ name: s?.name ?? "", contactName: s?.contactName ?? "", email: s?.email ?? "", phone: s?.phone ?? "", taxNumber: s?.taxNumber ?? "", address: s?.address ?? "", paymentTermsDays: String(s?.paymentTermsDays ?? 30), notes: s?.notes ?? "", isActive: s?.isActive ?? true });
  const save = useAction(async () => {
    const body = { name: f.name.trim(), contactName: f.contactName || null, email: f.email || null, phone: f.phone || null, taxNumber: f.taxNumber || null, address: f.address || null, paymentTermsDays: Number(f.paymentTermsDays) || 0, notes: f.notes || null, isActive: f.isActive };
    await api(s ? `/suppliers/${s.id}` : "/suppliers", { method: s ? "PATCH" : "POST", body });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required maxLength={100} /></Field>
      <Field label="Contact"><Input value={f.contactName} onChange={set("contactName")} /></Field>
      <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Tax number (TRN)"><Input value={f.taxNumber} onChange={set("taxNumber")} /></Field>
      <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
      <Field label="Payment terms (days)"><Input type="number" min={0} max={365} value={f.paymentTermsDays} onChange={set("paymentTermsDays")} /></Field>
      {s && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>}
      <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} onChange={set("notes")} maxLength={500} /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>{s ? "Save" : "Add supplier"}</Button></div>
    </form>
  );
}

// ── supplier invoices ───────────────────────────────────────────────────────

const INV_TONE = { UNPAID: "warn", PARTIALLY_PAID: "warn", PAID: "ok", DISPUTED: "danger", VOID: "neutral" } as const;

function Invoices({ suppliers }: { suppliers: Supplier[] }) {
  const can = useCan();
  const [filter, setFilter] = useState("UNPAID,PARTIALLY_PAID,DISPUTED");
  const list = useApi<Invoice[]>(`/supplier-invoices${filter ? `?status=${filter}` : ""}`);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const status = useAction(async (inv: Invoice, s: "DISPUTED" | "UNPAID" | "VOID") => {
    const reason = prompt(s === "DISPUTED" ? "What's wrong with it?" : s === "VOID" ? "Why void it?" : "Why is it resolved?");
    if (!reason || reason.trim().length < 3) return;
    await api(`/supplier-invoices/${inv.id}/status`, { method: "POST", body: { status: s, reason: reason.trim() } });
    void list.reload();
  });
  const due = (list.data ?? []).filter((i) => ["UNPAID", "PARTIALLY_PAID"].includes(i.status)).reduce((a, i) => a + Number(i.due), 0);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
          <option value="UNPAID,PARTIALLY_PAID,DISPUTED">To pay</option>
          <option value="PAID">Paid</option>
          <option value="">All</option>
        </Select>
        <span className="text-sm text-ink-3">Outstanding: <strong className="tabular-nums text-ink">{due.toFixed(2)}</strong></span>
        {can("purchasing.suppliers_manage") && <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}><FileText className="size-4" /> Record invoice</Button>}
      </div>
      <ErrorNote>{status.error}</ErrorNote>
      <Card>
        {!list.data ? <Spinner /> : list.data.length === 0 ? <p className="p-6 text-center text-sm text-ink-3">No invoices here.</p> : (
          <Table head={["Invoice", "Supplier", "Order", "Due", "Total", "Paid", "Match", "Status", ""]}>
            {list.data.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-xs">{i.invoiceNumber}</td>
                <td className="px-4 py-2">{i.supplier.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-2">{i.purchaseOrder?.number ?? "—"}</td>
                <td className={cx("px-4 py-2", i.overdue && "font-semibold text-danger")}>{day(i.dueDate)}{i.overdue ? " · overdue" : ""}</td>
                <td className="px-4 py-2 tabular-nums">{i.total}</td>
                <td className="px-4 py-2 tabular-nums text-ink-2">{i.paidAmount}</td>
                <td className="px-4 py-2">{i.match ? <Badge tone={i.match.status === "MATCHED" ? "ok" : "danger"}>{i.match.status === "MATCHED" ? "matches" : `${i.match.status.toLowerCase()} ${i.match.difference}`}</Badge> : <span className="text-xs text-ink-3">no order</span>}</td>
                <td className="px-4 py-2"><Badge tone={INV_TONE[i.status]}>{i.status.replace("_", " ").toLowerCase()}</Badge></td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  {can("purchasing.suppliers_manage") && ["UNPAID", "PARTIALLY_PAID"].includes(i.status) && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setPaying(i)}><Wallet className="size-3.5" /> Pay</Button>
                      <Button size="sm" variant="ghost" onClick={() => void status.run(i, "DISPUTED")}>Dispute</Button>
                    </>
                  )}
                  {can("purchasing.suppliers_manage") && i.status === "DISPUTED" && <Button size="sm" variant="ghost" onClick={() => void status.run(i, "UNPAID")}>Resolve</Button>}
                  {can("purchasing.suppliers_manage") && i.status !== "VOID" && i.status !== "PAID" && Number(i.paidAmount) === 0 && <Button size="sm" variant="ghost" onClick={() => void status.run(i, "VOID")}>Void</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Record supplier invoice">
        {adding && <InvoiceForm suppliers={suppliers} onDone={() => { setAdding(false); void list.reload(); }} />}
      </Modal>
      <Modal open={!!paying} onClose={() => setPaying(null)} title={paying ? `Pay ${paying.invoiceNumber}` : ""}>
        {paying && <PayInvoiceForm inv={paying} onDone={() => { setPaying(null); void list.reload(); }} />}
      </Modal>
    </div>
  );
}

function InvoiceForm({ suppliers, onDone }: { suppliers: Supplier[]; onDone: () => void }) {
  const [f, setF] = useState({ supplierId: suppliers[0]?.id ?? "", purchaseOrderId: "", invoiceNumber: "", invoiceDate: new Date().toISOString().slice(0, 10), dueDate: "", amount: "", taxAmount: "" });
  const pos = useApi<PoRow[]>(f.supplierId ? `/purchase-orders?supplierId=${f.supplierId}&status=PARTIALLY_RECEIVED,RECEIVED` : null);
  const save = useAction(async () => {
    await api("/supplier-invoices", { method: "POST", body: { ...f, purchaseOrderId: f.purchaseOrderId || null, dueDate: f.dueDate || null, taxAmount: f.taxAmount || "0" } });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Supplier" className="sm:col-span-2"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value, purchaseOrderId: "" })}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="For order" hint="Checked against what was received" className="sm:col-span-2">
        <Select value={f.purchaseOrderId} onChange={set("purchaseOrderId")}><option value="">No order</option>{(pos.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.total}</option>)}</Select>
      </Field>
      <Field label="Invoice number"><Input value={f.invoiceNumber} onChange={set("invoiceNumber")} required maxLength={40} /></Field>
      <Field label="Invoice date"><Input type="date" value={f.invoiceDate} onChange={set("invoiceDate")} required /></Field>
      <Field label="Amount (before tax)"><Input inputMode="decimal" value={f.amount} onChange={set("amount")} required /></Field>
      <Field label="Tax"><Input inputMode="decimal" value={f.taxAmount} onChange={set("taxAmount")} placeholder="0.00" /></Field>
      <Field label="Due date" hint="Blank = supplier's terms" className="sm:col-span-2"><Input type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>Record</Button></div>
    </form>
  );
}

function PayInvoiceForm({ inv, onDone }: { inv: Invoice; onDone: () => void }) {
  const [f, setF] = useState({ amount: inv.due, method: "BANK_TRANSFER", reference: "" });
  const save = useAction(async () => {
    await api(`/supplier-invoices/${inv.id}/pay`, { method: "POST", body: { ...f, reference: f.reference || null } });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <p className="text-sm text-ink-3">Records a payment made to {inv.supplier.name} (the transfer itself is done in your bank). Outstanding {inv.currency} {inv.due}.</p>
      <Field label="Amount"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
      <Field label="Paid by">
        <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="BANK_TRANSFER">Bank transfer</option><option value="CHEQUE">Cheque</option><option value="CARD">Card</option><option value="CASH">Cash</option></Select>
      </Field>
      <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} placeholder="Transfer ref / cheque no." /></Field>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending}>Record payment</Button></div>
    </form>
  );
}
