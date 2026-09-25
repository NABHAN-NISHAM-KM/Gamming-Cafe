// The Shell never talks to the network (CSP: connect-src 'none'). Everything
// goes through the Windows host → named pipe → ArenaOS agent service, which
// holds the device identity and verifies every server command.

export interface Venue {
  name: string;
  branchName: string;
  logoUrl: string | null;
}

export interface ShellSession {
  id: string;
  customerName: string;
  tier: string | null;
  startedAt: string;
  expiresAt: string | null; // null = open (pay at the end)
  warningMinutes: number[];
}

export interface ShellState {
  connected: boolean; // agent ↔ server link
  station: { name: string };
  venue: Venue;
  session: ShellSession | null;
  serverOffsetMs: number; // serverNow − localNow
  safeMode: boolean;
}

export interface ShellGame {
  id: string;
  title: string;
  categories: string[];
  coverUrl: string | null;
  minAge: number | null;
  featured: boolean;
  launcher: string | null;
  installed: boolean;
  updateRequired: boolean;
  /** above the signed-in customer's age */
  locked: boolean;
}
export interface ShellAppItem {
  id: string;
  name: string;
  kind: string;
}
export interface PointerPreset {
  id: string;
  name: string;
  mouseSpeed?: number | null;
  enhancePointerPrecision?: boolean | null;
}
export interface Probe {
  targets: Array<{ name: string; host: string; pingMs: number | null; lossPct: number }>;
  linkType?: string | null;
  linkSpeedMbps?: number | null;
  dnsMs?: number | null;
}
export interface Peripheral {
  type: string;
  name: string;
  vendor?: string | null;
}
export type RequestResult = { requestId: string; ok: boolean; error?: string; message?: string };

export type HostMessage =
  | ({ type: "state" } & ShellState)
  | { type: "login_result"; requestId: string; ok: boolean; error?: string; message?: string }
  | { type: "message"; title: string; text: string }
  | { type: "library"; games: ShellGame[]; apps: ShellAppItem[]; presets: PointerPreset[] }
  | ({ type: "launch_result" | "help_result" | "repair_result" } & RequestResult)
  | { type: "playing"; gameId: string | null; title: string | null }
  | { type: "network"; probe: Probe }
  | { type: "peripherals"; items: Peripheral[] }
  | { type: "pointer"; mouseSpeed: number; enhancePointerPrecision: boolean };

export type HelpTopic = "general" | "game" | "peripheral" | "network" | "payment";
export type SelfRepair = "FLUSH_DNS" | "RESTART_AUDIO" | "RESTART_SHELL";

export type ShellMessage =
  | { type: "ready" }
  | { type: "login"; requestId: string; username: string; secret: string }
  | { type: "logout" }
  | { type: "launch"; requestId: string; gameId: string }
  | { type: "launch_app"; requestId: string; appId: string }
  | { type: "help"; requestId: string; topic: HelpTopic; note?: string }
  | { type: "repair"; requestId: string; action: SelfRepair }
  | { type: "pointer_get" }
  | { type: "pointer_apply"; mouseSpeed?: number; enhancePointerPrecision?: boolean };

type Listener = (m: HostMessage) => void;

interface Bridge {
  send(m: ShellMessage): void;
  subscribe(fn: Listener): () => void;
  readonly mock: boolean;
}

declare global {
  interface Window {
    chrome?: { webview?: { postMessage(m: unknown): void; addEventListener(t: "message", fn: (e: { data: unknown }) => void): void; removeEventListener(t: "message", fn: (e: { data: unknown }) => void): void } };
  }
}

function webviewBridge(): Bridge {
  const wv = window.chrome!.webview!;
  return {
    mock: false,
    send: (m) => wv.postMessage(m),
    subscribe(fn) {
      const h = (e: { data: unknown }) => fn(e.data as HostMessage);
      wv.addEventListener("message", h);
      return () => wv.removeEventListener("message", h);
    },
  };
}

// ── preview data (browser only) ─────────────────────────────────────────────

