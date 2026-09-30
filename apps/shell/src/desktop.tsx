import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AppWindow, Gamepad2, Globe, Layers, LifeBuoy, LogOut, Maximize2, Minimize2, Minus, Mouse, Signal, UtensilsCrossed, WifiOff, X } from "lucide-react";
import { bridge, type OpenWindow, type ShellMode, type ShellState, type WindowAction } from "./bridge";
import type { Strings } from "./i18n";
import { AppsScreen, ConnectivityScreen, GamesScreen, PeripheralsScreen, SupportScreen, type Notify } from "./screens";
import { FoodScreen } from "./food";
import { askConfirm } from "./confirm";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ── Host state: the real game/app windows and the Shell's mode ──────────────

let openWindows: OpenWindow[] = [];
let mode: ShellMode = "desktop";
const subs = new Set<() => void>();
bridge.subscribe((m) => {
  if (m.type === "windows") openWindows = m.items;
  else if (m.type === "shell_mode") {
    mode = m.mode;
    document.documentElement.dataset.mode = m.mode; // styles.css pauses the wallpaper animation in bar mode
  } else return;
  subs.forEach((f) => f());
});

export function useHost() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return { windows: openWindows, mode };
}

export const windowAction = (id: string, action: WindowAction) => bridge.send({ type: "window_action", id, action });

// ── Sections: the Shell's own "apps", each opens as a window ────────────────

export type Section = "games" | "platforms" | "apps" | "internet" | "food" | "connectivity" | "peripherals" | "support";
type SectionDef = { id: Section; label: string; icon: typeof Gamepad2; tint: string };
export const SECTIONS: SectionDef[] = [
  { id: "games", label: "Games", icon: Gamepad2, tint: "from-violet-500 to-fuchsia-500" },
  { id: "platforms", label: "Platforms", icon: Layers, tint: "from-sky-500 to-indigo-500" },
  { id: "apps", label: "Apps", icon: AppWindow, tint: "from-emerald-500 to-teal-500" },
  { id: "internet", label: "Internet", icon: Globe, tint: "from-cyan-500 to-blue-500" },
  { id: "food", label: "Food", icon: UtensilsCrossed, tint: "from-amber-500 to-orange-500" },
  { id: "connectivity", label: "Connection", icon: Signal, tint: "from-lime-500 to-green-500" },
  { id: "peripherals", label: "Peripherals", icon: Mouse, tint: "from-pink-500 to-rose-500" },
  { id: "support", label: "Support", icon: LifeBuoy, tint: "from-red-500 to-orange-500" },
];
const sectionDef = (id: Section) => SECTIONS.find((s) => s.id === id)!;

const SectionBody = memo(function SectionBody({ id, notify, station }: { id: Section; notify: Notify; station: string }) {
  switch (id) {
    case "games": return <GamesScreen notify={notify} />;
    case "platforms": return <AppsScreen kinds={["PLATFORM_LAUNCHER"]} title="Game platforms" hint="Sign in with your own account. You're signed out automatically when your session ends." notify={notify} />;
    case "apps": return <AppsScreen kinds={null} title="Apps" hint="Chat, music and tools." notify={notify} />;
    case "internet": return <AppsScreen kinds={["BROWSER"]} title="Internet" hint="Private browsing: nothing is kept after you log out." notify={notify} />;
    case "food": return <FoodScreen notify={notify} station={station} />;
    case "connectivity": return <ConnectivityScreen notify={notify} />;
    case "peripherals": return <PeripheralsScreen notify={notify} />;
    case "support": return <SupportScreen station={station} notify={notify} />;
  }
});

// ── In-Shell window manager ─────────────────────────────────────────────────

export interface Win { id: Section; x: number; y: number; w: number; h: number; z: number; min: boolean; max: boolean }

export function useWindowManager(area: () => DOMRect | undefined) {
  const [wins, setWins] = useState<Win[]>([]);
  const zTop = useRef(1);
  const top = wins.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0]?.id ?? null;

  const open = (id: Section) =>
    setWins((ws) => {
      const z = ++zTop.current;
      const found = ws.find((w) => w.id === id);
      if (found) return ws.map((w) => (w.id === id ? { ...w, min: false, z } : w));
      const r = area();
      const W = r?.width ?? 1200, H = r?.height ?? 700;
      const w = Math.round(W * 0.72), h = Math.round(H * 0.8);
      const n = ws.length % 6;
      return [...ws, { id, w, h, x: Math.round((W - w) / 2) + (n - 2) * 28, y: Math.max(8, Math.round((H - h) / 2) + (n - 2) * 24), z, min: false, max: false }];
    });
  const update = (id: Section, patch: Partial<Win>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const focus = (id: Section) => update(id, { z: ++zTop.current, min: false });
  const close = (id: Section) => setWins((ws) => ws.filter((w) => w.id !== id));
  /** Taskbar click: bring it up, or minimize it when it's already on top. */
  const toggle = (id: Section) => {
    const w = wins.find((x) => x.id === id);
    if (w && !w.min && top === id) update(id, { min: true });
    else open(id);
  };
  return { wins, top, open, update, focus, close, toggle };
}

