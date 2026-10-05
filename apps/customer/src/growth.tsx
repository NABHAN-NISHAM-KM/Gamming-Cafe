import { useState } from "react";
import { Check, CreditCard, Gift, Loader2, MapPin, Medal, Plus, ReceiptText, ShieldCheck, Swords, Timer, Users, UtensilsCrossed, X } from "lucide-react";
import { api, key, type Booking, type Me } from "./api";
import { askConfirm } from "./confirm";
import { locale, t } from "./i18n";
import { cx, ErrorText, Loading, Screen, Sheet, useLoad, type Toast } from "./ui";

const money = (cur: string, v: string | number) => `${cur} ${Number(v).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// ── waitlist ────────────────────────────────────────────────────────────────

interface WaitView {
  mine: { id: string; branch: string; zone: string | null; partySize: number; status: "WAITING" | "NOTIFIED"; position: number; device: string | null; claimUntil: string | null } | null;
  branches: Array<{ id: string; name: string; zones: Array<{ id: string; name: string; free: number }> }>;
}

/** Floor full? Join the line from home; a push says when a station is free for you. */
export function WaitlistCard({ toast }: { toast: Toast }) {
  const w = useLoad(() => api<WaitView>("/waitlist"));
  const [open, setOpen] = useState(false);
  const leave = async () => {
    if (!(await askConfirm(t("Leave the waitlist?"), { ok: t("Leave"), cancel: t("Stay in line") }))) return;
    try {
      await api("/waitlist", { method: "DELETE" });
      w.reload();
    } catch (e) {
      toast(errText(e, t("Couldn't leave the line.")), false);
    }
  };
  if (!w.data) return null;
  const m = w.data.mine;
  const allBusy = w.data.branches.length > 0 && w.data.branches.every((b) => b.zones.every((z) => z.free === 0));
  if (!m && !allBusy) return null;
  return (
    <>
      <div className={cx("card mt-4 p-5", m?.status === "NOTIFIED" && "border-good/50")}>
        {m ? (
          <div className="flex items-center gap-4">
            <Users className={cx("size-7", m.status === "NOTIFIED" ? "text-good" : "text-glow")} />
            <div className="flex-1">
              {m.status === "NOTIFIED" ? (
                <>
                  <p className="font-semibold">{t("{station} is free for you!", { station: m.device ?? "" })}</p>
                  <p className="text-sm text-dim">{t("Claim it at the counter by {time}.", { time: m.claimUntil ? new Date(m.claimUntil).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "" })}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">{t("You're number {n} in line", { n: m.position })}</p>
                  <p className="text-sm text-dim">{m.branch}{m.zone ? ` · ${m.zone}` : ""} · {t("we'll notify you")}</p>
                </>
              )}
            </div>
            <button onClick={() => void leave()} className="text-sm text-alarm">{t("Leave")}</button>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="flex w-full items-center gap-4 text-start">
            <Users className="size-7 text-glow" />
            <div className="flex-1"><p className="font-semibold">{t("Everything's busy right now")}</p><p className="text-sm text-dim">{t("Join the waitlist — we'll tell you when a station frees up.")}</p></div>
            <Plus className="size-5 text-glow" />
          </button>
        )}
      </div>
      {open && <JoinLineSheet view={w.data} onClose={() => setOpen(false)} onDone={() => { setOpen(false); w.reload(); toast(t("You're in line.")); }} />}
    </>
  );
}

function JoinLineSheet({ view, onClose, onDone }: { view: WaitView; onClose: () => void; onDone: () => void }) {
  const [branchId, setBranch] = useState(view.branches[0]?.id ?? "");
  const [zoneId, setZone] = useState("");
  const [people, setPeople] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branch = view.branches.find((b) => b.id === branchId);
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/waitlist", { method: "POST", body: { branchId, zoneId: zoneId || null, partySize: people } });
      onDone();
    } catch (e) {
      setError(errText(e, t("Couldn't join the line.")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Join the waitlist")} onClose={onClose}>
      <div className="grid gap-4">
        {view.branches.length > 1 && (
          <select className="field" value={branchId} onChange={(e) => { setBranch(e.target.value); setZone(""); }} aria-label={t("Branch")}>
            {view.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="chip" aria-pressed={!zoneId} onClick={() => setZone("")}>{t("Any area")}</button>
          {branch?.zones.map((z) => <button key={z.id} className="chip" aria-pressed={zoneId === z.id} onClick={() => setZone(z.id)}>{z.name}</button>)}
        </div>
        <div className="flex items-center justify-between">
          <span>{t("How many of you?")}</span>
          <div className="flex items-center gap-3">
            <button className="chip" onClick={() => setPeople(Math.max(1, people - 1))} aria-label={t("Fewer")}>−</button>
            <span className="tabular w-6 text-center text-lg">{people}</span>
            <button className="chip" onClick={() => setPeople(Math.min(10, people + 1))} aria-label={t("More")}>+</button>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4" disabled={busy || !branchId} onClick={() => void join()}>{busy ? <Loader2 className="size-5 animate-spin" /> : <Users className="size-5" />} {t("Join the line")}</button>
      </div>
    </Sheet>
  );
}

// ── season pass ─────────────────────────────────────────────────────────────

interface Season {
  id: string; name: string; startsAt: string; endsAt: string; price: string; currency: string; joined: boolean; xp: number;
  tiers: Array<{ index: number; xp: number; reward: { type: "BONUS" | "MINUTES" | "POINTS"; amount: number }; reached: boolean; claimed: boolean }>;
}
const rewardText = (r: Season["tiers"][number]["reward"], cur: string) => (r.type === "POINTS" ? t("{n} points", { n: r.amount }) : r.type === "MINUTES" ? t("{n} free minutes", { n: r.amount }) : t("{amount} bonus", { amount: money(cur, r.amount) }));

export function SeasonScreen({ back, toast, onChanged }: { back: () => void; toast: Toast; onChanged: () => void }) {
  const list = useLoad(() => api<Season[]>("/seasons"));
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, path: string, done: string) => {
    setBusy(id);
    try {
      await api(path, { method: "POST" });
      toast(done);
      list.reload();
      onChanged();
    } catch (e) {
      toast(errText(e, t("That didn't work.")), false);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Screen title={t("Season pass")} back={back}>
      {!list.data ? <Loading /> : list.data.length === 0 ? <p className="text-dim">{t("No season running right now — check back soon.")}</p> : list.data.map((s) => {
        const next = s.tiers.find((x) => !x.reached);
        const top = s.tiers.at(-1)?.xp ?? 1;
        return (
          <div key={s.id} className="card mb-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-xl font-semibold">{s.name}</p>
                <p className="text-sm text-dim">{t("Until {date}", { date: new Date(s.endsAt).toLocaleDateString(locale()) })}</p>
              </div>
              <Medal className="size-7 text-warn" />
            </div>
            {s.joined ? (
              <>
                <p className="mt-4 text-sm"><b className="tabular text-glow">{s.xp}</b> XP{next ? ` · ${t("{n} XP to the next reward", { n: next.xp - s.xp })}` : ` · ${t("all levels reached!")}`}</p>
                <div className="mt-2 h-2 rounded-full bg-deck-2"><div className="h-2 rounded-full brand-gradient" style={{ width: `${Math.min(100, (s.xp / top) * 100)}%` }} /></div>
                <p className="mt-2 text-xs text-dim">{t("1 XP per minute played, 100 XP per challenge finished.")}</p>
              </>
            ) : (
              <button className="btn btn-primary mt-4 w-full py-3" disabled={busy === s.id} onClick={() => void act(s.id, `/seasons/${s.id}/join`, t("You've joined {name}!", { name: s.name }))}>
                {busy === s.id ? <Loader2 className="size-5 animate-spin" /> : <Medal className="size-5" />} {Number(s.price) > 0 ? t("Join for {amount} (from your wallet)", { amount: money(s.currency, s.price) }) : t("Join for free")}
              </button>
            )}
            <ol className="mt-4 grid gap-2">
              {s.tiers.map((x) => (
                <li key={x.index} className={cx("flex items-center gap-3 rounded-xl border px-4 py-3", x.reached ? "border-good/40" : "border-rim")}>
                  <span className="tabular w-16 text-sm text-dim">{x.xp} XP</span>
                  <span className="flex-1">{rewardText(x.reward, s.currency)}</span>
                  {x.claimed ? <Check className="size-5 text-good" /> : x.reached && s.joined ? (
                    <button className="btn btn-primary px-3 py-1.5 text-sm" disabled={busy === `${s.id}:${x.index}`} onClick={() => void act(`${s.id}:${x.index}`, `/seasons/${s.id}/claim/${x.index}`, t("Reward claimed!"))}><Gift className="size-4" /> {t("Claim")}</button>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </Screen>
  );
}

// ── find a team ─────────────────────────────────────────────────────────────

interface Post { id: string; game: string; branch: string; branchId: string; startsAt: string; note: string | null; status: "OPEN" | "FULL"; playersNeeded: number; host: string; mine: boolean; joined: boolean; members: string[] }

export function TeamsScreen({ back, toast, branches }: { back: () => void; toast: Toast; branches: Array<{ id: string; name: string }> }) {
  const posts = useLoad(() => api<Post[]>("/lfg"));
  const [creating, setCreating] = useState(false);
  const act = async (p: Post, action: "join" | "leave" | "close") => {
    try {
      const r = await api<{ full?: boolean }>(`/lfg/${p.id}/${action}`, { method: "POST" });
      toast(action === "join" ? (r.full ? t("You're in — the team is full!") : t("You're in!")) : action === "leave" ? t("You left.") : t("Post closed."));
      posts.reload();
    } catch (e) {
      toast(errText(e, t("That didn't work.")), false);
    }
  };
  return (
    <Screen title={t("Find a team")} back={back} action={<button className="btn btn-primary px-3 py-2 text-sm" onClick={() => setCreating(true)}><Plus className="size-4" /> {t("Post")}</button>}>
      <p className="mb-4 text-sm text-dim">{t("Looking for players? Post what you're playing and when — others at the venue can join.")}</p>
      {!posts.data ? <Loading /> : posts.data.length === 0 ? <p className="text-dim">{t("Nobody's looking yet. Be the first!")}</p> : posts.data.map((p) => (
        <div key={p.id} className="card mb-3 p-5">
          <div className="flex items-start gap-3">
            <Swords className="mt-1 size-6 text-glow" />
            <div className="flex-1">
              <p className="font-semibold">{p.game} · {t("{n} wanted", { n: p.playersNeeded })}</p>
              <p className="text-sm text-dim">{when(p.startsAt)} · {p.branch} · {t("by {name}", { name: p.host })}</p>
              {p.note && <p className="mt-1 text-sm">{p.note}</p>}
              <p className="mt-2 text-xs text-dim">{p.members.length ? t("Joined: {names}", { names: p.members.join(", ") }) : t("No one's joined yet")}{p.status === "FULL" ? ` · ${t("full")}` : ""}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-3 text-sm">
            {p.mine ? <button className="text-alarm" onClick={() => void act(p, "close")}>{t("Close")}</button>
              : p.joined ? <button className="text-dim" onClick={() => void act(p, "leave")}>{t("Leave")}</button>
              : p.status === "OPEN" && <button className="btn btn-primary px-4 py-1.5" onClick={() => void act(p, "join")}>{t("Join")}</button>}
          </div>
        </div>
      ))}
      {creating && <NewPostSheet branches={branches} onClose={() => setCreating(false)} onDone={() => { setCreating(false); posts.reload(); toast(t("Posted!")); }} />}
    </Screen>
  );
}

function NewPostSheet({ branches, onClose, onDone }: { branches: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const soon = new Date(Date.now() + 2 * 3_600_000);
  soon.setMinutes(0, 0, 0);
  const localValue = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [f, setF] = useState({ game: "", players: 1, at: localValue, note: "", branchId: branches[0]?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/lfg", { method: "POST", body: { branchId: f.branchId, game: f.game.trim(), playersNeeded: f.players, startsAt: new Date(f.at).toISOString(), note: f.note.trim() || null } });
      onDone();
    } catch (e) {
      setError(errText(e, t("Couldn't post.")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Looking for players")} onClose={onClose}>
      <div className="grid gap-3">
        <input className="field" value={f.game} onChange={(e) => setF({ ...f, game: e.target.value })} placeholder={t("Game, e.g. Valorant")} maxLength={60} />
        <div className="flex items-center justify-between">
          <span>{t("Players wanted")}</span>
          <div className="flex items-center gap-3">
            <button className="chip" onClick={() => setF({ ...f, players: Math.max(1, f.players - 1) })}>−</button>
            <span className="tabular w-6 text-center text-lg">{f.players}</span>
            <button className="chip" onClick={() => setF({ ...f, players: Math.min(20, f.players + 1) })}>+</button>
          </div>
        </div>
        <input className="field" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} aria-label={t("When")} />
        {branches.length > 1 && <select className="field" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <input className="field" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t("Note (optional), e.g. ranked, Gold+")} maxLength={300} />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary py-4" disabled={busy || !f.game.trim()} onClick={() => void post()}>{busy ? <Loader2 className="size-5 animate-spin" /> : <Swords className="size-5" />} {t("Post")}</button>
      </div>
    </Sheet>
  );
}

// ── spending limit & guardians ──────────────────────────────────────────────

interface CapView { currency: string; cap: string | null; spentThisWeek: string; left: string | null; setByGuardian: boolean; guardian: string | null }
interface Spending extends CapView { wards: Array<CapView & { id: string; name: string; username: string }> }

export function SpendingScreen({ back, toast }: { back: () => void; toast: Toast }) {
  const s = useLoad(() => api<Spending>("/me/spending"));
  const [cap, setCap] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; expiresInMinutes: number } | null>(null);
  const [link, setLink] = useState({ username: "", code: "" });
  const save = async (path: string, value: string | null) => {
    try {
      await api(path, { method: "PUT", body: { cap: value && value.trim() ? value.trim() : null } });
      toast(t("Saved."));
      setCap(null);
      s.reload();
    } catch (e) {
      toast(errText(e, t("Couldn't save.")), false);
    }
  };
  const makeCode = async () => {
    try {
      setCode(await api("/me/guardian-code", { method: "POST" }));
    } catch (e) {
      toast(errText(e, t("That didn't work.")), false);
    }
  };
  const linkWard = async () => {
    try {
      await api("/me/wards", { method: "POST", body: { username: link.username.trim(), code: link.code.trim() } });
      toast(t("Linked."));
      setLink({ username: "", code: "" });
      s.reload();
    } catch (e) {
      toast(errText(e, t("That didn't work.")), false);
    }
  };
  if (!s.data) return <Screen title={t("Spending limit")} back={back}><Loading /></Screen>;
  const d = s.data;
  return (
    <Screen title={t("Spending limit")} back={back}>
      <div className="card p-5">
        <p className="text-sm text-dim">{t("Spent from your wallet in the last 7 days")}</p>
        <p className="tabular mt-1 font-display text-3xl font-semibold" dir="ltr">{money(d.currency, d.spentThisWeek)}</p>
        {d.cap && <p className="mt-1 text-sm">{t("Limit {cap} · {left} left", { cap: money(d.currency, d.cap), left: money(d.currency, d.left ?? 0) })}</p>}
        {d.setByGuardian ? (
          <p className="mt-4 flex items-start gap-2 text-sm text-dim"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" /> {t("{name} set this limit.", { name: d.guardian ?? t("Your guardian") })}</p>
        ) : (
          <div className="mt-4 flex gap-2">
            <input className="field flex-1" inputMode="decimal" placeholder={t("Weekly limit (empty = none)")} value={cap ?? d.cap ?? ""} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} />
            <button className="btn btn-primary px-4" onClick={() => void save("/me/spending", cap ?? d.cap)}>{t("Save")}</button>
          </div>
        )}
      </div>

      <h2 className="mb-2 mt-6 font-display text-lg font-semibold">{t("Parents & guardians")}</h2>
      {!d.guardian && (
        <div className="card p-5">
          <p className="text-sm text-dim">{t("A parent can set your limit from their own account: show them this code.")}</p>
          {code ? <p className="tabular mt-3 text-center font-mono text-4xl tracking-[0.3em]" dir="ltr">{code.code}</p> : <button className="btn btn-ghost mt-3 w-full" onClick={() => void makeCode()}>{t("Show a code")}</button>}
          {code && <p className="mt-2 text-center text-xs text-dim">{t("Valid for {n} minutes.", { n: code.expiresInMinutes })}</p>}
        </div>
      )}
      <div className="card mt-3 p-5">
        <p className="text-sm text-dim">{t("Linking your child's account? Enter their username and the code from their app.")}</p>
        <div className="mt-3 grid grid-cols-[1.4fr_1fr_auto] gap-2">
          <input className="field" placeholder={t("Username")} value={link.username} onChange={(e) => setLink({ ...link, username: e.target.value })} dir="ltr" />
          <input className="field" placeholder={t("Code")} inputMode="numeric" maxLength={6} value={link.code} onChange={(e) => setLink({ ...link, code: e.target.value.replace(/\D/g, "") })} dir="ltr" />
          <button className="btn btn-primary px-4" disabled={link.code.length !== 6 || !link.username.trim()} onClick={() => void linkWard()}>{t("Link")}</button>
        </div>
      </div>
      {d.wards.map((w) => (
        <WardCard key={w.id} w={w} onSave={(v) => void save(`/me/wards/${w.id}/spending`, v)} onUnlink={async () => {
          if (!(await askConfirm(t("Unlink {name}?", { name: w.name })))) return;
          await api(`/me/wards/${w.id}`, { method: "DELETE" }).then(() => s.reload(), (e) => toast(errText(e, t("That didn't work.")), false));
        }} />
      ))}
    </Screen>
  );
}

function WardCard({ w, onSave, onUnlink }: { w: Spending["wards"][number]; onSave: (v: string | null) => void; onUnlink: () => void }) {
  const [v, setV] = useState(w.cap ?? "");
  return (
    <div className="card mt-3 p-5">
      <div className="flex items-center justify-between"><p className="font-semibold">{w.name} <span className="text-sm text-dim" dir="ltr">@{w.username}</span></p><button className="text-sm text-alarm" onClick={onUnlink}>{t("Unlink")}</button></div>
      <p className="mt-1 text-sm text-dim">{t("Spent this week: {amount}", { amount: money(w.currency, w.spentThisWeek) })}</p>
      <div className="mt-3 flex gap-2">
        <input className="field flex-1" inputMode="decimal" placeholder={t("Weekly limit (empty = none)")} value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} />
        <button className="btn btn-primary px-4" onClick={() => onSave(v || null)}>{t("Save")}</button>
      </div>
    </div>
  );
}

// ── receipts ────────────────────────────────────────────────────────────────

interface BillRow { id: string; number: string; total: string; currency: string; openedAt: string; closedAt: string | null }
interface Receipt {
  venue: { name: string; legalName: string; taxNumber: string | null; branch: string; address: string | null };
  bill: { number: string; closedAt: string | null; openedAt: string; currency: string; table: string | null };
  items: Array<{ name: string; quantity: number; total: string }>;
  play: Array<{ station: string | null; minutes: number }>;
  totals: { subtotal: string; discount: string; tax: string; total: string };
  payments: Array<{ method: string; amount: string; refunded: boolean }>;
}

export function ReceiptsScreen({ back }: { back: () => void }) {
  const bills = useLoad(() => api<BillRow[]>("/me/bills"));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Screen title={t("Receipts")} back={back}>
      {!bills.data ? <Loading /> : bills.data.length === 0 ? <p className="text-dim">{t("No receipts yet.")}</p> : (
        <div className="card divide-y divide-rim">
          {bills.data.map((b) => (
            <button key={b.id} onClick={() => setOpen(b.id)} className="flex w-full items-center gap-3 px-5 py-4 text-start">
              <ReceiptText className="size-5 text-glow" />
              <span className="flex-1"><span className="block">{new Date(b.closedAt ?? b.openedAt).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}</span><span className="font-mono text-xs text-mute">{b.number}</span></span>
              <span className="tabular" dir="ltr">{money(b.currency, b.total)}</span>
            </button>
          ))}
        </div>
      )}
      {open && <ReceiptSheet id={open} onClose={() => setOpen(null)} />}
    </Screen>
  );
}

function ReceiptSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useLoad(() => api<Receipt>(`/me/bills/${id}`), [id]);
  return (
    <Sheet title={t("Receipt")} onClose={onClose}>
      {!r.data ? <Loading /> : (
        <div className="receipt grid gap-3 text-sm">
          <div><p className="font-semibold">{r.data.venue.name}</p><p className="text-dim">{r.data.venue.legalName}{r.data.venue.taxNumber ? ` · ${t("Tax no. {n}", { n: r.data.venue.taxNumber })}` : ""}</p><p className="text-dim">{[r.data.venue.branch, r.data.venue.address].filter(Boolean).join(" · ")}</p></div>
          <p className="font-mono text-xs text-mute">{r.data.bill.number} · {new Date(r.data.bill.closedAt ?? r.data.bill.openedAt).toLocaleString(locale())}</p>
          <ul className="divide-y divide-rim">{r.data.items.map((i, n) => <li key={n} className="flex justify-between py-1.5"><span>{i.quantity}× {i.name}</span><span className="tabular" dir="ltr">{i.total}</span></li>)}</ul>
          {r.data.play.length > 0 && <p className="text-dim">{r.data.play.map((p) => `${p.station ?? ""} ${p.minutes} ${t("min")}`).join(", ")}</p>}
          <div className="grid grid-cols-2 gap-1 border-t border-rim pt-2">
            <span className="text-dim">{t("Tax")}</span><span className="tabular text-end" dir="ltr">{r.data.totals.tax}</span>
            <span className="font-semibold">{t("Total")}</span><span className="tabular text-end font-semibold" dir="ltr">{money(r.data.bill.currency, r.data.totals.total)}</span>
            {r.data.payments.map((p, n) => [<span key={`m${n}`} className="text-dim">{p.method.toLowerCase()}</span>, <span key={`a${n}`} className="tabular text-end" dir="ltr">{p.amount}</span>])}
          </div>
          <button className="btn btn-ghost mt-2" onClick={() => print()}>{t("Save or print")}</button>
        </div>
      )}
    </Sheet>
  );
}

// ── ordering from a table's QR code ─────────────────────────────────────────

interface Product { id: string; name: string; price: string }
interface TableMenu { table: { id: string; name: string; branch: string }; menu: { currency: string; categories: Array<{ id: string; name: string; products: Product[] }> } }

/** Opened from a table's QR code (…?table=ID): the menu, delivered to that table and added to its bill. */
export function TableOrderSheet({ tableId, me, onClose, toast }: { tableId: string; me: Me; onClose: () => void; toast: Toast }) {
  const m = useLoad(() => api<TableMenu>(`/tables/${tableId}`), [tableId]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payWith, setPayWith] = useState<"BILL" | "WALLET">("BILL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [k] = useState(key);
  const products = m.data?.menu.categories.flatMap((c) => c.products) ?? [];
  const total = products.reduce((a, p) => a + Number(p.price) * (cart[p.id] ?? 0), 0);
  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));
  const order = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/tables/${tableId}/orders`, { method: "POST", body: { lines: Object.entries(cart).filter(([, q]) => q > 0).map(([productId, quantity]) => ({ productId, quantity })), payWith, idempotencyKey: k } });
      toast(t("Ordered! It'll come to table {name}.", { name: m.data!.table.name }));
      onClose();
    } catch (e) {
      setError(errText(e, t("Couldn't place the order.")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={m.data ? t("Table {name}", { name: m.data.table.name }) : t("Menu")} onClose={onClose}>
      {m.error ? <ErrorText>{m.error}</ErrorText> : !m.data ? <Loading /> : (
        <div className="grid gap-4">
          {m.data.menu.categories.filter((c) => c.products.length).map((c) => (
            <div key={c.id}>
              <p className="mb-2 text-sm font-semibold text-dim">{c.name}</p>
              <div className="grid gap-2">
                {c.products.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="flex-1">{p.name}<span className="block text-xs text-dim" dir="ltr">{money(m.data!.menu.currency, p.price)}</span></span>
                    {cart[p.id] ? <><button className="chip" onClick={() => add(p.id, -1)}>−</button><span className="tabular w-5 text-center">{cart[p.id]}</span></> : null}
                    <button className="chip" onClick={() => add(p.id, 1)} aria-label={t("Add {name}", { name: p.name })}><Plus className="size-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="chip flex-1 justify-center" aria-pressed={payWith === "BILL"} onClick={() => setPayWith("BILL")}>{t("Add to the table's bill")}</button>
            <button className="chip flex-1 justify-center" aria-pressed={payWith === "WALLET"} onClick={() => setPayWith("WALLET")}>{t("Pay from wallet ({amount})", { amount: me.wallet.total })}</button>
          </div>
          <ErrorText>{error}</ErrorText>
          <button className="btn btn-primary py-4" disabled={busy || total <= 0} onClick={() => void order()}>{busy ? <Loader2 className="size-5 animate-spin" /> : <UtensilsCrossed className="size-5" />} {t("Order · {amount}", { amount: money(m.data.menu.currency, total) })}</button>
        </div>
      )}
    </Sheet>
  );
}

// ── bookings: running late, directions ─────────────────────────────────────

export function BookingExtras({ b, toast, onChanged }: { b: Booking; toast: Toast; onChanged: () => void }) {
  const soon = Math.abs(new Date(b.startsAt).getTime() - Date.now()) < 60 * 60_000 || (Date.now() > new Date(b.startsAt).getTime() && Date.now() < new Date(b.startsAt).getTime() + 15 * 60_000);
  const late = async () => {
    try {
      const r = await api<{ holdUntil: string }>(`/bookings/${b.id}/late`, { method: "POST" });
      toast(t("Got it — we'll hold your station until {time}.", { time: new Date(r.holdUntil).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) }));
      onChanged();
    } catch (e) {
      toast(errText(e, t("That didn't work.")), false);
    }
  };
  const directions = async () => {
    try {
      const d = await api<{ mapsUrl: string }>(`/bookings/${b.id}/directions`);
      window.open(d.mapsUrl, "_blank", "noopener");
    } catch (e) {
      toast(errText(e, t("That didn't work.")), false);
    }
  };
  if (b.status !== "CONFIRMED") return null;
  return (
    <>
      <button onClick={() => void directions()} className="flex items-center gap-1.5 text-sm text-glow"><MapPin className="size-4" /> {t("Directions")}</button>
      {soon && <button onClick={() => void late()} className="flex items-center gap-1.5 text-sm text-warn"><Timer className="size-4" /> {t("Running late")}</button>}
    </>
  );
}

// ── card top-up through the venue's gateway ─────────────────────────────────

/** Paying by card on the venue's own payment page; the wallet is credited when the payment is confirmed. */
export function CardTopUp({ me, onClose }: { me: Me; onClose: () => void }) {
  const [amount, setAmount] = useState("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ url: string }>("/wallet/checkout", { method: "POST", body: { amount } });
      location.assign(r.url);
    } catch (e) {
      setError(errText(e, t("Couldn't top up.")));
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-4 gap-2">
        {["20", "50", "100", "200"].map((a) => <button key={a} className="chip justify-center py-3" aria-pressed={amount === a} onClick={() => setAmount(a)}>{a}</button>)}
      </div>
      <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-label={t("Amount ({cur})", { cur: me.wallet.currency })} />
      <p className="flex items-start gap-2 text-sm text-dim"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" /> {t("You'll pay on a secure card page, then come back here.")}</p>
      <ErrorText>{error}</ErrorText>
      <button className="btn btn-primary py-4 text-lg" disabled={busy || !(Number(amount) >= 5)} onClick={() => void pay()}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : <CreditCard className="size-5" />} {t("Pay {amount}", { amount: `${me.wallet.currency} ${amount}` })}
      </button>
      <button className="text-sm text-dim" onClick={onClose}><X className="inline size-4" /> {t("Cancel")}</button>
    </div>
  );
}

