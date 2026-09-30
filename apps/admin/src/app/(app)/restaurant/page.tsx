"use client";

import { useMemo, useState } from "react";
import { Ban, CheckCircle2, ChefHat, Pencil, Plus, Send, Trash2, UtensilsCrossed } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useCanOrg } from "@/lib/client/me";
import { type CartLine, type Menu, type TableRow } from "@/lib/client/pos";
import { idem } from "@/lib/client/sessions";
import { BillPanel } from "@/components/bill";
import { CartList, MenuGrid, cartTotal, toOrderLines } from "@/components/pos";
import { RecordActions } from "@/components/records";
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
  const canOrg = useCanOrg();
  const { branches, branchId, setBranchId } = useBranch();
  const tabs = ([can("restaurant.order", branchId ?? undefined) && "tables", canOrg("restaurant.menu_manage") && "menu"].filter(Boolean) as Tab[]);
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
        {table && <TableDetail t={table} branchId={branchId} onChanged={() => void tables.reload()} onDeleted={() => { setOpen(null); void tables.reload(); }} />}
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add table">
        {adding && <AddTable branchId={branchId} onDone={() => { setAdding(false); void tables.reload(); }} />}
      </Modal>
    </>
  );
}

function TableDetail({ t, branchId, onChanged, onDeleted }: { t: TableRow; branchId: string; onChanged: () => void; onDeleted: () => void }) {
  const can = useCan();
  const [ordering, setOrdering] = useState(!t.bill);
  const [editing, setEditing] = useState(false);
  const setStatus = useAction(async (status: TableRow["status"]) => {
    await api(`/tables/${t.id}/status`, { method: "POST", body: { status } });
    onChanged();
  });
  if (editing) return <EditTable t={t} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  const choices: TableRow["status"][] = ["AVAILABLE", "RESERVED", "BILL_REQUESTED", "CLEANING", ...(can("restaurant.tables_manage", branchId) ? (["OUT_OF_SERVICE"] as const) : [])];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-3">Mark as</span>
        {choices.map((s) => (
          <Button key={s} size="sm" variant={t.status === s ? "primary" : "ghost"} disabled={t.status === s} pending={setStatus.pending} onClick={() => void setStatus.run(s)}>{STATUS_LABEL[s]}</Button>
        ))}
        <span className="ml-auto"><RecordActions kind="table" id={t.id} name={`Table ${t.name}`} onEdit={() => setEditing(true)} onDone={onDeleted} /></span>
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

function EditTable({ t, onDone, onCancel }: { t: TableRow; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: t.name, seats: String(t.seats) });
  const save = useAction(async () => {
    await api(`/tables/${t.id}`, { method: "PATCH", body: { name: f.name.trim(), seats: Number(f.seats) || 1 } });
    onDone();
  });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={20} autoFocus /></Field>
      <Field label="Seats"><Input type="number" min={1} max={40} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} required /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Back</Button>
        <Button type="submit" variant="primary" pending={save.pending}>Save</Button>
      </div>
    </form>
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
  const [editingCat, setEditingCat] = useState<Manage["categories"][number] | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [addingStation, setAddingStation] = useState(false);
  const [recipeFor, setRecipeFor] = useState<ManagedProduct | null>(null);
  const [costView, setCostView] = useState(false);
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
      <div className="grid gap-3 md:grid-cols-3">
        <SetupCard
          step="1" title="Categories" help="Sections of your menu, e.g. Drinks, Snacks, Meals." add="Add category" onAdd={() => setAddingCat(true)}
          empty="No categories yet — add one first."
          items={m.data.categories.map((c) => ({ id: c.id, label: c.name, sub: `${m.data!.products.filter((p) => p.categoryId === c.id).length} items · click to edit`, onClick: () => setEditingCat(c) }))}
        />
        <SetupCard
          step="2" title="Kitchen stations" help="Where orders get made, e.g. Kitchen, Bar. Each gets its own column on the kitchen screen." add="Add station" onAdd={() => setAddingStation(true)}
          empty="None at this branch — items are handed over at once."
          items={m.data.stations.filter((s) => s.branchId === branchId).map((s) => ({ id: s.id, label: s.name }))}
        />
        <SetupCard
          step="3" title="Option groups" help="Choices a customer picks for an item, e.g. Size (S/M/L) or Sauce." add="Add option group" onAdd={() => setAddingGroup(true)}
          empty="No option groups yet — optional."
          items={m.data.modifierGroups.map((g) => ({ id: g.id, label: g.name, sub: g.modifiers.map((x) => x.name).join(", ") }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-semibold">4. Menu items</span>
        {[{ id: "all", name: "All" }, ...m.data.categories].map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={cx("rounded-full border px-3 py-1 text-sm", cat === c.id ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2")}>{c.name}</button>
        ))}
        {cat !== "all" && (() => {
          const c = m.data.categories.find((x) => x.id === cat);
          return c && <RecordActions kind="product-category" id={c.id} name={c.name} onEdit={() => setEditingCat(c)} onDone={() => { setCat("all"); void m.reload(); }} />;
        })()}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant={costView ? "primary" : "ghost"} onClick={() => setCostView(!costView)}><ChefHat className="size-4" /> Food cost</Button>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> Add menu item</Button>
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
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  {["RECIPE_ITEM", "STOCK_ITEM", "COMBO"].includes(p.type) && <Button size="sm" variant="ghost" onClick={() => setRecipeFor(p)} aria-label={`Recipe for ${p.name}`} title={p.type === "STOCK_ITEM" ? "Stock item" : "Recipe"}><ChefHat className="size-3.5" /></Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil className="size-3.5" /></Button>
                  <RecordActions kind="product" id={p.id} name={p.name} onDone={() => void m.reload()} />
                </td>
              </tr>
            );
          })}
        </Table>
        {products.length === 0 && <p className="p-6 text-center text-sm text-ink-3">{m.data.categories.length ? "No items here yet — click “Add menu item”." : "Add a category first (step 1), then add menu items."}</p>}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New menu item" : editing ? `Edit ${editing.name}` : ""} wide>
        {editing && <ProductForm m={m.data} branchId={branchId} p={editing === "new" ? null : editing} defaultCategory={cat === "all" ? m.data.categories[0]?.id : cat} onDone={() => { setEditing(null); void m.reload(); }} />}
      </Modal>
      <Modal open={!!recipeFor} onClose={() => setRecipeFor(null)} title={recipeFor ? `${recipeFor.type === "STOCK_ITEM" ? "Stock item" : "Recipe"} · ${recipeFor.name}` : ""} wide>
        {recipeFor && <RecipeEditor productId={recipeFor.id} stockItem={recipeFor.type === "STOCK_ITEM"} onDone={() => setRecipeFor(null)} />}
      </Modal>
      <Modal open={costView} onClose={() => setCostView(false)} title="Food cost" wide>
        {costView && <FoodCost branchId={branchId} />}
      </Modal>
      <Modal open={addingCat} onClose={() => setAddingCat(false)} title="New category">
        {addingCat && <CategoryForm onDone={() => { setAddingCat(false); void m.reload(); }} />}
      </Modal>
      <Modal open={!!editingCat} onClose={() => setEditingCat(null)} title={editingCat ? `Edit ${editingCat.name}` : ""}>
        {editingCat && <CategoryForm c={editingCat} onDone={() => { setEditingCat(null); void m.reload(); }} />}
      </Modal>
      <Modal open={addingStation} onClose={() => setAddingStation(false)} title="New kitchen station">
        {addingStation && <StationForm branchId={branchId} existing={m.data.stations.filter((s) => s.branchId === branchId).map((s) => s.name)} onDone={() => { setAddingStation(false); void m.reload(); }} />}
      </Modal>
      <Modal open={addingGroup} onClose={() => setAddingGroup(false)} title="New option group">
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
    const saved = p ? await api<{ id: string }>(`/products/${p.id}`, { method: "PATCH", body, done: `${body.name} saved.` }) : await api<{ id: string }>("/products", { method: "POST", body, done: `${body.name} added to the menu.` });
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