const g = (n: number, title: string, categories: string[], minAge: number, o: Partial<ShellGame> = {}): ShellGame => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title,
  categories,
  minAge,
  coverUrl: null,
  featured: false,
  launcher: "STEAM",
  installed: true,
  updateRequired: false,
  locked: false,
  ...o,
});
const MOCK_GAMES: ShellGame[] = [
  g(1, "Counter-Strike 2", ["FPS", "COMPETITIVE"], 18, { featured: true }),
  g(2, "VALORANT", ["FPS", "COMPETITIVE"], 16, { featured: true, launcher: "RIOT" }),
  g(3, "Fortnite", ["BATTLE_ROYALE", "KIDS"], 12, { featured: true, launcher: "EPIC" }),
  g(4, "EA SPORTS FC 25", ["SPORTS"], 3, { featured: true }),
  g(5, "Dota 2", ["MOBA", "COMPETITIVE"], 12),
  g(6, "League of Legends", ["MOBA", "COMPETITIVE"], 12, { launcher: "RIOT" }),
  g(7, "Apex Legends", ["BATTLE_ROYALE", "FPS"], 16, { updateRequired: true }),
  g(8, "PUBG: Battlegrounds", ["BATTLE_ROYALE", "FPS"], 18),
  g(9, "Rocket League", ["SPORTS", "RACING", "KIDS"], 3, { launcher: "EPIC" }),
  g(10, "Marvel Rivals", ["FPS", "COMPETITIVE"], 12),
  g(11, "Minecraft", ["CASUAL", "KIDS"], 7, { launcher: null }),
  g(12, "Elden Ring", ["RPG", "STORY"], 16, { installed: false }),
  g(13, "Grand Theft Auto V", ["STORY"], 18),
  g(14, "Rust", ["SIMULATION"], 18, { installed: false }),
];
function mockLibrary(age: number | null) {
  return {
    games: MOCK_GAMES.map((x) => ({ ...x, locked: age !== null && x.minAge !== null && age < x.minAge })),
    apps: [
      { id: "a1", name: "Google Chrome", kind: "BROWSER" },
      { id: "a2", name: "Microsoft Edge", kind: "BROWSER" },
      { id: "a3", name: "Steam", kind: "PLATFORM_LAUNCHER" },
      { id: "a4", name: "Epic Games", kind: "PLATFORM_LAUNCHER" },
      { id: "a5", name: "Riot Client", kind: "PLATFORM_LAUNCHER" },
      { id: "a6", name: "Battle.net", kind: "PLATFORM_LAUNCHER" },
      { id: "a7", name: "Discord", kind: "COMMUNICATION" },
      { id: "a8", name: "Notepad", kind: "UTILITY" },
    ],
    presets: [
      { id: "p1", name: "Windows default", mouseSpeed: 10, enhancePointerPrecision: true },
      { id: "p2", name: "FPS — low sensitivity, raw", mouseSpeed: 6, enhancePointerPrecision: false },
      { id: "p3", name: "MOBA — fast", mouseSpeed: 14, enhancePointerPrecision: true },
    ],
  };
}
const MOCK_PERIPHERALS: Peripheral[] = [
  { type: "MOUSE", name: "Razer DeathAdder V3", vendor: "Razer" },
  { type: "KEYBOARD", name: "Logitech G915 TKL", vendor: "Logitech" },
  { type: "HEADSET", name: "HyperX Cloud II", vendor: "HyperX" },
  { type: "CONTROLLER", name: "Xbox Wireless Controller", vendor: "Microsoft" },
];
function mockProbe(): Probe {
  const j = (base: number) => Math.round((base + Math.random() * base * 0.3) * 10) / 10;
  return {
    targets: [
      { name: "Router", host: "gateway", pingMs: j(0.8), lossPct: 0 },
      { name: "Cloudflare", host: "1.1.1.1", pingMs: j(4), lossPct: 0 },
      { name: "Google DNS", host: "8.8.8.8", pingMs: j(6), lossPct: 0 },
      { name: "Valve (Dubai)", host: "155.133.x.x", pingMs: j(9), lossPct: 0 },
    ],
    linkType: "ETHERNET",
    linkSpeedMbps: 2500,
    dnsMs: j(11),
  };
}

/**
 * Browser preview without Windows: a fake agent so the UI can be designed and
 * reviewed. ?session=90 starts logged in with 90 seconds left (expiry demo);
 * ?age=13 signs in as a 13-year-old (age-locked games).
 */
