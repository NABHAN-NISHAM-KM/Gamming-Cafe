"use client";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: any,
  ) {
    super(describeError(status, body));
    this.name = "ApiError";
  }
}

/** Human wording for the API's machine-readable errors. */
export function describeError(status: number, body: any): string {
  const code: string | undefined = body?.error;
  const map: Record<string, string> = {
    invalid_credentials: "Email or password is incorrect.",
    account_locked: "Too many failed attempts. The account is temporarily locked.",
    invalid_mfa_code: "That code is not valid. Wait for the next code and try again.",
    no_membership: "This account has no access to that organization.",
    validation_failed: "Some fields are invalid.",
    plan_limit_reached: `Your plan limit has been reached (${body?.limit ?? "limit"}: ${body?.max ?? "?"}). Upgrade to add more.`,
    privilege_escalation: "You can't grant permissions you don't hold yourself.",
    last_owner: "The organization must keep at least one owner.",
    branch_code_taken: "That branch code is already in use.",
    employee_code_taken: "That employee code is already in use.",
    already_member: "That person is already a member of this organization.",
    role_key_taken: "A role with that key already exists.",
    cannot_deactivate_self: "You can't deactivate your own account.",
    conflict: "That conflicts with an existing record.",
    not_found: "Not found.",
    csrf: "Security check failed — reload the page.",
    api_unreachable: "Can't reach the ArenaOS API. Check that it is running (npm run dev -w @arena/api), then retry.",
  };
  if (code === "forbidden") {
    const reasons: Record<string, string> = {
      NOT_GRANTED: "Your role doesn't allow this.",
      OUT_OF_SCOPE: "You don't have access to this branch.",
      FEATURE_DISABLED: "This module isn't included in your plan.",
      REASON_REQUIRED: "A reason is required for this action.",
      IMPERSONATION_BLOCKED: "Not allowed while impersonating.",
    };
    return reasons[body?.reason] ?? "You don't have permission to do this.";
  }
  if (code && map[code]) {
    if (code === "validation_failed" && body?.issues?.length) {
      return `${map[code]} ${body.issues.map((i: any) => `${i.path || "form"}: ${i.message}`).join("; ")}`;
    }
    return map[code];
  }
  return status >= 500 ? "Something went wrong on the server." : `Request failed (${status}).`;
}

// ── Reason prompt hook-up (registered by <ReasonProvider/>) ─────────────────
type AskReason = (action: string) => Promise<string | null>;
let askReason: AskReason = async () => window.prompt("Reason for this action:");
export const registerReasonPrompt = (fn: AskReason) => {
  askReason = fn;
};

interface Opts {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  reason?: string;
  /** Label shown in the reason dialog. */
  action?: string;
}

/**
 * Calls the API through the BFF. If the server says a reason is required for a
 * sensitive action, asks the user and retries once.
 */
export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const send = (reason?: string) =>
    fetch(`/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-arena-csrf": "1",
        ...(reason ? { "x-action-reason": encodeURIComponent(reason) } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });

  let res = await send(opts.reason);
  let body = res.status === 204 ? null : await res.json().catch(() => null);

  if (res.status === 403 && body?.reason === "REASON_REQUIRED") {
    const reason = await askReason(opts.action ?? "This action");
    if (!reason) throw new ApiError(499, { error: "cancelled" });
    res = await send(reason);
    body = res.status === 204 ? null : await res.json().catch(() => null);
  }

  if (res.status === 401) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(401, body);
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export async function session(path: "login" | "mfa" | "logout", body?: unknown) {
  const res = await fetch(`/api/session/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-arena-csrf": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
