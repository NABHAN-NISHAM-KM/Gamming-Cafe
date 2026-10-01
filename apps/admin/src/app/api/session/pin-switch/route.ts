import type { NextRequest } from "next/server";
import { API_URL, AT_COOKIE, RT_COOKIE, csrfOk, forwardHeaders, json, refreshOnce, setTokens } from "@/lib/server/session";

/** Hands this browser's session to a colleague by PIN; the new tokens go straight into the httpOnly cookies. */
export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return json(403, { error: "csrf" });
  const body = await req.text();
  const call = (token: string) => fetch(`${API_URL}/v1/auth/pin-switch`, { method: "POST", headers: { ...forwardHeaders(req), authorization: `Bearer ${token}` }, body, cache: "no-store" });
  let at = req.cookies.get(AT_COOKIE)?.value;
  const rt = req.cookies.get(RT_COOKIE)?.value;
  let res = at ? await call(at) : null;
  if ((!res || (res.status === 401 && (await res.clone().json().catch(() => ({})))?.error !== "invalid_credentials")) && rt) {
    // Expired access token (not a wrong PIN): refresh once and retry.
    const fresh = await refreshOnce(rt, forwardHeaders(req));
    at = fresh?.accessToken;
    if (at) res = await call(at);
  }
  if (!res) return json(401, { error: "not_authenticated" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.accessToken) return json(res.status, data);
  const out = json(200, { ok: true });
  setTokens(out, data);
  return out;
}
