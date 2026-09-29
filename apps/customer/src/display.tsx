import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/*
 * TV station display: runs full-screen in the browser of the TV next to a
 * console (or a VR bay's screen). Paired once with a code from staff; then it
 * shows who's playing, the countdown, warnings, and "time's up".
 */

type Station = {
  name: string;
  kind: string;
  platform: string;
  status: string;
  justEnded: { at: string; reason: string } | null;
  session: { player: string; status: string; startedAt: string | null; expiresAt: string | null; paused: boolean; open: boolean; players: number } | null;
};
type State = { display: string; venue: string; branch: string; logoUrl: string | null; serverTime: string; stations: Station[] };

const KEY = "arena.display.token";
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const readToken = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

function Pair({ onPaired }: { onPaired: (token: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/v1/display/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 429 ? "Too many tries — wait a few minutes." : "That code didn't work. Ask staff for a new one.");
      try {
        localStorage.setItem(KEY, body.token);
      } catch {
        /* private mode: stays paired until the page reloads */
      }
      onPaired(body.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't pair.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-dvh place-items-center p-8">
      <form onSubmit={submit} className="w-full max-w-md text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-glow">Station display</p>
        <h1 className="mt-3 font-display text-4xl font-semibold">Pair this screen</h1>
        <p className="mt-3 text-dim">In the ArenaOS admin, open Consoles &amp; VR, pick this TV and choose “Pair display”. Type the code shown there.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoFocus
          inputMode="text"
          autoComplete="off"
          maxLength={9}
          placeholder="ABCD-2345"
          aria-label="Pairing code"
          className="mt-8 w-full rounded-2xl border border-rim bg-deck px-6 py-5 text-center font-mono text-4xl tracking-[0.2em] text-text outline-none focus:border-glow"
        />
        {error && <p className="mt-4 text-alarm">{error}</p>}
        <button disabled={busy || code.replace(/[^0-9A-Z]/g, "").length < 8} className="mt-6 w-full rounded-2xl brand-gradient press py-4 font-display text-xl font-semibold text-void disabled:opacity-40">
          {busy ? "Pairing…" : "Pair"}
        </button>
      </form>
    </main>
  );
}

function StationCard({ s, now, big }: { s: Station; now: number; big: boolean }) {
  const live = s.session;
  const left = live?.expiresAt ? new Date(live.expiresAt).getTime() - now : null;
  const timesUp = (live && left !== null && left <= 0) || (!live && s.justEnded && now - new Date(s.justEnded.at).getTime() < 90_000);
  const tone = timesUp ? "alarm" : left !== null && left <= 60_000 ? "alarm" : left !== null && left <= 5 * 60_000 ? "warn" : "glow";
  return (
    <section
      className={cx(
        "flex flex-col items-center justify-center rounded-[2rem] border p-8 text-center transition-colors",
        timesUp ? "animate-pulse border-alarm/70 bg-alarm/10" : tone === "warn" ? "border-warn/60 bg-warn/5" : tone === "alarm" ? "border-alarm/60 bg-alarm/5" : "border-rim bg-deck/70",
      )}
    >
      <p className="font-display text-2xl font-semibold tracking-wide text-dim">{s.name}</p>
      {timesUp ? (
        <>
          <p className={cx("mt-4 font-display font-semibold text-alarm", big ? "text-8xl" : "text-6xl")}>Time's up</p>
          <p className="mt-4 text-xl text-text">Please hand the controllers back at the front desk.</p>
          <p className="mt-1 text-dim">Want more time? Ask at the counter.</p>
        </>
      ) : live ? (
        <>
          <p className="mt-2 text-2xl">{live.player}{live.players > 1 ? ` + ${live.players - 1}` : ""}</p>
          {live.paused ? (
            <p className={cx("mt-4 font-display font-semibold text-warn", big ? "text-8xl" : "text-6xl")}>Paused</p>
          ) : live.open || left === null ? (
            <>
              <p className={cx("tabular mt-4 font-display font-semibold", big ? "text-[9rem] leading-none" : "text-7xl")}>{clock(now - new Date(live.startedAt ?? now).getTime())}</p>
              <p className="mt-2 text-dim">played so far</p>
            </>
          ) : (
            <>
              <p className={cx("tabular mt-4 font-display font-semibold", big ? "text-[9rem] leading-none" : "text-7xl", tone === "warn" && "text-warn", tone === "alarm" && "text-alarm")}>{clock(left)}</p>
              <p className="mt-2 text-dim">{tone === "alarm" ? "Last minute — save your game!" : tone === "warn" ? "A few minutes left — ask at the counter to add time" : "time left"}</p>
            </>
          )}
        </>
      ) : s.status === "CLEANING" ? (
        <p className="mt-6 font-display text-5xl text-warn">Being cleaned</p>
      ) : s.status === "MAINTENANCE" || s.status === "OFFLINE" ? (
        <p className="mt-6 font-display text-5xl text-dim">Out of service</p>
      ) : (
        <>
          <p className="mt-6 font-display text-6xl text-good">Free</p>
          <p className="mt-3 text-xl text-dim">Ask at the counter to play</p>
        </>
      )}
    </section>
  );
}

function Board({ token, onUnpaired }: { token: string; onUnpaired: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/v1/display/state", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        if (res.status === 401) {
          try {
            localStorage.removeItem(KEY);
          } catch {
            /* ignore */
          }
          return onUnpaired();
        }
        if (!res.ok) throw new Error(String(res.status));
        const s = (await res.json()) as State;
        skew.current = new Date(s.serverTime).getTime() - Date.now();
        if (!stop) {
          setState(s);
          setOffline(false);
        }
      } catch {
        if (!stop) setOffline(true);
      }
    };
    void load();
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now() + skew.current), 250);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [token, onUnpaired]);

  if (!state) return <main className="grid min-h-dvh place-items-center text-2xl text-dim">{offline ? "Can't reach the venue…" : "Loading…"}</main>;
  return (
    <main className="flex min-h-dvh flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {state.logoUrl ? <img src={state.logoUrl} alt="" className="size-12 rounded-xl" /> : <span className="grid size-12 place-items-center rounded-xl brand-gradient font-display text-2xl font-bold text-void">{state.venue.slice(0, 1)}</span>}
          <div>
            <p className="font-display text-2xl font-semibold">{state.venue}</p>
            <p className="text-dim">{state.branch}</p>
          </div>
        </div>
        <p className="tabular font-display text-3xl text-dim">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      </header>
      {state.stations.length === 0 ? (
        <p className="m-auto text-2xl text-dim">No stations are linked to this screen yet.</p>
      ) : (
        <div className={cx("grid flex-1 gap-6", state.stations.length === 1 ? "grid-cols-1" : state.stations.length === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3")}>
          {state.stations.map((s) => <StationCard key={s.name} s={s} now={now} big={state.stations.length === 1} />)}
        </div>
      )}
      {offline && <p className="text-center text-warn">Connection lost — the times shown may be out of date.</p>}
    </main>
  );
}

function Display() {
  const [token, setToken] = useState<string | null>(readToken);
  const unpaired = useCallback(() => setToken(null), []); // stable: the board's polling must not restart every tick
  return token ? <Board token={token} onUnpaired={unpaired} /> : <Pair onPaired={setToken} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Display />
  </StrictMode>,
);
