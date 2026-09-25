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

export type HostMessage =
  | ({ type: "state" } & ShellState)
  | { type: "login_result"; requestId: string; ok: boolean; error?: string; message?: string }
  | { type: "message"; title: string; text: string };

export type ShellMessage = { type: "ready" } | { type: "login"; requestId: string; username: string; secret: string } | { type: "logout" };

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

/**
 * Browser preview without Windows: a fake agent so the UI can be designed and
 * reviewed. ?session=90 starts logged in with 90 seconds left (expiry demo).
 */
function mockBridge(): Bridge {
  const listeners = new Set<Listener>();
  const params = new URLSearchParams(location.search);
  const emit = (m: HostMessage) => setTimeout(() => listeners.forEach((l) => l(m)), 0);
  const startSeconds = Number(params.get("session") ?? 0);
  let state: ShellState = {
    connected: true,
    station: { name: "PC-07" },
    venue: { name: "Demo Arena", branchName: "Dubai Marina", logoUrl: null },
    session: startSeconds
      ? { id: "mock", customerName: "Ahmed", tier: "Gold", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + startSeconds * 1000).toISOString(), warningMinutes: [30, 15, 10, 5, 1] }
      : null,
    serverOffsetMs: 0,
    safeMode: true,
  };
  const push = () => emit({ type: "state", ...state });
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const armExpiry = () => {
    clearTimeout(expiry);
    if (state.session?.expiresAt) expiry = setTimeout(() => ((state = { ...state, session: null }), push()), new Date(state.session.expiresAt).getTime() - Date.now() + 1500);
  };
  armExpiry();
  return {
    mock: true,
    send(m) {
      if (m.type === "ready") push();
      if (m.type === "logout") {
        state = { ...state, session: null };
        push();
      }
      if (m.type === "login") {
        const ok = m.username.toLowerCase() === "ahmed" && (m.secret === "ahmed123" || m.secret === "1234");
        setTimeout(() => {
          emit(ok ? { type: "login_result", requestId: m.requestId, ok } : { type: "login_result", requestId: m.requestId, ok: false, error: "invalid_credentials", message: "Wrong username or password." });
          if (ok) {
            state = { ...state, session: { id: "mock", customerName: "Ahmed", tier: "Gold", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(), warningMinutes: [30, 15, 10, 5, 1] } };
            armExpiry();
            push();
          }
        }, 600);
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const bridge: Bridge = window.chrome?.webview ? webviewBridge() : mockBridge();
