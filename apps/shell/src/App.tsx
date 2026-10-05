import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { AppWindow, Gamepad2, Languages, Loader2, Monitor, Smartphone, Wifi, WifiOff } from "lucide-react";
import { bridge, request, type HostMessage, type ShellState } from "./bridge";
import { strings, type Lang, type Strings } from "./i18n";
import { FeaturedRow, type Notify } from "./screens";
import { useStation } from "./station";
import { PrintApproval } from "./print";
import { Desktop, StartMenu, Taskbar, useHost, useWindowManager } from "./desktop";
import { addNotice, clearNotices } from "./tray";
import { AddTime } from "./add-time";
import { AccountCards, AwayLock, ThanksCard, useLangPref } from "./account";
import { setSession } from "./player";
import { StaffExit } from "./staff-exit";
import { LowTimeNudge } from "./extras";

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

function Backdrop({ wallpaper }: { wallpaper?: string | null }) {
  if (wallpaper)
    return (
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${wallpaper}")` }} />
        {/* Darkened so the Shell's text and icons stay readable on any picture. */}
        <div className="absolute inset-0 bg-gradient-to-t from-void/85 via-void/45 to-void/60" />
      </div>
    );
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
        <div className={cx("brand-gradient grid place-items-center rounded-xl font-display font-bold text-void shadow-glow", big ? "size-14 text-2xl" : "size-9 text-base")}>{state.venue.name.slice(0, 1)}</div>
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
          className="glass animate-pop w-full max-w-md rounded-3xl p-10 shadow-2xl shadow-black/50"
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
              className="w-full rounded-xl border border-rim bg-void/70 px-4 py-4 text-lg outline-none transition focus:border-glow focus:ring-4 focus:ring-glow/15"
            />
          </label>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm text-dim">{t.password}</span>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              className="w-full rounded-xl border border-rim bg-void/70 px-4 py-4 text-lg outline-none transition focus:border-glow focus:ring-4 focus:ring-glow/15"
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
            className="brand-gradient press mt-8 flex w-full items-center justify-center gap-2 rounded-xl py-4 font-display text-lg font-semibold text-void hover:shadow-glow hover:brightness-110 disabled:opacity-50"
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
          {state.connected && <PhoneSignIn t={t} />}
        </form>
      </section>
      {!state.connected && <ConnectionBanner t={t} />}
      <ThanksCard />
    </main>
  );
}

/**
 * "Sign in with your phone": a QR of a one-time link for this PC. The player
 * scans it, confirms in the app, and the PC unlocks with their saved time.
 * A fresh code is fetched before the old one runs out.
 */
function PhoneSignIn({ t }: { t: Strings }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const r = await request({ type: "qr_login", requestId: crypto.randomUUID() }, "qr_login_code");
      if (!live) return;
      if (r.ok && r.url) setQr(await QRCode.toDataURL(r.url, { margin: 1, width: 360, color: { dark: "#0b0e14", light: "#ffffff" } }));
      else setQr(null);
      const left = r.expiresAt ? new Date(r.expiresAt).getTime() - Date.now() : 0;
      timer = setTimeout(() => void load(), r.ok ? Math.max(20_000, left - 20_000) : 30_000);
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  if (!qr) return null;
  return (
    <div className="mt-8 flex items-center gap-5 border-t border-rim pt-6">
      <img src={qr} alt="" className="size-28 shrink-0 rounded-xl bg-white p-1.5" />
      <div>
        <p className="flex items-center gap-2 font-display font-semibold"><Smartphone className="size-5 text-glow" /> {t.phoneSignIn}</p>
        <p className="mt-1 text-sm leading-relaxed text-dim">{t.phoneHint}</p>
      </div>
    </div>
  );
}

function ConnectionBanner({ t }: { t: Strings }) {
  return (
    <div className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-5 py-2 text-warn">
      <WifiOff className="size-4" /> {t.offline}
    </div>
  );
}

// ── Session: a small desktop OS ─────────────────────────────────────────────

function TimeRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const r = 120;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remainingMs / Math.max(1, totalMs)));
  const low = remainingMs <= 5 * 60_000;
  return (
    <svg viewBox="0 0 280 280" className="size-80" aria-hidden>
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

/** The desktop's home widget: time left, welcome, featured games. Ticks on its own. */
function HomeWidget({ state, t, notify, openGames, openAccount, addTime }: { state: ShellState; t: Strings; notify: Notify; openGames: () => void; openAccount: () => void; addTime: () => void }) {
  const s = state.session!;
  const serverNow = useNow(1000) + state.serverOffsetMs;
  const remaining = s.expiresAt ? new Date(s.expiresAt).getTime() - serverNow : null;
  const total = s.expiresAt ? new Date(s.expiresAt).getTime() - new Date(s.startedAt).getTime() : 1;
  const { playing } = useStation();
  return (
    <div className="mx-auto grid min-h-full max-w-6xl items-center gap-12 xl:grid-cols-[auto_1fr]">
      <div className="relative grid place-items-center">
        {remaining !== null && <TimeRing remainingMs={remaining} totalMs={total} />}
        <div className={cx("text-center", remaining !== null && "absolute")}>
          <p className="text-sm uppercase tracking-[0.3em] text-dim">{remaining === null ? t.openSession : t.timeLeft}</p>
          <p className="tabular mt-2 font-mono text-4xl font-semibold tracking-tight">{remaining === null ? hms(serverNow - new Date(s.startedAt).getTime()) : hms(remaining)}</p>
          {remaining !== null && (
            <button onClick={addTime} className="press mt-3 rounded-full border border-glow/50 bg-glow/10 px-4 py-1 text-sm text-glow hover:bg-glow/20">+ Add time</button>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <VenueMark state={state} />
        <p className="mt-8 text-xl text-dim">{t.welcome},</p>
        <h1 className="mt-1 font-display text-6xl font-semibold tracking-tight">{s.customerName}</h1>
        {playing && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-good/40 bg-good/10 px-4 py-1.5 text-sm text-good">
            <span className="live-dot size-2 rounded-full bg-good" /> Playing {playing.title}
          </p>
        )}
        <AccountCards openAccount={openAccount} notify={notify} />
        <p className="mt-10 mb-4 text-sm uppercase tracking-[0.25em] text-dim">Featured</p>
        <FeaturedRow notify={notify} />
        <button onClick={openGames} className="mt-6 flex items-center gap-2 text-glow hover:underline">
          <Gamepad2 className="size-5" /> All games
        </button>
      </div>
    </div>
  );
}

/** Minute warnings and the time's-up screen. The server's clock decides; this only shows it. */
function SessionAlerts({ state, t }: { state: ShellState; t: Strings }) {
  const s = state.session!;
  const serverNow = useNow(1000) + state.serverOffsetMs;
  const remaining = s.expiresAt ? new Date(s.expiresAt).getTime() - serverNow : null;
  const [toast, setToast] = useState<string | null>(null);
  const shown = useRef(new Set<number>());

  useEffect(() => {
    if (remaining === null) return;
    for (const m of s.warningMinutes) {
      if (remaining <= m * 60_000 && remaining > (m - 1) * 60_000 && !shown.current.has(m)) {
        shown.current.add(m);
        setToast(t.minutesLeft(m));
        addNotice(t.timeLeft, t.minutesLeft(m), m <= 5 ? "alarm" : "warn");
        setTimeout(() => setToast(null), m === 1 ? 60_000 : 9_000);
      }
    }
  }, [remaining, s.warningMinutes, t]);
  useEffect(() => {
    shown.current = new Set(s.warningMinutes.filter((m) => remaining !== null && remaining <= (m - 1) * 60_000));
    // re-arm when a new session starts or the session is extended
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id, s.expiresAt]);

  // A gentle break reminder every two hours of play.
  const playedMs = serverNow - new Date(s.startedAt).getTime();
  const breaks = Math.floor(playedMs / (2 * 3_600_000));
  const breaksShown = useRef(breaks);
  useEffect(() => {
    if (breaks <= breaksShown.current) return;
    breaksShown.current = breaks;
    const text = `You've been playing ${breaks * 2} hours — stretch, look away from the screen and drink some water.`;
    addNotice("Time for a short break", text, "warn");
    setToast(text);
    setTimeout(() => setToast(null), 12_000);
  }, [breaks]);

  const lastMinute = remaining !== null && remaining <= 60_000 && remaining > 0;
  const timesUp = remaining !== null && remaining <= 0;
  return (
    <>
      {toast && !timesUp && (
        <div role="status" className={cx("fixed left-1/2 top-8 z-50 -translate-x-1/2 rounded-2xl border px-8 py-4 font-display text-xl shadow-2xl", lastMinute ? "border-alarm bg-alarm/20 text-alarm" : "border-warn/50 bg-deck text-warn")}>
          {toast}
        </div>
      )}
      {timesUp && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-void/90 backdrop-blur">
          <div className="text-center">
            <p className="font-display text-5xl font-semibold">{t.timesUp}</p>
            <p className="mt-4 flex items-center justify-center gap-2 text-dim">
              <Loader2 className="size-5 animate-spin" /> {t.finishing}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** Preview only: stands in for the real game/app window that would be in front in bar mode. */
function PreviewFrontWindow() {
  const { windows } = useHost();
  const w = windows.find((x) => x.active);
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-[repeating-linear-gradient(45deg,#0d0c17,#0d0c17_12px,#100f1c_12px,#100f1c_24px)] text-center text-dim">
      <div>
        <AppWindow className="mx-auto size-12 opacity-60" />
        <p className="mt-3 font-display text-2xl text-text">{w?.title ?? "A game or app"}</p>
        <p className="mt-1 text-sm">is in front (preview). On the PC the desktop shows around it.</p>
      </div>
    </div>
  );
}

function SessionScreen({ state, t }: { state: ShellState; t: Strings }) {
  const [note, setNote] = useState<{ text: string; tone: "good" | "warn" | "alarm" } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify: Notify = useCallback((text, tone = "good") => {
    clearTimeout(noteTimer.current);
    setNote({ text, tone });
    noteTimer.current = setTimeout(() => setNote(null), 5000);
  }, []);
  // Kitchen progress on food orders shows up wherever the customer is.
  useEffect(() => bridge.subscribe((m) => {
    if (m.type === "order_status") notify(`Order ${m.number}: ${m.message}`, "good");
  }), [notify]);

  // A new customer starts with an empty notification list.
  const sessionId = state.session!.id;
  useEffect(() => clearNotices(), [sessionId]);

  const areaRef = useRef<HTMLDivElement>(null);
  const wm = useWindowManager(() => areaRef.current?.getBoundingClientRect());
  const [startOpen, setStartOpen] = useState(false);
  const [addingTime, setAddingTime] = useState(false);
  const { mode } = useHost();
  const bar = mode === "bar";
  const openGames = wm.open;
  const home = useMemo(
    () => <HomeWidget state={state} t={t} notify={notify} openGames={() => openGames("games")} openAccount={() => openGames("account")} addTime={() => setAddingTime(true)} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, t, notify],
  );

  return (
    <main className="relative flex h-full flex-col">
      {/* On the PC the desktop stays drawn behind the game/app windows, like Windows'. The preview has no real windows, so it shows a stand-in. */}
      {bar && bridge.mock ? <PreviewFrontWindow /> : <Desktop wm={wm} areaRef={areaRef} home={home} notify={notify} station={state.station.name} />}
      <Taskbar state={state} t={t} wm={wm} startOpen={startOpen && !bar} onStart={() => setStartOpen((o) => !o)} onAddTime={() => setAddingTime(true)} className="h-[max(44px,5vh)]" />
      {addingTime && <AddTime onClose={() => setAddingTime(false)} onDone={(text) => notify(text, "good")} />}
      {startOpen && !bar && <StartMenu state={state} t={t} notify={notify} onOpen={wm.open} onClose={() => setStartOpen(false)} />}

      {note && (
        <div role="status" key={note.text} className={cx("glass animate-pop fixed bottom-[calc(max(44px,5vh)+1rem)] left-1/2 z-50 -translate-x-1/2 rounded-2xl border px-6 py-3 shadow-2xl", note.tone === "good" ? "border-good/40 bg-deck text-good" : note.tone === "warn" ? "border-warn/50 bg-deck text-warn" : "border-alarm bg-deck text-alarm")}>
          {note.text}
        </div>
      )}
      <PrintApproval notify={notify} />
      <SessionAlerts state={state} t={t} />
      <LowTimeNudge state={state} onAddTime={() => setAddingTime(true)} />
      <AwayLock name={state.session!.customerName} />
    </main>
  );
}

// ── Root ────────────────────────────────────────────────────────────────────

function StaffMessage({ msg, onClose }: { msg: { title: string; text: string } | null; onClose: () => void }) {
  if (!msg) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-void/60 backdrop-blur-sm">
      <div className="glass animate-pop max-w-lg rounded-3xl p-10 text-center shadow-2xl">
        <p className="text-sm uppercase tracking-[0.25em] text-glow">{msg.title}</p>
        <p className="mt-4 font-display text-3xl">{msg.text}</p>
        <button onClick={onClose} className="brand-gradient press mt-8 rounded-xl px-10 py-3 font-display font-semibold text-void hover:shadow-glow">
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
  useLangPref(setLang); // a signed-in player's saved language
  const sessionId = state?.session?.id ?? null;
  useEffect(() => setSession(sessionId), [sessionId]);

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
      <Backdrop wallpaper={state?.venue.wallpaperUrl} />
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
      <StaffExit />
      {bridge.mock && (
        <div className="fixed bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-rim bg-deck px-3 py-1 text-xs text-mute">
          <Wifi className="size-3" /> {import.meta.env.VITE_ARENA_DEMO === "1" ? `Live demo · ${state?.station.name ?? ""} · sign in as ahmed / ahmed123` : "Preview mode · try ahmed / ahmed123"}
        </div>
      )}
    </div>
  );
}
