import { useEffect, useMemo, useState } from "react";
import {
  AppWindow, Cable, Check, Gamepad2, Globe, Headphones, Keyboard, Loader2, Lock, Mic, Monitor, Mouse, Play, RefreshCcw, Search, Signal,
  Sparkles, Volume2, Webcam, Wifi, Wrench,
} from "lucide-react";
import { bridge, request, type HelpTopic, type SelfRepair, type ShellAppItem, type ShellGame } from "./bridge";
import { CATEGORY_LABEL, tileColors, useStation } from "./station";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const rid = () => crypto.randomUUID();

export type Notify = (text: string, tone?: "good" | "warn" | "alarm") => void;

// ── Games ──────────────────────────────────────────────────────────────────

function GameTile({ game, playing, onPlay, busy }: { game: ShellGame; playing: boolean; onPlay: () => void; busy: boolean }) {
  const [a, b] = tileColors(game.title);
  const disabled = game.locked || !game.installed;
  return (
    <button
      onClick={onPlay}
      disabled={disabled || busy}
      className={cx("sheen press group relative aspect-[3/4] overflow-hidden rounded-2xl border text-left duration-300", disabled ? "border-rim opacity-50" : "border-rim hover:-translate-y-1.5 hover:border-glow/70 hover:shadow-glow", playing && "border-good ring-2 ring-good/50")}
      style={{ background: game.coverUrl ? `center/cover url(${game.coverUrl})` : `linear-gradient(155deg, ${a}, ${b})` }}
      title={game.locked ? `Rated ${game.minAge}+` : !game.installed ? "Not installed on this PC" : `Play ${game.title}`}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-void/95 via-void/20 to-transparent" />
      {!game.coverUrl && <span className="absolute -right-3 top-2 font-display text-[7rem] font-bold leading-none text-white/10 select-none">{game.title.slice(0, 1)}</span>}
      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
        {game.featured && <span className="rounded-full bg-glow/90 px-2 py-0.5 text-[11px] font-semibold text-void">Featured</span>}
        {game.updateRequired && game.installed && <span className="rounded-full bg-warn/90 px-2 py-0.5 text-[11px] font-semibold text-void">Update pending</span>}
        {playing && <span className="rounded-full bg-good px-2 py-0.5 text-[11px] font-semibold text-void">Playing</span>}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="font-display text-lg font-semibold leading-tight">{game.title}</p>
        <p className="mt-1 text-xs text-dim">{game.categories.slice(0, 2).map((c) => CATEGORY_LABEL[c] ?? c).join(" · ")}{game.minAge ? ` · ${game.minAge}+` : ""}</p>
      </div>
      {game.locked ? (
        <div className="absolute inset-0 grid place-items-center"><div className="flex items-center gap-2 rounded-full bg-void/80 px-4 py-2 text-sm"><Lock className="size-4" /> {game.minAge}+ only</div></div>
      ) : !game.installed ? (
        <div className="absolute inset-0 grid place-items-center"><div className="rounded-full bg-void/80 px-4 py-2 text-sm text-dim">Not on this PC</div></div>
      ) : (
        <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
          <div className="brand-gradient grid size-16 scale-90 place-items-center rounded-full text-void shadow-glow transition-transform duration-300 group-hover:scale-100">{busy ? <Loader2 className="size-7 animate-spin" /> : <Play className="ml-1 size-7 fill-current" />}</div>
        </div>
      )}
    </button>
  );
}

export function useLauncher(notify: Notify) {
  const [busy, setBusy] = useState<string | null>(null);
  const launch = async (kind: "game" | "app", id: string, name: string) => {
    setBusy(id);
    const requestId = rid();
    const r = await request(kind === "game" ? { type: "launch", requestId, gameId: id } : { type: "launch_app", requestId, appId: id }, "launch_result");
    setBusy(null);
    notify(r.ok ? `Starting ${name}…` : (r.message ?? "Couldn't start that."), r.ok ? "good" : "warn");
  };
  return { busy, launch };
}

