import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, BellOff, Cable, Camera, Signal, Volume1, Volume2, VolumeX, Wifi, WifiOff, X } from "lucide-react";
import { bridge } from "./bridge";
import { useStation } from "./station";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ── Notifications: everything the Shell told the customer, in one place ─────

export interface Notice { id: number; at: number; title: string; text: string; tone: "info" | "good" | "warn" | "alarm" }
let notices: Notice[] = [];
let unread = 0;
let seq = 0;
const noticeSubs = new Set<() => void>();
const changed = () => noticeSubs.forEach((f) => f());

export function addNotice(title: string, text: string, tone: Notice["tone"] = "info") {
  notices = [{ id: ++seq, at: Date.now(), title, text, tone }, ...notices].slice(0, 50);
  unread++;
  changed();
}
/** A new customer starts with an empty list. */
export function clearNotices() {
  notices = [];
  unread = 0;
  changed();
}

bridge.subscribe((m) => {
  if (m.type === "message") addNotice(m.title || "Message from staff", m.text, "info");
  else if (m.type === "order_status") addNotice(`Food order ${m.number}`, m.message, "good");
  else if (m.type === "print_status") addNotice("Printing", m.message, m.status === "FAILED" || m.status === "CANCELLED" ? "warn" : "good");
  else if (m.type === "screenshot_result") addNotice("Screenshot", m.message ?? (m.ok ? "Saved." : "Not saved."), m.ok ? "good" : "warn");
});

function useNotices() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    noticeSubs.add(f);
    return () => void noticeSubs.delete(f);
  }, []);
  return { notices, unread };
}

// ── Volume (the PC's speakers, through the Windows host) ────────────────────

let volume: { level: number; muted: boolean } | null = null;
const volumeSubs = new Set<() => void>();
bridge.subscribe((m) => {
  if (m.type !== "volume") return;
  volume = { level: m.level, muted: m.muted };
  volumeSubs.forEach((f) => f());
});

function useVolume() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    volumeSubs.add(f);
    bridge.send({ type: "volume_get" });
    return () => void volumeSubs.delete(f);
  }, []);
  return volume;
}

// ── Tray pieces ─────────────────────────────────────────────────────────────

/** A taskbar icon that opens a small panel above it. */
function TrayButton({ label, icon, badge, children, onOpen, bringForward }: { label: string; icon: ReactNode; badge?: number; children: ReactNode; onOpen?: () => void; bringForward: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", off);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off); removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative h-full">
      <button
        onClick={() => { if (!open) { bringForward(); onOpen?.(); } setOpen(!open); }}
        aria-label={label} title={label} aria-expanded={open}
        className={cx("press relative grid h-full w-10 place-items-center rounded-lg text-dim hover:bg-white/10 hover:text-text", open && "bg-white/10 text-text")}
      >
        {icon}
        {!!badge && <span className="absolute right-1 top-1.5 grid min-w-4 place-items-center rounded-full bg-alarm px-1 text-[0.625rem] font-bold text-white">{badge > 9 ? "9+" : badge}</span>}
      </button>
      {open && <div className="glass animate-pop absolute bottom-full right-0 z-50 mb-2 w-80 rounded-2xl p-4 shadow-2xl shadow-black/60">{children}</div>}
    </div>
  );
}

export function NetworkTray({ connected, bringForward }: { connected: boolean; bringForward: () => void }) {
  const { probe } = useStation();
  const internet = probe?.targets.filter((t) => t.host !== "gateway") ?? [];
  const best = internet.filter((t) => t.pingMs !== null).map((t) => t.pingMs!).sort((a, b) => a - b)[0] ?? null;
  const wifi = probe?.linkType === "WIFI";
  const Icon = !connected ? WifiOff : wifi ? Wifi : probe?.linkType === "ETHERNET" ? Cable : Signal;
  return (
    <TrayButton label="Network" icon={<Icon className={cx("size-4", !connected && "text-warn")} />} bringForward={bringForward}>
      <p className="font-display text-base font-semibold">Network</p>
      <div className="mt-3 grid gap-2 text-sm">
        <Row k="Venue connection" v={connected ? "Connected" : "Reconnecting…"} tone={connected ? "text-good" : "text-warn"} />
        <Row k="Link" v={probe?.linkType ? `${probe.linkType === "WIFI" ? "Wi-Fi" : probe.linkType === "ETHERNET" ? "Ethernet (cable)" : "Other"}${probe.linkSpeedMbps ? ` · ${probe.linkSpeedMbps >= 1000 ? `${probe.linkSpeedMbps / 1000} Gbps` : `${probe.linkSpeedMbps} Mbps`}` : ""}` : "—"} />
        <Row k="Ping" v={best === null ? "—" : `${Math.round(best)} ms`} tone={best === null ? undefined : best < 40 ? "text-good" : best < 80 ? "text-warn" : "text-alarm"} />
        {internet.map((t) => <Row key={t.host} k={t.name} v={t.pingMs === null ? "no reply" : `${Math.round(t.pingMs)} ms${t.lossPct ? ` · ${Math.round(t.lossPct)}% loss` : ""}`} />)}
      </div>
    </TrayButton>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-dim">{k}</span>
      <span className={cx("tabular text-right", tone)}>{v}</span>
    </div>
  );
}

