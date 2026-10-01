"use client";

import { useMemo, useState } from "react";
import { Banknote, CreditCard, Minus, Plus, Search, Trash2, Wallet, X } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { cartTotal, money, type CartLine, type Menu, type MenuProduct, type Tender } from "@/lib/client/pos";
import { Button, ErrorNote, Field, Input, Modal, cx } from "@/components/ui";

const rid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// ── menu grid + options ─────────────────────────────────────────────────────

const TOP = "__top";

export function MenuGrid({ menu, onAdd }: { menu: Menu; onAdd: (l: CartLine) => void }) {
  const all = useMemo(() => menu.categories.flatMap((c) => c.products), [menu]);
  const top = useMemo(() => (menu.topProductIds ?? []).map((id) => all.find((p) => p.id === id)).filter((p): p is MenuProduct => !!p), [menu, all]);
  const [cat, setCat] = useState(top.length ? TOP : (menu.categories[0]?.id ?? ""));
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState<string | null>(null);
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  const products = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) return all.filter((p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle) || p.barcode === q.trim());
    if (cat === TOP) return top;
    return menu.categories.find((c) => c.id === cat)?.products ?? [];
  }, [menu, all, top, cat, q]);
  const pick = (p: MenuProduct) =>
    p.modifierGroups.length ? setPicking(p) : onAdd({ key: rid(), productId: p.id, name: p.name, quantity: 1, modifierIds: [], optionNames: [], unit: Number(p.price) });
  // A barcode scanner types the code and presses Enter: an exact barcode/SKU match goes straight on the order.
  const scan = () => {
    const code = q.trim();
    if (!code) return;
    const hit = all.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase()) ?? (products.length === 1 ? products[0] : undefined);
    if (!hit) return setMiss(code);
    if (!hit.available) return setMiss(`${hit.name} — sold out`);
    pick(hit);
    setQ("");
    setMiss(null);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-3" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMiss(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              scan();
            }
          }}
          placeholder="Search, or scan a barcode…"
          className="pl-9"
          autoFocus
          aria-label="Search the menu or scan a barcode"
        />
      </div>
      {miss && <p className="text-xs text-reserved" role="status">Nothing matches “{miss}”.</p>}
      {!q && (
        <div className="flex flex-wrap gap-1.5">
          {top.length > 0 && (
            <button onClick={() => setCat(TOP)} className={cx("rounded-full border px-3 py-1 text-sm", cat === TOP ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:text-ink")}>
              ★ Top sellers
            </button>
          )}
          {menu.categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={cx("rounded-full border px-3 py-1 text-sm", cat === c.id ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:text-ink")}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
        {products.map((p) => (
          <button
            key={p.id}
            disabled={!p.available}
            onClick={() => pick(p)}
            className="flex min-h-24 flex-col rounded-lg border border-line bg-panel p-3 text-left transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-sm font-medium leading-tight">{p.name}</span>
            <span className="mt-auto flex items-end justify-between pt-2 text-xs">
              <span className="tabular-nums text-ink-2">{Number(p.price).toFixed(2)}</span>
              {!p.available ? <span className="text-danger">Sold out</span> : p.modifierGroups.length > 0 && <span className="text-ink-3">options</span>}
            </span>
          </button>
        ))}
        {products.length === 0 && <p className="col-span-full py-6 text-center text-sm text-ink-3">Nothing here.</p>}
      </div>
      <Modal open={!!picking} onClose={() => setPicking(null)} title={picking?.name ?? ""}>
        {picking && <Options p={picking} currency={menu.currency} onAdd={(l) => { onAdd(l); setPicking(null); }} />}
      </Modal>
    </div>
  );
}

function Options({ p, currency, onAdd }: { p: MenuProduct; currency: string; onAdd: (l: CartLine) => void }) {
  const [chosen, setChosen] = useState<string[]>(() => p.modifierGroups.flatMap((g) => (g.minSelect === 1 && g.maxSelect === 1 && g.modifiers[0] ? [g.modifiers[0].id] : [])));
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const inGroup = (g: MenuProduct["modifierGroups"][number]) => chosen.filter((id) => g.modifiers.some((m) => m.id === id));
  const toggle = (g: MenuProduct["modifierGroups"][number], id: string) =>
    setChosen((c) => {
      if (c.includes(id)) return g.minSelect === 1 && g.maxSelect === 1 ? c : c.filter((x) => x !== id);
      if (g.maxSelect === 1) return [...c.filter((x) => !g.modifiers.some((m) => m.id === x)), id];
      return inGroup(g).length >= g.maxSelect ? c : [...c, id];
    });
  const mods = p.modifierGroups.flatMap((g) => g.modifiers).filter((m) => chosen.includes(m.id));
  const unit = Number(p.price) + mods.reduce((a, m) => a + Number(m.priceDelta), 0);
  const missing = p.modifierGroups.find((g) => inGroup(g).length < g.minSelect);
  return (
    <div className="grid gap-4">
      {p.modifierGroups.map((g) => (
        <div key={g.id}>
          <p className="mb-1.5 text-xs text-ink-3">
            {g.name} · {g.minSelect > 0 ? <span className="text-reserved">required</span> : "optional"}{g.maxSelect > 1 ? ` · up to ${g.maxSelect}` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {g.modifiers.map((m) => (
              <button key={m.id} type="button" onClick={() => toggle(g, m.id)} className={cx("rounded-md border px-3 py-1.5 text-sm", chosen.includes(m.id) ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2")}>
                {m.name}{Number(m.priceDelta) ? <span className="ml-1 text-ink-3">{Number(m.priceDelta) > 0 ? "+" : ""}{Number(m.priceDelta).toFixed(2)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Field label="Kitchen note (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="No onions…" /></Field>
      <div className="flex items-center gap-3">
        <Qty value={qty} onChange={setQty} />
        <Button
          variant="primary"
          className="flex-1"
          disabled={!!missing}
          onClick={() => onAdd({ key: rid(), productId: p.id, name: p.name, quantity: qty, modifierIds: chosen, optionNames: mods.map((m) => m.name), unit, notes: notes.trim() || undefined })}
        >
          {missing ? `Choose ${missing.name.toLowerCase()}` : `Add · ${money(unit * qty, currency)}`}
        </Button>
      </div>
    </div>
  );
}

export function Qty({ value, onChange, max = 50 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-line">
      <button type="button" className="p-1.5 text-ink-2 hover:text-ink" onClick={() => onChange(Math.max(1, value - 1))} aria-label="Less"><Minus className="size-3.5" /></button>
      <span className="w-6 text-center text-sm tabular-nums">{value}</span>
      <button type="button" className="p-1.5 text-ink-2 hover:text-ink" onClick={() => onChange(Math.min(max, value + 1))} aria-label="More"><Plus className="size-3.5" /></button>
    </div>
  );
}

export function CartList({ lines, setLines }: { lines: CartLine[]; setLines: (fn: (l: CartLine[]) => CartLine[]) => void }) {
  if (!lines.length) return <p className="py-8 text-center text-sm text-ink-3">Tap items to add them.</p>;
  return (
    <ul className="divide-y divide-line">
      {lines.map((l) => (
        <li key={l.key} className="flex items-start gap-2 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{l.name}</p>
            {(l.optionNames.length > 0 || l.notes) && <p className="text-xs text-ink-3">{[...l.optionNames, l.notes && `“${l.notes}”`].filter(Boolean).join(", ")}</p>}
          </div>
          <Qty value={l.quantity} onChange={(n) => setLines((all) => all.map((x) => (x.key === l.key ? { ...x, quantity: n } : x)))} />
          <span className="w-16 text-right text-sm tabular-nums">{(l.unit * l.quantity).toFixed(2)}</span>
          <button onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))} className="p-1 text-ink-3 hover:text-danger" aria-label={`Remove ${l.name}`}><Trash2 className="size-3.5" /></button>
        </li>
      ))}
    </ul>
  );
}

export const toOrderLines = (lines: CartLine[]) => lines.map((l) => ({ productId: l.productId, quantity: l.quantity, modifierIds: l.modifierIds, notes: l.notes ?? null }));
export { cartTotal };

// ── customer search ─────────────────────────────────────────────────────────

export type PickedCustomer = { id: string; displayName: string; username: string };
export function CustomerPicker({ value, onChange }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void }) {
  const [q, setQ] = useState("");
  const found = useApi<PickedCustomer[]>(q.trim().length >= 2 && !value ? `/customers?q=${encodeURIComponent(q.trim())}` : null);
  if (value)
    return (
      <p className="flex items-center gap-2 text-sm">
        <span className="truncate"><strong>{value.displayName}</strong> <span className="text-ink-3">@{value.username}</span></span>
        <button onClick={() => onChange(null)} className="ml-auto text-ink-3 hover:text-ink" aria-label="Remove customer"><X className="size-4" /></button>
      </p>
    );
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer (optional) — name, @user, phone" />
      {found.data && found.data.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-panel shadow-lg">
          {found.data.slice(0, 6).map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-panel-2" onClick={() => { onChange(c); setQ(""); }}>
                {c.displayName} <span className="text-ink-3">@{c.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── payment ─────────────────────────────────────────────────────────────────

type Row = { key: string; method: Tender["method"]; amount: string; tendered: string; reference: string };
const METHOD_ICON = { CASH: Banknote, CARD: CreditCard, WALLET: Wallet } as const;
const METHOD_LABEL = { CASH: "Cash", CARD: "Card", WALLET: "Wallet" } as const;

/**
 * Split tenders. Every row but the last has a fixed amount; the last pays
 * whatever is left, so the server's total always wins over a UI estimate.
 */
export function PayForm({ due, currency, walletOk, onPay, submitLabel = "Take payment" }: { due: number; currency: string; walletOk: boolean; onPay: (t: Tender[]) => Promise<unknown>; submitLabel?: string }) {
  const [rows, setRows] = useState<Row[]>([{ key: rid(), method: "CASH", amount: "", tendered: "", reference: "" }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixed = rows.slice(0, -1).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const rest = Math.max(0, due - fixed);
  const last = rows[rows.length - 1]!;
  const change = last.method === "CASH" && last.tendered ? Number(last.tendered) - rest : null;
  const set = (key: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const quick = [rest, Math.ceil(rest / 10) * 10, Math.ceil(rest / 50) * 50, Math.ceil(rest / 100) * 100].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  const bad = rows.slice(0, -1).some((r) => !(Number(r.amount) > 0)) || fixed >= due || (change !== null && change < 0);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onPay(rows.map((r, i) => ({
        method: r.method,
        amount: i < rows.length - 1 ? r.amount : null,
        tendered: r.method === "CASH" && r.tendered && i === rows.length - 1 ? r.tendered : null,
        reference: r.method === "CARD" && r.reference ? r.reference : null,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3">
      <p className="flex items-baseline justify-between"><span className="text-sm text-ink-3">To pay</span><span className="text-2xl font-semibold tabular-nums">{money(due, currency)}</span></p>
      {rows.map((r, i) => {
        const isLast = i === rows.length - 1;
        return (
          <div key={r.key} className="grid gap-2 rounded-lg border border-line p-3">
            <div className="flex gap-1.5">
              {(["CASH", "CARD", "WALLET"] as const).filter((m) => m !== "WALLET" || walletOk).map((m) => {
                const Icon = METHOD_ICON[m];
                return (
                  <button key={m} type="button" onClick={() => set(r.key, { method: m })} className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-md border py-2 text-sm", r.method === m ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2")}>
                    <Icon className="size-4" /> {METHOD_LABEL[m]}
                  </button>
                );
              })}
              {rows.length > 1 && <button type="button" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} className="px-2 text-ink-3 hover:text-danger" aria-label="Remove tender"><X className="size-4" /></button>}
            </div>
            {isLast ? (
              <p className="text-sm text-ink-2">Amount: <strong className="tabular-nums">{money(rest, currency)}</strong>{rows.length > 1 && <span className="text-ink-3"> (the rest)</span>}</p>
            ) : (
              <Field label="Amount"><Input inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })} placeholder="0.00" /></Field>
            )}
            {isLast && r.method === "CASH" && (
              <>
                <Field label="Cash received (optional)"><Input inputMode="decimal" value={r.tendered} onChange={(e) => set(r.key, { tendered: e.target.value })} placeholder={rest.toFixed(2)} /></Field>
                <div className="flex flex-wrap gap-1.5">
                  {quick.map((v) => <button key={v} type="button" onClick={() => set(r.key, { tendered: v.toFixed(2) })} className="rounded-md border border-line px-2.5 py-1 text-xs tabular-nums hover:border-accent">{v.toFixed(2)}</button>)}
                </div>
                {change !== null && <p className={cx("text-sm", change < 0 ? "text-danger" : "text-ok")}>{change < 0 ? `Short by ${(-change).toFixed(2)}` : `Change: ${money(change, currency)}`}</p>}
              </>
            )}
            {r.method === "CARD" && <Field label="Terminal ref (optional)"><Input value={r.reference} onChange={(e) => set(r.key, { reference: e.target.value })} maxLength={100} /></Field>}
          </div>
        );
      })}
      {rows.length < 4 && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setRows((all) => [...all.slice(0, -1), { ...all[all.length - 1]!, amount: "" }, { key: rid(), method: "CARD", amount: "", tendered: "", reference: "" }])}>
          <Plus className="size-4" /> Split payment
        </Button>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button variant="primary" pending={pending} disabled={bad || due <= 0} onClick={() => void submit()}>{submitLabel}</Button>
    </div>
  );
}
