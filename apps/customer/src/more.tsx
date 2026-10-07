import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Bell, BellOff, Check, Clock, CreditCard, Download, Gamepad2, Gift, HeartHandshake, KeyRound, Languages, LifeBuoy, Loader2, LogIn, Medal, Minus, Monitor,
  Plus, Send, Share2, ShieldCheck, Star, Trash2, Trophy, User, UtensilsCrossed, Users,
} from "lucide-react";
import { api, key, setToken, type Booking, type Me, type Venue } from "./api";
import { askConfirm } from "./confirm";
import { getLang, locale, setLang, t } from "./i18n";
import { disablePush, enablePush, pushState, type PushState } from "./push";
import { cx, ErrorText, hours, Loading, Screen, Sheet, useLoad, type Toast } from "./ui";
import { CardTopUp } from "./growth";

const money = (cur: string, v: string | number) => `${cur} ${Number(v).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

// ── live venue status ───────────────────────────────────────────────────────

interface LiveBranch { id: string; name: string; zones: Array<{ id: string; name: string; type: string; total: number; free: number }> }

/** "5 of 20 free in Regular" — so people know whether to come in now. */
export function LiveCard({ multiBranch }: { multiBranch: boolean }) {
  const live = useLoad(() => api<LiveBranch[]>("/live"));
  useEffect(() => {
    const id = setInterval(live.reload, 30_000);
    return () => clearInterval(id);
  }, [live.reload]);
  const branches = (live.data ?? []).filter((b) => b.zones.length);
  if (!branches.length) return null;
  return (
    <div className="card mt-4 p-5">
      <p className="flex items-center gap-2 text-sm text-dim"><span className="live-dot size-2 rounded-full bg-good text-good" /> {t("Free right now")}</p>
      {branches.map((b) => (
        <div key={b.id} className="mt-3">
          {multiBranch && <p className="mb-1 text-xs uppercase tracking-widest text-mute">{b.name}</p>}
          <div className="grid gap-2">
            {b.zones.map((z) => (
              <div key={z.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{z.name}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-rim"><span className={cx("block h-full rounded-full", z.free === 0 ? "bg-alarm" : z.free / z.total < 0.25 ? "bg-warn" : "bg-good")} style={{ width: `${(z.free / z.total) * 100}%` }} /></span>
                <span className={cx("tabular w-16 text-end font-semibold", z.free === 0 && "text-alarm")}>{z.free === 0 ? t("Full") : t("{free} of {total}", { free: z.free, total: z.total })}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── add time to my session ──────────────────────────────────────────────────

interface Offers { ok: boolean; message?: string; currency: string; wallet: string | null; savedMinutes: number; savedSteps: number[]; packages: Array<{ id: string; name: string; minutes: number; bonusMinutes: number; price: string }> }

export function AddTimeSheet({ station, onClose, onDone, toast }: { station: string; onClose: () => void; onDone: () => void; toast: Toast }) {
  const offers = useLoad(() => api<Offers>("/session/offers"));
  const [busy, setBusy] = useState<string | null>(null);
  const buy = async (id: string, body: { packageId?: string; savedMinutes?: number }, what: string) => {
    if (body.packageId && !(await askConfirm(t("Pay for {what} from your wallet?", { what }), { ok: t("Pay"), cancel: t("Cancel") }))) return;
    setBusy(id);
    try {
      const r = await api<{ expiresAt: string }>("/session/extend", { method: "POST", body: { ...body, idempotencyKey: key() } });
      toast(t("Time added — you now play until {time}.", { time: clock(r.expiresAt) }));
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't add time."), false);
    } finally {
      setBusy(null);
    }
  };
  const o = offers.data;
  return (
    <Sheet title={t("Add time on {station}", { station })} onClose={onClose}>
      {offers.error ? <ErrorText>{offers.error}</ErrorText> : !o ? <Loading /> : !o.ok ? <ErrorText>{o.message ? t(o.message) : t("This session can't be extended here.")}</ErrorText> : (
        <div className="grid gap-3">
          {o.savedSteps.length > 0 && (
            <>
              <p className="text-sm text-dim">{t("From your saved time ({time} left)", { time: hours(o.savedMinutes) })}</p>
              <div className="grid grid-cols-3 gap-2">
                {o.savedSteps.map((m) => (
                  <button key={m} className="btn btn-ghost py-3" disabled={!!busy} onClick={() => void buy(`s${m}`, { savedMinutes: m }, hours(m))}>
                    {busy === `s${m}` ? <Loader2 className="size-4 animate-spin" /> : `+${hours(m)}`}
                  </button>
                ))}
              </div>
            </>
          )}
          {o.packages.length > 0 && <p className="mt-2 text-sm text-dim">{o.wallet ? t("Pay from your wallet ({amount})", { amount: money(o.currency, o.wallet) }) : t("Your wallet is on hold — pay at the counter.")}</p>}
          {o.packages.map((p) => (
            <div key={p.id} className="card flex items-center gap-4 p-4">
              <Clock className="size-6 text-glow" />
              <div className="flex-1">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-dim">+{hours(p.minutes)}{p.bonusMinutes ? ` · ${t("incl. {n} min bonus", { n: p.bonusMinutes })}` : ""}</p>
              </div>
              <button className="btn btn-primary px-4 py-2.5" disabled={!!busy || !o.wallet} onClick={() => void buy(p.id, { packageId: p.id }, p.name)}>
                {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : money(o.currency, p.price)}
              </button>
            </div>
          ))}
          {!o.savedSteps.length && !o.packages.length && <p className="text-dim">{t("Nothing to add here — ask at the counter.")}</p>}
        </div>
      )}
    </Sheet>
  );
}

// ── food to my seat ─────────────────────────────────────────────────────────

interface Modifier { id: string; name: string; priceDelta: string }
interface Product { id: string; name: string; description: string | null; price: string; available: boolean; modifierGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; modifiers: Modifier[] }> }
interface Menu { station: string | null; menu: { currency: string; categories: Array<{ id: string; name: string; products: Product[] }> } | null }
interface MyOrder { id: string; number: string; status: string; total: string; currency: string; createdAt: string; orderItems: Array<{ nameSnapshot: string; quantity: number }> }
interface CartLine { key: string; product: Product; modifiers: Modifier[]; quantity: number }

const ORDER_STATUS: Record<string, string> = { PLACED: "Sent to the kitchen", ACCEPTED: "Sent to the kitchen", IN_PROGRESS: "Being made", READY: "Ready", SERVED: "Delivered", COMPLETED: "Delivered", CANCELLED: "Cancelled" };

export function FoodScreen({ me, back, toast, onOrdered }: { me: Me; back: () => void; toast: Toast; onOrdered: () => void }) {
  const menu = useLoad(() => api<Menu>("/menu"));
  const mine = useLoad(() => api<MyOrder[]>("/orders"));
  useEffect(() => {
    const id = setInterval(mine.reload, 15_000);
    return () => clearInterval(id);
  }, [mine.reload]);
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = menu.data?.menu;
  const cats = m?.categories.filter((c) => c.products.length) ?? [];
  const shown = cats.find((c) => c.id === cat) ?? cats[0];
  const lineTotal = (l: CartLine) => (Number(l.product.price) + l.modifiers.reduce((s, x) => s + Number(x.priceDelta), 0)) * l.quantity;
  const total = cart.reduce((s, l) => s + lineTotal(l), 0);
  const add = (product: Product, modifiers: Modifier[]) => {
    const k = `${product.id}:${modifiers.map((x) => x.id).sort().join(",")}`;
    setCart((c) => (c.some((l) => l.key === k) ? c.map((l) => (l.key === k ? { ...l, quantity: Math.min(20, l.quantity + 1) } : l)) : [...c, { key: k, product, modifiers, quantity: 1 }]));
  };
  const bump = (k: string, d: number) => setCart((c) => c.map((l) => (l.key === k ? { ...l, quantity: l.quantity + d } : l)).filter((l) => l.quantity > 0));
  const place = async (payWith: "BILL" | "WALLET") => {
    setBusy(true);
    try {
      const o = await api<{ number: string }>("/orders", { method: "POST", body: { lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, modifierIds: l.modifiers.map((x) => x.id) })), payWith, idempotencyKey: key() } });
      toast(t("Order {number} is on its way to {station}!", { number: o.number, station: menu.data?.station ?? "" }));
      setCart([]);
      setCheckout(false);
      mine.reload();
      onOrdered();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't place the order."), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t("Food & drinks")} back={back}>
      {(mine.data ?? []).length > 0 && (
        <div className="card mb-5 divide-y divide-rim">
          {mine.data!.slice(0, 3).map((o) => (
            <div key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className={cx("size-2 shrink-0 rounded-full", o.status === "READY" ? "bg-good" : ["SERVED", "COMPLETED"].includes(o.status) ? "bg-mute" : o.status === "CANCELLED" ? "bg-alarm" : "live-dot bg-glow text-glow")} />
              <span className="min-w-0 flex-1 truncate">{o.number} · {o.orderItems.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(", ")}</span>
              <span className="shrink-0 text-dim">{t(ORDER_STATUS[o.status] ?? o.status)}</span>
            </div>
          ))}
        </div>
      )}
      {menu.error ? <ErrorText>{menu.error}</ErrorText> : !menu.data ? <Loading /> : !m ? (
        <div className="card p-8 text-center text-dim">
          <UtensilsCrossed className="mx-auto size-10 opacity-60" />
          <p className="mt-3">{t("Sign in at a PC to order food and drinks to your seat.")}</p>
        </div>
      ) : (
        <>
          <p className="mb-3 flex items-center gap-2 text-sm text-dim"><Monitor className="size-4 text-glow" /> {t("Delivered to {station}", { station: menu.data.station ?? "" })}</p>
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {cats.map((c) => <button key={c.id} className="chip" aria-pressed={shown?.id === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
          <div className="grid gap-3">
            {shown?.products.map((p) => (
              <button key={p.id} disabled={!p.available} onClick={() => (p.modifierGroups.length ? setPicking(p) : add(p, []))} className={cx("card press flex items-center gap-4 p-4 text-start", !p.available && "opacity-40")}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}</p>
                  {p.description && <p className="text-sm text-dim">{p.description}</p>}
                  {!p.available && <p className="text-sm text-alarm">{t("Sold out")}</p>}
                </div>
                <span className="tabular shrink-0 font-semibold">{money(m.currency, p.price)}</span>
                <Plus className="size-5 shrink-0 text-glow" />
              </button>
            ))}
          </div>
        </>
      )}
      {cart.length > 0 && (
        <button onClick={() => setCheckout(true)} className="btn btn-primary fixed inset-x-4 bottom-24 z-30 mx-auto max-w-lg py-4 shadow-2xl">
          <UtensilsCrossed className="size-5" /> {t("View order · {n} items · {total}", { n: cart.reduce((s, l) => s + l.quantity, 0), total: money(m!.currency, total) })}
        </button>
      )}
      {picking && m && <ModifierSheet product={picking} currency={m.currency} onClose={() => setPicking(null)} onAdd={(mods) => { add(picking, mods); setPicking(null); }} />}
      {checkout && m && (
        <Sheet title={t("Your order")} onClose={() => setCheckout(false)}>
          <div className="grid gap-2">
            {cart.map((l) => (
              <div key={l.key} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.product.name}</p>
                  {l.modifiers.length > 0 && <p className="text-xs text-dim">{l.modifiers.map((x) => x.name).join(", ")}</p>}
                </div>
                <button className="rounded-full border border-rim p-1.5" aria-label={t("Less")} onClick={() => bump(l.key, -1)}><Minus className="size-4" /></button>
                <span className="tabular w-5 text-center">{l.quantity}</span>
                <button className="rounded-full border border-rim p-1.5" aria-label={t("More")} onClick={() => bump(l.key, 1)}><Plus className="size-4" /></button>
                <span className="tabular w-20 text-end">{money(m.currency, lineTotal(l))}</span>
              </div>
            ))}
            <div className="mt-3 flex justify-between border-t border-rim pt-3 font-display text-lg font-semibold"><span>{t("Total")}</span><span className="tabular">{money(m.currency, total)}</span></div>
            <p className="text-xs text-mute">{t("VAT is added when the bill is printed.")}</p>
            <button className="btn btn-primary mt-3 py-4" disabled={busy} onClick={() => void place("BILL")}>{busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />} {t("Order · pay with my session's bill")}</button>
            <button className="btn btn-ghost" disabled={busy || me.wallet.frozen} onClick={() => void place("WALLET")}><CreditCard className="size-5" /> {t("Order · pay from my wallet ({amount})", { amount: `${me.wallet.currency} ${me.wallet.total}` })}</button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}

function ModifierSheet({ product, currency, onClose, onAdd }: { product: Product; currency: string; onClose: () => void; onAdd: (m: Modifier[]) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const ok = product.modifierGroups.every((g) => (picked[g.id]?.length ?? 0) >= g.minSelect);
  const toggle = (g: Product["modifierGroups"][number], id: string) =>
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : g.maxSelect === 1 ? [id] : cur.length >= g.maxSelect ? cur : [...cur, id];
      return { ...p, [g.id]: next };
    });
  return (
    <Sheet title={product.name} onClose={onClose}>
      <div className="grid gap-5">
        {product.modifierGroups.map((g) => (
          <div key={g.id}>
            <p className="mb-2 text-sm text-dim">{g.name}{g.minSelect > 0 ? ` · ${t("required")}` : ""}{g.maxSelect > 1 ? ` · ${t("up to {n}", { n: g.maxSelect })}` : ""}</p>
            <div className="grid gap-2">
              {g.modifiers.map((x) => {
                const on = picked[g.id]?.includes(x.id);
                return (
                  <button key={x.id} onClick={() => toggle(g, x.id)} className={cx("flex items-center gap-3 rounded-xl border px-4 py-3 text-start", on ? "border-glow bg-glow/10" : "border-rim")}>
                    <span className="flex-1">{x.name}</span>
                    {Number(x.priceDelta) > 0 && <span className="text-sm text-dim">+{money(currency, x.priceDelta)}</span>}
                    {on && <Check className="size-4 text-glow" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button className="btn btn-primary py-4" disabled={!ok} onClick={() => onAdd(product.modifierGroups.flatMap((g) => g.modifiers.filter((x) => picked[g.id]?.includes(x.id))))}>
          <Plus className="size-5" /> {t("Add to order")}
        </button>
      </div>
    </Sheet>
  );
}

// ── games ───────────────────────────────────────────────────────────────────

interface Game { id: string; title: string; coverUrl: string | null; categories: string[]; minAge: number | null; featured: boolean; stations: number; favorite: boolean }

export function GamesScreen({ venue, back, toast }: { venue: Venue; back: () => void; toast: Toast }) {
  const [branchId, setBranch] = useState(venue.branches[0]?.id ?? "");
  const games = useLoad(() => api<Game[]>(`/games?branchId=${branchId}`), [branchId]);
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const fav = async (g: Game) => {
    const on = !(favs[g.id] ?? g.favorite);
    setFavs((f) => ({ ...f, [g.id]: on }));
    try {
      await api(`/games/${g.id}/favorite`, { method: on ? "POST" : "DELETE" });
    } catch (e) {
      setFavs((f) => ({ ...f, [g.id]: !on }));
      toast(e instanceof Error ? e.message : t("Couldn't save that."), false);
    }
  };
  const shown = (games.data ?? []).filter((g) => !q || g.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen title={t("Games")} back={back}>
      {venue.branches.length > 1 && (
        <select className="field mb-3" value={branchId} onChange={(e) => setBranch(e.target.value)}>
          {venue.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <input className="field mb-4" placeholder={t("Search games")} value={q} onChange={(e) => setQ(e.target.value)} />
      {games.error ? <ErrorText>{games.error}</ErrorText> : !games.data ? <Loading /> : shown.length === 0 ? <p className="card p-6 text-center text-dim">{t("No games found.")}</p> : (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((g) => {
            const on = favs[g.id] ?? g.favorite;
            return (
              <div key={g.id} className="card overflow-hidden">
                <div className="relative aspect-[3/4] bg-deck-2">
                  {g.coverUrl ? <img src={g.coverUrl} alt="" loading="lazy" className="size-full object-cover" /> : <Gamepad2 className="absolute inset-0 m-auto size-10 text-mute" />}
                  <button onClick={() => void fav(g)} aria-pressed={on} aria-label={on ? t("Remove from favourites") : t("Add to favourites")} className="absolute end-2 top-2 rounded-full bg-void/70 p-2">
                    <Star className={cx("size-5", on ? "fill-warn text-warn" : "text-text")} />
                  </button>
                  {g.minAge ? <span className="absolute start-2 top-2 rounded-full bg-void/70 px-2 py-0.5 text-xs">{g.minAge}+</span> : null}
                </div>
                <div className="p-3">
                  <p className="truncate font-semibold">{g.title}</p>
                  <p className={cx("text-xs", g.stations ? "text-good" : "text-mute")}>{g.stations ? t("On {n} PCs", { n: g.stations }) : t("Not installed here")}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

// ── friends: invite, gift ───────────────────────────────────────────────────

interface Referrals { code: string | null; friends: Array<{ name: string; joinedAt: string; played: boolean }>; points: number }

export function FriendsScreen({ me, venue, back, toast, onChanged }: { me: Me; venue: Venue; back: () => void; toast: Toast; onChanged: () => void }) {
  const r = useLoad(() => api<Referrals>("/referrals"));
  const [gift, setGift] = useState(false);
  const share = async () => {
    const code = r.data?.code;
    if (!code) return;
    const text = t("Join me at {venue}! Sign up with my invite code {code} and we both get points.", { venue: venue.name, code });
    const url = `${location.origin}/${location.pathname.split("/").filter(Boolean)[0] ?? ""}`;
    if (navigator.share) await navigator.share({ title: venue.name, text, url }).catch(() => undefined);
    else await navigator.clipboard.writeText(`${text} ${url}`).then(() => toast(t("Invite copied — paste it to your friends.")), () => toast(t("Couldn't copy."), false));
  };
  return (
    <Screen title={t("Friends")} back={back}>
      <div className="card p-5">
        <p className="flex items-center gap-2 font-semibold"><Users className="size-5 text-glow-2" /> {t("Invite a friend")}</p>
        <p className="mt-1 text-sm text-dim">{t("They sign up with your code; you get bonus points when they first play.")}</p>
        <p className="mt-3 rounded-xl bg-void/60 py-3 text-center font-mono text-2xl tracking-widest">{r.data?.code ?? "…"}</p>
        <button className="btn btn-primary mt-3 w-full" onClick={() => void share()} disabled={!r.data?.code}><Share2 className="size-5" /> {t("Share invite")}</button>
      </div>
      {r.data && (
        <div className="card mt-4 p-5">
          <div className="flex items-baseline justify-between">
            <p className="font-semibold">{t("Friends who joined")}</p>
            <p className="text-sm text-good">{t("{n} points earned", { n: r.data.points })}</p>
          </div>
          {r.data.friends.length === 0 ? <p className="mt-2 text-sm text-dim">{t("Nobody yet — share your code!")}</p> : (
            <ul className="mt-3 grid gap-2 text-sm">
              {r.data.friends.map((f, i) => (
                <li key={i} className="flex items-center gap-3"><User className="size-4 text-dim" /><span className="flex-1">{f.name}</span><span className="text-dim">{day(f.joinedAt)}</span>{f.played ? <span className="text-good">{t("played")}</span> : <span className="text-mute">{t("not yet")}</span>}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button className="card press mt-4 flex w-full items-center gap-4 p-5 text-start" onClick={() => setGift(true)}>
        <Gift className="size-7 text-glow" />
        <div className="flex-1"><p className="font-semibold">{t("Send a gift")}</p><p className="text-sm text-dim">{t("Give a friend wallet money or some of your play time.")}</p></div>
      </button>
      {gift && <GiftSheet me={me} onClose={() => setGift(false)} onDone={() => { setGift(false); onChanged(); }} toast={toast} />}
    </Screen>
  );
}

export function GiftSheet({ me, onClose, onDone, toast }: { me: Me; onClose: () => void; onDone: () => void; toast: Toast }) {
  const [f, setF] = useState({ to: "", bucket: "CASH" as "CASH" | "TIME", amount: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [k] = useState(key);
  const send = async () => {
    const what = f.bucket === "TIME" ? hours(Number(f.amount)) : `${me.wallet.currency} ${f.amount}`;
    if (!(await askConfirm(t("Send {what} to @{to}? This can't be undone.", { what, to: f.to.replace(/^@/, "") }), { ok: t("Send"), cancel: t("Cancel") }))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sent: string; to: string }>("/gift", { method: "POST", body: { to: f.to.replace(/^@/, "").trim(), bucket: f.bucket, amount: f.bucket === "TIME" ? Number(f.amount) : f.amount, idempotencyKey: k } });
      toast(t("Sent {what} to {to}!", { what: r.sent, to: r.to }));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't send it."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Send a gift")} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="field" placeholder={t("Friend's username")} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} autoCapitalize="none" required minLength={3} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="chip justify-center py-3" aria-pressed={f.bucket === "CASH"} onClick={() => setF({ ...f, bucket: "CASH", amount: "" })}>{t("Money")} · {me.wallet.cash}</button>
          <button type="button" className="chip justify-center py-3" aria-pressed={f.bucket === "TIME"} onClick={() => setF({ ...f, bucket: "TIME", amount: "" })}>{t("Play time")} · {hours(me.wallet.timeMinutes)}</button>
        </div>
        {f.bucket === "TIME" ? (
          <div className="grid grid-cols-4 gap-2">
            {[15, 30, 60, 120].map((m) => <button type="button" key={m} className="chip justify-center" disabled={m > me.wallet.timeMinutes} aria-pressed={f.amount === String(m)} onClick={() => setF({ ...f, amount: String(m) })}>{hours(m)}</button>)}
          </div>
        ) : (
          <input className="field" inputMode="decimal" placeholder={t("Amount ({cur})", { cur: me.wallet.currency })} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} required />
        )}
        <p className="text-xs text-mute">{t("Bonus credit can't be given. Gifts can't be taken back.")}</p>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4" disabled={busy || !f.to || !f.amount}>{busy ? <Loader2 className="size-5 animate-spin" /> : <Gift className="size-5" />} {t("Send gift")}</button>
      </form>
    </Sheet>
  );
}

// ── help ────────────────────────────────────────────────────────────────────

interface TicketRow { id: string; category: string; subject: string; message: string | null; status: string; createdAt: string; resolvedAt: string | null }
const TOPICS: Array<[string, string]> = [["PAYMENT", "Payment or wallet"], ["GAME", "A game"], ["HARDWARE", "PC, headset or controller"], ["FOOD", "Food & drinks"], ["OTHER", "Something else"]];

export function HelpScreen({ back, toast }: { back: () => void; toast: Toast }) {
  const list = useLoad(() => api<TicketRow[]>("/tickets"));
  const [f, setF] = useState({ category: "PAYMENT", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api("/tickets", { method: "POST", body: { category: f.category, subject: f.subject.trim(), message: f.message.trim() || null } });
      toast(t("Sent — the staff will get back to you."));
      setF({ category: "PAYMENT", subject: "", message: "" });
      list.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't send that."), false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t("Help")} back={back}>
      <form className="card grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <p className="font-semibold">{t("Tell us what's wrong")}</p>
        <select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {TOPICS.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
        <input className="field" placeholder={t("In a few words")} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={3} maxLength={120} />
        <textarea className="field min-h-24" placeholder={t("Details (optional)")} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={2000} />
        <button className="btn btn-primary" disabled={busy}>{busy ? <Loader2 className="size-5 animate-spin" /> : <LifeBuoy className="size-5" />} {t("Send to the staff")}</button>
      </form>
      <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">{t("Your requests")}</p>
      {!list.data ? <Loading /> : list.data.length === 0 ? <p className="text-dim">{t("Nothing yet.")}</p> : (
        <div className="grid gap-3">
          {list.data.map((x) => (
            <div key={x.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{x.subject}</p>
                <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-xs", x.status === "RESOLVED" || x.status === "CLOSED" ? "bg-good/15 text-good" : "bg-glow/15 text-glow")}>{x.status === "RESOLVED" || x.status === "CLOSED" ? t("Sorted") : t("Open")}</span>
              </div>
              {x.message && <p className="mt-1 text-sm text-dim">{x.message}</p>}
              <p className="mt-2 text-xs text-mute">{day(x.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

// ── my stats ────────────────────────────────────────────────────────────────

interface Stats { minutes: number; spend: string; visits: number; sessions: number; memberSince: string; favouriteStation: string | null; months: Array<{ month: string; minutes: number; visits: number }> }

export function StatsScreen({ me, back }: { me: Me; back: () => void }) {
  const s = useLoad(() => api<Stats>("/me/stats"));
  const months = useMemo(() => {
    const out: Array<{ label: string; minutes: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({ label: d.toLocaleDateString(locale(), { month: "short" }), minutes: s.data?.months.find((m) => m.month === k)?.minutes ?? 0 });
    }
    return out;
  }, [s.data]);
  const max = Math.max(60, ...months.map((m) => m.minutes));
  return (
    <Screen title={t("My stats")} back={back}>
      {!s.data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              [t("Played"), hours(s.data.minutes)],
              [t("Visits"), String(s.data.visits)],
              [t("Spent"), `${me.wallet.currency} ${s.data.spend}`],
              [t("Favourite PC"), s.data.favouriteStation ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="card p-4"><p className="text-xs text-dim">{k}</p><p className="tabular mt-1 truncate font-display text-xl font-semibold">{v}</p></div>
            ))}
          </div>
          <div className="card mt-4 p-5">
            <p className="mb-4 text-sm text-dim">{t("Hours played, last 6 months")}</p>
            <div className="flex h-36 items-end gap-3">
              {months.map((m) => (
                <div key={m.label} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="tabular text-[11px] text-dim">{m.minutes ? Math.round(m.minutes / 60) : ""}</span>
                  <span className="w-full rounded-t-md brand-gradient" style={{ height: `${Math.max(2, (m.minutes / max) * 100)}px` }} />
                  <span className="text-xs text-mute">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-mute">{t("Member since {date}", { date: new Date(s.data.memberSince).toLocaleDateString(locale(), { month: "long", year: "numeric" }) })}</p>
        </>
      )}
    </Screen>
  );
}

// ── challenges & leaderboard (on the Rewards tab) ───────────────────────────

interface Challenge { id: string; name: string; description: string | null; rewardPoints: number; type: string; target: number; progress: number; earnedAt: string | null }
interface Board { top: Array<{ place: number; name: string; minutes: number; me: boolean }>; me: { minutes: number; place: number | null; of: number; shown: boolean } }
const UNIT: Record<string, (n: number) => string> = {
  PLAY_MINUTES: (n) => hours(n),
  VISITS: (n) => t("{n} visits", { n }),
  BOOKINGS: (n) => t("{n} bookings", { n }),
  TOURNAMENTS: (n) => t("{n} tournaments", { n }),
};

export function Challenges() {
  const list = useLoad(() => api<Challenge[]>("/challenges"));
  if (!list.data?.length) return null;
  return (
    <>
      <h2 className="mb-3 mt-6 font-display text-lg font-semibold">{t("Challenges")}</h2>
      <div className="grid gap-3">
        {list.data.map((c) => (
          <div key={c.id} className={cx("card p-4", c.earnedAt && "border-good/40")}>
            <div className="flex items-center gap-3">
              {c.earnedAt ? <Medal className="size-6 shrink-0 text-good" /> : <Trophy className="size-6 shrink-0 text-warn" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.name}</p>
                <p className="text-sm text-dim">{c.earnedAt ? t("Done on {date}", { date: day(c.earnedAt) }) : `${UNIT[c.type]?.(c.progress) ?? c.progress} / ${UNIT[c.type]?.(c.target) ?? c.target}`}</p>
              </div>
              <span className={cx("shrink-0 text-sm font-semibold", c.earnedAt ? "text-good" : "text-glow")}>+{c.rewardPoints}</span>
            </div>
            {!c.earnedAt && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-rim"><div className="h-full rounded-full brand-gradient" style={{ width: `${(c.progress / c.target) * 100}%` }} /></div>}
          </div>
        ))}
      </div>
    </>
  );
}

export function Leaderboard({ me, toast }: { me: Me; toast: Toast }) {
  const b = useLoad(() => api<Board>("/leaderboard"));
  const [shown, setShown] = useState(me.showOnLeaderboard);
  const toggle = async () => {
    try {
      await api("/me", { method: "PATCH", body: { showOnLeaderboard: !shown } });
      setShown(!shown);
      b.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't save that."), false);
    }
  };
  if (!b.data) return null;
  return (
    <>
      <h2 className="mb-3 mt-6 font-display text-lg font-semibold">{t("Top players this month")}</h2>
      <div className="card divide-y divide-rim">
        {b.data.top.length === 0 && <p className="p-4 text-sm text-dim">{t("No one on the board yet — be the first!")}</p>}
        {b.data.top.map((r) => (
          <div key={r.place} className={cx("flex items-center gap-3 px-4 py-3 text-sm", r.me && "bg-glow/10")}>
            <span className={cx("w-6 font-display font-semibold", r.place === 1 ? "text-warn" : "text-dim")}>{r.place}</span>
            <span className="flex-1">{r.name}</span>
            <span className="tabular text-dim">{hours(r.minutes)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-dim">
        {b.data.me.place ? t("You're #{place} of {of} with {time}.", { place: b.data.me.place, of: b.data.me.of, time: hours(b.data.me.minutes) }) : t("Play this month to get on the board.")}
      </p>
      <label className="mt-2 flex items-center gap-3 text-sm">
        <input type="checkbox" checked={shown} onChange={() => void toggle()} className="size-5 accent-[var(--color-glow)]" /> {t("Show my first name on the board")}
      </label>
    </>
  );
}

// ── wallet: online top-up ───────────────────────────────────────────────────

export function TopUpSheet({ me, venue, onClose, onDone, toast }: { me: Me; venue: Venue; onClose: () => void; onDone: () => void; toast: Toast }) {
  const [amount, setAmount] = useState("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [k] = useState(key);
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/wallet/topup", { method: "POST", body: { amount, idempotencyKey: k } });
      toast(t("{amount} added to your wallet!", { amount: `${me.wallet.currency} ${amount}` }));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't top up."));
    } finally {
      setBusy(false);
    }
  };
  const card = useLoad(() => api<{ available: boolean }>("/wallet/card").catch(() => ({ available: false })));
  if (card.data?.available) return <Sheet title={t("Top up your wallet")} onClose={onClose}><CardTopUp me={me} onClose={onClose} /></Sheet>;
  return (
    <Sheet title={t("Top up your wallet")} onClose={onClose}>
      {!venue.demoPayments ? <p className="text-dim">{t("Top up your wallet at the counter — card and cash.")}</p> : (
        <div className="grid gap-4">
          <div className="grid grid-cols-4 gap-2">
            {["20", "50", "100", "200"].map((a) => <button key={a} className="chip justify-center py-3" aria-pressed={amount === a} onClick={() => setAmount(a)}>{a}</button>)}
          </div>
          <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-label={t("Amount ({cur})", { cur: me.wallet.currency })} />
          <div className="rounded-2xl p-5 text-void" style={{ background: "linear-gradient(135deg, var(--color-glow), var(--color-glow-2))" }}>
            <p className="text-xs font-semibold uppercase tracking-widest opacity-70">{t("Demo card")}</p>
            <p className="tabular mt-4 font-mono text-xl tracking-widest" dir="ltr">4242 4242 4242 4242</p>
          </div>
          <p className="flex items-start gap-2 text-sm text-dim"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" /> {t("Demo mode — no real card is charged.")}</p>
          <ErrorText>{error}</ErrorText>
          <button className="btn btn-primary py-4 text-lg" disabled={busy || !(Number(amount) >= 5)} onClick={() => void pay()}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : <CreditCard className="size-5" />} {t("Pay {amount}", { amount: `${me.wallet.currency} ${amount}` })}
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ── wallet: gift card ───────────────────────────────────────────────────────

/** A code bought at the counter becomes wallet money. */
export function GiftCardSheet({ me, onClose, onDone, toast }: { me: Me; onClose: () => void; onDone: () => void; toast: Toast }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ amount: string }>("/wallet/gift-card", { method: "POST", body: { code } });
      toast(t("{amount} added to your wallet!", { amount: `${me.wallet.currency} ${r.amount}` }));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't redeem that code."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Redeem a gift card")} onClose={onClose}>
      <div className="grid gap-4">
        <input className="field text-center font-mono text-lg uppercase tracking-widest" dir="ltr" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("Gift card code")} />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4 text-lg" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length < 16} onClick={() => void redeem()}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Gift className="size-5" />} {t("Redeem")}
        </button>
      </div>
    </Sheet>
  );
}

// ── sign in at a PC with the phone ──────────────────────────────────────────

/** Opened from the PC's QR code (…?pc=CODE): confirm, and the PC unlocks with my saved time. */
export function PcLoginSheet({ code, onClose, onDone, toast }: { code: string; onClose: () => void; onDone: () => void; toast: Toast }) {
  const pc = useLoad(() => api<{ station: string; branch: string }>(`/pc-login/${encodeURIComponent(code)}`), [code]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ station: string; timeBalanceMinutes: number }>("/pc-login", { method: "POST", body: { code } });
      toast(t("You're signed in on {station} — have fun!", { station: r.station }));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't sign in on that PC."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Sign in on a PC")} onClose={onClose}>
      {pc.error ? <ErrorText>{pc.error}</ErrorText> : !pc.data ? <Loading /> : (
        <div className="grid gap-4">
          <div className="flex items-center gap-4 rounded-2xl border border-rim p-4">
            <Monitor className="size-8 text-glow" />
            <div><p className="font-display text-xl font-semibold">{pc.data.station}</p><p className="text-sm text-dim">{pc.data.branch}</p></div>
          </div>
          <p className="text-sm text-dim">{t("Your saved play time starts on this PC.")}</p>
          <ErrorText>{error}</ErrorText>
          <button className="btn btn-primary py-4 text-lg" disabled={busy} onClick={() => void go()}>{busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />} {t("Sign in on {station}", { station: pc.data.station })}</button>
        </div>
      )}
    </Sheet>
  );
}

/** Opened from a guest PC's QR (…?claim=CODE): the running session moves onto this account. */
export function ClaimSheet({ code, onClose, onDone, toast }: { code: string; onClose: () => void; onDone: () => void; toast: Toast }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ station: string }>("/claim", { method: "POST", body: { code } });
      toast(t("The session on {station} is yours now — points included!", { station: r.station }));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't move the session."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Keep this session")} onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-dim">{t("The guest session on the PC you scanned becomes yours: its time counts for points, rewards and your stats.")}</p>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4 text-lg" disabled={busy} onClick={() => void go()}>{busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />} {t("Move it to my account")}</button>
      </div>
    </Sheet>
  );
}

// ── split a booking with friends ────────────────────────────────────────────

export function SplitSheet({ booking, onClose, toast }: { booking: Booking; onClose: () => void; toast: Toast }) {
  const shares = useLoad(() => api<Array<{ name: string; paid: boolean; share: string }>>(`/bookings/${booking.id}/shares`), [booking.id]);
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ invited: string[]; share: string; currency: string }>(`/bookings/${booking.id}/invite`, { method: "POST", body: { usernames: names.split(/[\s,]+/).map((s) => s.replace(/^@/, "")).filter(Boolean) } });
      toast(t("Sent! Each friend's share is {amount}.", { amount: `${r.currency} ${r.share}` }));
      setNames("");
      shares.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't send the invites."), false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Split with friends")} onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-sm text-dim">{t("Friends get a message in the app to pay their share of {total} into your wallet.", { total: `${booking.currency} ${booking.estimatedTotal}` })}</p>
        <input className="field" placeholder={t("Friends' usernames, separated by spaces")} value={names} onChange={(e) => setNames(e.target.value)} autoCapitalize="none" />
        <button className="btn btn-primary" disabled={busy || !names.trim()} onClick={() => void send()}>{busy ? <Loader2 className="size-5 animate-spin" /> : <HeartHandshake className="size-5" />} {t("Send invites")}</button>
        {(shares.data ?? []).length > 0 && (
          <ul className="card divide-y divide-rim text-sm">
            {shares.data!.map((s, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-3"><span>{s.name}</span><span className={s.paid ? "text-good" : "text-dim"}>{s.paid ? t("paid {amount}", { amount: s.share }) : t("waiting")}</span></li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

// ── profile, sign-in details, notifications, language, delete ───────────────

export function ProfileScreen({ me, back, toast, onChanged }: { me: Me; back: () => void; toast: Toast; onChanged: () => void }) {
  const [f, setF] = useState({ displayName: me.displayName, phone: me.phone ?? "", email: me.email ?? "", dateOfBirth: me.dateOfBirth ?? "", marketingConsent: me.marketingConsent });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"password" | "pin" | "export" | "delete" | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    void pushState().then(setPush, () => setPush("unsupported"));
    void QRCode.toDataURL(me.username, { margin: 1, width: 240, color: { dark: "#0b0e14", light: "#ffffff" } }).then(setQr);
  }, [me.username]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/me", { method: "PATCH", body: { displayName: f.displayName.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, marketingConsent: f.marketingConsent, ...(me.dateOfBirth ? {} : { dateOfBirth: f.dateOfBirth || null }) } });
      toast(t("Saved."));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't save."));
    } finally {
      setBusy(false);
    }
  };
  const lang = async (l: "en" | "ar") => {
    setLang(l);
    await api("/me", { method: "PATCH", body: { locale: l } }).catch(() => undefined);
  };
  const togglePush = async () => {
    try {
      setPush(push === "on" ? await disablePush() : await enablePush());
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't change notifications."), false);
    }
  };
  return (
    <Screen title={t("Profile")} back={back}>
      <form className="card grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="grid gap-1.5 text-sm text-dim">{t("Your name")}<input className="field" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required maxLength={60} /></label>
        <label className="grid gap-1.5 text-sm text-dim">{t("Phone")}<input className="field" type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="grid gap-1.5 text-sm text-dim">{t("Email")}<input className="field" type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="grid gap-1.5 text-sm text-dim">
          {t("Date of birth")}
          <input className="field" type="date" value={f.dateOfBirth} disabled={!!me.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} />
          <span className="text-xs text-mute">{me.dateOfBirth ? t("Set — ask the staff if it's wrong.") : t("For age-rated games. You can set it once.")}</span>
        </label>
        <label className="flex items-center gap-3 text-sm text-dim">
          <input type="checkbox" checked={f.marketingConsent} onChange={(e) => setF({ ...f, marketingConsent: e.target.checked })} className="size-5 accent-[var(--color-glow)]" /> {t("Tell me about tournaments and offers")}
        </label>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary" disabled={busy}>{busy && <Loader2 className="size-5 animate-spin" />} {t("Save")}</button>
      </form>

      <div className="card mt-4 divide-y divide-rim">
        <div className="flex items-center gap-3 px-5 py-4">
          <Languages className="size-5 text-glow" />
          <span className="flex-1">{t("Language")}</span>
          <button className="chip" aria-pressed={getLang() === "en"} onClick={() => void lang("en")}>English</button>
          <button className="chip" aria-pressed={getLang() === "ar"} onClick={() => void lang("ar")}>العربية</button>
        </div>
        <button className="flex w-full items-center gap-3 px-5 py-4 text-start" disabled={!push || push === "unsupported" || push === "denied"} onClick={() => void togglePush()}>
          {push === "on" ? <Bell className="size-5 text-glow" /> : <BellOff className="size-5 text-dim" />}
          <span className="flex-1">
            {t("Notifications")}
            <span className="block text-xs text-mute">
              {push === "unsupported" ? t("Not available on this device.") : push === "denied" ? t("Blocked — allow them in your browser settings.") : t("Time running out, food ready, booking reminders.")}
            </span>
          </span>
          <span className={cx("text-sm", push === "on" ? "text-good" : "text-dim")}>{push === "on" ? t("On") : t("Off")}</span>
        </button>
        <button className="flex w-full items-center gap-3 px-5 py-4 text-start" onClick={() => setSheet("password")}><KeyRound className="size-5 text-glow" /><span className="flex-1">{t("Change password")}</span></button>
        <button className="flex w-full items-center gap-3 px-5 py-4 text-start" onClick={() => setSheet("pin")}><KeyRound className="size-5 text-glow-2" /><span className="flex-1">{me.hasPin ? t("Change PC PIN") : t("Set a PC PIN")}<span className="block text-xs text-mute">{t("4–8 digits for quick sign-in at a PC")}</span></span></button>
      </div>

      {qr && (
        <div className="card mt-4 flex items-center gap-4 p-5">
          <img src={qr} alt="" className="size-24 rounded-xl bg-white p-1" />
          <p className="text-sm text-dim">{t("Show this at the counter and the staff find you straight away.")}</p>
        </div>
      )}

      <button className="btn btn-ghost mt-6 w-full" onClick={() => setSheet("export")}><Download className="size-5" /> {t("Download my data")}</button>
      <button className="btn btn-ghost mt-3 w-full text-alarm" onClick={() => setSheet("delete")}><Trash2 className="size-5" /> {t("Delete my account")}</button>

      {sheet === "password" && <PasswordSheet onClose={() => setSheet(null)} toast={toast} />}
      {sheet === "pin" && <PinSheet hasPin={me.hasPin} onClose={() => setSheet(null)} onDone={() => { setSheet(null); onChanged(); }} toast={toast} />}
      {sheet === "export" && <ExportSheet onClose={() => setSheet(null)} />}
      {sheet === "delete" && <DeleteSheet onClose={() => setSheet(null)} />}
    </Screen>
  );
}

function PasswordSheet({ onClose, toast }: { onClose: () => void; toast: Toast }) {
  const [f, setF] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/me/password", { method: "POST", body: f });
      toast(t("Password changed. Other phones were signed out."));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't change it."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Change password")} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input className="field" type="password" placeholder={t("Current password")} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" required />
        <input className="field" type="password" placeholder={t("New password (8+ characters)")} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" minLength={8} required />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4" disabled={busy}>{busy && <Loader2 className="size-5 animate-spin" />} {t("Change password")}</button>
      </form>
    </Sheet>
  );
}

function PinSheet({ hasPin, onClose, onDone, toast }: { hasPin: boolean; onClose: () => void; onDone: () => void; toast: Toast }) {
  const [f, setF] = useState({ password: "", pin: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (pin: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api("/me/pin", { method: "POST", body: { password: f.password, pin } });
      toast(pin ? t("PIN saved. Use it with your username at any PC.") : t("PIN removed."));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't save the PIN."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={hasPin ? t("Change PC PIN") : t("Set a PC PIN")} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save(f.pin); }}>
        <input className="field" type="password" placeholder={t("Your password")} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" required />
        <input className="field tracking-[0.5em]" inputMode="numeric" placeholder={t("New PIN")} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })} minLength={4} required />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4" disabled={busy || f.pin.length < 4}>{busy && <Loader2 className="size-5 animate-spin" />} {t("Save PIN")}</button>
        {hasPin && <button type="button" className="btn btn-ghost text-alarm" disabled={busy || !f.password} onClick={() => void save(null)}>{t("Remove PIN")}</button>}
      </form>
    </Sheet>
  );
}

/** The venue's copy of my data, saved as a JSON file on this phone. */
function ExportSheet({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<unknown>("/me/export", { method: "POST", body: { password } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "my-data.json" });
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't prepare your data."));
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Download my data")} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <p className="text-sm text-dim">{t("Your profile, wallet history, sessions, bills, bookings, points and messages, in one file.")}</p>
        <input className="field" type="password" placeholder={t("Your password")} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4" disabled={busy || !password}>{busy && <Loader2 className="size-5 animate-spin" />} {t("Download")}</button>
      </form>
    </Sheet>
  );
}

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!(await askConfirm(t("Delete your account for good? Your name, phone, email and logins are erased and you can't sign in again."), { ok: t("Delete"), cancel: t("Keep it") }))) return;
    setBusy(true);
    setError(null);
    try {
      await api("/me/delete", { method: "POST", body: { password } });
      setToken(null);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't delete the account."));
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Delete my account")} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <p className="text-sm text-dim">{t("Your wallet must be empty and nothing booked or running. Receipts stay in the venue's books without your name.")}</p>
        <input className="field" type="password" placeholder={t("Your password")} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-ghost border-alarm/60 py-4 text-alarm" disabled={busy}>{busy && <Loader2 className="size-5 animate-spin" />} {t("Delete my account")}</button>
      </form>
    </Sheet>
  );
}

