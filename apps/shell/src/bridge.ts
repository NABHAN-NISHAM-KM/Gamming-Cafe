// The Shell never talks to the network (CSP: connect-src 'none'). Everything
// goes through the Windows host → named pipe → ArenaOS agent service, which
// holds the device identity and verifies every server command.

export interface Venue {
  name: string;
  branchName: string;
  logoUrl: string | null;
  /** The venue's own desktop background (admin: Settings → Gaming Shell look). */
  wallpaperUrl?: string | null;
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

export interface SeatMenu {
  currency: string;
  canPayWithWallet: boolean;
  categories: Array<{
    id: string;
    name: string;
    products: Array<{ id: string; name: string; description: string | null; price: string; available: boolean; modifierGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; modifiers: Array<{ id: string; name: string; priceDelta: string }> }> }>;
  }>;
}
export interface OrderLine {
  productId: string;
  quantity: number;
  modifierIds: string[];
}

/** The real icon / cover of a library game or app, found on this PC by the Windows host. */
export interface Art {
  id: string;
  icon: string | null;
  cover: string | null;
}

/** A game/app window open on this PC (from the Windows host; id = its window handle). */
export interface OpenWindow {
  id: string;
  title: string;
  icon: string | null; // data: URL
  minimized: boolean;
  maximized: boolean;
  active: boolean;
}
export type WindowAction = "focus" | "minimize" | "maximize" | "restore" | "close" | "snap_left" | "snap_right";
/** desktop: the Shell is in front. bar: a game/app is in front and the Shell is the desktop behind it. */
export type ShellMode = "desktop" | "bar";

/** "Add time": what the signed-in customer can buy for their running session. */
export interface TimeOffers {
  requestId: string;
  ok: boolean;
  error?: string;
  message?: string;
  currency: string;
  wallet: string | null; // null = wallet on hold
  savedMinutes: number;
  savedSteps: Array<30 | 60 | 120>;
  packages: Array<{ id: string; name: string; minutes: number; bonusMinutes: number; price: string }>;
}

export type HostMessage =
  | ({ type: "state" } & ShellState)
  | { type: "login_result"; requestId: string; ok: boolean; error?: string; message?: string }
  | { type: "message"; title: string; text: string }
  | { type: "library"; games: ShellGame[]; apps: ShellAppItem[]; presets: PointerPreset[] }
  | ({ type: "launch_result" | "help_result" | "repair_result" | "staff_exit_result" } & RequestResult)
  | { type: "playing"; gameId: string | null; title: string | null }
  | { type: "network"; probe: Probe }
  | { type: "peripherals"; items: Peripheral[] }
  | { type: "pointer"; mouseSpeed: number; enhancePointerPrecision: boolean }
  | { type: "menu"; requestId: string; menu: SeatMenu | null; error?: string }
  | { type: "order_result"; requestId: string; ok: boolean; orderId?: string; number?: string; total?: string; currency?: string; error?: string; message?: string }
  | { type: "order_status"; orderId: string; number: string; status: "PREPARING" | "READY" | "SERVED"; message: string }
  | { type: "print_quote"; quote: PrintQuote }
  | { type: "windows"; items: OpenWindow[] }
  | { type: "art"; items: Art[] }
  | { type: "volume"; level: number; muted: boolean }
  | ({ type: "time_offers" } & TimeOffers)
  | ({ type: "buy_time_result" } & RequestResult)
  | ({ type: "qr_login_code"; code?: string; url?: string; expiresAt?: string } & RequestResult)
  | { type: "screenshot_taken" }
  | { type: "screenshot_result"; id?: string; ok: boolean; message?: string }
  | { type: "shell_mode"; mode: ShellMode }
  | { type: "print_status"; jobKey: string; status: "WAITING_STAFF" | "PRINTING" | "COMPLETED" | "CANCELLED" | "FAILED"; message: string };

/** A paused print job the customer is asked to approve (priced by the venue). */
export interface PrintQuote {
  jobKey: string;
  jobId: string;
  document: string | null;
  pages: number;
  copies: number;
  color: boolean;
  unitPrice: string;
  total: string;
  currency: string;
  canPayWithWallet: boolean;
  needsStaff: boolean;
  expiresAt: string;
  notice?: string | null;
}

export type HelpTopic = "general" | "game" | "peripheral" | "network" | "payment";
export type SelfRepair = "FLUSH_DNS" | "RESTART_AUDIO" | "RESTART_SHELL";