type WM = ReturnType<typeof useWindowManager>;

function WindowFrame({ win, wm, active, area, children }: { win: Win; wm: WM; active: boolean; area: () => DOMRect | undefined; children: ReactNode }) {
  const def = sectionDef(win.id);
  const el = useRef<HTMLDivElement>(null);

  // Drag and resize move the element directly (no React re-render per pixel); the result is saved on release.
  const track = (e: ReactPointerEvent, kind: "move" | "size") => {
    if (win.max || e.button !== 0) return;
    e.preventDefault();
    wm.focus(win.id);
    const start = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    const r = area();
    const bounds = { W: r?.width ?? innerWidth, H: r?.height ?? innerHeight };
    let next = { x: win.x, y: win.y, w: win.w, h: win.h };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
      if (kind === "move") {
        next = { ...next, x: Math.min(Math.max(start.x + dx, 80 - start.w), bounds.W - 80), y: Math.min(Math.max(start.y + dy, 0), bounds.H - 48) };
      } else {
        next = { ...next, w: Math.max(420, Math.min(start.w + dx, bounds.W - start.x)), h: Math.max(300, Math.min(start.h + dy, bounds.H - start.y)) };
      }
      const s = el.current!.style;
      s.left = `${next.x}px`; s.top = `${next.y}px`; s.width = `${next.w}px`; s.height = `${next.h}px`;
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      wm.update(win.id, next);
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={el}
      role="dialog"
      aria-label={def.label}
      onPointerDownCapture={() => !active && wm.focus(win.id)}
      className={cx(
        "absolute flex flex-col overflow-hidden border bg-deck/95 shadow-2xl shadow-black/60 backdrop-blur-xl",
        win.max ? "rounded-none border-transparent" : "animate-pop rounded-2xl",
        active ? "border-glow/40" : "border-rim",
        win.min && "hidden",
      )}
      style={win.max ? { inset: 0, zIndex: win.z } : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
    >
      <div
        onPointerDown={(e) => track(e, "move")}
        onDoubleClick={() => wm.update(win.id, { max: !win.max })}
        className={cx("flex h-11 shrink-0 cursor-default items-center gap-3 border-b px-4 select-none", active ? "border-rim bg-deck-2/80" : "border-rim/60 bg-deck/60")}
      >
        <span className={cx("grid size-6 place-items-center rounded-md bg-gradient-to-br text-white", def.tint)}><def.icon className="size-3.5" /></span>
        <span className={cx("font-display text-sm tracking-wide", active ? "text-text" : "text-dim")}>{def.label}</span>
        <div className="ml-auto flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <ChromeButton label="Minimize" onClick={() => wm.update(win.id, { min: true })}><Minus className="size-4" /></ChromeButton>
          <ChromeButton label={win.max ? "Restore" : "Maximize"} onClick={() => wm.update(win.id, { max: !win.max })}>
            {win.max ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </ChromeButton>
          <ChromeButton label="Close" danger onClick={() => wm.close(win.id)}><X className="size-4" /></ChromeButton>
        </div>
      </div>
      <div className="@container relative min-h-0 flex-1 overflow-y-auto p-8">{children}</div>
      {!win.max && <div onPointerDown={(e) => track(e, "size")} className="absolute right-0 bottom-0 size-5 cursor-nwse-resize" aria-hidden />}
    </div>
  );
}

function ChromeButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cx("grid size-8 place-items-center rounded-lg text-dim transition-colors", danger ? "hover:bg-alarm hover:text-white" : "hover:bg-rim/60 hover:text-text")}>
      {children}
    </button>
  );
}