function mockBridge(): Bridge {
  const listeners = new Set<Listener>();
  const params = new URLSearchParams(location.search);
  const emit = (m: HostMessage) => setTimeout(() => listeners.forEach((l) => l(m)), 0);
  const startSeconds = Number(params.get("session") ?? 0);
  const age = Number(params.get("age") ?? 27);
  const newSession = (seconds: number): ShellSession => ({
    id: "mock", customerName: age < 18 ? "Sara" : "Ahmed", tier: "Gold", startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), warningMinutes: [30, 15, 10, 5, 1],
  });
  let state: ShellState = {
    connected: true,
    station: { name: "PC-07" },
    venue: { name: "Demo Arena", branchName: "Dubai Marina", logoUrl: null },
    session: startSeconds ? newSession(startSeconds) : null,
    serverOffsetMs: 0,
    safeMode: true,
  };
  let pointer = { mouseSpeed: 10, enhancePointerPrecision: true };
  const push = () => emit({ type: "state", ...state });
  const pushLibrary = () => emit({ type: "library", ...mockLibrary(state.session ? age : null) });
  const pushExtras = () => {
    pushLibrary();
    emit({ type: "peripherals", items: MOCK_PERIPHERALS });
    emit({ type: "network", probe: mockProbe() });
    emit({ type: "playing", gameId: null, title: null });
  };
  setInterval(() => emit({ type: "network", probe: mockProbe() }), 10_000);
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const armExpiry = () => {
    clearTimeout(expiry);
    if (state.session?.expiresAt)
      expiry = setTimeout(() => {
        state = { ...state, session: null };
        push();
        pushLibrary();
      }, new Date(state.session.expiresAt).getTime() - Date.now() + 1500);
  };
  armExpiry();
  return {
    mock: true,
    send(m) {
      switch (m.type) {
        case "ready":
          push();
          pushExtras();
          break;
        case "logout":
          state = { ...state, session: null };
          push();
          pushLibrary();
          break;
        case "login": {
          const ok = ["ahmed", "sara"].includes(m.username.toLowerCase()) && ["ahmed123", "sara1234", "1234"].includes(m.secret);
          setTimeout(() => {
            emit(ok ? { type: "login_result", requestId: m.requestId, ok } : { type: "login_result", requestId: m.requestId, ok: false, error: "invalid_credentials", message: "Wrong username or password." });
            if (ok) {
              state = { ...state, session: newSession(2 * 3600) };
              armExpiry();
              push();
              pushLibrary();
            }
          }, 600);
          break;
        }
        case "launch":
        case "launch_app": {
          const game = m.type === "launch" ? MOCK_GAMES.find((x) => x.id === m.gameId) : undefined;
          setTimeout(() => {
            emit({ type: "launch_result", requestId: m.requestId, ok: true });
            if (game) setTimeout(() => emit({ type: "playing", gameId: game.id, title: game.title }), 1500);
          }, 400);
          break;
        }
        case "help":
          setTimeout(() => emit({ type: "help_result", requestId: m.requestId, ok: true, message: "Staff have been notified." }), 500);
          break;
        case "repair":
          setTimeout(() => emit({ type: "repair_result", requestId: m.requestId, ok: true, message: "Done." }), 900);
          break;
        case "pointer_get":
          emit({ type: "pointer", ...pointer });
          break;
        case "pointer_apply":
          pointer = { mouseSpeed: m.mouseSpeed ?? pointer.mouseSpeed, enhancePointerPrecision: m.enhancePointerPrecision ?? pointer.enhancePointerPrecision };
          emit({ type: "pointer", ...pointer });
          break;
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const bridge: Bridge = window.chrome?.webview ? webviewBridge() : mockBridge();

/** Sends a request and resolves with the matching *_result (or a timeout failure). */
export function request(m: Extract<ShellMessage, { requestId: string }>, resultType: "launch_result" | "help_result" | "repair_result" | "login_result", timeoutMs = 15_000): Promise<RequestResult> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      off();
      resolve({ requestId: m.requestId, ok: false, error: "timeout", message: "No answer from this PC. Please ask staff." });
    }, timeoutMs);
    const off = bridge.subscribe((msg) => {
      if (msg.type === resultType && msg.requestId === m.requestId) {
        clearTimeout(t);
        off();
        resolve(msg);
      }
    });
    bridge.send(m);
  });
}
