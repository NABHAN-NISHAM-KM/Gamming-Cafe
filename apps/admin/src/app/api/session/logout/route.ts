import type { NextRequest } from "next/server";
import { API_URL, RT_COOKIE, clearTokens, csrfOk, forwardHeaders, json } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return json(403, { error: "csrf" });
  const rt = req.cookies.get(RT_COOKIE)?.value;
  if (rt) {
    await fetch(`${API_URL}/v1/auth/logout`, { method: "POST", headers: forwardHeaders(req), body: JSON.stringify({ refreshToken: rt }), cache: "no-store" }).catch(() => undefined);
  }
  const out = json(200, { ok: true });
  clearTokens(out);
  return out;
}