/** The desktop: wallpaper, section icons, the home widget, and the open section windows. */
export function Desktop({ wm, areaRef, home, notify, station }: { wm: WM; areaRef: React.RefObject<HTMLDivElement | null>; home: ReactNode; notify: Notify; station: string }) {
  const area = () => areaRef.current?.getBoundingClientRect();
  return (
    <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-0 grid grid-cols-[auto_1fr]">
        <nav aria-label="Desktop" className="flex h-full flex-col flex-wrap content-start gap-2 p-5">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => wm.open(s.id)} className="press group flex w-24 flex-col items-center gap-2 rounded-2xl p-3 text-center hover:bg-white/5 focus-visible:bg-white/10">
              <span className={cx("grid size-14 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg shadow-black/40 transition-transform group-hover:-translate-y-0.5", s.tint)}>
                <s.icon className="size-7" />
              </span>
              <span className="text-sm text-text/90 drop-shadow">{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0 overflow-y-auto p-10">{home}</div>
      </div>
      {wm.wins.map((w) => (
        <WindowFrame key={w.id} win={w} wm={wm} active={wm.top === w.id} area={area}>
          <SectionBody id={w.id} notify={notify} station={station} />
        </WindowFrame>
      ))}
    </div>
  );
}

// ── Taskbar ─────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

function useNow(ms: number) {
  const [now, set] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Ticks on its own, so the rest of the taskbar and desktop don't re-render every second. */
function TimeLeftPill({ state, t }: { state: ShellState; t: Strings }) {
  const now = useNow(1000) + state.serverOffsetMs;
  const s = state.session!;
  const remaining = s.expiresAt ? new Date(s.expiresAt).getTime() - now : null;
  const low = remaining !== null && remaining <= 5 * 60_000;
  const last = remaining !== null && remaining <= 60_000;
  return (
    <div className={cx("flex h-[70%] items-center gap-2 rounded-lg border px-3", last ? "border-alarm/60 bg-alarm/15 text-alarm" : low ? "border-warn/50 bg-warn/10 text-warn" : "border-rim bg-deck-2/70")}>
      <span className="text-[0.625rem] uppercase tracking-[0.18em] text-dim">{remaining === null ? t.openSession : t.timeLeft}</span>
      <span className={cx("tabular font-mono text-base font-semibold", last && "pulse")}>{remaining === null ? hms(now - new Date(s.startedAt).getTime()) : hms(remaining)}</span>
    </div>
  );
}

function Clock() {
  const d = new Date(useNow(10_000));
  return <span className="tabular text-sm text-dim">{pad(d.getHours())}:{pad(d.getMinutes())}</span>;
}

function TaskButton({ active, minimized, title, onClick, onContext, children }: { active: boolean; minimized?: boolean; title: string; onClick: () => void; onContext?: (e: React.MouseEvent) => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContext}
      title={title}
      className={cx("press relative flex h-[80%] max-w-52 min-w-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors", active ? "bg-white/10 text-text" : "text-dim hover:bg-white/5 hover:text-text")}
    >
      {children}
      <span className="truncate">{title}</span>
      <span className={cx("absolute bottom-0.5 left-1/2 h-0.5 -translate-x-1/2 rounded-full transition-all", active ? "w-5 bg-glow" : minimized ? "w-1.5 bg-dim" : "w-2.5 bg-dim")} />
    </button>
  );
}

