import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BellRing, CalendarClock, Coins, Crown, Gift, Hourglass, Inbox, Languages, LifeBuoy, Loader2, Lock, Medal, Send, Trophy, UserPlus, Users, Wallet } from "lucide-react";
import { bridge, player } from "./bridge";
import { chooseLang, currentLang, lastEnded, onLangPref, refreshOverview, savePref, useOverview, type Overview } from "./player";
import type { Notify } from "./screens";
import { A11ySettings, CheckInButton } from "./extras";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayTime = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
const HELP: Record<string, string> = { OPEN: "Staff have your request", ACKNOWLEDGED: "Staff are on their way", RESOLVED: "Sorted — thanks for waiting" };

// ── on the home widget ──────────────────────────────────────────────────────

/** Wallet, saved time and points, plus anything the player should know right now. */
export function AccountCards({ openAccount, notify }: { openAccount: () => void; notify?: Notify }) {
  const o = useOverview();
  if (!o) return null;
  const c = o.customer;
  const notes: Array<{ icon: typeof Lock; text: string; tone: "warn" | "glow" | "good" }> = [];
  if (o.pcBookedAt) notes.push({ icon: CalendarClock, text: `This PC is booked at ${clock(o.pcBookedAt)} — your session can't run past it.`, tone: "warn" });
  if (c?.minutesLeftToday != null) notes.push({ icon: Hourglass, text: `${hm(c.minutesLeftToday)} of play left today.`, tone: "warn" });
  if (o.help) notes.push({ icon: LifeBuoy, text: HELP[o.help.status] ?? "Staff have your request", tone: o.help.status === "RESOLVED" ? "good" : "glow" });
  if (c?.booking) notes.push({ icon: CalendarClock, text: `Your booking ${c.booking.reference}: ${dayTime(c.booking.startsAt)}`, tone: "glow" });
  for (const t of (c?.tournaments ?? []).filter((x) => x.status !== "CHECK_IN")) notes.push({ icon: Trophy, text: `${t.name}: ${t.status === "CHECK_IN" ? "check in now!" : t.status === "IN_PROGRESS" ? "live now" : dayTime(t.startsAt)}`, tone: t.status === "CHECK_IN" ? "warn" : "glow" });
  return (
    <div className="mt-8 grid max-w-2xl gap-3">
      {c ? (
        <button onClick={openAccount} className="press grid grid-cols-3 gap-3 text-left">
          {[
            [Wallet, "Wallet", `${c.wallet.currency} ${c.wallet.total}`],
            [Hourglass, "Saved time", hm(c.savedMinutes)],
            [Coins, "Points", String(c.points)],
          ].map(([Icon, k, v]) => {
            const I = Icon as typeof Wallet;
            return (
              <div key={k as string} className="glass rounded-2xl px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-dim"><I className="size-3.5" /> {k as string}</p>
                <p className="tabular mt-1 font-display text-xl font-semibold">{v as string}</p>
              </div>
            );
          })}
        </button>
      ) : (
        <GuestJoin />
      )}
      {notes.map((n, i) => (
        <p key={i} className={cx("flex items-center gap-2 rounded-xl border px-4 py-2 text-sm", n.tone === "warn" ? "border-warn/40 bg-warn/10 text-warn" : n.tone === "good" ? "border-good/40 bg-good/10 text-good" : "border-glow/40 bg-glow/10")}>
          <n.icon className="size-4 shrink-0" /> {n.text}
        </p>
      ))}
      {notify && c?.tournaments.filter((x) => x.status === "CHECK_IN").map((x) => (
        <div key={x.id} className="flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2 text-sm">
          <Trophy className="size-4 shrink-0 text-warn" /><span className="flex-1">{x.name}: check-in is open</span><CheckInButton tournamentId={x.id} name={x.name} notify={notify} />
        </div>
      ))}
      {c?.challenges.map((ch) => (
        <div key={ch.id} className="glass rounded-xl px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm"><Medal className="size-4 text-warn" /> <span className="flex-1">{ch.name}</span> <span className="text-glow">+{ch.rewardPoints}</span></p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rim"><div className="brand-gradient h-full rounded-full" style={{ width: `${(ch.progress / ch.target) * 100}%` }} /></div>
          <p className="mt-1 text-xs text-dim">{ch.type === "PLAY_MINUTES" ? `${hm(ch.target - ch.progress)} to go` : `${ch.target - ch.progress} to go`}</p>
        </div>
      ))}
    </div>
  );
}

