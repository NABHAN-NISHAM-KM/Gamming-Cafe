import type { NextRequest } from "next/server";
import { AT_COOKIE, RT_COOKIE, csrfOk, forwardHeaders, json } from "@/lib/server/session";
import { PAT_COOKIE, PLATFORM_API_URL } from "@/lib/server/platform-session";

/** Which support session this browser is in, so "End support session" can close it on the platform. */
const IMP_COOKIE = "arena_imp";
const secure = process.env.NODE_ENV === "production";

/**
 * Support signing in as a venue, from the Super Admin console in this same
 * browser. "start" asks the platform for a short-lived venue sign-in and
 * swaps it in as this browser's venue session (no refresh token: it simply
 * runs out). "end" closes it on the platform and signs the venue session out.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  if (!csrfOk(req)) return json(403, { error: "csrf" });
  const { action } = await ctx.params;
  const platformToken = req.cookies.get(PAT_COOKIE)?.value;
  if (!platformToken) return json(401, { error: "not_authenticated" });
  const call = (path: string, body: string) =>
    fetch(`${PLATFORM_API_URL}/v1/platform/${path}`, { method: "POST", headers: { ...forwardHeaders(req), authorization: `Bearer ${platformToken}` }, body, cache: "no-store" });

  if (action === "start") {
    const { organizationId, ...rest } = (await req.json().catch(() => ({}))) as { organizationId?: string };
    if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) return json(400, { error: "bad_request" });
    const res = await call(`organizations/${organizationId}/impersonate`, JSON.stringify(rest));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return json(res.status, body);
    const out = json(200, { ok: true, as: body.as, expiresAt: body.expiresAt });
    out.cookies.set(AT_COOKIE, body.accessToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: body.expiresIn });
    out.cookies.set(RT_COOKIE, "", { httpOnly: true, path: "/api", maxAge: 0 });
    out.cookies.set(IMP_COOKIE, body.sessionId, { httpOnly: true, sameSite: "strict", secure, path: "/api", maxAge: body.expiresIn });
    return out;
  }
  if (action === "end") {
    const sessionId = req.cookies.get(IMP_COOKIE)?.value;
    if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) await call(`impersonation/${sessionId}/end`, "{}").catch(() => undefined);
    const out = json(200, { ok: true });
    out.cookies.set(AT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    out.cookies.set(IMP_COOKIE, "", { httpOnly: true, path: "/api", maxAge: 0 });
    return out;
  }
  return json(404, { error: "not_found" });
}
