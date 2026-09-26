import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppWindow, Gamepad2, Globe, Home, Languages, Layers, LifeBuoy, Loader2, LogOut, Monitor, Mouse, Signal, UtensilsCrossed, Wifi, WifiOff } from "lucide-react";
import { bridge, type HostMessage, type ShellState } from "./bridge";
import { strings, type Lang, type Strings } from "./i18n";
import { AppsScreen, ConnectivityScreen, FeaturedRow, GamesScreen, PeripheralsScreen, SupportScreen, type Notify } from "./screens";
import { useStation } from "./station";
import { FoodScreen } from "./food";
import { PrintApproval } from "./print";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

function useNow(ms = 250) {
  const [now, set] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");
function hms(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="aurora absolute -left-[20%] -top-[30%] h-[80vh] w-[80vw] rounded-full opacity-30 blur-[120px]" style={{ background: "radial-gradient(circle, var(--color-glow-2), transparent 60%)" }} />
      <div className="aurora absolute -bottom-[35%] -right-[15%] h-[70vh] w-[70vw] rounded-full opacity-20 blur-[120px]" style={{ background: "radial-gradient(circle, var(--color-glow), transparent 60%)", animationDelay: "-9s" }} />
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(var(--color-rim) 1px, transparent 1px), linear-gradient(90deg, var(--color-rim) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />
    </div>
  );
}

function VenueMark({ state, big }: { state: ShellState; big?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {state.venue.logoUrl ? (
        <img src={state.venue.logoUrl} alt="" className={big ? "h-14" : "h-8"} />
      ) : (
        <div className={cx("grid place-items-center rounded-xl bg-gradient-to-br from-glow to-glow-2 font-display font-bold text-void", big ? "size-14 text-2xl" : "size-9 text-base")}>{state.venue.name.slice(0, 1)}</div>
      )}
      <div>
        <p className={cx("whitespace-nowrap font-display font-semibold tracking-wide", big ? "text-3xl" : "text-lg")}>{state.venue.name}</p>
        <p className="whitespace-nowrap text-sm text-dim">{state.venue.branchName}</p>
      </div>
    </div>
  );
}

// ── Lock screen ─────────────────────────────────────────────────────────────

function LockScreen({ state, t, lang, setLang }: { state: ShellState; t: Strings; lang: Lang; setLang: (l: Lang) => void }) {
  const now = useNow(1000);
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const clock = new Date(now + state.serverOffsetMs);

  useEffect(
    () =>
      bridge.subscribe((m: HostMessage) => {
        if (m.type === "login_result" && m.requestId === pending.current) {
          pending.current = null;
          setBusy(false);
          if (!m.ok) setError(m.message ?? "Sign-in failed");
          else setSecret("");
        }
      }),
    [],
  );

  const submit = () => {
    if (!username.trim() || !secret || busy) return;
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setBusy(true);
    setError(null);
    bridge.send({ type: "login", requestId, username: username.trim(), secret });
    setTimeout(() => {
      if (pending.current === requestId) {
        pending.current = null;
        setBusy(false);
        setError(t.offline);
      }
    }, 12_000);
  };

  return (
    <main dir={lang === "ar" ? "rtl" : "ltr"} className="relative grid h-full grid-cols-1 lg:grid-cols-[1.25fr_1fr]">
      <section className="relative flex flex-col justify-between p-12 xl:p-16">
        <VenueMark state={state} big />
        <div>
          <p className="tabular font-display text-[9rem] font-light leading-none tracking-tight xl:text-[11rem]">
            {pad(clock.getHours())}
            <span className="pulse text-glow">:</span>
            {pad(clock.getMinutes())}
          </p>
          <p className="mt-4 text-2xl text-dim">{clock.toLocaleDateString(lang === "ar" ? "ar-AE" : "en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div className="flex items-center gap-3 text-dim">
          <Monitor className="size-5 text-glow" />
          <span>
            {t.station} <strong className="font-display text-xl text-text">{state.station.name}</strong>
          </span>
        </div>
      </section>

      <section className="relative flex items-center justify-center p-10">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="glass w-full max-w-md rounded-3xl p-10 shadow-2xl shadow-black/40"
        >
          <div className="mb-8 flex items-center justify-between">
            <h1 className="font-display text-3xl font-semibold">{t.signIn}</h1>
            <button type="button" onClick={() => setLang(lang === "en" ? "ar" : "en")} className="flex items-center gap-1.5 rounded-full border border-rim px-3 py-1.5 text-sm text-dim hover:text-text">
              <Languages className="size-4" /> {lang === "en" ? "العربية" : "English"}
            </button>
          </div>
          <label className="block">
            <span className="mb-2 block text-sm text-dim">{t.username}</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-rim bg-void/70 px-4 py-4 text-lg outline-none transition focus:border-glow"
            />
          </label>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm text-dim">{t.password}</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              className="w-full rounded-xl border border-rim bg-void/70 px-4 py-4 text-lg outline-none transition focus:border-glow"
            />
          </label>
          {error && (
            <p role="alert" className="mt-5 rounded-xl border border-alarm/40 bg-alarm/10 px-4 py-3 text-alarm">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !state.connected}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-glow to-glow-2 py-4 font-display text-lg font-semibold text-void transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin" /> {t.signingIn}
              </>
            ) : (
              t.start
            )}
          </button>
          <p className="mt-6 text-center text-sm leading-relaxed text-mute">{t.noAccount}</p>
        </form>
      </section>
      {!state.connected && <ConnectionBanner t={t} />}
    </main>
  );
}

function ConnectionBanner({ t }: { t: Strings }) {
  return (
    <div className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-5 py-2 text-warn">
      <WifiOff className="size-4" /> {t.offline}
    </div>
  );
}

// ── Session ─────────────────────────────────────────────────────────────────

type Tab = "home" | "games" | "platforms" | "apps" | "internet" | "connectivity" | "peripherals" | "food" | "support";
const TABS: Array<{ id: Tab; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "platforms", label: "Platforms", icon: Layers },
  { id: "apps", label: "Apps", icon: AppWindow },
  { id: "internet", label: "Internet", icon: Globe },
  { id: "connectivity", label: "Connection", icon: Signal },
  { id: "peripherals", label: "Peripherals", icon: Mouse },
  { id: "food", label: "Food", icon: UtensilsCrossed },
  { id: "support", label: "Support", icon: LifeBuoy },
];

function TimeRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const r = 120;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remainingMs / Math.max(1, totalMs)));
  const low = remainingMs <= 5 * 60_000;
  return (
    <svg viewBox="0 0 280 280" className="size-72" aria-hidden>
      <circle cx="140" cy="140" r={r} fill="none" stroke="var(--color-rim)" strokeWidth="10" />
      <circle
        cx="140" cy="140" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
        stroke={low ? "var(--color-warn)" : "url(#g)"} strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 140 140)" style={{ transition: "stroke-dashoffset 1s linear" }}
      />
      <defs>
        <linearGradient id="g" x1="0" x2="1">
          <stop offset="0" stopColor="var(--color-glow)" />
          <stop offset="1" stopColor="var(--color-glow-2)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Placeholder({ icon: Icon, title, text }: { icon: typeof Home; title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="max-w-lg text-center">
        <Icon className="mx-auto size-14 text-glow opacity-70" />
        <h2 className="mt-6 font-display text-3xl font-semibold">{title}</h2>
        <p className="mt-3 text-lg text-dim">{text}</p>
      </div>
    </div>
  );
}

