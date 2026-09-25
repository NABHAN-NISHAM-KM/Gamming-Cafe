import { useEffect, useMemo, useState } from "react";
import { Check, ChefHat, Loader2, Minus, Plus, Receipt, ShoppingBag, Wallet, X } from "lucide-react";
import { bridge, request, type OrderLine, type SeatMenu } from "./bridge";
import type { Notify } from "./screens";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const rid = () => crypto.randomUUID();
type Product = SeatMenu["categories"][number]["products"][number];
type CartLine = OrderLine & { key: string; name: string; unit: number; optionNames: string[] };
type Tracked = { orderId: string; number: string; status: "PLACED" | "PREPARING" | "READY" | "SERVED"; total: string };

const STEPS: Tracked["status"][] = ["PLACED", "PREPARING", "READY", "SERVED"];
const STEP_LABEL: Record<Tracked["status"], string> = { PLACED: "Received", PREPARING: "Preparing", READY: "On its way", SERVED: "Delivered" };

// Orders placed this session survive tab switches.
let tracked: Tracked[] = [];

function Options({ p, currency, onAdd, onClose }: { p: Product; currency: string; onAdd: (l: CartLine) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<string[]>(() => p.modifierGroups.flatMap((g) => (g.minSelect === 1 && g.maxSelect === 1 ? [g.modifiers[0]!.id] : [])));
  const [qty, setQty] = useState(1);
  const toggle = (g: Product["modifierGroups"][number], id: string) =>
    setChosen((c) => {
      const inGroup = c.filter((x) => g.modifiers.some((m) => m.id === x));
      if (c.includes(id)) return g.minSelect === 1 && g.maxSelect === 1 ? c : c.filter((x) => x !== id);
      if (g.maxSelect === 1) return [...c.filter((x) => !inGroup.includes(x)), id];
      return inGroup.length >= g.maxSelect ? c : [...c, id];
    });
  const mods = p.modifierGroups.flatMap((g) => g.modifiers).filter((m) => chosen.includes(m.id));
  const unit = Number(p.price) + mods.reduce((a, m) => a + Number(m.priceDelta), 0);
  const missing = p.modifierGroups.find((g) => chosen.filter((x) => g.modifiers.some((m) => m.id === x)).length < g.minSelect);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-void/70 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-lg rounded-3xl p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-semibold">{p.name}</h3>
            {p.description && <p className="mt-1 text-dim">{p.description}</p>}
          </div>
          <button onClick={onClose} className="text-dim" aria-label="Close"><X className="size-6" /></button>
        </div>
        {p.modifierGroups.map((g) => (
          <div key={g.id} className="mt-5">
            <p className="mb-2 text-sm text-dim">{g.name} {g.minSelect > 0 ? <span className="text-warn">· required</span> : g.maxSelect > 1 ? `· up to ${g.maxSelect}` : "· optional"}</p>
            <div className="flex flex-wrap gap-2">
              {g.modifiers.map((m) => (
                <button key={m.id} onClick={() => toggle(g, m.id)} className={cx("rounded-xl border px-4 py-2", chosen.includes(m.id) ? "border-glow bg-glow/15 text-glow" : "border-rim text-text")}>
                  {m.name}{Number(m.priceDelta) ? <span className="ml-1 text-dim">+{Number(m.priceDelta).toFixed(0)}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-7 flex items-center gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-rim px-2 py-1.5">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less"><Minus className="size-5" /></button>
            <span className="tabular w-6 text-center font-display text-xl">{qty}</span>
            <button onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="More"><Plus className="size-5" /></button>
          </div>
          <button
            disabled={!!missing}
            onClick={() => onAdd({ key: rid(), productId: p.id, quantity: qty, modifierIds: chosen, name: p.name, unit, optionNames: mods.map((m) => m.name) })}
            className="flex-1 rounded-xl bg-gradient-to-r from-glow to-glow-2 py-3.5 font-display text-lg font-semibold text-void disabled:opacity-40"
          >
            {missing ? `Choose ${missing.name.toLowerCase()}` : `Add · ${currency} ${(unit * qty).toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FoodScreen({ notify, station }: { notify: Notify; station: string }) {
  const [menu, setMenu] = useState<SeatMenu | null | undefined>(undefined);
  const [cat, setCat] = useState<string | null>(null);
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payWith, setPayWith] = useState<"BILL" | "WALLET">("BILL");
  const [sending, setSending] = useState(false);
  const [orders, setOrders] = useState<Tracked[]>(tracked);

  useEffect(() => {
    const requestId = rid();
    const off = bridge.subscribe((m) => {
      if (m.type === "menu" && m.requestId === requestId) {
        setMenu(m.menu);
        setCat((c) => c ?? m.menu?.categories[0]?.id ?? null);
      }
      if (m.type === "order_status") {
        tracked = tracked.map((o) => (o.orderId === m.orderId ? { ...o, status: m.status } : o));
        setOrders(tracked);
      }
    });
    bridge.send({ type: "menu_request", requestId });
    const t = setTimeout(() => setMenu((x) => (x === undefined ? null : x)), 12_000);
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);

  const current = menu?.categories.find((c) => c.id === cat);
  const total = useMemo(() => cart.reduce((a, l) => a + l.unit * l.quantity, 0), [cart]);
  const send = async () => {
    setSending(true);
    const r = await request({ type: "place_order", requestId: rid(), lines: cart.map(({ productId, quantity, modifierIds }) => ({ productId, quantity, modifierIds })), payWith }, "order_result", 20_000);
    setSending(false);
    if (!r.ok) return notify(r.message ?? "Couldn't place the order — please ask staff.", "warn");
    tracked = [{ orderId: r["orderId"], number: r["number"], status: "PLACED", total: r["total"] }, ...tracked];
    setOrders(tracked);
    setCart([]);
    notify(`Order ${r["number"]} placed — we'll bring it to ${station}.`, "good");
  };

  if (menu === undefined) return <div className="grid h-full place-items-center text-dim"><Loader2 className="size-8 animate-spin" /></div>;
  if (menu === null) return <div className="grid h-full place-items-center text-center text-dim"><div><ChefHat className="mx-auto size-12 opacity-60" /><p className="mt-4 text-lg">The menu isn't available right now.</p><p>Please order at the counter.</p></div></div>;

  return (
    <div className="mx-auto grid h-full max-w-7xl gap-8 lg:grid-cols-[1fr_380px]">
      <section className="min-w-0">
        {orders.length > 0 && (
          <div className="mb-6 grid gap-3">
            {orders.slice(0, 2).map((o) => (
              <div key={o.orderId} className="glass rounded-2xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-display text-lg">Order {o.number}</p>
                  <p className="text-sm text-dim">{menu.currency} {o.total}</p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {STEPS.map((s, i) => {
                    const reached = STEPS.indexOf(o.status) >= i;
                    return (
                      <div key={s}>
                        <div className={cx("h-1.5 rounded-full", reached ? "bg-glow" : "bg-rim")} />
                        <p className={cx("mt-1.5 text-xs", reached ? "text-text" : "text-mute")}>{STEP_LABEL[s]}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mb-5 flex flex-wrap gap-2">
          {menu.categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={cx("rounded-full border px-5 py-2", cat === c.id ? "border-glow bg-glow text-void" : "border-rim text-dim hover:text-text")}>{c.name}</button>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
          {current?.products.map((p) => (
            <button
              key={p.id}
              disabled={!p.available}
              onClick={() => (p.modifierGroups.length ? setPicking(p) : setCart((c) => [...c, { key: rid(), productId: p.id, quantity: 1, modifierIds: [], name: p.name, unit: Number(p.price), optionNames: [] }]))}
              className="glass group flex flex-col rounded-2xl p-5 text-left transition hover:border-glow/60 disabled:opacity-40"
            >
              <span className="font-display text-lg font-semibold leading-tight">{p.name}</span>
              {p.description && <span className="mt-1 line-clamp-2 text-sm text-dim">{p.description}</span>}
              <span className="mt-auto flex items-center justify-between pt-4">
                <span className="tabular font-display text-xl">{menu.currency} {Number(p.price).toFixed(0)}</span>
                {p.available ? <span className="grid size-9 place-items-center rounded-full bg-glow/15 text-glow group-hover:bg-glow group-hover:text-void"><Plus className="size-5" /></span> : <span className="text-sm text-alarm">Sold out</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-6 lg:sticky lg:top-0 lg:max-h-[calc(100vh-10rem)]">
        <p className="flex items-center gap-2 font-display text-xl font-semibold"><ShoppingBag className="size-5 text-glow" /> Your order</p>
        <p className="mt-1 text-sm text-dim">Brought to {station}</p>
        <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
          {cart.length === 0 && <p className="py-10 text-center text-mute">Tap something tasty.</p>}
          {cart.map((l) => (
            <div key={l.key} className="flex items-start gap-3">
              <span className="tabular rounded-lg bg-deck-2 px-2 py-0.5 font-display">{l.quantity}×</span>
              <div className="flex-1">
                <p className="font-medium">{l.name}</p>
                {l.optionNames.length > 0 && <p className="text-xs text-dim">{l.optionNames.join(", ")}</p>}
              </div>
              <span className="tabular">{(l.unit * l.quantity).toFixed(2)}</span>
              <button onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} className="text-mute hover:text-alarm" aria-label={`Remove ${l.name}`}><X className="size-4" /></button>
            </div>
          ))}
        </div>
        {cart.length > 0 && (
          <div className="mt-4 border-t border-rim pt-4">
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button onClick={() => setPayWith("BILL")} className={cx("flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm", payWith === "BILL" ? "border-glow bg-glow/10 text-glow" : "border-rim text-dim")}>
                <Receipt className="size-4" /> Add to my bill
              </button>
              <button disabled={!menu.canPayWithWallet} onClick={() => setPayWith("WALLET")} className={cx("flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm disabled:opacity-40", payWith === "WALLET" ? "border-glow bg-glow/10 text-glow" : "border-rim text-dim")} title={menu.canPayWithWallet ? "" : "Sign in with your account to use your wallet"}>
                <Wallet className="size-4" /> Pay from wallet
              </button>
            </div>
            <div className="mb-4 flex items-baseline justify-between">
              <span className="text-dim">Total</span>
              <span className="tabular font-display text-2xl font-semibold">{menu.currency} {total.toFixed(2)}</span>
            </div>
            <button onClick={() => void send()} disabled={sending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-glow to-glow-2 py-4 font-display text-lg font-semibold text-void disabled:opacity-60">
              {sending ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />} Place order
            </button>
            <p className="mt-2 text-center text-xs text-mute">Prices include VAT.</p>
          </div>
        )}
      </aside>
      {picking && <Options p={picking} currency={menu.currency} onClose={() => setPicking(null)} onAdd={(l) => { setCart((c) => [...c, l]); setPicking(null); }} />}
    </div>
  );
}