export function VolumeTray({ bringForward }: { bringForward: () => void }) {
  const v = useVolume();
  const [local, setLocal] = useState<number | null>(null);
  const level = local ?? v?.level ?? 50;
  const muted = v?.muted ?? false;
  const Icon = muted || level === 0 ? VolumeX : level < 50 ? Volume1 : Volume2;
  const set = (patch: { level?: number; muted?: boolean }) => bridge.send({ type: "volume_set", ...patch });
  return (
    <TrayButton label="Volume" icon={<Icon className="size-4" />} onOpen={() => bridge.send({ type: "volume_get" })} bringForward={bringForward}>
      <p className="font-display text-base font-semibold">Volume</p>
      {v === null ? (
        <p className="mt-3 text-sm text-dim">No speakers or headset found.</p>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => set({ muted: !muted })} aria-label={muted ? "Unmute" : "Mute"} className="press grid size-9 place-items-center rounded-lg hover:bg-white/10">
            <Icon className="size-5" />
          </button>
          <input
            type="range" min={0} max={100} value={level} aria-label="Volume"
            onChange={(e) => { const n = Number(e.target.value); setLocal(n); set({ level: n, ...(muted && n > 0 ? { muted: false } : {}) }); }}
            onPointerUp={() => setLocal(null)}
            className="h-2 flex-1 cursor-pointer accent-[var(--color-glow)]"
          />
          <span className="tabular w-9 text-right text-sm">{level}</span>
        </div>
      )}
    </TrayButton>
  );
}

export function NotificationsTray({ bringForward }: { bringForward: () => void }) {
  const { notices: list, unread: count } = useNotices();
  return (
    <TrayButton
      label="Notifications" badge={count}
      icon={<Bell className="size-4" />}
      onOpen={() => { unread = 0; changed(); }}
      bringForward={bringForward}
    >
      <div className="flex items-center justify-between">
        <p className="font-display text-base font-semibold">Notifications</p>
        {list.length > 0 && <button onClick={clearNotices} className="text-xs text-dim hover:text-text">Clear all</button>}
      </div>
      {list.length === 0 ? (
        <div className="grid place-items-center py-8 text-sm text-dim"><BellOff className="mb-2 size-6 opacity-60" />Nothing new</div>
      ) : (
        <ul className="mt-3 grid max-h-96 gap-2 overflow-y-auto pr-1">
          {list.map((n) => (
            <li key={n.id} className={cx("group relative rounded-xl border bg-deck-2/60 p-3", n.tone === "warn" ? "border-warn/40" : n.tone === "alarm" ? "border-alarm/50" : n.tone === "good" ? "border-good/30" : "border-rim")}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold">{n.title}</p>
                <span className="shrink-0 text-[0.6875rem] text-dim">{new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <p className="mt-1 text-sm text-dim">{n.text}</p>
              <button onClick={() => { notices = notices.filter((x) => x.id !== n.id); changed(); }} aria-label="Dismiss" className="absolute -right-1.5 -top-1.5 hidden size-5 place-items-center rounded-full bg-rim text-dim group-hover:grid hover:text-text">
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </TrayButton>
  );
}

/** Takes a screenshot (so does the Print Screen key, even in games); it's kept on the customer's account. */
export function ScreenshotButton() {
  const [flash, setFlash] = useState(false);
  useEffect(
    () =>
      bridge.subscribe((m) => {
        if (m.type !== "screenshot_taken") return;
        setFlash(true);
        setTimeout(() => setFlash(false), 180);
      }),
    [],
  );
  return (
    <>
      <button onClick={() => bridge.send({ type: "screenshot" })} aria-label="Screenshot (Print Screen)" title="Screenshot (Print Screen)" className="press grid h-full w-10 place-items-center rounded-lg text-dim hover:bg-white/10 hover:text-text">
        <Camera className="size-4" />
      </button>
      {flash && <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] bg-white/70" />}
    </>
  );
}

/** Windows 11's sliver at the far right: minimize every app and show the desktop. */
export function ShowDesktopButton() {
  return <button onClick={() => bridge.send({ type: "show_desktop" })} aria-label="Show desktop" title="Show desktop" className="ml-1 h-[70%] w-2 rounded-sm border-l border-rim hover:bg-white/15" />;
}