export type ShellMessage =
  | { type: "ready" }
  | { type: "login"; requestId: string; username: string; secret: string }
  | { type: "logout" }
  | { type: "feedback"; rating: number; comment: string | null }
  | { type: "launch"; requestId: string; gameId: string }
  | { type: "launch_app"; requestId: string; appId: string }
  | { type: "help"; requestId: string; topic: HelpTopic; note?: string }
  | { type: "repair"; requestId: string; action: SelfRepair }
  | { type: "pointer_get" }
  | { type: "pointer_apply"; mouseSpeed?: number; enhancePointerPrecision?: boolean }
  | { type: "menu_request"; requestId: string }
  | { type: "place_order"; requestId: string; lines: OrderLine[]; notes?: string; payWith: "BILL" | "WALLET" }
  | { type: "print_confirm"; jobKey: string; payWith: "BILL" | "WALLET" }
  | { type: "print_cancel"; jobKey: string }
  | { type: "staff_exit"; requestId: string; username: string; password: string }
  | { type: "window_action"; id: string; action: WindowAction }
  | { type: "desktop_show" }
  | { type: "show_desktop" }
  | { type: "volume_get" }
  | { type: "volume_set"; level?: number; muted?: boolean }
  | { type: "time_offers"; requestId: string }
  | { type: "qr_login"; requestId: string }
  | { type: "screenshot" }
  | { type: "buy_time"; requestId: string; packageId?: string; savedMinutes?: 30 | 60 | 120 };

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
const mg = (id: string, name: string, minSelect: number, maxSelect: number, mods: Array<[string, string, string]>) => ({ id, name, minSelect, maxSelect, modifiers: mods.map(([mid, n, d]) => ({ id: mid, name: n, priceDelta: d })) });
const EXTRAS = mg("g-extras", "Extras", 0, 3, [["m-cheese", "Cheese", "3.00"], ["m-bacon", "Bacon", "5.00"], ["m-jal", "Jalapeños", "2.00"]]);
const SIZE = mg("g-size", "Size", 1, 1, [["m-reg", "Regular", "0.00"], ["m-lg", "Large", "5.00"]]);
const pr = (id: string, name: string, price: string, groups: SeatMenu["categories"][number]["products"][number]["modifierGroups"] = [], description: string | null = null) => ({ id, name, price, description, available: true, modifierGroups: groups });
const MOCK_MENU: SeatMenu = {
  currency: "AED",
  canPayWithWallet: true,
  categories: [
    { id: "c1", name: "Burgers", products: [pr("p1", "Classic smash burger", "32.00", [EXTRAS], "Double smashed patty, cheddar, pickles"), pr("p2", "Crispy chicken burger", "29.00", [EXTRAS]), pr("p3", "Halloumi burger", "27.00", [EXTRAS])] },
    { id: "c2", name: "Snacks", products: [pr("p4", "Fries", "12.00", [SIZE]), pr("p5", "Chicken wings (8)", "26.00"), pr("p6", "Loaded nachos", "24.00")] },
    { id: "c3", name: "Drinks", products: [pr("p7", "Cola (can)", "8.00"), pr("p8", "Energy drink", "14.00"), pr("p9", "Oreo milkshake", "22.00", [SIZE])] },
  ],
};

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
/** Demo build: the Shell runs as one station of the shared demo venue (@arena/demo). */
interface DemoLink {
  stationName: string;
  venue: { name: string; branchName: string };
  session(): { id: string; customerName: string; tier: string | null; startedAt: string; expiresAt: string | null; customerAge: number | null } | null;
  login(u: string, s: string): { ok: true } | { ok: false; error: string; message: string };
  logout(): void;
  menu(): SeatMenu;
  order(lines: OrderLine[], notes: string | undefined, payWith: "BILL" | "WALLET"): Promise<{ ok: boolean; orderId?: string; number?: string; total?: string; currency?: string; error?: string; message?: string }>;
  help(topic: string): void;
  onChange(fn: (e: { kind: "state" } | { kind: "message"; title: string; text: string } | { kind: "order"; orderId: string; number: string; status: string }) => void): () => void;
}

