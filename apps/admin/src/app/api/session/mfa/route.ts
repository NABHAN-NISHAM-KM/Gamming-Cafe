import type { NextRequest } from "next/server";
import { API_URL, csrfOk, forwardHeaders, json, setTokens } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return json(403, { error: "csrf" });
  const res = await fetch(`${API_URL}/v1/auth/mfa/verify`, { method: "POST", headers: forwardHeaders(req), body: await req.text(), cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.accessToken) {
    const out = json(200, { ok: true, organization: body.organization });
    setTokens(out, body);
    return out;
  }
  return json(res.status, body);
}
