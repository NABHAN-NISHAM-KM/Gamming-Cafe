// Entry point: installDemo() turns any ArenaOS app into a self-contained demo.
// It answers the app's API calls from the in-browser engine (fetch and
// EventSource are intercepted), so the unmodified app runs with no server.
import { clone, nowIso, num, rand, uuid, Engine, type Fixtures, type Scope } from "./engine";
import { Router, type Res } from "./http";
import { staffBackend } from "./staff";
import { platformBackend } from "./platform";
import { customerBackend, DEMO_CUSTOMERS } from "./customer";
import { createShellLink, type ShellLink } from "./shell";

export const DEMO_PASSWORD = "ArenaDemo!2026";
export const DEMO_STAFF = ["owner@demo.test", "manager@demo.test", "cashier@demo.test", "tech@demo.test", "waiter@demo.test", "kitchen@demo.test", "inventory@demo.test"];
export const DEMO_SUPER_ADMIN = "super@arenaos.test";
export { DEMO_CUSTOMERS };

const AUTH_KEY = "arena.demo.auth";
type Auth = { staff?: string | null; platform?: string | null };
const readAuth = (): Auth => {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const writeAuth = (a: Auth) => {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
};

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_ACTIONS: Record<string, string> = { cancel: "CANCELLED", approve: "APPROVED", ack: "ACKNOWLEDGED", release: "RELEASED", submit: "SUBMITTED", close: "CLOSED", pay: "PAID", start: "IN_PROGRESS", complete: "COMPLETED", archive: "ARCHIVED" };

export interface DemoHandle {
  engine: Engine;
  reset(): void;
  signOut(): void;
  /** The Gaming Shell demo, running as one station on the demo floor. */
  shell(stationName: string): ShellLink;
}
export type { ShellLink };

declare global {
  interface Window {
    __ARENA_DEMO__?: DemoHandle & { app: string };
  }
}

export async function installDemo(app: "admin" | "customer" | "shell"): Promise<DemoHandle> {
  if (window.__ARENA_DEMO__) return window.__ARENA_DEMO__;
  const [meta, staffFx, platformFx, customerFx] = await Promise.all([
    import("./fixtures/meta.json"),
    import("./fixtures/staff.json"),
    import("./fixtures/platform.json"),
    import("./fixtures/customer.json"),
  ]);
  const fixtures: Fixtures = { meta: (meta as any).default ?? meta, staff: (staffFx as any).default ?? staffFx, platform: (platformFx as any).default ?? platformFx, customer: (customerFx as any).default ?? customerFx };
  const engine = new Engine(fixtures);
  const staff = staffBackend(engine);
  const platform = platformBackend(engine);
  const customer = customerBackend(engine, staff);

  // ── generic document layer (everything without a dedicated handler) ─────
  const generic = async (scope: Scope, method: string, path: string, query: URLSearchParams, body: any): Promise<Res> => {
    const docs = engine.docs(scope);
    const qs = query.toString();
    if (method === "GET") {
      const exact = docs[qs ? `${path}?${qs}` : path];
      if (exact !== undefined) return { status: 200, body: exact };
      if (docs[path] !== undefined) return { status: 200, body: docs[path] };
      const prefix = Object.keys(docs).find((k) => k.startsWith(`${path}?`));
      if (prefix) return { status: 200, body: docs[prefix] };
      return { status: 404, body: { error: "not_found" } };
    }
    const segs = path.split("/").filter(Boolean);
    const lastId = [...segs].reverse().find((s) => UUIDISH.test(s));
    if (method === "DELETE") {
      if (lastId) engine.removeById(lastId, scope);
      return { status: 204 };
    }
    if (method === "POST") {
      const last = segs.at(-1)!;
      // POST /collection or /branches/:id/collection → create a row
      if (!UUIDISH.test(last) && (segs.length === 1 || (segs.length === 3 && UUIDISH.test(segs[1]!))) && Array.isArray(docs[path])) {
        const row = { id: uuid(), ...clone(body ?? {}), status: body?.status ?? "ACTIVE", isActive: body?.isActive ?? true, createdAt: nowIso(), updatedAt: nowIso() };
        docs[path].unshift(row);
        return { status: 201, body: row };
      }
      // POST /thing/:id/action
      if (lastId) {
        const action = last === lastId ? null : last;
        const patch: Record<string, unknown> = { ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}) };
        delete patch["idempotencyKey"];
        if (action && STATUS_ACTIONS[action]) patch["status"] = STATUS_ACTIONS[action];
        if (action && Object.keys(patch).length) engine.patchById(lastId, patch, [scope]);
        return { status: 200, body: engine.findById(lastId, scope) ?? { ok: true } };
      }
      return { status: 201, body: { id: uuid(), ...clone(body ?? {}), createdAt: nowIso() } };
    }
    // PATCH / PUT
    if (lastId) {
      const patch = { ...(body ?? {}) };
      delete patch["idempotencyKey"];
      engine.patchById(lastId, { ...patch, updatedAt: nowIso() }, [scope]);
      return { status: 200, body: engine.findById(lastId, scope) ?? { ok: true } };
    }
    if (docs[path] && typeof docs[path] === "object" && !Array.isArray(docs[path])) Object.assign(docs[path], body ?? {});
    return { status: 200, body: docs[path] ?? { ok: true } };
  };

  const serve = async (scope: Scope, router: Router, method: string, path: string, query: URLSearchParams, body: any, headers: Headers): Promise<Res> => {
    const hit = await router.handle({ method, path, query, body, headers });
    const res = hit ?? (await generic(scope, method, path, query, body));
    if (method !== "GET") engine.commit();
    return res;
  };

  // ── sign-in (BFF routes of the admin app) ───────────────────────────────
  const staffSession = (action: string, body: any): Res => {
    const auth = readAuth();
    if (action === "logout") {
      writeAuth({ ...auth, staff: null });
      return { status: 200, body: { ok: true } };
    }
    if (action === "mfa") return { status: 200, body: { ok: true } };
    const email = String(body?.email ?? "").toLowerCase();
    if (email === DEMO_SUPER_ADMIN && body?.password === DEMO_PASSWORD) return { status: 403, body: { error: "no_membership" } };
    if (!DEMO_STAFF.includes(email) || body?.password !== DEMO_PASSWORD) return { status: 401, body: { error: "invalid_credentials" } };
    writeAuth({ ...auth, staff: email });
    return { status: 200, body: { ok: true, organization: engine.get("staff", "/auth/me")?.organization, mfaSetupRequired: false } };
  };
  const platformSession = (action: string, body: any): Res => {
    const auth = readAuth();
    if (action === "logout") {
      writeAuth({ ...auth, platform: null });
      return { status: 200, body: { ok: true } };
    }
    if (action === "login") {
      const email = String(body?.email ?? "").toLowerCase();
      if (email !== DEMO_SUPER_ADMIN || body?.password !== DEMO_PASSWORD) return DEMO_STAFF.includes(email) ? { status: 403, body: { error: "not_platform_admin" } } : { status: 401, body: { error: "invalid_credentials" } };
      return { status: 200, body: { mfaRequired: true, mfaToken: "demo" } };
    }
    if (!/^\d{6}$/.test(String(body?.code ?? ""))) return { status: 401, body: { error: "invalid_mfa_code" } };
    writeAuth({ ...auth, platform: DEMO_SUPER_ADMIN });
    return { status: 200, body: { ok: true } };
  };

  // ── request dispatcher ──────────────────────────────────────────────────
  const dispatch = async (url: URL, method: string, body: any, headers: Headers): Promise<Res | null> => {
    const p = url.pathname;
    let m: RegExpExecArray | null;
    if ((m = /\/api\/session\/(login|mfa|logout)$/.exec(p))) return staffSession(m[1]!, body);
    if ((m = /\/api\/platform\/session\/(login|mfa|logout)$/.exec(p))) return platformSession(m[1]!, body);
    if ((m = /\/api\/platform\/v1(\/.*)$/.exec(p))) {
      if (!readAuth().platform) return { status: 401, body: { error: "not_authenticated" } };
      const path = m[1]!.replace(/^\/auth\/me$/, "/auth/me");
      return serve("platform", platform, method, path, url.searchParams, body, headers);
    }
    if ((m = /\/api\/v1(\/.*)$/.exec(p))) {
      if (!readAuth().staff) return { status: 401, body: { error: "not_authenticated" } };
      return serve("staff", staff.router, method, m[1]!, url.searchParams, body, headers);
    }
    if ((m = /\/v1\/app(\/.*)$/.exec(p))) {
      const path = m[1]!.replace(/^\/[a-z0-9-]+\/(venue|login|register)$/, (_s, a) => (a === "venue" ? "/demo/venue" : `/demo/${a}`));
      const res = await serve("customer", customer, method, path, url.searchParams, body, headers);
      if (res.status === 404 && method === "GET" && path === "/demo/venue") return { status: 200, body: engine.get("customer", "/demo/venue") };
      return res;
    }
    return null;
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), location.href);
    if (url.origin !== location.origin && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) return realFetch(input, init);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    let body: any;
    const raw = init?.body ?? (req && method !== "GET" ? await req.clone().text() : undefined);
    if (typeof raw === "string" && raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const headers = new Headers(init?.headers ?? req?.headers);
    const res = await dispatch(url, method, body, headers);
    if (!res) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 140)); // feels like a network
    return new Response(res.status === 204 || res.body === undefined ? null : JSON.stringify(res.body), { status: res.status, headers: { "content-type": "application/json" } });
  };

  // ── live streams (Server-Sent Events) ───────────────────────────────────
  const RealES = window.EventSource;
  class DemoEventSource extends EventTarget {
    readyState = 0;
    onerror: ((e: Event) => void) | null = null;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    private off: (() => void) | null = null;
    constructor(readonly url: string) {
      super();
      const m = /\/branches\/([^/]+)\/(floor|kitchen)\/events/.exec(url);
      const branchId = m?.[1];
      const kind = m?.[2];
      setTimeout(() => {
        this.readyState = 1;
        this.send("ready", { at: nowIso() });
      }, 120);
      this.off = engine.on((ev) => {
        if (ev.type === "changed") return this.send(kind === "kitchen" ? "kitchen" : "booking", {});
        if (!("branchId" in ev) || ev.branchId !== branchId) return;
        if (kind === "kitchen") {
          if (ev.type === "kitchen") this.send("kitchen", {});
          return;
        }
        if (ev.type === "device") this.send("device", { device: ev.device });
        if (ev.type === "metrics") this.send("metrics", { deviceId: ev.deviceId, metrics: ev.metrics, at: ev.at });
        if (ev.type === "command") this.send("command", { command: ev.command });
        if (ev.type === "alert") this.send("alert", { alert: ev.alert });
        if (ev.type === "booking") this.send("booking", {});
      });
    }
    private send(type: string, data: unknown) {
      if (this.readyState === 2) return;
      this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
    close() {
      this.readyState = 2;
      this.off?.();
    }
  }
  window.EventSource = function (this: unknown, url: string | URL, init?: EventSourceInit) {
    const u = String(url);
    return /\/api\/v1\//.test(u) ? new DemoEventSource(u) : new RealES(u, init);
  } as unknown as typeof EventSource;

  // ── the venue keeps living: metrics, session expiry, walk-in players ───
  const LEADER = "arena.demo.leader";
  const me = uuid();
  const isLeader = () => {
    try {
      const cur = JSON.parse(localStorage.getItem(LEADER) ?? "null");
      if (!cur || cur.id === me || Date.now() - cur.at > 6000) {
        localStorage.setItem(LEADER, JSON.stringify({ id: me, at: Date.now() }));
        return true;
      }
      return false;
    } catch {
      return true;
    }
  };
  const jitter = (v: number, d: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round((v + (Math.random() - 0.5) * d) * 10) / 10));
  setInterval(() => {
    // Metrics are cosmetic: every tab animates its own, so no leader needed.
    for (const d of staff.allDevices()) {
      if (!d.isOnline || d.agentless || !d.metrics) continue;
      const busy = !!d.session;
      const m = d.metrics;
      d.metrics = {
        ...m,
        cpuPct: jitter(busy ? Math.max(num(m.cpuPct), 35) : 6, 12),
        gpuPct: jitter(busy ? Math.max(num(m.gpuPct), 55) : 2, 14),
        ramPct: jitter(num(m.ramPct) || 40, 3),
        cpuTempC: jitter(busy ? 66 : 42, 4, 30, 95),
        gpuTempC: jitter(busy ? 62 : 38, 4, 30, 95),
        pingMs: jitter(num(m.pingMs) || 4, 2, 1, 80),
        fps: busy ? Math.round(jitter(num(m.fps) || 240, 30, 60, 400)) : null,
        uptimeSec: num(m.uptimeSec) + 3,
      };
      d.metricsAt = nowIso();
      engine.emit({ type: "metrics", branchId: d.branchId, deviceId: d.id, metrics: d.metrics, at: d.metricsAt }, false);
    }
  }, 3000);
  const expireSessions = () => {
    let changed = false;
    for (const d of staff.allDevices()) {
      if (d.session?.expiresAt && Date.parse(d.session.expiresAt) <= Date.now()) {
        staff.endSession(d.session.id, "Time ran out");
        changed = true;
      }
    }
    return changed;
  };
  /** Walk-in players: keeps the floor lively (about 60% of PCs busy). PC-01 stays free for the Shell demo. */
  const walkIns = (max: number) => {
    let started = 0;
    for (let i = 0; i < max; i++) {
      const pcs = staff.allDevices().filter((d) => d.kind === "GAMING_PC" && d.isOnline);
      const free = pcs.filter((d) => !d.session && d.status === "AVAILABLE" && d.name !== "PC-01");
      if (!pcs.length || free.length / pcs.length < 0.4) break;
      const people = staff.customers().filter((c) => !staff.allDevices().some((d) => d.session?.customer?.id === c.id) && c.username !== "sara" && c.username !== "ahmed");
      try {
        staff.startSession(rand(free), { customerId: people.length && Math.random() > 0.2 ? rand(people).id : null, guestLabel: "Walk-in", request: { kind: "minutes", minutes: rand([45, 60, 90, 120, 180]) }, payment: { method: "CARD" } });
        started++;
      } catch {
        break; // e.g. no plan for that station
      }
    }
    return started > 0;
  };
  // Opening a demo that sat idle: end what ran out, then fill the floor straight away.
  if (isLeader()) {
    const ended = expireSessions();
    if (walkIns(20) || ended) engine.commit();
  }
  setInterval(() => {
    if (isLeader() && expireSessions()) engine.commit();
  }, 5000);
  setInterval(() => {
    if (isLeader() && walkIns(1)) engine.commit();
  }, 45_000);

  // Simulated kitchen crew: tickets nobody touches still move along, so seat
  // orders reach the player even when no one has the kitchen screen open.
  setInterval(() => {
    if (!isLeader()) return;
    for (const b of staff.branches()) {
      const kd = engine.get("staff", `/branches/${b.id}/kitchen`);
      for (const t of kd?.tickets ?? []) {
        const age = (iso: string | null) => (iso ? Date.now() - Date.parse(iso) : 0);
        const to = t.status === "NEW" && age(t.createdAt) > 15_000 ? "PREPARING" : t.status === "ACCEPTED" && age(t.createdAt) > 20_000 ? "PREPARING" : t.status === "PREPARING" && age(t.startedAt) > 35_000 ? "READY" : t.status === "READY" && age(t.readyAt) > 45_000 ? "SERVED" : null;
        if (to) void serve("staff", staff.router, "POST", `/kitchen-tickets/${t.id}/bump`, new URLSearchParams(), { to }, new Headers());
      }
    }
  }, 5000);

  const handle = {
    engine,
    app,
    shell: (name: string) => createShellLink(engine, staff, name, (method, path, body) => serve("staff", staff.router, method, path, new URLSearchParams(), body, new Headers()).then((r) => ({ status: r.status, body: r.body }))),
    reset() {
      engine.reset();
      location.reload();
    },
    signOut() {
      writeAuth({});
      location.reload();
    },
  };
  window.__ARENA_DEMO__ = handle;
  return handle;
}
