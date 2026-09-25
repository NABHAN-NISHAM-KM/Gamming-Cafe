"use client";

import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Pencil, Plus, Send, UtensilsCrossed } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { type CartLine, type Menu, type TableRow } from "@/lib/client/pos";
import { idem } from "@/lib/client/sessions";
import { BillPanel } from "@/components/bill";
import { CartList, MenuGrid, cartTotal, toOrderLines } from "@/components/pos";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

type Tab = "tables" | "menu";
const TABLE_STYLE: Record<TableRow["status"], string> = {
  AVAILABLE: "border-ok/50 bg-ok/5",
  OCCUPIED: "border-accent/60 bg-accent/10",
  RESERVED: "border-reserved/50 bg-reserved/10",
  CLEANING: "border-maint/50 bg-maint/10",
  BILL_REQUESTED: "border-danger/60 bg-danger/10",
  OUT_OF_SERVICE: "border-line bg-panel-2 opacity-60",
};
const STATUS_LABEL: Record<TableRow["status"], string> = { AVAILABLE: "Free", OCCUPIED: "Seated", RESERVED: "Reserved", CLEANING: "Needs clearing", BILL_REQUESTED: "Bill requested", OUT_OF_SERVICE: "Out of service" };

export default function RestaurantPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const tabs = ([can("restaurant.order", branchId ?? undefined) && "tables", can("restaurant.menu_manage") && "menu"].filter(Boolean) as Tab[]);
  const [pick, setTab] = useState<Tab | null>(null);
  const tab = pick && tabs.includes(pick) ? pick : tabs[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Restaurant"
        subtitle="Tables and their bills, and the menu that the POS, the kitchen and customers' PCs all share."
        actions={branches.data && branches.data.length > 1 && (
          <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
            {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        )}
      />
      <div className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {t === "tables" ? "Tables" : "Menu"}
          </button>
        ))}
      </div>
      {!branchId ? <Spinner /> : !tab ? <Empty title="Nothing here for your role" /> : tab === "tables" ? <Tables branchId={branchId} /> : <MenuAdmin branchId={branchId} />}
    </div>
  );
}

// ── tables ──────────────────────────────────────────────────────────────────

