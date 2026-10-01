// ArenaOS demo engine: a simulated backend that lives in the browser.
//
// It starts from responses captured from the real API (src/fixtures, made by
// scripts/capture.ts) and keeps them as "documents" keyed by request path.
// Reads return those documents; actions (start a session, take an order,
// suspend an organization…) update them with the same rules the real server
// applies, so every screen that shows an entity sees the change.
//
// State is saved per device (localStorage) and shared live between the demo
// apps on one origin (BroadcastChannel), so a session started in the admin
// demo appears in the Gaming Shell demo.

export type Scope = "staff" | "platform" | "customer";
export type Docs = Record<string, any>;

export interface DemoState {
  version: number;
  createdAt: number;
  updatedAt: number;
  staff: Docs;
  platform: Docs;
  customer: Docs;
  seq: number;
}

const VERSION = 3;
const STORAGE_KEY = "arena.demo.state";
/** A demo left alone longer than this starts fresh (sessions would all have ended). */
const STALE_MS = 8 * 3_600_000;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Moves every timestamp by `delta` so captured data reads as "now". */
function timeShift(v: any, delta: number): any {
  if (typeof v === "string") return ISO.test(v) ? new Date(Date.parse(v) + delta).toISOString() : v;
  if (Array.isArray(v)) return v.map((x) => timeShift(x, delta));
  if (v && typeof v === "object") {
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = timeShift(v[k], delta);
    return out;
  }
  return v;
}

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export const nowIso = () => new Date().toISOString();
export const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
export const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
export const num = (v: unknown) => Number(v ?? 0) || 0;
export const rand = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
export const code = (len = 6) => Array.from({ length: len }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

type Listener = (e: DemoEvent) => void;
export type DemoEvent =
  | { type: "device"; branchId: string; device: any }
  | { type: "metrics"; branchId: string; deviceId: string; metrics: any; at: string }
  | { type: "command"; branchId: string; command: any }
  | { type: "alert"; branchId: string; alert: any }
  | { type: "booking"; branchId: string }
  | { type: "kitchen"; branchId: string }
  | { type: "order"; branchId: string; change: "placed" | "updated"; order: any }
  | { type: "changed" };

export interface Fixtures {
  meta: { capturedAt: string };
  staff: Docs;
  platform: Docs;
  customer: Docs;
}

export class Engine {
  state!: DemoState;
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly fixtures: Fixtures) {
    this.load();
    try {
      this.channel = new BroadcastChannel("arena-demo");
      this.channel.onmessage = (m) => {
        if (m.data?.type === "sync") {
          this.load();
          this.emit({ type: "changed" }, false);
        } else if (m.data?.type === "event") this.emit(m.data.event, false);
      };
    } catch {
      /* no BroadcastChannel: single-tab demo */
    }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  private fresh(): DemoState {
    const delta = Date.now() - Date.parse(this.fixtures.meta.capturedAt);
    return {
      version: VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      staff: timeShift(clone(this.fixtures.staff), delta),
      platform: timeShift(clone(this.fixtures.platform), delta),
      customer: timeShift(clone(this.fixtures.customer), delta),
      seq: 1,
    };
  }

  private load() {
    let saved: DemoState | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      saved = raw ? (JSON.parse(raw) as DemoState) : null;
    } catch {
      saved = null;
    }
    this.state = saved && saved.version === VERSION && Date.now() - saved.updatedAt < STALE_MS ? saved : this.fresh();
  }

  reset() {
    this.state = this.fresh();
    this.persist(true);
    this.emit({ type: "changed" });
  }

  /** Call after every change. Saves shortly after (batched) and tells other tabs. */
  commit() {
    this.state.updatedAt = Date.now();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(true), 150);
  }

  private persist(broadcast: boolean) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage full or blocked: the demo keeps working in memory */
    }
    if (broadcast) this.channel?.postMessage({ type: "sync" });
  }

  // ── events (SSE simulation, cross-app live updates) ─────────────────────

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: DemoEvent, broadcast = true) {
    for (const fn of this.listeners) fn(e);
    if (broadcast && e.type !== "changed" && e.type !== "metrics") this.channel?.postMessage({ type: "event", event: e });
  }

  // ── document helpers ────────────────────────────────────────────────────

  docs(scope: Scope) {
    return this.state[scope];
  }
  get(scope: Scope, key: string) {
    return this.state[scope][key];
  }
  set(scope: Scope, key: string, value: any) {
    this.state[scope][key] = value;
  }
  keys(scope: Scope, re: RegExp) {
    return Object.keys(this.state[scope]).filter((k) => re.test(k));
  }

  /** Merges `patch` into every object with this id, in every document of the scope(s). */
  patchById(id: string, patch: Record<string, unknown>, scopes: Scope[] = ["staff"]) {
    let hits = 0;
    const visit = (v: any) => {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") {
        if (v.id === id) {
          Object.assign(v, clone(patch));
          hits++;
        }
        for (const k in v) if (v[k] && typeof v[k] === "object") visit(v[k]);
      }
    };
    for (const s of scopes) visit(this.state[s]);
    return hits;
  }

  /** The first object with this id (a list row or a detail document). */
  findById(id: string, scope: Scope = "staff"): any {
    const direct = Object.entries(this.state[scope]).find(([, v]) => v && typeof v === "object" && !Array.isArray(v) && v.id === id);
    if (direct) return direct[1];
    let found: any;
    const visit = (v: any) => {
      if (found) return;
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") {
        if (v.id === id) found = v;
        else for (const k in v) if (v[k] && typeof v[k] === "object") visit(v[k]);
      }
    };
    visit(this.state[scope]);
    return found;
  }

  /** Removes every object with this id from arrays in the scope. */
  removeById(id: string, scope: Scope = "staff") {
    const visit = (v: any) => {
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) if (v[i] && typeof v[i] === "object" && v[i].id === id) v.splice(i, 1);
        v.forEach(visit);
      } else if (v && typeof v === "object") for (const k in v) if (v[k] && typeof v[k] === "object") visit(v[k]);
    };
    visit(this.state[scope]);
  }

  nextSeq() {
    return this.state.seq++;
  }
}