export function Taskbar({ state, t, wm, onStart, startOpen, className }: { state: ShellState; t: Strings; wm: WM; onStart: () => void; startOpen: boolean; className?: string }) {
  const { windows, mode } = useHost();
  const [menu, setMenu] = useState<{ win: OpenWindow; x: number } | null>(null);
  const s = state.session!;
  const inBar = mode === "bar";
  /** In bar mode a game/app is in front: anything about the Shell brings the desktop back first. */
  const toDesktop = () => inBar && bridge.send({ type: "desktop_show" });

  return (
    <footer className={cx("glass relative z-40 flex shrink-0 items-center gap-1.5 border-x-0 border-b-0 px-2", className)}>
      <button
        onClick={() => { toDesktop(); onStart(); }}
        aria-label="Start" aria-expanded={startOpen}
        className={cx("press grid aspect-square h-[80%] place-items-center rounded-lg", startOpen ? "bg-white/15" : "hover:bg-white/10")}
      >
        <span className="brand-gradient grid size-[70%] place-items-center rounded-md font-display font-bold text-void">{state.venue.name.slice(0, 1)}</span>
      </button>
      <span className="mx-1 h-1/2 w-px bg-rim" />

      {wm.wins.map((w) => {
        const d = sectionDef(w.id);
        return (
          <TaskButton key={w.id} title={d.label} active={!inBar && wm.top === w.id} minimized={w.min} onClick={() => { if (inBar) { toDesktop(); wm.open(w.id); } else wm.toggle(w.id); }}>
            <d.icon className="size-4 shrink-0" />
          </TaskButton>
        );
      })}
      {wm.wins.length > 0 && windows.length > 0 && <span className="mx-1 h-1/2 w-px bg-rim" />}
      {windows.map((w) => (
        <TaskButton
          key={w.id} title={w.title} active={w.active} minimized={w.minimized}
          onClick={() => windowAction(w.id, w.active && !w.minimized ? "minimize" : "focus")}
          // The menu opens above the taskbar, which in bar mode is outside the Shell's window: bring the desktop back first.
          onContext={(e) => { e.preventDefault(); toDesktop(); setMenu({ win: w, x: e.clientX }); }}
        >
          {w.icon ? <img src={w.icon} alt="" className="size-4 shrink-0" /> : <AppWindow className="size-4 shrink-0" />}
        </TaskButton>
      ))}

      <div className="ml-auto flex h-full items-center gap-3 pr-2">
        {!state.connected && <WifiOff className="size-4 text-warn" aria-label={t.offline} />}
        <TimeLeftPill state={state} t={t} />
        <Clock />
        <span className="flex items-center gap-2">
          <span className="brand-gradient grid size-7 place-items-center rounded-full font-display text-sm font-bold text-void">{s.customerName.slice(0, 1)}</span>
          <span className="hidden text-sm xl:inline">{s.customerName}</span>
        </span>
        <button
          onClick={async () => { toDesktop(); if (await askConfirm(t.logoutConfirm, { ok: t.logout })) bridge.send({ type: "logout" }); }}
          aria-label={t.logout} title={t.logout}
          className="press grid size-9 place-items-center rounded-lg text-dim hover:bg-alarm/15 hover:text-alarm"
        >
          <LogOut className="size-4" />
        </button>
      </div>

      {menu && <WindowMenu win={menu.win} x={menu.x} onClose={() => setMenu(null)} />}
    </footer>
  );
}

/** Right-click on a game/app in the taskbar. */
function WindowMenu({ win, x, onClose }: { win: OpenWindow; x: number; onClose: () => void }) {
  useEffect(() => {
    const off = () => onClose();
    addEventListener("pointerdown", off);
    addEventListener("blur", off);
    return () => { removeEventListener("pointerdown", off); removeEventListener("blur", off); };
  }, [onClose]);
  const item = (label: string, action: WindowAction, icon: ReactNode, danger = false) => (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => { windowAction(win.id, action); onClose(); }}
      className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", danger ? "text-alarm hover:bg-alarm/15" : "hover:bg-white/10")}
    >
      {icon} {label}
    </button>
  );
  return (
    <div className="glass animate-pop absolute bottom-full mb-2 w-56 rounded-xl p-1.5 shadow-2xl" style={{ left: Math.max(8, x - 20) }}>
      <p className="truncate px-3 py-1.5 text-xs text-dim">{win.title}</p>
      {win.maximized ? item("Restore", "restore", <Minimize2 className="size-4" />) : item("Maximize", "maximize", <Maximize2 className="size-4" />)}
      {item("Minimize", "minimize", <Minus className="size-4" />)}
      {item("Close", "close", <X className="size-4" />, true)}
    </div>
  );
}

export function StartMenu({ state, t, onOpen, onClose }: { state: ShellState; t: Strings; onOpen: (id: Section) => void; onClose: () => void }) {
  const s = state.session!;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-30" onPointerDown={onClose} />
      <div className="glass animate-pop absolute bottom-[calc(max(44px,5vh)+0.75rem)] left-3 z-40 w-[28rem] rounded-2xl p-5 shadow-2xl shadow-black/60">
        <div className="flex items-center gap-3">
          <span className="brand-gradient grid size-11 place-items-center rounded-full font-display text-lg font-bold text-void">{s.customerName.slice(0, 1)}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{s.customerName}</p>
            <p className="truncate text-xs text-dim">{s.tier ?? state.venue.name} · {t.station} {state.station.name}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2">
          {SECTIONS.map((x) => (
            <button key={x.id} onClick={() => { onOpen(x.id); onClose(); }} className="press flex flex-col items-center gap-2 rounded-xl p-3 hover:bg-white/10">
              <span className={cx("grid size-11 place-items-center rounded-xl bg-gradient-to-br text-white", x.tint)}><x.icon className="size-5" /></span>
              <span className="text-xs">{x.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end border-t border-rim pt-3">
          <button
            onClick={async () => { onClose(); if (await askConfirm(t.logoutConfirm, { ok: t.logout })) bridge.send({ type: "logout" }); }}
            className="press flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-dim hover:bg-alarm/15 hover:text-alarm"
          >
            <LogOut className="size-4" /> {t.logout}
          </button>
        </div>
      </div>
    </>
  );
}
