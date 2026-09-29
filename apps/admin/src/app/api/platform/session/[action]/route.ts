import type { NextRequest } from "next/server";
import { csrfOk, forwardHeaders, json } from "@/lib/server/session";
import { clearPlatformTokens, PLATFORM_API_URL, PRT_COOKIE, setPlatformTokens } from "@/lib/server/platform-session";

/** Super Admin sign-in steps: login (password), mfa (code / enrolment), logout. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  if (!csrfOk(req)) return json(403, { error: "csrf" });
  const { action } = await ctx.params;
  const headers = forwardHeaders(req);

  if (action === "logout") {
    const rt = req.cookies.get(PRT_COOKIE)?.value;
    if (rt) await fetch(`${PLATFORM_API_URL}/v1/platform/auth/logout`, { method: "POST", headers, body: JSON.stringify({ refreshToken: rt }), cache: "no-store" }).catch(() => undefined);
    const out = json(200, { ok: true });
    clearPlatformTokens(out);
    return out;
  }
  if (action !== "login" && action !== "mfa") return json(404, { error: "not_found" });

  const upstream = action === "login" ? "login" : "mfa/verify";
  let res: Response;
  try {
    res = await fetch(`${PLATFORM_API_URL}/v1/platform/auth/${upstream}`, { method: "POST", headers, body: await req.text(), cache: "no-store" });
  } catch {
    return json(502, { error: "platform_unreachable" });
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.accessToken) {
    const out = json(200, { ok: true });
    setPlatformTokens(out, body);
    return out;
  }
  // Password step → { mfaRequired } or { mfaSetupRequired, secret, otpauthUrl }; errors pass through.
  return json(res.status, body);
}
