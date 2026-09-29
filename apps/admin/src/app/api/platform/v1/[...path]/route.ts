import { NextResponse, type NextRequest } from "next/server";
import { csrfOk, forwardHeaders, json } from "@/lib/server/session";
import { clearPlatformTokens, PAT_COOKIE, PLATFORM_API_URL, PRT_COOKIE, refreshPlatformOnce, setPlatformTokens, type PlatformTokenPair } from "@/lib/server/platform-session";

/** Relays /api/platform/v1/* to the Super Admin service with the platform session, refreshing it transparently. */
async function relay(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!csrfOk(req)) return json(403, { error: "csrf" });
  const { path } = await ctx.params;
  const url = `${PLATFORM_API_URL}/v1/platform/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  const base = forwardHeaders(req);
  const reason = req.headers.get("x-action-reason");
  if (reason) base["x-action-reason"] = reason;
  const call = (token: string) => fetch(url, { method: req.method, headers: { ...base, authorization: `Bearer ${token}` }, body, cache: "no-store" });

  const at = req.cookies.get(PAT_COOKIE)?.value;
  const rt = req.cookies.get(PRT_COOKIE)?.value;
  let res: Response | null = null;
  let refreshed: PlatformTokenPair | null = null;
  try {
    res = at ? await call(at) : null;
    if ((!res || res.status === 401) && rt) {
      refreshed = await refreshPlatformOnce(rt, forwardHeaders(req));
      if (refreshed) res = await call(refreshed.accessToken);
    }
  } catch {
    return json(502, { error: "platform_unreachable" });
  }
  if (!res) {
    const out = json(401, { error: "not_authenticated" });
    clearPlatformTokens(out);
    return out;
  }
  const out = new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
  if (refreshed) setPlatformTokens(out, refreshed);
  else if (res.status === 401) clearPlatformTokens(out);
  return out;
}

export { relay as GET, relay as POST, relay as PATCH, relay as PUT, relay as DELETE };
