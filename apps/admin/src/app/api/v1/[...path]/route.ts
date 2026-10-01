import { NextResponse, type NextRequest } from "next/server";
import { API_URL, AT_COOKIE, RT_COOKIE, clearTokens, csrfOk, forwardHeaders, json, refreshOnce, setTokens, type TokenPair } from "@/lib/server/session";

/** API routes that answer with tokens: only the /api/session/* routes may call them, so tokens never reach browser JavaScript. */
const TOKEN_ROUTES = new Set(["auth/login", "auth/refresh", "auth/mfa/verify", "auth/pin-switch"]);

/** Relays /api/v1/* to the ArenaOS API with the session's access token, refreshing it transparently. */
async function relay(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!csrfOk(req)) return json(403, { error: "csrf" });
  const { path } = await ctx.params;
  if (TOKEN_ROUTES.has(path.join("/").toLowerCase())) return json(404, { error: "not_found" });
  const url = `${API_URL}/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  const base = forwardHeaders(req);
  const reason = req.headers.get("x-action-reason");
  if (reason) base["x-action-reason"] = reason;

  // req.signal: when the browser closes a live stream, the upstream stream closes too.
  const call = (token: string) => fetch(url, { method: req.method, headers: { ...base, authorization: `Bearer ${token}` }, body, cache: "no-store", signal: req.signal });

  const at = req.cookies.get(AT_COOKIE)?.value;
  const rt = req.cookies.get(RT_COOKIE)?.value;
  let res: Response | null = null;
  let refreshed: TokenPair | null = null;
  try {
    res = at ? await call(at) : null;
    if ((!res || res.status === 401) && rt) {
      refreshed = await refreshOnce(rt, forwardHeaders(req));
      if (refreshed) res = await call(refreshed.accessToken);
    }
  } catch (e) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 }); // browser closed the stream
    // API down or restarting: a clear, retryable error instead of a crash.
    return json(502, { error: "api_unreachable" });
  }
  if (!res) {
    const out = json(401, { error: "not_authenticated" });
    clearTokens(out);
    return out;
  }

  const type = res.headers.get("content-type") ?? "application/json";
  // Live Floor events (SSE) are piped through unbuffered.
  const streaming = type.startsWith("text/event-stream");
  const out = new NextResponse(res.status === 204 ? null : streaming ? res.body : await res.text(), {
    status: res.status,
    headers: { "content-type": type, "cache-control": "no-store", ...(streaming ? { "x-accel-buffering": "no", connection: "keep-alive" } : {}) },
  });
  if (refreshed) setTokens(out, refreshed);
  else if (res.status === 401) clearTokens(out);
  return out;
}

export { relay as GET, relay as POST, relay as PATCH, relay as PUT, relay as DELETE };