/** A guest at the PC: scan to create an account and keep this session on it. */
function GuestJoin() {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = async () => {
    try {
      const r = await player<{ url: string }>("claim_code");
      setQr(await QRCode.toDataURL(r.url, { margin: 1, width: 320, color: { dark: "#0b0e14", light: "#ffffff" } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a code.");
    }
  };
  return (
    <div className="glass flex items-center gap-5 rounded-2xl p-5">
      {qr ? <img src={qr} alt="" className="size-28 shrink-0 rounded-xl bg-white p-1.5" /> : <UserPlus className="size-10 shrink-0 text-glow" />}
      <div>
        <p className="font-display text-lg font-semibold">Playing as a guest</p>
        <p className="mt-1 text-sm text-dim">{qr ? "Scan with your phone, sign up in the app, and this session is yours — points included." : "Create a free account and this session counts for points, rewards and your stats."}</p>
        {!qr && <button onClick={() => void show()} className="press mt-3 rounded-full border border-glow/50 bg-glow/10 px-4 py-1.5 text-sm text-glow hover:bg-glow/20">Join with my phone</button>}
        {error && <p className="mt-2 text-sm text-alarm">{error}</p>}
      </div>
    </div>
  );
}

// ── the "My account" window ─────────────────────────────────────────────────

type Tab = "rewards" | "inbox" | "board" | "friends" | "settings";

export function AccountScreen({ notify }: { notify: Notify }) {
  const o = useOverview();
  const [tab, setTab] = useState<Tab>("rewards");
  const [lang, setLangState] = useState(currentLang());
  const setLang = (l: "en" | "ar") => {
    setLangState(l);
    chooseLang(l);
  };
  if (!o) return <Spin />;
  if (!o.customer) return <div className="mx-auto max-w-xl py-10"><GuestJoin /></div>;
  const tabs: Array<[Tab, string, typeof Gift, number?]> = [["rewards", "Rewards", Gift], ["inbox", "Inbox", Inbox, o.customer.unread], ["board", "Top players", Trophy], ["friends", "Friends here", Users], ["settings", "Settings", Languages]];
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center gap-4">
        <span className="brand-gradient grid size-14 place-items-center rounded-full font-display text-2xl font-bold text-void">{o.customer.name.slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-semibold">{o.customer.name}</p>
          <p className="text-sm text-dim">{o.customer.tier ? <><Crown className="mr-1 inline size-4 text-warn" />{o.customer.tier} · </> : ""}{o.customer.points} points · {o.customer.wallet.currency} {o.customer.wallet.total}</p>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map(([k, label, Icon, badge]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("press flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm", tab === k ? "border-glow bg-glow font-semibold text-void" : "border-rim text-dim hover:text-text")}>
            <Icon className="size-4" /> {label}{badge ? <span className="rounded-full bg-alarm px-1.5 text-[11px] font-bold text-white">{badge}</span> : null}
          </button>
        ))}
      </div>
      {tab === "rewards" && <Rewards notify={notify} />}
      {tab === "inbox" && <InboxList />}
      {tab === "board" && <Board />}
      {tab === "friends" && <FriendsHere notify={notify} visible={o.customer.visible} />}
      {tab === "settings" && (
        <div className="glass grid gap-4 rounded-2xl p-6">
          <p className="font-semibold">Language</p>
          <div className="flex gap-2">
            {(["en", "ar"] as const).map((l) => (
              <button key={l} onClick={() => { setLang(l); savePref({ lang: l }); }} className={cx("press rounded-xl border px-5 py-2", lang === l ? "border-glow bg-glow/10 text-glow" : "border-rim text-dim")}>{l === "en" ? "English" : "العربية"}</button>
            ))}
          </div>
          <A11ySettings prefs={o.customer.prefs ?? {}} save={savePref} />
          <p className="text-sm text-dim">Your mouse settings, volume, language and text size are saved on your account and come back on any PC you sign in to.</p>
        </div>
      )}
    </div>
  );
}

const Spin = () => <div className="grid place-items-center py-16"><Loader2 className="size-7 animate-spin text-glow" /></div>;

function useLoad<T>(action: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const reload = () => void player<T>(action).then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(reload, [action]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload };
}

function Rewards({ notify }: { notify: Notify }) {
  const r = useLoad<{ points: number; rewards: Array<{ id: string; name: string; description: string | null; costPoints: number; affordable: boolean }> }>("rewards");
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const redeem = async (id: string, name: string) => {
    setBusy(id);
    try {
      const out = await player<{ code?: string; minutes?: number; walletCredit?: string }>("redeem", { rewardId: id, key: crypto.randomUUID() });
      if (out.code) setCode(out.code);
      notify(out.code ? `${name}: show the code at the counter.` : out.minutes ? `${out.minutes} minutes added!` : `${name} — done!`, "good");
      r.reload();
      void refreshOverview();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't redeem that.", "warn");
    } finally {
      setBusy(null);
    }
  };
  if (r.error) return <p className="text-alarm">{r.error}</p>;
  if (!r.data) return <Spin />;
  return (
    <div className="grid gap-3">
      {code && <p className="glass rounded-2xl p-5 text-center font-mono text-3xl tracking-widest text-glow">{code}</p>}
      {r.data.rewards.map((x) => (
        <div key={x.id} className="glass flex items-center gap-4 rounded-2xl p-4">
          <Gift className={cx("size-7", x.affordable ? "text-glow" : "text-mute")} />
          <div className="min-w-0 flex-1"><p className="font-semibold">{x.name}</p>{x.description && <p className="text-sm text-dim">{x.description}</p>}</div>
          <button disabled={!x.affordable || busy === x.id} onClick={() => void redeem(x.id, x.name)} className="brand-gradient press rounded-xl px-4 py-2 font-semibold text-void disabled:opacity-40">
            {busy === x.id ? <Loader2 className="size-4 animate-spin" /> : `${x.costPoints} pts`}
          </button>
        </div>
      ))}
      {r.data.rewards.length === 0 && <p className="text-dim">No rewards yet.</p>}
    </div>
  );
}

function InboxList() {
  const r = useLoad<Array<{ id: string; title: string | null; body: string; data: { code?: string } | null; readAt: string | null; createdAt: string }>>("inbox");
  useEffect(() => {
    const unread = (r.data ?? []).filter((m) => !m.readAt);
    if (unread.length) void Promise.all(unread.map((m) => player("inbox_read", { id: m.id }))).then(() => refreshOverview());
  }, [r.data]);
  if (!r.data) return <Spin />;
  if (!r.data.length) return <p className="text-dim">No messages.</p>;
  return (
    <div className="grid gap-3">
      {r.data.map((m) => (
        <div key={m.id} className={cx("glass rounded-2xl p-5", !m.readAt && "border-glow/50")}>
          {m.title && <p className="font-semibold">{m.title}</p>}
          <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
          {m.data?.code && <p className="mt-3 rounded-xl bg-void/60 py-2 text-center font-mono text-xl tracking-widest text-glow">{m.data.code}</p>}
        </div>
      ))}
    </div>
  );
}

function Board() {
  const r = useLoad<{ top: Array<{ place: number; name: string; minutes: number; me: boolean }>; me: { minutes: number; place: number | null; of: number } }>("leaderboard");
  if (!r.data) return <Spin />;
  return (
    <div className="glass rounded-2xl p-2">
      {r.data.top.map((x) => (
        <p key={x.place} className={cx("flex items-center gap-3 rounded-xl px-4 py-2.5", x.me && "bg-glow/10")}>
          <span className={cx("w-6 font-display font-semibold", x.place === 1 ? "text-warn" : "text-dim")}>{x.place}</span>
          <span className="flex-1">{x.name}</span><span className="tabular text-dim">{hm(x.minutes)}</span>
        </p>
      ))}
      {r.data.top.length === 0 && <p className="p-4 text-dim">Nobody on the board yet.</p>}
      <p className="px-4 py-3 text-sm text-dim">{r.data.me.place ? `You're #${r.data.me.place} of ${r.data.me.of} this month.` : "Play this month to get on the board."}</p>
    </div>
  );
}

function FriendsHere({ notify, visible }: { notify: Notify; visible: boolean }) {
  const r = useLoad<Array<{ name: string; username: string; station: string; game: string | null }>>("players");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const invite = async (username: string) => {
    setBusy(true);
    try {
      await player("invite", { username });
      notify(`Invite sent to @${username}.`, "good");
      setWho("");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't send the invite.", "warn");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4">
      {!visible && <p className="rounded-xl border border-rim px-4 py-3 text-sm text-dim">Others can't see you here. Turn on "Show my first name" in the app's Rewards to appear.</p>}
      <div className="glass rounded-2xl p-2">
        {!r.data ? <Spin /> : r.data.length === 0 ? <p className="p-4 text-dim">No one else who shares it is playing right now.</p> : r.data.map((p) => (
          <p key={p.username} className="flex items-center gap-3 rounded-xl px-4 py-2.5">
            <Users className="size-4 text-glow" /><span className="flex-1">{p.name} <span className="text-dim">· {p.station}{p.game ? ` · ${p.game}` : ""}</span></span>
          </p>
        ))}
      </div>
      <form className="glass flex gap-2 rounded-2xl p-4" onSubmit={(e) => { e.preventDefault(); if (who.trim()) void invite(who.trim().replace(/^@/, "")); }}>
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Invite a friend by username" className="flex-1 rounded-xl border border-rim bg-void/60 px-4 py-2.5 outline-none focus:border-glow" />
        <button disabled={busy || !who.trim()} className="brand-gradient press flex items-center gap-2 rounded-xl px-5 font-semibold text-void disabled:opacity-40"><Send className="size-4" /> Invite</button>
      </form>
    </div>
  );
}

// ── asking staff for a game ────────────────────────────────────────────────

export function RequestGame({ notify, initial }: { notify: Notify; initial: string }) {
  const [title, setTitle] = useState(initial);
  const [sent, setSent] = useState(false);
  useEffect(() => setTitle(initial), [initial]);
  const send = async () => {
    try {
      const r = await player<{ sent: boolean; message?: string }>("request_game", { title: title.trim() });
      setSent(true);
      notify(r.sent ? "Staff will see your request." : r.message ?? "Staff already have it.", "good");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't send that.", "warn");
    }
  };
  return (
    <form className="glass mx-auto mt-8 flex max-w-xl items-center gap-3 rounded-2xl p-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <BellRing className="size-5 shrink-0 text-glow" />
      <input value={title} onChange={(e) => { setTitle(e.target.value); setSent(false); }} placeholder="Missing a game? Tell staff which one" maxLength={80} className="flex-1 bg-transparent outline-none" />
      <button disabled={sent || title.trim().length < 2} className="press rounded-xl border border-glow/50 bg-glow/10 px-4 py-2 text-sm text-glow disabled:opacity-40">{sent ? "Sent" : "Ask staff"}</button>
    </form>
  );
}

// ── away lock ───────────────────────────────────────────────────────────────

const awaySubs = new Set<(on: boolean) => void>();
let away = false;
export const setAway = (on: boolean) => {
  away = on;
  if (on) bridge.send({ type: "desktop_show" }); // the lock must be in front of the game
  awaySubs.forEach((f) => f(on));
};
export function useAway() {
  const [on, setOn] = useState(away);
  useEffect(() => {
    awaySubs.add(setOn);
    return () => void awaySubs.delete(setOn);
  }, []);
  return on;
}

/** Locks the screen while the player steps away; their time keeps running. Their password or PIN opens it. */
export function AwayLock({ name }: { name: string }) {
  const on = useAway();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSecret("");
    setError(null);
  }, [on]);
  if (!on) return null;
  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await player<{ ok: boolean; message?: string }>("verify", { secret });
      if (r.ok) setAway(false);
      else setError(r.message ?? "That's not right.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check that.");
    } finally {
      setBusy(false);
      setSecret("");
    }
  };
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-void/95 backdrop-blur-xl">
      <form className="glass animate-pop w-full max-w-sm rounded-3xl p-10 text-center" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
        <Lock className="mx-auto size-10 text-glow" />
        <p className="mt-4 font-display text-2xl font-semibold">Locked — {name} is away</p>
        <p className="mt-2 text-sm text-dim">Your time keeps running. Enter your password or PIN to come back.</p>
        <input type="password" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} className="mt-6 w-full rounded-xl border border-rim bg-void/70 px-4 py-3 text-center text-lg outline-none focus:border-glow" />
        {error && <p className="mt-3 text-sm text-alarm">{error}</p>}
        <button disabled={busy || !secret} className="brand-gradient press mt-5 w-full rounded-xl py-3 font-display font-semibold text-void disabled:opacity-50">{busy ? <Loader2 className="mx-auto size-5 animate-spin" /> : "Unlock"}</button>
      </form>
    </div>
  );
}

