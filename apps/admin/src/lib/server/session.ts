import "server-only";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Backend-for-frontend session handling. Tokens live only in httpOnly
 * cookies set by this Next.js server; browser JavaScript never sees them, so
 * an XSS bug cannot exfiltrate a session.
 */
export const API_URL = process.env["ARENA_API_URL"] ?? "http://localhost:4000";
export const AT_COOKIE = "arena_at";
export const RT_COOKIE = "arena_rt";
const secure = process.env.NODE_ENV === "production";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function setTokens(res: NextResponse, t: TokenPair) {
  res.cookies.set(AT_COOKIE, t.accessToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: t.expiresIn });
  res.cookies.set(RT_COOKIE, t.refreshToken, { httpOnly: true, sameSite: "strict", secure, path: "/api", maxAge: 30 * 86_400 });
}

export function clearTokens(res: NextResponse) {
  res.cookies.set(AT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(RT_COOKIE, "", { httpOnly: true, path: "/api", maxAge: 0 });
}

/** Headers that let the API log the real client and apply per-client limits. */
export function forwardHeaders(req: NextRequest): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) h["x-forwarded-for"] = fwd;
  const ua = req.headers.get("user-agent");
  if (ua) h["user-agent"] = ua;
  return h;
}

/**
 * Mutating /api routes must carry X-Arena-CSRF. Browsers cannot add custom
 * headers to cross-site requests without a CORS preflight we never allow;
 * together with SameSite cookies this blocks CSRF.
 */
export function csrfOk(req: NextRequest) {
  return req.method === "GET" || req.method === "HEAD" || req.headers.get("x-arena-csrf") === "1";
}

// ── Single-flight refresh ────────────────────────────────────────────────────
// The API rotates refresh tokens and treats reuse of a rotated token as theft.
// When the access token expires, a page often fires several requests at once;
// without this they would each refresh with the same token and the API would
// (correctly) kill the session. Concurrent/near-concurrent refreshes with the
// same token share one result. In-memory: fine for one admin server; use
// Redis for this map when running several instances.
const inflight = new Map<string, { at: number; p: Promise<TokenPair | null> }>();
const REUSE_WINDOW_MS = 20_000;

export function refreshOnce(refreshToken: string, headers: Record<string, string>): Promise<TokenPair | null> {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at > REUSE_WINDOW_MS) inflight.delete(k);
  const hit = inflight.get(key);
  if (hit) return hit.p;
  const p = fetch(`${API_URL}/v1/auth/refresh`, { method: "POST", headers, body: JSON.stringify({ refreshToken }) })
    .then(async (r) => (r.ok ? ((await r.json()) as TokenPair) : null))
    .catch(() => null);
  inflight.set(key, { at: now, p });
  return p;
}

export const json = (status: number, body: unknown) => NextResponse.json(body, { status });
