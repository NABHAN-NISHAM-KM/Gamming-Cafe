import { useEffect, useRef, useState } from "react";
import { Hourglass, Loader2, Sparkles, Trophy, X } from "lucide-react";
import { player, request, type ShellState, type TimeOffers } from "./bridge";
import type { Prefs } from "./player";
import type { Notify } from "./screens";

const rid = () => crypto.randomUUID();
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ── "time's nearly up" with the cheapest way to keep playing ────────────────

/** Minutes left when the offer pops up (once per session and extension). */
export const NUDGE_AT_MIN = 10;

/**
 * At ten minutes left, a signed-in player sees the best-value package for
 * their rate and any offer running now, with one tap to add time.
 */
export function LowTimeNudge({ state, onAddTime }: { state: ShellState; onAddTime: () => void }) {
  const s = state.session;
  const [serverNow, setNow] = useState(() => Date.now() + state.serverOffsetMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + state.serverOffsetMs), 15_000);
    return () => clearInterval(id);
  }, [state.serverOffsetMs]);
  const [offer, setOffer] = useState<{ pkg: TimeOffers["packages"][number] | null; currency: string; promotions: Array<{ name: string; description: string | null }> } | null>(null);
  const shownFor = useRef<string | null>(null);
  const remaining = s?.expiresAt ? new Date(s.expiresAt).getTime() - serverNow : null;
  const key = s ? `${s.id}:${s.expiresAt}` : null;

  useEffect(() => {
    if (!s?.customerName || remaining === null || !key) return;
    if (remaining > NUDGE_AT_MIN * 60_000 || remaining < 60_000 || shownFor.current === key) return;
    shownFor.current = key;
    void request({ type: "time_offers", requestId: rid() }, "time_offers").then((r) => {
      const o = r as TimeOffers & { promotions?: Array<{ name: string; description: string | null }> };
      if (!o.ok || (!o.packages.length && !o.promotions?.length)) return;
      // Best value: the lowest price per minute (bonus minutes included).
      const pkg = [...o.packages].sort((a, b) => Number(a.price) / a.minutes - Number(b.price) / b.minutes)[0] ?? null;
      setOffer({ pkg, currency: o.currency, promotions: o.promotions ?? [] });
      setTimeout(() => setOffer(null), 45_000);
    });
  }, [remaining, key, s?.customerName]);

  if (!offer) return null;
  return (
    <div role="status" className="glass animate-pop fixed bottom-24 right-6 z-40 w-96 rounded-2xl border border-warn/50 p-5 shadow-2xl">
      <div className="flex items-start gap-3">
        <Hourglass className="mt-0.5 size-6 text-warn" />
        <div className="flex-1">
          <p className="font-display text-lg font-semibold">{NUDGE_AT_MIN} minutes left</p>
          {offer.pkg && <p className="text-sm text-dim">Best value: <b className="text-text">{offer.pkg.name}</b> — {offer.pkg.minutes} min for {offer.currency} {offer.pkg.price}{offer.pkg.bonusMinutes ? ` (incl. ${offer.pkg.bonusMinutes} free)` : ""}</p>}
          {offer.promotions.map((p) => <p key={p.name} className="mt-1 flex items-center gap-1.5 text-sm text-glow"><Sparkles className="size-3.5" /> {p.name}{p.description ? ` — ${p.description}` : ""}</p>)}
        </div>
        <button onClick={() => setOffer(null)} aria-label="Close" className="text-dim hover:text-text"><X className="size-5" /></button>
      </div>
      <button onClick={() => { setOffer(null); onAddTime(); }} className="press brand-gradient mt-4 w-full rounded-xl py-2.5 font-semibold text-void">Add time</button>
    </div>
  );
}

// ── the venue's news on game tiles ──────────────────────────────────────────

let news: Map<string, string> | null = null;
let loading: Promise<void> | null = null;
/** News lines the venue wrote for its games ("New season out now"), fetched once per Shell start. */
export function useGameNews() {
  const [, bump] = useState(0);
  useEffect(() => {
    if (news) return;
    loading ??= player<Array<{ gameId: string; news: string }>>("news")
      .then((rows) => void (news = new Map(rows.map((r) => [r.gameId, r.news]))))
      .catch(() => void (news = new Map()));
    void loading.then(() => bump((n) => n + 1));
  }, []);
  return news;
}

// ── tournament check-in from the PC ─────────────────────────────────────────

export function CheckInButton({ tournamentId, name, notify }: { tournamentId: string; name: string; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      const r = await player<{ team: string; next: { round: number; vs: string; stations: string[]; at: string | null } | null }>("tournament_checkin", { tournamentId });
      const text = r.next ? `Round ${r.next.round} vs ${r.next.vs}${r.next.stations.length ? ` on ${r.next.stations.join(", ")}` : ""}` : "You'll see your first match here.";
      setDone(text);
      notify(`${r.team} is checked in for ${name}. ${text}`, "good");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't check in — ask staff.", "warn");
    } finally {
      setBusy(false);
    }
  };
  if (done) return <span className="flex items-center gap-1.5 text-sm text-good"><Trophy className="size-4" /> Checked in · {done}</span>;
  return (
    <button onClick={() => void go()} disabled={busy} className="press rounded-lg bg-warn px-3 py-1 text-sm font-semibold text-void disabled:opacity-60">
      {busy ? <Loader2 className="size-4 animate-spin" /> : "Check in"}
    </button>
  );
}

// ── accessibility ───────────────────────────────────────────────────────────

/** Larger text and high contrast, applied to the Shell's own screens (and kept on the player's account). */
let applied: Pick<Prefs, "textScale" | "contrast"> = {};
export function applyA11y(p: Pick<Prefs, "textScale" | "contrast">) {
  applied = { textScale: p.textScale, contrast: p.contrast };
  document.documentElement.style.setProperty("--text-scale", String((p.textScale ?? 100) / 100));
  document.documentElement.classList.toggle("contrast", !!p.contrast);
}

export function A11ySettings({ prefs, save }: { prefs: Prefs; save: (p: Prefs) => void }) {
  const [cur, setCur] = useState(() => ({ textScale: prefs.textScale ?? applied.textScale, contrast: prefs.contrast ?? applied.contrast }));
  const set = (p: Prefs) => {
    const next = { ...cur, ...p };
    setCur(next);
    applyA11y(next);
    save(p);
  };
  return (
    <>
      <p className="font-semibold">Text size</p>
      <div className="flex gap-2">
        {([100, 115, 130] as const).map((v) => (
          <button key={v} onClick={() => set({ textScale: v })} className={cx("press rounded-xl border px-5 py-2", (cur.textScale ?? 100) === v ? "border-glow bg-glow/10 text-glow" : "border-rim text-dim")} style={{ fontSize: `${v}%` }}>
            {v === 100 ? "Normal" : v === 115 ? "Large" : "Larger"}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" className="size-5" checked={!!cur.contrast} onChange={(e) => set({ contrast: e.target.checked })} />
        <span>High contrast</span>
      </label>
    </>
  );
}