export function GamesScreen({ notify }: { notify: Notify }) {
  const { games, playing } = useStation();
  const { busy, launch } = useLauncher(notify);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [installedOnly, setInstalledOnly] = useState(true);
  const cats = useMemo(() => [...new Set(games.flatMap((g) => g.categories))].filter((c) => CATEGORY_LABEL[c]).sort(), [games]);
  const shown = games.filter((g) => (!installedOnly || g.installed) && (!cat || g.categories.includes(cat)) && (!q || g.title.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex min-w-72 flex-1 items-center gap-3 rounded-xl border border-rim bg-deck/80 px-4 py-3 transition-colors focus-within:border-glow focus-within:shadow-glow">
          <Search className="size-5 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search games" className="w-full bg-transparent text-lg outline-none" />
        </label>
        <button onClick={() => setInstalledOnly(!installedOnly)} className={cx("press flex items-center gap-2 rounded-xl border px-4 py-3", installedOnly ? "border-glow/60 bg-glow/10 text-glow" : "border-rim text-dim")}>
          {installedOnly && <Check className="size-4" />} Installed on this PC
        </button>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {[null, ...cats].map((c) => (
          <button key={c ?? "all"} onClick={() => setCat(c)} className={cx("press rounded-full border px-4 py-1.5 text-sm", cat === c ? "border-glow bg-glow font-semibold text-void" : "border-rim text-dim hover:text-text")}>
            {c ? CATEGORY_LABEL[c] : "All"}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-24 text-center text-lg text-dim">{games.length === 0 ? "Loading the game library…" : "No games match."}</p>
      ) : (
        <div className="animate-enter grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5">
          {shown.map((g) => (
            <GameTile key={g.id} game={g} playing={playing?.gameId === g.id} busy={busy === g.id} onPlay={() => launch("game", g.id, g.title)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FeaturedRow({ notify }: { notify: Notify }) {
  const { games, playing } = useStation();
  const { busy, launch } = useLauncher(notify);
  const featured = games.filter((g) => g.featured && g.installed).slice(0, 4);
  if (!featured.length) return null;
  return (
    <div className="grid max-w-2xl grid-cols-4 gap-4">
      {featured.map((g) => (
        <GameTile key={g.id} game={g} playing={playing?.gameId === g.id} busy={busy === g.id} onPlay={() => launch("game", g.id, g.title)} />
      ))}
    </div>
  );
}

// ── Apps (platforms, internet, apps) ───────────────────────────────────────

const APP_ICON: Record<string, typeof Globe> = { BROWSER: Globe, PLATFORM_LAUNCHER: Gamepad2, COMMUNICATION: Headphones, MEDIA: Volume2 };

export function AppsScreen({ kinds, title, hint, notify }: { kinds: string[] | null; title: string; hint: string; notify: Notify }) {
  const { apps } = useStation();
  const { busy, launch } = useLauncher(notify);
  const shown = apps.filter((a: ShellAppItem) => (kinds ? kinds.includes(a.kind) : !["BROWSER", "PLATFORM_LAUNCHER"].includes(a.kind)));
  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="font-display text-3xl font-semibold">{title}</h2>
      <p className="mt-2 text-dim">{hint}</p>
      {shown.length === 0 ? (
        <p className="py-24 text-center text-dim">Nothing here yet.</p>
      ) : (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {shown.map((a) => {
            const Icon = APP_ICON[a.kind] ?? AppWindow;
            const [c1] = tileColors(a.name);
            return (
              <button key={a.id} onClick={() => launch("app", a.id, a.name)} disabled={busy === a.id} className="glass press group flex items-center gap-4 rounded-2xl p-5 text-left hover:-translate-y-0.5 hover:border-glow/60">
                <div className="grid size-12 place-items-center rounded-xl" style={{ background: c1 }}>
                  {busy === a.id ? <Loader2 className="size-6 animate-spin" /> : <Icon className="size-6" />}
                </div>
                <span className="font-display text-lg">{a.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Connectivity ───────────────────────────────────────────────────────────

const pingTone = (ms: number | null, loss: number) => (ms === null || loss >= 50 ? "text-alarm" : loss >= 10 || ms >= 80 ? "text-warn" : "text-good");

export function ConnectivityScreen({ notify }: { notify: Notify }) {
  const { probe } = useStation();
  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="font-display text-3xl font-semibold">Connection</h2>
      <p className="mt-2 text-dim">Live latency from this PC. Updated every minute.</p>
      <div className="mt-8 grid grid-cols-3 gap-4">
        <Stat icon={probe?.linkType === "WIFI" ? Wifi : Cable} label="Link" value={probe?.linkType ? `${probe.linkType === "WIFI" ? "Wi-Fi" : "Ethernet"}` : "—"} sub={probe?.linkSpeedMbps ? `${probe.linkSpeedMbps >= 1000 ? `${probe.linkSpeedMbps / 1000} Gbps` : `${probe.linkSpeedMbps} Mbps`}` : ""} />
        <Stat icon={Signal} label="Best ping" value={bestPing(probe) ?? "—"} sub="to the internet" />
        <Stat icon={Globe} label="DNS lookup" value={probe?.dnsMs != null ? `${Math.round(probe.dnsMs)} ms` : "—"} sub="" />
      </div>
      <div className="glass mt-6 overflow-hidden rounded-2xl">
        {(probe?.targets ?? []).map((t) => (
          <div key={t.name} className="flex items-center justify-between border-b border-rim/60 px-6 py-4 last:border-0">
            <div>
              <p className="font-semibold">{t.name}</p>
              <p className="text-sm text-mute">{t.host === "gateway" ? "Your router" : t.host}</p>
            </div>
            <div className="text-right">
              <p className={cx("tabular font-mono text-2xl font-semibold", pingTone(t.pingMs, t.lossPct))}>{t.pingMs === null ? "—" : `${Math.round(t.pingMs)} ms`}</p>
              <p className="text-xs text-mute">{t.lossPct ? `${t.lossPct}% loss` : "no loss"}</p>
            </div>
          </div>
        ))}
        {!probe && <p className="px-6 py-10 text-center text-dim">Measuring…</p>}
      </div>
      <SelfFix action="FLUSH_DNS" label="Game can't connect? Refresh network settings" notify={notify} />
    </div>
  );
}

function bestPing(p: ReturnType<typeof useStation>["probe"]) {
  const ms = p?.targets.filter((t) => t.host !== "gateway" && t.pingMs !== null).map((t) => t.pingMs!) ?? [];
  return ms.length ? `${Math.round(Math.min(...ms))} ms` : null;
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Wifi; label: string; value: string; sub: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <p className="flex items-center gap-2 text-sm text-dim"><Icon className="size-4 text-glow" /> {label}</p>
      <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
      <p className="text-sm text-mute">{sub}</p>
    </div>
  );
}

// ── Peripherals ────────────────────────────────────────────────────────────

const PERIPHERAL_ICON: Record<string, typeof Mouse> = { MOUSE: Mouse, KEYBOARD: Keyboard, HEADSET: Headphones, MICROPHONE: Mic, WEBCAM: Webcam, CONTROLLER: Gamepad2, STEERING_WHEEL: Gamepad2, JOYSTICK: Gamepad2 };

export function PeripheralsScreen({ notify }: { notify: Notify }) {
  const { peripherals, presets, pointer } = useStation();
  const [speed, setSpeed] = useState<number | null>(null);
  useEffect(() => bridge.send({ type: "pointer_get" }), []);
  useEffect(() => setSpeed(pointer?.mouseSpeed ?? null), [pointer?.mouseSpeed]);
  const apply = (s: { mouseSpeed?: number; enhancePointerPrecision?: boolean }) => bridge.send({ type: "pointer_apply", ...s });

  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-2">
      <section>
        <h2 className="font-display text-3xl font-semibold">Your gear</h2>
        <p className="mt-2 text-dim">What this PC can see right now.</p>
        <div className="mt-6 space-y-3">
          {peripherals.map((p, i) => {
            const Icon = PERIPHERAL_ICON[p.type] ?? Monitor;
            return (
              <div key={i} className="glass flex items-center gap-4 rounded-2xl px-5 py-4">
                <Icon className="size-7 text-glow" />
                <div className="flex-1">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-mute">{p.type.charAt(0) + p.type.slice(1).toLowerCase().replace("_", " ")}{p.vendor ? ` · ${p.vendor}` : ""}</p>
                </div>
                <span className="flex items-center gap-1.5 text-sm text-good"><span className="live-dot size-2 rounded-full bg-good" /> Connected</span>
              </div>
            );
          })}
          {peripherals.length === 0 && <p className="glass rounded-2xl px-5 py-8 text-center text-dim">No USB gaming gear detected.</p>}
        </div>
        <SelfFix action="RESTART_AUDIO" label="No sound in your headset? Restart audio" notify={notify} />
      </section>
      <section>
        <h2 className="font-display text-3xl font-semibold">Mouse</h2>
        <p className="mt-2 text-dim">Applies to your session only — reset for the next player.</p>
        <div className="glass mt-6 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Pointer speed</p>
            <p className="tabular font-mono text-2xl">{speed ?? "—"}<span className="text-sm text-mute"> / 20</span></p>
          </div>
          <input
            type="range" min={1} max={20} value={speed ?? 10} disabled={speed === null}
            onChange={(e) => setSpeed(Number(e.target.value))}
            onPointerUp={(e) => apply({ mouseSpeed: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => apply({ mouseSpeed: Number((e.target as HTMLInputElement).value) })}
            className="mt-4 w-full accent-[var(--color-glow)]"
          />
          <label className="mt-6 flex items-center justify-between">
            <span>
              <span className="font-semibold">Enhance pointer precision</span>
              <span className="block text-sm text-mute">Mouse acceleration. Most FPS players turn it off.</span>
            </span>
            <input type="checkbox" checked={pointer?.enhancePointerPrecision ?? false} onChange={(e) => apply({ enhancePointerPrecision: e.target.checked })} className="size-6 accent-[var(--color-glow)]" />
          </label>
        </div>
        {presets.length > 0 && (
          <>
            <p className="mt-6 mb-3 text-sm uppercase tracking-[0.2em] text-dim">Presets</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button key={p.id} onClick={() => apply({ mouseSpeed: p.mouseSpeed ?? undefined, enhancePointerPrecision: p.enhancePointerPrecision ?? undefined })} className="press rounded-xl border border-rim px-4 py-2 hover:border-glow hover:text-glow">
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ── Support ────────────────────────────────────────────────────────────────

const TOPICS: Array<{ id: HelpTopic; label: string; icon: typeof Mouse }> = [
  { id: "game", label: "A game won't start", icon: Gamepad2 },
  { id: "peripheral", label: "Mouse, keyboard or headset", icon: Headphones },
  { id: "network", label: "Lag or disconnects", icon: Wifi },
  { id: "payment", label: "Time or payment", icon: Sparkles },
  { id: "general", label: "Something else", icon: Wrench },
];

export function SupportScreen({ station, notify }: { station: string; notify: Notify }) {
  const [sending, setSending] = useState<HelpTopic | null>(null);
  const [sent, setSent] = useState(false);
  const ask = async (topic: HelpTopic) => {
    setSending(topic);
    const r = await request({ type: "help", requestId: rid(), topic }, "help_result");
    setSending(null);
    setSent(r.ok);
    notify(r.message ?? (r.ok ? "Staff have been notified." : "Couldn't reach staff."), r.ok ? "good" : "warn");
  };
  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.3fr_1fr]">
      <section>
        <h2 className="font-display text-3xl font-semibold">Call staff</h2>
        <p className="mt-2 text-dim">Pick what's wrong — someone will come to <strong className="text-text">{station}</strong>.</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {TOPICS.map((t) => (
            <button key={t.id} onClick={() => ask(t.id)} disabled={!!sending} className="glass press flex items-center gap-4 rounded-2xl p-5 text-left hover:border-glow/60 disabled:opacity-60">
              {sending === t.id ? <Loader2 className="size-7 animate-spin text-glow" /> : <t.icon className="size-7 text-glow" />}
              <span className="font-display text-lg">{t.label}</span>
            </button>
          ))}
        </div>
        {sent && <p className="mt-6 flex items-center gap-2 rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-good"><Check className="size-5" /> Help is on the way.</p>}
      </section>
      <section>
        <h2 className="font-display text-3xl font-semibold">Quick fixes</h2>
        <p className="mt-2 text-dim">Safe to try — nothing you're doing is lost.</p>
        <SelfFix action="RESTART_AUDIO" label="Restart sound" notify={notify} />
        <SelfFix action="FLUSH_DNS" label="Refresh network settings" notify={notify} />
        <SelfFix action="RESTART_SHELL" label="Reload this screen" notify={notify} />
      </section>
    </div>
  );
}

function SelfFix({ action, label, notify }: { action: SelfRepair; label: string; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await request({ type: "repair", requestId: rid(), action }, "repair_result", 60_000);
    setBusy(false);
    notify(r.ok ? `${label}: done` : (r.message ?? "That didn't work — please call staff."), r.ok ? "good" : "warn");
  };
  return (
    <button onClick={run} disabled={busy} className="press mt-4 flex w-full items-center gap-3 rounded-2xl border border-rim px-5 py-4 text-left hover:border-glow/60 hover:bg-deck/60 disabled:opacity-60">
      {busy ? <Loader2 className="size-5 animate-spin text-glow" /> : <RefreshCcw className="size-5 text-glow" />}
      <span>{label}</span>
    </button>
  );
}