function SessionScreen({ state, t }: { state: ShellState; t: Strings }) {
  const s = state.session!;
  const now = useNow();
  const serverNow = now + state.serverOffsetMs;
  const remaining = s.expiresAt ? new Date(s.expiresAt).getTime() - serverNow : null;
  const total = s.expiresAt ? new Date(s.expiresAt).getTime() - new Date(s.startedAt).getTime() : 1;
  const [tab, setTab] = useState<Tab>("home");
  const [toast, setToast] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; tone: "good" | "warn" | "alarm" } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify: Notify = (text, tone = "good") => {
    clearTimeout(noteTimer.current);
    setNote({ text, tone });
    noteTimer.current = setTimeout(() => setNote(null), 5000);
  };
  const { playing } = useStation();
  // Kitchen progress on food orders shows up wherever the customer is.
  useEffect(() => bridge.subscribe((m) => {
    if (m.type === "order_status") notify(`Order ${m.number}: ${m.message}`, "good");
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useRef(new Set<number>());

  // Warnings at the configured thresholds (30/15/10/5/1 min). The server's clock decides.
  useEffect(() => {
    if (remaining === null) return;
    for (const m of s.warningMinutes) {
      if (remaining <= m * 60_000 && remaining > (m - 1) * 60_000 && !shown.current.has(m)) {
        shown.current.add(m);
        setToast(t.minutesLeft(m));
        setTimeout(() => setToast(null), m === 1 ? 60_000 : 9_000);
      }
    }
  }, [remaining, s.warningMinutes, t]);
  useEffect(() => {
    shown.current = new Set(s.warningMinutes.filter((m) => remaining !== null && remaining <= (m - 1) * 60_000));
    // re-arm when a new session starts or the session is extended
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id, s.expiresAt]);

  const lastMinute = remaining !== null && remaining <= 60_000 && remaining > 0;
  const timesUp = remaining !== null && remaining <= 0;

  return (
    <main className="relative flex h-full flex-col">
      <header className="glass relative z-10 flex h-20 shrink-0 items-center gap-6 border-x-0 border-t-0 px-8">
        <VenueMark state={state} />
        {playing && (
          <button onClick={() => setTab("games")} className="ml-4 flex items-center gap-2 rounded-full border border-good/40 bg-good/10 px-4 py-1.5 text-sm text-good">
            <span className="size-2 animate-pulse rounded-full bg-good" /> Playing {playing.title}
          </button>
        )}
        <div className="ml-auto flex items-center gap-5">
          {!state.connected && <WifiOff className="size-5 text-warn" aria-label={t.offline} />}
          <div className={cx("rounded-2xl border px-5 py-2 text-right", lastMinute ? "border-alarm/60 bg-alarm/15" : remaining !== null && remaining <= 5 * 60_000 ? "border-warn/50 bg-warn/10" : "border-rim bg-deck-2")}>
            <p className="text-[11px] uppercase tracking-[0.2em] text-dim">{remaining === null ? t.openSession : t.timeLeft}</p>
            <p className={cx("tabular font-mono text-2xl font-semibold", lastMinute && "text-alarm pulse")}>{remaining === null ? hms(serverNow - new Date(s.startedAt).getTime()) : hms(remaining)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-glow-2 to-glow font-display text-lg font-bold text-void">{s.customerName.slice(0, 1)}</div>
            <div className="leading-tight">
              <p className="font-semibold">{s.customerName}</p>
              {s.tier && <p className="text-xs text-glow-2">{s.tier}</p>}
            </div>
          </div>
          <button onClick={() => confirm(t.logoutConfirm) && bridge.send({ type: "logout" })} className="rounded-xl border border-rim p-3 text-dim hover:border-alarm hover:text-alarm" aria-label={t.logout} title={t.logout}>
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
      <nav className="glass flex w-56 shrink-0 flex-col gap-1 border-y-0 border-l-0 p-3">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={cx("relative flex items-center gap-3 rounded-xl px-4 py-3 font-display text-base tracking-wide transition", tab === x.id ? "bg-glow/10 text-glow" : "text-dim hover:bg-deck-2 hover:text-text")}
          >
            {tab === x.id && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-glow" />}
            <x.icon className="size-5" />
            {x.label}
          </button>
        ))}
      </nav>
      <section className="relative min-w-0 flex-1 overflow-y-auto p-10">
        {tab === "home" && (
          <div className="mx-auto grid min-h-full max-w-6xl items-center gap-12 lg:grid-cols-[auto_1fr]">
            <div className="relative grid place-items-center">
              {remaining !== null && <TimeRing remainingMs={remaining} totalMs={total} />}
              <div className="absolute text-center">
                <p className="text-sm uppercase tracking-[0.3em] text-dim">{remaining === null ? t.openSession : t.timeLeft}</p>
                <p className="tabular mt-2 font-mono text-5xl font-semibold">{remaining === null ? hms(serverNow - new Date(s.startedAt).getTime()) : hms(remaining)}</p>
              </div>
            </div>
            <div>
              <p className="text-xl text-dim">{t.welcome},</p>
              <h1 className="mt-1 font-display text-6xl font-semibold tracking-tight">{s.customerName}</h1>
              <p className="mt-10 mb-4 text-sm uppercase tracking-[0.25em] text-dim">Featured</p>
              <FeaturedRow notify={notify} />
              <button onClick={() => setTab("games")} className="mt-6 flex items-center gap-2 text-glow hover:underline">
                <Gamepad2 className="size-5" /> All games
              </button>
            </div>
          </div>
        )}
        {tab === "games" && <GamesScreen notify={notify} />}
        {tab === "platforms" && <AppsScreen kinds={["PLATFORM_LAUNCHER"]} title="Game platforms" hint="Sign in with your own account. You're signed out automatically when your session ends." notify={notify} />}
        {tab === "apps" && <AppsScreen kinds={null} title="Apps" hint="Chat, music and tools." notify={notify} />}
        {tab === "internet" && <AppsScreen kinds={["BROWSER"]} title="Internet" hint="Private browsing: nothing is kept after you log out." notify={notify} />}
        {tab === "connectivity" && <ConnectivityScreen notify={notify} />}
        {tab === "peripherals" && <PeripheralsScreen notify={notify} />}
        {tab === "food" && <FoodScreen notify={notify} station={state.station.name} />}
        {tab === "support" && <SupportScreen station={state.station.name} notify={notify} />}
      </section>
      </div>

      {note && (
        <div role="status" className={cx("fixed bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-2xl border px-6 py-3 shadow-2xl", note.tone === "good" ? "border-good/40 bg-deck text-good" : note.tone === "warn" ? "border-warn/50 bg-deck text-warn" : "border-alarm bg-deck text-alarm")}>
          {note.text}
        </div>
      )}

      <PrintApproval notify={notify} />
      {toast && !timesUp && (
        <div role="status" className={cx("fixed left-1/2 top-24 z-20 -translate-x-1/2 rounded-2xl border px-8 py-4 font-display text-xl shadow-2xl", lastMinute ? "border-alarm bg-alarm/20 text-alarm" : "border-warn/50 bg-deck text-warn")}>
          {toast}
        </div>
      )}
      {timesUp && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-void/90 backdrop-blur">
          <div className="text-center">
            <p className="font-display text-5xl font-semibold">{t.timesUp}</p>
            <p className="mt-4 flex items-center justify-center gap-2 text-dim">
              <Loader2 className="size-5 animate-spin" /> {t.finishing}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

// ── Root ────────────────────────────────────────────────────────────────────

function StaffMessage({ msg, onClose }: { msg: { title: string; text: string } | null; onClose: () => void }) {
  if (!msg) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-void/60 backdrop-blur-sm">
      <div className="glass max-w-lg rounded-3xl p-10 text-center shadow-2xl">
        <p className="text-sm uppercase tracking-[0.25em] text-glow">{msg.title}</p>
        <p className="mt-4 font-display text-3xl">{msg.text}</p>
        <button onClick={onClose} className="mt-8 rounded-xl bg-gradient-to-r from-glow to-glow-2 px-10 py-3 font-display font-semibold text-void">
          OK
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<ShellState | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [msg, setMsg] = useState<{ title: string; text: string } | null>(null);
  const t = useMemo(() => strings(lang), [lang]);

  useEffect(() => {
    const off = bridge.subscribe((m) => {
      if (m.type === "state") {
        const { type: _, ...s } = m;
        setState(s);
      }
      if (m.type === "message") setMsg({ title: m.title, text: m.text });
    });
    bridge.send({ type: "ready" });
    return off;
  }, []);

  return (
    <div className="relative h-full">
      <Backdrop />
      {!state ? (
        <div className="grid h-full place-items-center text-dim">
          <Loader2 className="size-8 animate-spin" />
        </div>
      ) : state.session ? (
        <SessionScreen state={state} t={t} />
      ) : (
        <LockScreen state={state} t={t} lang={lang} setLang={setLang} />
      )}
      <StaffMessage msg={msg} onClose={() => setMsg(null)} />
      {bridge.mock && (
        <div className="fixed bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-rim bg-deck px-3 py-1 text-xs text-mute">
          <Wifi className="size-3" /> Preview mode · try ahmed / ahmed123
        </div>
      )}
    </div>
  );
}