/** One step of menu setup: what it is, what already exists, and a button to add more. */
function SetupCard({ step, title, help, add, onAdd, items, empty }: {
  step: string; title: string; help: string; add: string; onAdd: () => void; empty: string;
  items: Array<{ id: string; label: string; sub?: string; onClick?: () => void }>;
}) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{step}</span>
        <h3 className="font-semibold">{title}</h3>
        <Badge>{items.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-ink-3">{help}</p>
      <div className="mb-3 flex flex-1 flex-wrap content-start gap-1.5">
        {items.length === 0 && <p className="text-xs italic text-ink-3">{empty}</p>}
        {items.map((i) => (
          <button key={i.id} type="button" onClick={i.onClick} disabled={!i.onClick} title={i.sub} className={cx("rounded-md border border-line bg-panel-2 px-2 py-1 text-left text-sm", i.onClick && "hover:border-accent")}>
            {i.label}
            {i.sub && <span className="block max-w-40 truncate text-[11px] text-ink-3">{i.sub}</span>}
          </button>
        ))}
      </div>
      <Button size="sm" onClick={onAdd}><Plus className="size-4" /> {add}</Button>
    </Card>
  );
}

/** A prep station at this branch. Products are routed to it, and it gets its own column on the kitchen screen. */
function StationForm({ branchId, existing, onDone }: { branchId: string; existing: string[]; onDone: () => void }) {
  const [name, setName] = useState(existing.includes("Kitchen") ? "Bar" : "Kitchen");
  const save = useAction(async () => {
    await api(`/branches/${branchId}/kitchen-stations`, { method: "POST", body: { name: name.trim() }, done: `Kitchen station “${name.trim()}” created.` });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <p className="text-sm text-ink-3">A place where orders are prepared. Menu items sent to it show up in its own column on the kitchen screen.</p>
      <Field label="Station name" hint={existing.length ? `Already here: ${existing.join(", ")}` : "e.g. Kitchen, Bar, Grill"}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
      </Field>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending}>Create station</Button></div>
    </form>
  );
}