// ── after log-out ──────────────────────────────────────────────────────────

/** On the lock screen right after someone logs out: what they played, spent and earned. */
export function ThanksCard() {
  const [s, setS] = useState<{ minutes: number; spent: string; currency: string; points: number | null; games?: string[]; nextReward?: { name: string; pointsNeeded: number } | null } | null>(null);
  useEffect(() => {
    if (!lastEnded || Date.now() - lastEnded.at > 60_000) return;
    const id = lastEnded.id;
    // Points arrive when the session is closed and billed: ask again shortly after.
    const load = () => void player<NonNullable<typeof s>>("summary", { sessionId: id }).then(setS, () => undefined);
    load();
    const again = setTimeout(load, 4000);
    const hide = setTimeout(() => setS(null), 30_000);
    return () => {
      clearTimeout(again);
      clearTimeout(hide);
    };
  }, []);
  if (!s) return null;
  return (
    <div className="glass animate-pop fixed left-1/2 top-8 z-30 flex -translate-x-1/2 items-center gap-6 rounded-2xl px-8 py-4 shadow-2xl">
      <p className="font-display text-lg">Thanks for playing!</p>
      <div>
        <p className="text-dim">{hm(s.minutes)} · {s.currency} {s.spent}{s.points ? <span className="text-good"> · +{s.points} points</span> : null}</p>
        {!!s.games?.length && <p className="text-sm text-dim">Played {s.games.join(", ")}</p>}
        {s.nextReward && <p className="text-sm text-glow">{s.nextReward.pointsNeeded} points to {s.nextReward.name} · book your next visit in the app</p>}
      </div>
    </div>
  );
}

/** Applies a language the player saved on their account. */
export const useLangPref = (setLang: (l: "en" | "ar") => void) => useEffect(() => onLangPref(setLang), [setLang]);

export type { Overview };