function Tables({ branchId }: { branchId: string }) {
  const can = useCan();
  const tables = useApi<TableRow[]>(`/branches/${branchId}/tables`);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const table = tables.data?.find((t) => t.id === open) ?? null;

  if (!tables.data) return tables.error ? <ErrorNote>{tables.error.message}</ErrorNote> : <Spinner />;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
        {(Object.keys(STATUS_LABEL) as TableRow["status"][]).map((s) => <span key={s} className="flex items-center gap-1.5"><span className={cx("size-3 rounded border", TABLE_STYLE[s])} />{STATUS_LABEL[s]}</span>)}
        {can("restaurant.tables_manage", branchId) && <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> Table</Button>}
      </div>
      {tables.data.length === 0 ? (
        <Empty icon={<UtensilsCrossed className="size-8" />} title="No tables yet" />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {tables.data.map((t) => (
            <button key={t.id} onClick={() => setOpen(t.id)} className={cx("flex aspect-[4/3] flex-col rounded-xl border-2 p-3 text-left transition hover:brightness-125", TABLE_STYLE[t.status])}>
              <span className="text-2xl font-bold">{t.name}</span>
              <span className="text-xs text-ink-3">{t.seats} seats · {STATUS_LABEL[t.status]}</span>
              {t.bill && (
                <span className="mt-auto">
                  <span className="block text-lg font-semibold tabular-nums">{t.bill.due}</span>
                  <span className="text-[11px] text-ink-3">due · {Math.round((Date.now() - new Date(t.bill.openedAt).getTime()) / 60_000)} min</span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <Modal open={!!table} onClose={() => { setOpen(null); void tables.reload(); }} title={table ? `Table ${table.name}` : ""} wide>
        {table && <TableDetail t={table} branchId={branchId} onChanged={() => void tables.reload()} />}
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add table">
        {adding && <AddTable branchId={branchId} onDone={() => { setAdding(false); void tables.reload(); }} />}
      </Modal>
    </>
  );
}

function TableDetail({ t, branchId, onChanged }: { t: TableRow; branchId: string; onChanged: () => void }) {
  const can = useCan();
  const [ordering, setOrdering] = useState(!t.bill);
  const setStatus = useAction(async (status: TableRow["status"]) => {
    await api(`/tables/${t.id}/status`, { method: "POST", body: { status } });
    onChanged();
  });
  const choices: TableRow["status"][] = ["AVAILABLE", "RESERVED", "BILL_REQUESTED", "CLEANING", ...(can("restaurant.tables_manage", branchId) ? (["OUT_OF_SERVICE"] as const) : [])];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-3">Mark as</span>
        {choices.map((s) => (
          <Button key={s} size="sm" variant={t.status === s ? "primary" : "ghost"} disabled={t.status === s} pending={setStatus.pending} onClick={() => void setStatus.run(s)}>{STATUS_LABEL[s]}</Button>
        ))}
      </div>
      <ErrorNote>{setStatus.error}</ErrorNote>
      {t.status !== "OUT_OF_SERVICE" && (
        ordering ? (
          <TableOrder branchId={branchId} tableId={t.id} onSent={() => { setOrdering(false); onChanged(); }} onCancel={t.bill ? () => setOrdering(false) : undefined} />
        ) : (
          <Button onClick={() => setOrdering(true)}><Plus className="size-4" /> Add to order</Button>
        )
      )}
      {t.bill && !ordering && <BillPanel key={t.bill.id + t.bill.total} billId={t.bill.id} branchId={branchId} onChanged={onChanged} />}
    </div>
  );
}

function TableOrder({ branchId, tableId, onSent, onCancel }: { branchId: string; tableId: string; onSent: () => void; onCancel?: () => void }) {
  const menu = useApi<Menu>(`/branches/${branchId}/menu`);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [key] = useState(idem);
  const send = useAction(async () => {
    await api(`/branches/${branchId}/orders`, { method: "POST", body: { type: "DINE_IN", tableId, lines: toOrderLines(lines), notes: notes.trim() || null, idempotencyKey: key } });
    onSent();
  });
  if (!menu.data) return menu.error ? <ErrorNote>{menu.error.message}</ErrorNote> : <Spinner />;
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_280px]">
      <MenuGrid menu={menu.data} onAdd={(l) => setLines((all) => [...all, l])} />
      <div className="grid content-start gap-3">
        <CartList lines={lines} setLines={setLines} />
        {lines.length > 0 && <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for the kitchen" maxLength={300} />}
        <p className="flex justify-between text-sm"><span className="text-ink-3">Adds</span><strong className="tabular-nums">{cartTotal(lines).toFixed(2)}</strong></p>
        <ErrorNote>{send.error}</ErrorNote>
        <div className="flex gap-2">
          {onCancel && <Button variant="ghost" onClick={onCancel}>Back to bill</Button>}
          <Button variant="primary" className="flex-1" disabled={!lines.length} pending={send.pending} onClick={() => void send.run()}><Send className="size-4" /> Send to kitchen</Button>
        </div>
      </div>
    </div>
  );
}

function AddTable({ branchId, onDone }: { branchId: string; onDone: () => void }) {
  const [f, setF] = useState({ name: "", seats: "4" });
  const save = useAction(async () => {
    await api(`/branches/${branchId}/tables`, { method: "POST", body: { name: f.name.trim(), seats: Number(f.seats) } });
    onDone();
  });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={20} placeholder="T7" /></Field>
      <Field label="Seats"><Input type="number" min={1} max={40} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>Add table</Button></div>
    </form>
  );
}

// ── menu management ─────────────────────────────────────────────────────────

interface Manage {
  categories: Array<{ id: string; name: string; sortOrder: number; showInShell: boolean; isActive: boolean }>;
  products: Array<{
    id: string; categoryId: string; name: string; description: string | null; type: string; sku: string; price: string; taxAppliesTo: string;
    kitchenStationId: string | null; prepTimeMinutes: number | null; availableInShell: boolean; isActive: boolean; sortOrder: number; modifierGroupIds: string[];
    productBranchPrices: Array<{ branchId: string; price: string | null; isAvailable: boolean }>;
  }>;
  modifierGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; modifiers: Array<{ id: string; name: string; priceDelta: string }> }>;
  stations: Array<{ id: string; name: string; branchId: string }>;
}
type ManagedProduct = Manage["products"][number];

function MenuAdmin({ branchId }: { branchId: string }) {
  const m = useApi<Manage>("/menu/manage");
  const [cat, setCat] = useState<string | "all">("all");
  const [editing, setEditing] = useState<ManagedProduct | "new" | null>(null);
  const [addingCat, setAddingCat] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const toggle = useAction(async (p: ManagedProduct, isAvailable: boolean) => {
    await api(`/products/${p.id}/branches/${branchId}`, { method: "PUT", body: { isAvailable } });
    await m.reload();
  });
  const products = useMemo(() => (m.data?.products ?? []).filter((p) => cat === "all" || p.categoryId === cat), [m.data, cat]);
  if (!m.data) return m.error ? <ErrorNote>{m.error.message}</ErrorNote> : <Spinner />;
  const catName = (id: string) => m.data!.categories.find((c) => c.id === id)?.name ?? "—";
  const here = (p: ManagedProduct) => p.productBranchPrices.find((b) => b.branchId === branchId);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {[{ id: "all", name: "All" }, ...m.data.categories].map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={cx("rounded-full border px-3 py-1 text-sm", cat === c.id ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2")}>{c.name}</button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAddingCat(true)}><Plus className="size-4" /> Category</Button>
          <Button size="sm" variant="ghost" onClick={() => setAddingGroup(true)}><Plus className="size-4" /> Options group</Button>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> Product</Button>
        </div>
      </div>
      <ErrorNote>{toggle.error}</ErrorNote>
      <Card>
        <Table head={["Product", "Category", "Price", "Kitchen", "On PCs", "Here", ""]}>
          {products.map((p) => {
            const bp = here(p);
            const available = bp ? bp.isAvailable : true;
            return (
              <tr key={p.id} className={cx("border-t border-line", !p.isActive && "opacity-50")}>
                <td className="px-4 py-2"><p className="font-medium">{p.name}</p><p className="font-mono text-[11px] text-ink-3">{p.sku}{p.modifierGroupIds.length ? ` · ${p.modifierGroupIds.length} option group${p.modifierGroupIds.length > 1 ? "s" : ""}` : ""}</p></td>
                <td className="px-4 py-2 text-ink-2">{catName(p.categoryId)}</td>
                <td className="px-4 py-2 tabular-nums">{Number(bp?.price ?? p.price).toFixed(2)}{bp?.price && <span className="ml-1 text-[11px] text-ink-3">(branch)</span>}</td>
                <td className="px-4 py-2 text-ink-2">{m.data!.stations.find((s) => s.id === p.kitchenStationId)?.name ?? "—"}</td>
                <td className="px-4 py-2">{p.availableInShell ? <CheckCircle2 className="size-4 text-ok" /> : <span className="text-ink-3">—</span>}</td>
                <td className="px-4 py-2">
                  <button onClick={() => void toggle.run(p, !available)} disabled={toggle.pending} title={available ? "Mark sold out (86)" : "Back in stock"}>
                    {available ? <Badge tone="ok">in stock</Badge> : <Badge tone="danger"><Ban className="size-3" /> sold out</Badge>}
                  </button>
                </td>
                <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil className="size-3.5" /></Button></td>
              </tr>
            );
          })}
        </Table>
        {products.length === 0 && <p className="p-6 text-center text-sm text-ink-3">No products in this category.</p>}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New product" : editing ? `Edit ${editing.name}` : ""} wide>
        {editing && <ProductForm m={m.data} branchId={branchId} p={editing === "new" ? null : editing} defaultCategory={cat === "all" ? m.data.categories[0]?.id : cat} onDone={() => { setEditing(null); void m.reload(); }} />}
      </Modal>
      <Modal open={addingCat} onClose={() => setAddingCat(false)} title="New category">
        {addingCat && <CategoryForm onDone={() => { setAddingCat(false); void m.reload(); }} />}
      </Modal>
      <Modal open={addingGroup} onClose={() => setAddingGroup(false)} title="New options group">
        {addingGroup && <GroupForm onDone={() => { setAddingGroup(false); void m.reload(); }} />}
      </Modal>
    </div>
  );
}

function ProductForm({ m, branchId, p, defaultCategory, onDone }: { m: Manage; branchId: string; p: ManagedProduct | null; defaultCategory?: string; onDone: () => void }) {
  const stations = m.stations.filter((s) => s.branchId === branchId);
  const bp = p?.productBranchPrices.find((b) => b.branchId === branchId);
  const [f, setF] = useState({
    categoryId: p?.categoryId ?? defaultCategory ?? "", name: p?.name ?? "", description: p?.description ?? "", type: p?.type ?? "RECIPE_ITEM", sku: p?.sku ?? "",
    price: p ? Number(p.price).toFixed(2) : "", taxAppliesTo: p?.taxAppliesTo ?? "FOOD", kitchenStationId: p?.kitchenStationId ?? stations[0]?.id ?? "",
    prepTimeMinutes: p?.prepTimeMinutes?.toString() ?? "", availableInShell: p?.availableInShell ?? true, isActive: p?.isActive ?? true, modifierGroupIds: p?.modifierGroupIds ?? [],
    branchPrice: bp?.price ? Number(bp.price).toFixed(2) : "",
  });
  const save = useAction(async () => {
    const body = {
      categoryId: f.categoryId, name: f.name.trim(), description: f.description.trim() || null, type: f.type, ...(f.sku ? { sku: f.sku.toUpperCase() } : {}),
      price: f.price, taxAppliesTo: f.taxAppliesTo, kitchenStationId: f.kitchenStationId || null, prepTimeMinutes: f.prepTimeMinutes ? Number(f.prepTimeMinutes) : null,
      availableInShell: f.availableInShell, isActive: f.isActive, modifierGroupIds: f.modifierGroupIds,
    };
    const saved = p ? await api<{ id: string }>(`/products/${p.id}`, { method: "PATCH", body }) : await api<{ id: string }>("/products", { method: "POST", body });
    const want = f.branchPrice || null;
    if ((bp?.price ? Number(bp.price).toFixed(2) : null) !== want) await api(`/products/${saved.id}/branches/${branchId}`, { method: "PUT", body: { price: want } });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required maxLength={80} /></Field>
      <Field label="Category"><Select value={f.categoryId} onChange={set("categoryId")} required>{m.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="SKU" hint={p ? undefined : "Blank = generated"}><Input value={f.sku} onChange={set("sku")} pattern="[A-Za-z0-9-]{2,30}" /></Field>
      <Field label="Description" className="sm:col-span-4"><Input value={f.description} onChange={set("description")} maxLength={300} /></Field>
      <Field label="Price (incl. VAT)"><Input inputMode="decimal" value={f.price} onChange={set("price")} required /></Field>
      <Field label="Price at this branch" hint="Blank = same everywhere"><Input inputMode="decimal" value={f.branchPrice} onChange={set("branchPrice")} /></Field>
      <Field label="Kind">
        <Select value={f.type} onChange={set("type")}>
          <option value="RECIPE_ITEM">Made to order</option>
          <option value="STOCK_ITEM">Ready item (can, snack)</option>
          <option value="COMBO">Combo</option>
          <option value="SERVICE">Service</option>
        </Select>
      </Field>
      <Field label="Tax class">
        <Select value={f.taxAppliesTo} onChange={set("taxAppliesTo")}>{["FOOD", "BEVERAGE", "MERCHANDISE", "SERVICE", "ALL"].map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}</Select>
      </Field>
      <Field label="Kitchen station">
        <Select value={f.kitchenStationId} onChange={set("kitchenStationId")}>
          <option value="">None (handed over at once)</option>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Prep time (min)"><Input type="number" min={0} max={240} value={f.prepTimeMinutes} onChange={set("prepTimeMinutes")} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.availableInShell} onChange={(e) => setF({ ...f, availableInShell: e.target.checked })} /> Orderable from customers' PCs</label>
      <div className="sm:col-span-4">
        <p className="mb-1.5 text-xs text-ink-3">Options</p>
        <div className="flex flex-wrap gap-1.5">
          {m.modifierGroups.map((g) => {
            const on = f.modifierGroupIds.includes(g.id);
            return (
              <button key={g.id} type="button" onClick={() => setF({ ...f, modifierGroupIds: on ? f.modifierGroupIds.filter((x) => x !== g.id) : [...f.modifierGroupIds, g.id] })} className={cx("rounded-md border px-2.5 py-1 text-sm", on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2")} title={g.modifiers.map((x) => x.name).join(", ")}>
                {g.name} <span className="text-ink-3">({g.minSelect ? "required" : "optional"})</span>
              </button>
            );
          })}
        </div>
      </div>
      {p && <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> On the menu (untick to retire it everywhere)</label>}
      <div className="sm:col-span-4"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-4"><Button type="submit" variant="primary" pending={save.pending}>{p ? "Save" : "Add product"}</Button></div>
    </form>
  );
}

function CategoryForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", sortOrder: "0", showInShell: true });
  const save = useAction(async () => {
    await api("/product-categories", { method: "POST", body: { name: f.name.trim(), sortOrder: Number(f.sortOrder) || 0, showInShell: f.showInShell } });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} placeholder="Desserts" /></Field>
      <Field label="Position" hint="Lower comes first"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.showInShell} onChange={(e) => setF({ ...f, showInShell: e.target.checked })} /> Show on customers' PCs</label>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending}>Add category</Button></div>
    </form>
  );
}

function GroupForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", minSelect: "0", maxSelect: "1" });
  const [mods, setMods] = useState([{ name: "", priceDelta: "0" }, { name: "", priceDelta: "0" }]);
  const filled = mods.filter((x) => x.name.trim());
  const save = useAction(async () => {
    await api("/modifier-groups", { method: "POST", body: { name: f.name.trim(), minSelect: Number(f.minSelect), maxSelect: Math.min(Number(f.maxSelect), filled.length), modifiers: filled.map((x) => ({ name: x.name.trim(), priceDelta: x.priceDelta || "0" })) } });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Sauce" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Must choose at least"><Input type="number" min={0} max={10} value={f.minSelect} onChange={(e) => setF({ ...f, minSelect: e.target.value })} /></Field>
        <Field label="Can choose up to"><Input type="number" min={1} max={20} value={f.maxSelect} onChange={(e) => setF({ ...f, maxSelect: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-ink-3">Choices (price change can be negative)</p>
      {mods.map((x, i) => (
        <div key={i} className="grid grid-cols-[1fr_100px] gap-2">
          <Input value={x.name} onChange={(e) => setMods(mods.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} placeholder={`Choice ${i + 1}`} />
          <Input inputMode="decimal" value={x.priceDelta} onChange={(e) => setMods(mods.map((y, j) => (j === i ? { ...y, priceDelta: e.target.value } : y)))} aria-label="Price change" />
        </div>
      ))}
      {mods.length < 30 && <Button type="button" size="sm" variant="ghost" onClick={() => setMods([...mods, { name: "", priceDelta: "0" }])}><Plus className="size-4" /> Choice</Button>}
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending} disabled={!filled.length || Number(f.minSelect) > filled.length}>Add group</Button></div>
    </form>
  );
}