function CategoryForm({ c, onDone }: { c?: Manage["categories"][number]; onDone: () => void }) {
  const [f, setF] = useState({ name: c?.name ?? "", sortOrder: String(c?.sortOrder ?? 0), showInShell: c?.showInShell ?? true });
  const save = useAction(async () => {
    const body = { name: f.name.trim(), sortOrder: Number(f.sortOrder) || 0, showInShell: f.showInShell };
    await api(c ? `/product-categories/${c.id}` : "/product-categories", { method: c ? "PATCH" : "POST", body, done: `Category “${body.name}” ${c ? "saved" : "created"}.` });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Category name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} placeholder="Desserts" autoFocus /></Field>
      <Field label="Order on the menu" hint="Lower numbers are shown first"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.showInShell} onChange={(e) => setF({ ...f, showInShell: e.target.checked })} /> Show on customers' PCs</label>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending}>{c ? "Save" : "Create category"}</Button></div>
    </form>
  );
}

function GroupForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", minSelect: "0", maxSelect: "1" });
  const [mods, setMods] = useState([{ name: "", priceDelta: "0" }, { name: "", priceDelta: "0" }]);
  const filled = mods.filter((x) => x.name.trim());
  const save = useAction(async () => {
    await api("/modifier-groups", { method: "POST", done: `Option group “${f.name.trim()}” created.`, body: { name: f.name.trim(), minSelect: Number(f.minSelect), maxSelect: Math.min(Number(f.maxSelect), filled.length), modifiers: filled.map((x) => ({ name: x.name.trim(), priceDelta: x.priceDelta || "0" })) } });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <p className="text-sm text-ink-3">A question the customer answers when ordering, e.g. <b>Size</b> → Small / Medium / Large. Then tick it on the menu items it applies to.</p>
      <Field label="Group name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Size" autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Must the customer pick?">
          <Select value={f.minSelect === "0" ? "0" : "1"} onChange={(e) => setF({ ...f, minSelect: e.target.value })}>
            <option value="0">No — optional</option>
            <option value="1">Yes — required</option>
          </Select>
        </Field>
        <Field label="How many can they pick?"><Input type="number" min={1} max={20} value={f.maxSelect} onChange={(e) => setF({ ...f, maxSelect: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-ink-3">Choices and extra price (0 = no extra charge)</p>
      {mods.map((x, i) => (
        <div key={i} className="grid grid-cols-[1fr_100px] gap-2">
          <Input value={x.name} onChange={(e) => setMods(mods.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} placeholder={`Choice ${i + 1}`} />
          <Input inputMode="decimal" value={x.priceDelta} onChange={(e) => setMods(mods.map((y, j) => (j === i ? { ...y, priceDelta: e.target.value } : y)))} aria-label="Price change" />
        </div>
      ))}
      {mods.length < 30 && <Button type="button" size="sm" variant="ghost" onClick={() => setMods([...mods, { name: "", priceDelta: "0" }])}><Plus className="size-4" /> Choice</Button>}
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending} disabled={!filled.length || Number(f.minSelect) > filled.length}>Create option group</Button></div>
    </form>
  );
}

// ── recipes & food cost (Phase 8) ───────────────────────────────────────────

interface RecipeView {
  productId: string;
  name: string;
  type: string;
  price: string;
  stockItem: { id: string; name: string; baseUnit: string } | null;
  lines: Array<{ inventoryItemId: string; name: string; baseUnit: string; quantity: string; wastePct: string; cost: string }>;
  cost: string;
}
type StockItemLite = { id: string; name: string; sku: string; baseUnit: string; averageCost: string; isActive: boolean };

/** What one unit of a menu item takes out of stock — drives stock use and food cost. */
function RecipeEditor({ productId, stockItem, onDone }: { productId: string; stockItem: boolean; onDone: () => void }) {
  const recipe = useApi<RecipeView>(`/products/${productId}/recipe`);
  const items = useApi<StockItemLite[]>("/inventory/items");
  const [lines, setLines] = useState<Array<{ inventoryItemId: string; quantity: string; wastePct: string }> | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const cur = lines ?? recipe.data?.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: String(Number(l.quantity)), wastePct: String(Number(l.wastePct)) })) ?? [];
  const linked = link ?? recipe.data?.stockItem?.id ?? "";
  const byId = new Map((items.data ?? []).map((i) => [i.id, i]));
  const cost = stockItem ? Number(byId.get(linked)?.averageCost ?? 0) : cur.reduce((a, l) => a + (Number(l.quantity) || 0) * (1 + (Number(l.wastePct) || 0) / 100) * Number(byId.get(l.inventoryItemId)?.averageCost ?? 0), 0);
  const save = useAction(async () => {
    await api(`/products/${productId}/recipe`, { method: "PUT", body: stockItem ? { inventoryItemId: linked || null, lines: [] } : { lines: cur.filter((l) => Number(l.quantity) > 0).map((l) => ({ ...l, wastePct: l.wastePct || "0" })) } });
    onDone();
  });
  if (!recipe.data || !items.data) return recipe.error ?? items.error ? <ErrorNote>{(recipe.error ?? items.error)!.message}</ErrorNote> : <Spinner />;
  const set = (i: number, patch: Partial<(typeof cur)[number]>) => setLines(cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const price = Number(recipe.data.price);
  return (
    <div className="grid gap-4 text-sm">
      {stockItem ? (
        <Field label="Sold straight from stock item" hint="Each one sold takes one unit out of the bar/branch store, and shows sold out when it runs out">
          <Select value={linked} onChange={(e) => setLink(e.target.value)}>
            <option value="">Not tracked</option>
            {items.data.filter((i) => i.isActive).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
          </Select>
        </Field>
      ) : (
        <>
          <p className="text-ink-3">Ingredients for one portion, in each item's own unit. Waste % covers trimming and spillage.</p>
          <div className="rounded-lg border border-line">
            <div className="grid grid-cols-[1fr_100px_80px_80px_32px] gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-3"><span>Ingredient</span><span>Quantity</span><span>Waste %</span><span className="text-right">Cost</span><span /></div>
            {cur.map((l, i) => {
              const it = byId.get(l.inventoryItemId);
              return (
                <div key={l.inventoryItemId} className="grid grid-cols-[1fr_100px_80px_80px_32px] items-center gap-2 border-b border-line/60 px-3 py-1.5">
                  <span>{it?.name ?? "?"} <span className="text-ink-3">({it?.baseUnit})</span></span>
                  <Input inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label="Quantity" />
                  <Input inputMode="decimal" value={l.wastePct} onChange={(e) => set(i, { wastePct: e.target.value })} aria-label="Waste %" />
                  <span className="text-right tabular-nums">{((Number(l.quantity) || 0) * (1 + (Number(l.wastePct) || 0) / 100) * Number(it?.averageCost ?? 0)).toFixed(2)}</span>
                  <button type="button" onClick={() => setLines(cur.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger" aria-label="Remove ingredient"><Trash2 className="size-4" /></button>
                </div>
              );
            })}
            <div className="px-3 py-2">
              <Select value="" onChange={(e) => e.target.value && setLines([...cur, { inventoryItemId: e.target.value, quantity: "1", wastePct: "0" }])} aria-label="Add ingredient">
                <option value="">+ Add an ingredient…</option>
                {items.data.filter((i) => i.isActive && !cur.some((l) => l.inventoryItemId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.baseUnit})</option>)}
              </Select>
            </div>
          </div>
        </>
      )}
      <p className="text-right">Cost per portion <strong className="tabular-nums">{cost.toFixed(2)}</strong> of price {price.toFixed(2)}{price > 0 && cost > 0 && <span className="text-ink-3"> · {((cost / price) * 100).toFixed(1)}% (incl. VAT)</span>}</p>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button variant="primary" pending={save.pending} onClick={() => void save.run()}>Save</Button></div>
    </div>
  );
}

interface CostRow { productId: string; name: string; category: string; type: string; price: string; netPrice: string; cost: string; costed: boolean; foodCostPct: string | null; margin: string | null }

function FoodCost({ branchId }: { branchId: string }) {
  const rows = useApi<CostRow[]>(`/menu/costing?branchId=${branchId}`);
  if (!rows.data) return rows.error ? <ErrorNote>{rows.error.message}</ErrorNote> : <Spinner />;
  const tone = (pct: number) => (pct > 40 ? "text-danger" : pct > 30 ? "text-reserved" : "text-ok");
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-ink-3">Ingredient cost at today's average cost, against the price without VAT. A common target is 25–35 %.</p>
      <Table head={["Item", "Category", "Price (net)", "Cost", "Food cost", "Margin"]}>
        {rows.data.map((r) => (
          <tr key={r.productId} className="border-t border-line">
            <td className="px-4 py-2">{r.name}</td>
            <td className="px-4 py-2 text-ink-2">{r.category}</td>
            <td className="px-4 py-2 tabular-nums">{r.netPrice}</td>
            <td className="px-4 py-2 tabular-nums">{r.costed ? r.cost : "—"}</td>
            <td className={cx("px-4 py-2 font-medium tabular-nums", r.foodCostPct && tone(Number(r.foodCostPct)))}>{r.foodCostPct ? `${r.foodCostPct}%` : <span className="font-normal text-ink-3">no recipe</span>}</td>
            <td className="px-4 py-2 tabular-nums">{r.margin ?? "—"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
