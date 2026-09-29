import "server-only";
import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";

/**
 * Super Admin sessions: separate cookies (scoped to /platform and
 * /api/platform) and a separate upstream service, so a staff session and a
 * platform session never mix even in the same browser.
 */
export const PLATFORM_API_URL = process.env["ARENA_PLATFORM_API_URL"] ?? "http://localhost:4100";
export const PAT_COOKIE = "arena_pat";
export const PRT_COOKIE = "arena_prt";
const secure = process.env.NODE_ENV === "production";

export interface PlatformTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function setPlatformTokens(res: NextResponse, t: PlatformTokenPair) {
  res.cookies.set(PAT_COOKIE, t.accessToken, { httpOnly: true, sameSite: "strict", secure, path: "/api/platform", maxAge: t.expiresIn });
  res.cookies.set(PRT_COOKIE, t.refreshToken, { httpOnly: true, sameSite: "strict", secure, path: "/api/platform", maxAge: 12 * 3600 });
}

export function clearPlatformTokens(res: NextResponse) {
  res.cookies.set(PAT_COOKIE, "", { httpOnly: true, path: "/api/platform", maxAge: 0 });
  res.cookies.set(PRT_COOKIE, "", { httpOnly: true, path: "/api/platform", maxAge: 0 });
}

// Single-flight refresh, as for staff sessions: rotated tokens must never be replayed.
const inflight = new Map<string, { at: number; p: Promise<PlatformTokenPair | null> }>();
export function refreshPlatformOnce(refreshToken: string, headers: Record<string, string>): Promise<PlatformTokenPair | null> {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at > 20_000) inflight.delete(k);
  const hit = inflight.get(key);
  if (hit) return hit.p;
  const p = fetch(`${PLATFORM_API_URL}/v1/platform/auth/refresh`, { method: "POST", headers, body: JSON.stringify({ refreshToken }) })
    .then(async (r) => (r.ok ? ((await r.json()) as PlatformTokenPair) : null))
    .catch(() => null);
  inflight.set(key, { at: now, p });
  return p;
}