function mockBridge(): Bridge {
  const listeners = new Set<Listener>();
  const params = new URLSearchParams(location.search);
  const emit = (m: HostMessage) => setTimeout(() => listeners.forEach((l) => l(m)), 0);
  const demo = (window as unknown as { __ARENA_DEMO__?: { shell(n: string): DemoLink } }).__ARENA_DEMO__;
  const link = demo?.shell(params.get("station") ?? "PC-01") ?? null;
  const startSeconds = Number(params.get("session") ?? 0);
  let age = Number(params.get("age") ?? 27);
  const fromLink = (): ShellSession | null => {
    const s = link?.session();
    if (!s) return null;
    age = s.customerAge ?? 25;
    return { id: s.id, customerName: s.customerName, tier: s.tier, startedAt: s.startedAt, expiresAt: s.expiresAt, warningMinutes: [30, 15, 10, 5, 1] };
  };
  const newSession = (seconds: number): ShellSession => ({
    id: "mock", customerName: age < 18 ? "Sara" : "Ahmed", tier: "Gold", startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), warningMinutes: [30, 15, 10, 5, 1],
  });
  let state: ShellState = {
    connected: true,
    station: { name: link?.stationName ?? "PC-07" },
    venue: { name: link?.venue.name ?? "Demo Arena", branchName: link?.venue.branchName ?? "Dubai Marina", logoUrl: null },
    session: link ? fromLink() : startSeconds ? newSession(startSeconds) : null,
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
  if (!link) armExpiry();
  // Venue → station: staff start/extend/end sessions, send messages, kitchen progress.
  link?.onChange((ev) => {
    if (ev.kind === "state") {
      const before = state.session?.id ?? null;
      state = { ...state, session: fromLink() };
      push();
      if (before !== (state.session?.id ?? null)) pushLibrary();
    } else if (ev.kind === "message") emit({ type: "message", title: ev.title, text: ev.text });
    else if (ev.kind === "order") {
      const text = ev.status === "PREPARING" ? "Your order is being prepared" : ev.status === "READY" ? "Your order is ready — it's on its way to you" : "Enjoy your food!";
      emit({ type: "order_status", orderId: ev.orderId, number: ev.number, status: ev.status as "PREPARING" | "READY" | "SERVED", message: text });
    }
  });
  // Preview printing: ?print=1 (or window.arenaMockPrint() in the console) pops a quote as if a job was sent to the printer.
  const mockPrint = (color = false) => {
    const pages = 4;
    emit({ type: "print_quote", quote: { jobKey: `${Math.floor(Math.random() * 1e5)}:${Date.now()}`, jobId: crypto.randomUUID(), document: "Boarding pass.pdf", pages, copies: 1, color, unitPrice: color ? "2.00" : "0.50", total: (pages * (color ? 2 : 0.5)).toFixed(2), currency: "AED", canPayWithWallet: age >= 18, needsStaff: false, expiresAt: new Date(Date.now() + 180_000).toISOString() } });
  };
  (window as unknown as { arenaMockPrint: typeof mockPrint }).arenaMockPrint = mockPrint;
  // Preview "windows": launching a game/app opens a pretend window the taskbar can switch, minimize and close.
  let mockWindows: OpenWindow[] = [];
  let mockVolume = { level: 60, muted: false };
  const pushWindows = () => emit({ type: "windows", items: mockWindows });
  const focusMock = (id: string | null) => {
    mockWindows = mockWindows.map((w) => ({ ...w, active: w.id === id, minimized: w.id === id ? false : w.minimized }));
    pushWindows();
    emit({ type: "shell_mode", mode: id ? "bar" : "desktop" });
  };
  if (params.get("print")) setTimeout(() => mockPrint(params.get("print") === "color"), 2500);
  return {
    mock: true,
    send(m) {
      switch (m.type) {
        case "ready":
          push();
          pushExtras();
          break;
        case "logout":
          if (link) {
            link.logout();
            state = { ...state, session: fromLink() };
            push();
            pushLibrary();
            break;
          }
          state = { ...state, session: null };
          push();
          pushLibrary();
          break;
        case "login": {
          if (link) {
            const r = link.login(m.username, m.secret);
            setTimeout(() => {
              emit(r.ok ? { type: "login_result", requestId: m.requestId, ok: true } : { type: "login_result", requestId: m.requestId, ok: false, error: r.error, message: r.message });
              if (r.ok) {
                state = { ...state, session: fromLink() };
                push();
                pushLibrary();
              }
            }, 500);
            break;
          }
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
          const app = m.type === "launch_app" ? mockLibrary(age).apps.find((x) => x.id === m.appId) : undefined;
          setTimeout(() => {
            emit({ type: "launch_result", requestId: m.requestId, ok: true });
            if (game) setTimeout(() => emit({ type: "playing", gameId: game.id, title: game.title }), 1500);
            const id = String(Date.now());
            mockWindows = [...mockWindows, { id, title: game?.title ?? app?.name ?? "App", icon: null, minimized: false, maximized: true, active: false }];
            setTimeout(() => focusMock(id), 900);
          }, 400);
          break;
        }
        case "help":
          link?.help(m.topic);
          setTimeout(() => emit({ type: "help_result", requestId: m.requestId, ok: true, message: "Staff have been notified." }), 500);
          break;
        case "repair":
          setTimeout(() => emit({ type: "repair_result", requestId: m.requestId, ok: true, message: "Done." }), 900);
          break;
        case "window_action": {
          const w = mockWindows.find((x) => x.id === m.id);
          if (!w) break;
          if (m.action === "close") {
            mockWindows = mockWindows.filter((x) => x.id !== m.id);
            focusMock(null);
          } else if (m.action === "minimize") {
            mockWindows = mockWindows.map((x) => (x.id === m.id ? { ...x, minimized: true, active: false } : x));
            focusMock(null);
          } else {
            if (m.action !== "focus") mockWindows = mockWindows.map((x) => (x.id === m.id ? { ...x, maximized: m.action === "maximize" } : x));
            focusMock(m.id);
          }
          break;
        }
        case "desktop_show":
          focusMock(null);
          break;
        case "show_desktop":
          mockWindows = mockWindows.map((x) => ({ ...x, minimized: true, active: false }));
          focusMock(null);
          break;
        case "time_offers":
          setTimeout(() => emit({
            type: "time_offers", requestId: m.requestId, ok: true, currency: "AED", wallet: "85.00", savedMinutes: 75, savedSteps: [30, 60],
            packages: [
              { id: "00000000-0000-4000-8000-0000000000a1", name: "1 hour", minutes: 60, bonusMinutes: 0, price: "15.00" },
              { id: "00000000-0000-4000-8000-0000000000a2", name: "3 hours", minutes: 195, bonusMinutes: 15, price: "40.00" },
            ],
          }), 300);
          break;
        case "qr_login":
          setTimeout(() => emit({ type: "qr_login_code", requestId: m.requestId, ok: true, code: "DEMO7K2Q9P", url: "https://arena.example/demo?pc=DEMO7K2Q9P", expiresAt: new Date(Date.now() + 180_000).toISOString() }), 200);
          break;
        case "buy_time": {
          const add = (m.savedMinutes ?? (m.packageId?.endsWith("a2") ? 195 : 60)) * 60_000;
          setTimeout(() => {
            if (state.session?.expiresAt) state = { ...state, session: { ...state.session, expiresAt: new Date(new Date(state.session.expiresAt).getTime() + add).toISOString() } };
            push();
            emit({ type: "buy_time_result", requestId: m.requestId, ok: true });
          }, 500);
          break;
        }
        case "screenshot":
          emit({ type: "screenshot_taken" });
          setTimeout(() => emit({ type: "screenshot_result", ok: true, message: "Screenshot saved — see it in the Arena app under Screenshots." }), 800);
          break;
        case "volume_get":
          emit({ type: "volume", ...mockVolume });
          break;
        case "volume_set":
          mockVolume = { level: m.level ?? mockVolume.level, muted: m.muted ?? mockVolume.muted };
          emit({ type: "volume", ...mockVolume });
          break;
        case "staff_exit":
          setTimeout(() => emit({ type: "staff_exit_result", requestId: m.requestId, ok: false, error: "preview", message: "Only on a gaming PC. (Preview: nothing to exit to.)" }), 400);
          break;
        case "pointer_get":
          emit({ type: "pointer", ...pointer });
          break;
        case "menu_request":
          setTimeout(() => emit({ type: "menu", requestId: m.requestId, menu: link ? link.menu() : MOCK_MENU }), 300);
          break;
        case "place_order": {
          if (link) {
            void link.order(m.lines, m.notes, m.payWith).then((r) => emit({ type: "order_result", requestId: m.requestId, ...r, ok: r.ok }));
            break;
          }
          const total = m.lines.reduce((a, l) => {
            const p = MOCK_MENU.categories.flatMap((c) => c.products).find((x) => x.id === l.productId)!;
            const mods = p.modifierGroups.flatMap((g) => g.modifiers).filter((x) => l.modifierIds.includes(x.id)).reduce((s, x) => s + Number(x.priceDelta), 0);
            return a + (Number(p.price) + mods) * l.quantity;
          }, 0);
          const number = `S${String(Math.floor(Math.random() * 900) + 100)}`;
          const orderId = crypto.randomUUID();
          setTimeout(() => emit({ type: "order_result", requestId: m.requestId, ok: true, orderId, number, total: total.toFixed(2), currency: "AED" }), 500);
          setTimeout(() => emit({ type: "order_status", orderId, number, status: "PREPARING", message: "Your order is being prepared" }), 4000);
          setTimeout(() => emit({ type: "order_status", orderId, number, status: "READY", message: "Your order is ready — it's on its way to you" }), 9000);
          break;
        }
        case "print_confirm":
          setTimeout(() => emit({ type: "print_status", jobKey: m.jobKey, status: "PRINTING", message: "Printing…" }), 400);
          setTimeout(() => emit({ type: "print_status", jobKey: m.jobKey, status: "COMPLETED", message: "Your print is ready at the printer." }), 3500);
          break;
        case "print_cancel":
          emit({ type: "print_status", jobKey: m.jobKey, status: "CANCELLED", message: "Print cancelled." });
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
export function request(m: Extract<ShellMessage, { requestId: string }>, resultType: "launch_result" | "help_result" | "repair_result" | "login_result" | "order_result" | "time_offers" | "buy_time_result" | "qr_login_code", timeoutMs = 15_000): Promise<RequestResult & Record<string, any>> {
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
