"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Boxes, CalendarClock, ClipboardCheck, Minus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import type { FloorDevice } from "@/lib/client/floor";
import { useAction, useApi } from "@/lib/client/hooks";
import {
  CATEGORY_LABEL, MOVE_LABEL, STATUS_TONE, qtyLabel,
  type Item, type Movement, type Overview, type StockRow, type Supplier, type WarehouseStock, type WarehouseSummary,
} from "@/lib/client/inventory";
import { useCan } from "@/lib/client/me";
import { idem } from "@/lib/client/sessions";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

type Tab = "overview" | "stock" | "items" | "movements";
const WH_KEY = "arena.inventory.warehouse";
const whLabel = (w: { name: string; branch: { code: string } | null }) => `${w.branch?.code ?? "Central"} · ${w.name}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

export default function InventoryPage() {
  const overview = useApi<Overview>("/inventory/overview");
  const [tab, setTab] = useState<Tab>("overview");
  const [warehouse, setWarehouse] = useState<string>("");

  useEffect(() => {
    if (warehouse || !overview.data?.warehouses.length) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(WH_KEY);
    } catch {
      /* storage unavailable */
    }
    setWarehouse(overview.data.warehouses.find((w) => w.id === saved)?.id ?? overview.data.warehouses[0]!.id);
  }, [overview.data, warehouse]);
  const pick = (id: string) => {
    setWarehouse(id);
    try {
      localStorage.setItem(WH_KEY, id);
    } catch {
      /* ignore */
    }
  };
  const open = (id: string) => {
    pick(id);
    setTab("stock");
  };

  const can = useCan();
  const [addingStore, setAddingStore] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        subtitle="Stock in every store, what's running low, and every movement — sales, deliveries, waste, transfers and counts."
        actions={can("inventory.manage") && <Button onClick={() => setAddingStore(true)}><Plus className="size-4" /> Add store</Button>}
      />
      <AddStore open={addingStore} onClose={() => setAddingStore(false)} onSaved={() => void overview.reload()} />
      <div className="flex gap-1 border-b border-line">
        {(["overview", "stock", "items", "movements"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm capitalize", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>{t}</button>
        ))}
      </div>
      {overview.error ? (
        <ErrorNote>{overview.error.message}</ErrorNote>
      ) : !overview.data ? (
        <Spinner />
      ) : overview.data.warehouses.length === 0 && tab !== "items" ? (
        <Empty icon={<Boxes className="size-8" />} title="No stores yet">Add a warehouse (a branch store, kitchen, bar or central warehouse) to start tracking stock.</Empty>
      ) : tab === "overview" ? (
        <OverviewTab o={overview.data} onOpen={open} />
      ) : tab === "stock" ? (
        <StockTab warehouses={overview.data.warehouses} warehouse={warehouse} onPick={pick} onChanged={() => void overview.reload()} />
      ) : tab === "items" ? (
        <ItemsTab />
      ) : (
        <MovementsTab warehouses={overview.data.warehouses} warehouse={warehouse} onPick={pick} />
      )}
    </div>
  );
}

const STORE_TYPES: Array<[string, string]> = [["BRANCH_STORE", "Branch store"], ["KITCHEN", "Kitchen"], ["BAR", "Bar"], ["TECH_STORE", "Tech store (spare parts)"], ["CENTRAL", "Central warehouse"]];

/** A place stock lives: a branch store, kitchen, bar, or a central warehouse that serves every branch. */
function AddStore({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const branches = useApi<Array<{ id: string; code: string; name: string }>>(open ? "/branches" : null);
  const [f, setF] = useState({ name: "", type: "BRANCH_STORE", branchId: "" });
  const branchId = f.branchId || branches.data?.[0]?.id || "";
  const save = useAction(async () => {
    await api("/warehouses", { method: "POST", body: { name: f.name.trim(), type: f.type, branchId: f.type === "CENTRAL" ? null : branchId } });
    setF({ name: "", type: "BRANCH_STORE", branchId: "" });
    onSaved();
    onClose();
  });
  return (
    <Modal open={open} onClose={onClose} title="Add store">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Marina kitchen" autoFocus /></Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{STORE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        {f.type !== "CENTRAL" && (
          <Field label="Branch">
            <Select value={branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</Select>
          </Field>
        )}
        <ErrorNote>{save.error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" pending={save.pending}>Add store</Button>
        </div>
      </form>
    </Modal>
  );
}

function WarehousePicker({ warehouses, value, onChange }: { warehouses: WarehouseSummary[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto" aria-label="Warehouse">
      {warehouses.map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}
    </Select>
  );
}

// ── overview ────────────────────────────────────────────────────────────────

function OverviewTab({ o, onOpen }: { o: Overview; onOpen: (warehouseId: string) => void }) {
  const total = o.warehouses.reduce((a, w) => a + Number(w.value), 0);
  const whName = (id: string) => whLabel(o.warehouses.find((w) => w.id === id) ?? { name: "?", branch: null });
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-ink-3">Stock value</p><p className="mt-1 text-2xl font-semibold tabular-nums">{total.toFixed(2)}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-3">Low or out</p><p className={cx("mt-1 text-2xl font-semibold", o.alerts.length ? "text-reserved" : "")}>{o.alerts.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-3">Expiring within 7 days</p><p className={cx("mt-1 text-2xl font-semibold", o.expiring.length ? "text-danger" : "")}>{o.expiring.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-3">Stores</p><p className="mt-1 text-2xl font-semibold">{o.warehouses.length}</p></Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {o.warehouses.map((w) => (
          <button key={w.id} onClick={() => onOpen(w.id)} className="rounded-xl border border-line bg-panel p-4 text-left transition hover:border-accent">
            <p className="flex items-center justify-between"><span className="font-medium">{w.name}</span>{w.alerts > 0 && <Badge tone="warn"><AlertTriangle className="size-3" /> {w.alerts}</Badge>}</p>
            <p className="text-xs text-ink-3">{w.branch ? `${w.branch.code} · ${w.branch.name}` : "Central"} · {w.type.replace("_", " ").toLowerCase()}</p>
            <p className="mt-3 text-lg font-semibold tabular-nums">{w.value}</p>
            <p className="text-xs text-ink-3">{w.items} items stocked</p>
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="flex items-center gap-2 px-5 pt-4 font-semibold"><AlertTriangle className="size-4 text-reserved" /> Running low</h3>
          {o.alerts.length === 0 ? <p className="p-5 text-sm text-ink-3">Everything is above its minimum.</p> : (
            <Table head={["Item", "Store", "On hand", "Min", ""]}>
              {o.alerts.slice(0, 30).map((a) => (
                <tr key={`${a.warehouseId}-${a.itemId}`} className="border-t border-line">
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2 text-ink-2">{whName(a.warehouseId)}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(a.quantity)} {a.baseUnit}</td>
                  <td className="px-4 py-2 tabular-nums text-ink-3">{Number(a.minStock)}</td>
                  <td className="px-4 py-2"><Badge tone={STATUS_TONE[a.status]}>{a.status.toLowerCase()}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <h3 className="flex items-center gap-2 px-5 pt-4 font-semibold"><CalendarClock className="size-4 text-danger" /> Expiring soon</h3>
          {o.expiring.length === 0 ? <p className="p-5 text-sm text-ink-3">No batches expire in the next 7 days.</p> : (
            <Table head={["Item", "Store", "Batch", "Qty", "Expires"]}>
              {o.expiring.map((l) => (
                <tr key={l.lotId} className="border-t border-line">
                  <td className="px-4 py-2">{l.name}</td>
                  <td className="px-4 py-2 text-ink-2">{whName(l.warehouseId)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{l.lotCode ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(l.quantity)} {l.baseUnit}</td>
                  <td className={cx("px-4 py-2", l.expired && "font-semibold text-danger")}>{l.expired ? "Expired" : fmtDate(l.expiresAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── stock in one warehouse ──────────────────────────────────────────────────

function StockTab({ warehouses, warehouse, onPick, onChanged }: { warehouses: WarehouseSummary[]; warehouse: string; onPick: (id: string) => void; onChanged: () => void }) {
  const can = useCan();
  const [q, setQ] = useState("");
  const stock = useApi<WarehouseStock>(warehouse ? `/warehouses/${warehouse}/stock${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}` : null);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [counting, setCounting] = useState<Record<string, string> | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [countKey, setCountKey] = useState(idem);
  const branchId = stock.data?.warehouse.branch?.id;
  const saveCount = useAction(async () => {
    const lines = Object.entries(counting ?? {}).filter(([, v]) => v.trim() !== "").map(([itemId, counted]) => ({ itemId, counted: counted.trim() }));
    if (!lines.length) return setCounting(null);
    const r = await api<{ itemsOff: number; variance: string }>(`/warehouses/${warehouse}/counts`, { method: "POST", body: { lines, note: "Stock count", idempotencyKey: countKey } });
    alert(`Count saved — ${r.itemsOff} item(s) differed, value ${r.variance}.`);
    setCounting(null);
    setCountKey(idem());
    void stock.reload();
    onChanged();
  });
  const rows = (stock.data?.rows ?? []).filter((r) => showAll || counting || r.tracked);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <WarehousePicker warehouses={warehouses} value={warehouse} onChange={onPick} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, SKU, barcode" className="w-60 pl-9" />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-ink-2"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show items never stocked here</label>
        <div className="ml-auto flex gap-2">
          {can("inventory.transfer", branchId) && !counting && <Button onClick={() => setTransferring(true)}><ArrowLeftRight className="size-4" /> Transfer</Button>}
          {can("inventory.count", branchId) && (counting ? (
            <>
              <Button variant="ghost" onClick={() => setCounting(null)}>Cancel count</Button>
              <Button variant="primary" pending={saveCount.pending} onClick={() => void saveCount.run()}><ClipboardCheck className="size-4" /> Save count</Button>
            </>
          ) : (
            <Button onClick={() => setCounting({})}><ClipboardCheck className="size-4" /> Count</Button>
          ))}
        </div>
      </div>
      {counting && <p className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">Count mode: type what's on the shelf. Blank items are left as they are. Saving records the differences as a stock count.</p>}
      <ErrorNote>{saveCount.error}</ErrorNote>
      {stock.data && (
        <p className="text-sm text-ink-3">Value <strong className="text-ink tabular-nums">{stock.data.totals.value}</strong> · {stock.data.totals.low} low · {stock.data.totals.out} out</p>
      )}
      <Card>
        {!stock.data ? <Spinner /> : rows.length === 0 ? <p className="p-6 text-center text-sm text-ink-3">Nothing stocked here yet — receive a delivery or transfer stock in.</p> : (
          <Table head={["Item", "Category", counting ? "Counted" : "On hand", "Min", "Avg cost", "Value", "Status", ""]}>
            {rows.map((r) => (
              <tr key={r.itemId} className="border-t border-line">
                <td className="px-4 py-2"><p className="font-medium">{r.name}</p><p className="font-mono text-[11px] text-ink-3">{r.sku}{r.expiringSoon && <span className="ml-2 text-danger">· {Number(r.expiringSoon.quantity)} expiring {fmtDate(r.expiringSoon.first)}</span>}</p></td>
                <td className="px-4 py-2 text-ink-2">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                <td className="px-4 py-2 tabular-nums">
                  {counting ? (
                    <Input inputMode="decimal" value={counting[r.itemId] ?? ""} onChange={(e) => setCounting({ ...counting, [r.itemId]: e.target.value })} placeholder={Number(r.quantity).toString()} className="w-28" aria-label={`Counted ${r.name}`} />
                  ) : qtyLabel(r.quantity, r.baseUnit, r.purchaseUnitQty, r.purchaseUnit)}
                </td>
                <td className="px-4 py-2 tabular-nums text-ink-3">{Number(r.minStock)}</td>
                <td className="px-4 py-2 tabular-nums text-ink-2">{Number(r.averageCost).toFixed(r.averageCost.startsWith("0.0") ? 4 : 2)}</td>
                <td className="px-4 py-2 tabular-nums">{r.value}</td>
                <td className="px-4 py-2">{r.tracked ? <Badge tone={STATUS_TONE[r.status]}>{r.status.toLowerCase()}</Badge> : <span className="text-xs text-ink-3">not stocked</span>}</td>
                <td className="px-4 py-2 text-right">
                  {!counting && can("inventory.adjust", branchId) && <Button size="sm" variant="ghost" onClick={() => setAdjusting(r)} aria-label={`Adjust ${r.name}`}><Pencil className="size-3.5" /></Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!adjusting} onClose={() => setAdjusting(null)} title={adjusting ? `Adjust ${adjusting.name}` : ""}>
        {adjusting && stock.data && <AdjustForm row={adjusting} warehouseId={warehouse} branchId={branchId ?? null} onDone={() => { setAdjusting(null); void stock.reload(); onChanged(); }} />}
      </Modal>
      <Modal open={transferring} onClose={() => setTransferring(false)} title="Transfer stock" wide>
        {transferring && stock.data && <TransferForm from={warehouse} warehouses={warehouses} rows={stock.data.rows.filter((r) => Number(r.quantity) > 0)} onDone={() => { setTransferring(false); void stock.reload(); onChanged(); }} />}
      </Modal>
    </div>
  );
}

function AdjustForm({ row, warehouseId, branchId, onDone }: { row: StockRow; warehouseId: string; branchId: string | null; onDone: () => void }) {
  const [f, setF] = useState({ type: "WASTE" as "WASTE" | "ADJUSTMENT" | "ISSUE_TO_STATION", direction: "-1", quantity: "", reason: "", deviceId: "" });
  const [key] = useState(idem);
  const floor = useApi<{ devices: FloorDevice[] }>(f.type === "ISSUE_TO_STATION" && branchId ? `/branches/${branchId}/floor` : null);
  const save = useAction(async () => {
    const qty = f.type === "ADJUSTMENT" && f.direction === "-1" ? `-${f.quantity}` : f.quantity;
    await api(`/warehouses/${warehouseId}/adjust`, {
      method: "POST",
      reason: f.reason,
      action: "Stock adjustment",
      body: { itemId: row.itemId, type: f.type, quantity: qty, reason: f.reason, deviceId: f.type === "ISSUE_TO_STATION" ? f.deviceId : null, idempotencyKey: key },
    });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <p className="text-sm text-ink-3">On hand: <strong className="text-ink">{qtyLabel(row.quantity, row.baseUnit, row.purchaseUnitQty, row.purchaseUnit)}</strong> · valued at {row.averageCost} per {row.baseUnit}</p>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-1">
        {([["WASTE", "Waste"], ["ADJUSTMENT", "Correct"], ["ISSUE_TO_STATION", "Issue to PC"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setF({ ...f, type: k })} className={cx("rounded-md py-1.5 text-sm", f.type === k ? "bg-panel text-ink shadow" : "text-ink-3")}>{label}</button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        {f.type === "ADJUSTMENT" && (
          <Field label="Direction">
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="-1">Remove</option><option value="1">Add</option></Select>
          </Field>
        )}
        <Field label={`Quantity (${row.baseUnit})`} className="flex-1"><Input inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></Field>
      </div>
      {f.type === "ISSUE_TO_STATION" && (
        <Field label="PC">
          <Select value={f.deviceId} onChange={(e) => setF({ ...f, deviceId: e.target.value })} required>
            <option value="">Pick the PC…</option>
            {(floor.data?.devices ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Reason" hint="Required and kept in the audit log"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} placeholder={f.type === "WASTE" ? "Expired, dropped, spoiled…" : f.type === "ISSUE_TO_STATION" ? "Replacement for a broken headset…" : "Found in back store…"} /></Field>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant={f.type === "ADJUSTMENT" && f.direction === "1" ? "primary" : "danger"} pending={save.pending}>{f.type === "WASTE" ? <Trash2 className="size-4" /> : f.direction === "1" && f.type === "ADJUSTMENT" ? <Plus className="size-4" /> : <Minus className="size-4" />} Record</Button></div>
    </form>
  );
}

function TransferForm({ from, warehouses, rows, onDone }: { from: string; warehouses: WarehouseSummary[]; rows: StockRow[]; onDone: () => void }) {
  const [to, setTo] = useState(warehouses.find((w) => w.id !== from)?.id ?? "");
  const [lines, setLines] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [key] = useState(idem);
  const [q, setQ] = useState("");
  const chosen = Object.entries(lines).filter(([, v]) => Number(v) > 0);
  const send = useAction(async () => {
    await api("/inventory/transfers", { method: "POST", body: { fromWarehouseId: from, toWarehouseId: to, lines: chosen.map(([itemId, quantity]) => ({ itemId, quantity })), note: note || null, idempotencyKey: key } });
    onDone();
  });
  const visible = rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void send.run(); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From"><Input value={whLabel(warehouses.find((w) => w.id === from)!)} disabled /></Field>
        <Field label="To">
          <Select value={to} onChange={(e) => setTo(e.target.value)} required>{warehouses.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}</Select>
        </Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Restock bar for the weekend" /></Field>
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter items…" />
      <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-line">
        {visible.map((r) => (
          <div key={r.itemId} className="flex items-center gap-3 border-b border-line/60 px-3 py-1.5 text-sm last:border-0">
            <span className="flex-1">{r.name}</span>
            <span className="text-xs text-ink-3">{Number(r.quantity)} {r.baseUnit} here</span>
            <Input inputMode="decimal" value={lines[r.itemId] ?? ""} onChange={(e) => setLines({ ...lines, [r.itemId]: e.target.value })} className="w-24" placeholder="0" aria-label={`Move ${r.name}`} />
          </div>
        ))}
        {visible.length === 0 && <p className="p-4 text-center text-sm text-ink-3">Nothing in stock here.</p>}
      </div>
      <ErrorNote>{send.error}</ErrorNote>
      <div className="flex items-center justify-end gap-3">
        <span className="text-sm text-ink-3">{chosen.length} item(s)</span>
        <Button type="submit" variant="primary" pending={send.pending} disabled={!chosen.length || !to}><ArrowLeftRight className="size-4" /> Transfer</Button>
      </div>
    </form>
  );
}

// ── items ───────────────────────────────────────────────────────────────────

function ItemsTab() {
  const can = useCan();
  const [q, setQ] = useState("");
  const items = useApi<Item[]>(`/inventory/items${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  const suppliers = useApi<Supplier[]>(can("purchasing.view") ? "/suppliers" : null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, SKU, barcode" className="w-64 pl-9" />
        </div>
        {can("inventory.manage") && <Button variant="primary" className="ml-auto" onClick={() => setEditing("new")}><Plus className="size-4" /> Item</Button>}
      </div>
      <Card>
        {!items.data ? <Spinner /> : (
          <Table head={["Item", "Category", "Unit", "On hand (all stores)", "Avg cost", "Value", "Supplier", ""]}>
            {items.data.map((i) => (
              <tr key={i.id} className={cx("cursor-pointer border-t border-line hover:bg-panel-2", !i.isActive && "opacity-50")} onClick={() => setViewing(i.id)}>
                <td className="px-4 py-2"><p className="font-medium">{i.name}</p><p className="font-mono text-[11px] text-ink-3">{i.sku}{i.trackExpiry ? " · expiry" : ""}{i.trackSerial ? " · serials" : ""}</p></td>
                <td className="px-4 py-2 text-ink-2">{CATEGORY_LABEL[i.category] ?? i.category}</td>
                <td className="px-4 py-2 text-ink-2">{i.baseUnit}{i.purchaseUnit && i.purchaseUnitQty ? <span className="text-ink-3"> · {i.purchaseUnit} of {Number(i.purchaseUnitQty)}</span> : null}</td>
                <td className={cx("px-4 py-2 tabular-nums", Number(i.onHand) <= Number(i.minStock) && Number(i.minStock) > 0 && "text-reserved")}>{Number(i.onHand)}</td>
                <td className="px-4 py-2 tabular-nums text-ink-2">{Number(i.averageCost).toFixed(4)}</td>
                <td className="px-4 py-2 tabular-nums">{i.value}</td>
                <td className="px-4 py-2 text-ink-2">{i.defaultSupplier?.name ?? "—"}</td>
                <td className="px-4 py-2 text-right">{can("inventory.manage") && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(i); }} aria-label={`Edit ${i.name}`}><Pencil className="size-3.5" /></Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New stock item" : editing ? `Edit ${editing.name}` : ""} wide>
        {editing && <ItemForm item={editing === "new" ? null : editing} suppliers={suppliers.data ?? []} onDone={() => { setEditing(null); void items.reload(); }} />}
      </Modal>
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Item" wide>
        {viewing && <ItemDetail id={viewing} />}
      </Modal>
    </div>
  );
}

function ItemForm({ item, suppliers, onDone }: { item: Item | null; suppliers: Supplier[]; onDone: () => void }) {
  const [f, setF] = useState({
    sku: item?.sku ?? "", name: item?.name ?? "", category: item?.category ?? "INGREDIENT", barcode: item?.barcode ?? "", baseUnit: item?.baseUnit ?? "pcs",
    purchaseUnit: item?.purchaseUnit ?? "", purchaseUnitQty: item?.purchaseUnitQty ?? "", minStock: item ? String(Number(item.minStock)) : "0", reorderQty: item?.reorderQty ? String(Number(item.reorderQty)) : "",
    trackExpiry: item?.trackExpiry ?? false, trackSerial: item?.trackSerial ?? false, defaultSupplierId: item?.defaultSupplierId ?? "", isActive: item?.isActive ?? true,
  });
  const save = useAction(async () => {
    const body = {
      sku: f.sku.toUpperCase(), name: f.name.trim(), category: f.category, barcode: f.barcode || null, baseUnit: f.baseUnit.trim(), purchaseUnit: f.purchaseUnit || null,
      purchaseUnitQty: f.purchaseUnitQty || null, minStock: f.minStock || "0", reorderQty: f.reorderQty || null, trackExpiry: f.trackExpiry, trackSerial: f.trackSerial,
      defaultSupplierId: f.defaultSupplierId || null, isActive: f.isActive,
    };
    await api(item ? `/inventory/items/${item.id}` : "/inventory/items", { method: item ? "PATCH" : "POST", body });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required maxLength={80} /></Field>
      <Field label="SKU"><Input value={f.sku} onChange={set("sku")} required pattern="[A-Za-z0-9-]{2,30}" /></Field>
      <Field label="Barcode"><Input value={f.barcode} onChange={set("barcode")} maxLength={40} /></Field>
      <Field label="Category"><Select value={f.category} onChange={set("category")}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Counted in" hint="pcs, g, ml…"><Input value={f.baseUnit} onChange={set("baseUnit")} required maxLength={10} /></Field>
      <Field label="Bought by the" hint="case, bag…"><Input value={f.purchaseUnit} onChange={set("purchaseUnit")} maxLength={20} /></Field>
      <Field label={`${f.purchaseUnit || "Pack"} holds`}><Input inputMode="decimal" value={f.purchaseUnitQty} onChange={set("purchaseUnitQty")} placeholder="24" /></Field>
      <Field label="Minimum" hint="Alert at or below"><Input inputMode="decimal" value={f.minStock} onChange={set("minStock")} /></Field>
      <Field label="Reorder quantity" hint="Blank = up to 2× min"><Input inputMode="decimal" value={f.reorderQty} onChange={set("reorderQty")} /></Field>
      <Field label="Usual supplier" className="sm:col-span-2">
        <Select value={f.defaultSupplierId} onChange={set("defaultSupplierId")}><option value="">None</option>{suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.trackExpiry} onChange={(e) => setF({ ...f, trackExpiry: e.target.checked })} /> Track batches and expiry dates</label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.trackSerial} onChange={(e) => setF({ ...f, trackSerial: e.target.checked })} /> Track serial numbers (headsets, controllers, parts)</label>
      {item && <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>}
      <div className="sm:col-span-4"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-4"><Button type="submit" variant="primary" pending={save.pending}>{item ? "Save" : "Add item"}</Button></div>
    </form>
  );
}

function ItemDetail({ id }: { id: string }) {
  const it = useApi<Item & { levels: Array<{ warehouse: { id: string; name: string; branch: { code: string } | null }; quantity: string; status: keyof typeof STATUS_TONE }>; lots: Array<{ id: string; lotCode: string | null; serialNumber: string | null; expiresAt: string | null; quantity: string }>; movements: Movement[]; usedIn: Array<{ productId: string; product: string; quantity: string }> }>(`/inventory/items/${id}`);
  if (!it.data) return it.error ? <ErrorNote>{it.error.message}</ErrorNote> : <Spinner />;
  const i = it.data;
  return (
    <div className="grid gap-4 text-sm">
      <div>
        <p className="text-lg font-semibold">{i.name}</p>
        <p className="text-ink-3">{i.sku} · counted in {i.baseUnit} · average cost {Number(i.averageCost).toFixed(4)}{i.lastPurchaseCost ? ` · last bought at ${Number(i.lastPurchaseCost).toFixed(4)}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {i.levels.map((l) => <span key={l.warehouse.id} className="rounded-lg border border-line px-3 py-1.5">{l.warehouse.branch?.code ?? "Central"} · {l.warehouse.name}: <strong className="tabular-nums">{Number(l.quantity)}</strong> <Badge tone={STATUS_TONE[l.status]}>{l.status.toLowerCase()}</Badge></span>)}
        {i.levels.length === 0 && <span className="text-ink-3">Not stocked anywhere yet.</span>}
      </div>
      {i.usedIn.length > 0 && <p className="text-ink-2">Used in: {i.usedIn.map((u) => `${u.product} (${Number(u.quantity)} ${i.baseUnit})`).join(", ")}</p>}
      {i.lots.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wider text-ink-3">Batches / serials</p>
          <div className="flex flex-wrap gap-1.5">{i.lots.map((l) => <span key={l.id} className="rounded-md border border-line px-2 py-0.5 font-mono text-xs">{l.serialNumber ?? l.lotCode ?? "batch"} · {Number(l.quantity)}{l.expiresAt ? ` · exp ${fmtDate(l.expiresAt)}` : ""}</span>)}</div>
        </div>
      )}
      <MovementTable rows={i.movements} showItem={false} />
    </div>
  );
}

// ── movements ───────────────────────────────────────────────────────────────

function MovementsTab({ warehouses, warehouse, onPick }: { warehouses: WarehouseSummary[]; warehouse: string; onPick: (id: string) => void }) {
  const [type, setType] = useState("");
  const moves = useApi<Movement[]>(warehouse ? `/warehouses/${warehouse}/movements${type ? `?type=${type}` : ""}` : null);
  const totals = useMemo(() => (moves.data ?? []).reduce((a, m) => a + Number(m.value), 0), [moves.data]);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <WarehousePicker warehouses={warehouses} value={warehouse} onChange={onPick} />
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto" aria-label="Type">
          <option value="">All movements</option>
          {Object.entries(MOVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {moves.data && <span className="ml-auto text-sm text-ink-3">Net value of these {moves.data.length}: <strong className="tabular-nums text-ink">{totals.toFixed(2)}</strong></span>}
      </div>
      <Card>{!moves.data ? <Spinner /> : <MovementTable rows={moves.data} showItem />}</Card>
    </div>
  );
}

function MovementTable({ rows, showItem }: { rows: Movement[]; showItem: boolean }) {
  if (!rows.length) return <p className="p-6 text-center text-sm text-ink-3">No movements yet.</p>;
  return (
    <Table head={["When", ...(showItem ? ["Item"] : []), "What", "Store", "Qty", "After", "Value", "By / why"]}>
      {rows.map((m) => (
        <tr key={m.id} className="border-t border-line">
          <td className="whitespace-nowrap px-4 py-2 text-ink-3">{new Date(m.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
          {showItem && <td className="px-4 py-2">{m.item}</td>}
          <td className="px-4 py-2">{MOVE_LABEL[m.type] ?? m.type}</td>
          <td className="px-4 py-2 text-ink-2">{m.warehouse}</td>
          <td className={cx("px-4 py-2 tabular-nums", Number(m.quantity) < 0 ? "text-danger" : "text-ok")}>{Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)} {m.baseUnit}</td>
          <td className="px-4 py-2 tabular-nums text-ink-3">{Number(m.quantityAfter)}</td>
          <td className="px-4 py-2 tabular-nums">{m.value}</td>
          <td className="px-4 py-2 text-xs text-ink-3">{[m.by, m.reason].filter(Boolean).join(" · ") || "—"}</td>
        </tr>
      ))}
    </Table>
  );
}
