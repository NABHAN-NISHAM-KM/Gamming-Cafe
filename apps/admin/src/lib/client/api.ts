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
  if (code === "device_booked") return body?.freeMinutes > 0 ? `This PC is booked soon (${body.bookingReference}) — sell at most ${body.freeMinutes} min or use another PC.` : `This PC is booked right now (${body?.bookingReference}).`;
  if (code === "insufficient_funds") return `Not enough in the wallet${body?.balance ? ` (balance ${body.balance}${body.needed ? `, needs ${body.needed}` : ""})` : ""}.`;
  if (code === "not_enough_free") return `Only ${body?.free ?? 0} station(s) free at that time.`;
  if (code === "too_far_ahead") return `Bookings can be made up to ${body?.maxDays} days ahead.`;
  if (code === "sold_out") return `${body?.product ?? "An item"} is sold out.`;
  if (["modifier_required", "too_many_modifiers", "bad_modifier"].includes(code ?? "")) return body?.message ?? "Check the item options.";
  if (code === "insufficient_cash" || code === "not_enough_cash") return "The cash tendered doesn't cover the amount.";
  if (code === "drawer_in_use") return `That drawer is already open${body?.by ? ` by ${body.by}` : ""}.`;
  if (code === "bad_transition") return `That ticket is already ${String(body?.from ?? "").toLowerCase()}.`;
  const map: Record<string, string> = {
    no_open_shift: "Open a cash shift first (POS → My shift) to take cash.",
    shift_already_open: "You already have a shift open at this branch.",
    shift_not_open: "That shift is already closed.",
    not_your_shift: "Only the cashier who opened this shift (or a manager) can close it.",
    cannot_approve_own_shift: "Another manager has to approve your own shift.",
    nothing_to_approve: "This shift doesn't need approval.",
    bill_settled: "That bill is already paid.",
    bill_void: "That bill was voided.",
    order_paid: "That order is already paid — refund it instead.",
    already_paid: "That's already paid.",
    already_voided: "That item was already voided.",
    already_prepared: "The kitchen has already made this — a manager must void it.",
    not_cancellable: "This can't be cancelled any more.",
    no_session: "No one is playing on that PC right now.",
    device_required: "Pick the PC to deliver to.",
    table_required: "Pick a table.",
    table_out_of_service: "That table is out of service.",
    table_has_open_bill: "Settle the table's bill first.",
    table_name_taken: "A table with that name already exists.",
    not_orderable_here: "That item can't be ordered here.",
    product_not_found: "That item is no longer on the menu.",
    sku_taken: "That SKU is already used.",
    bad_amount: "That amount isn't valid.",
    bad_discount: "That discount isn't valid.",
    empty_order: "Add something to the order first.",
    wallet_frozen: "This customer's wallet is frozen.",
    wallet_needs_customer: "Pick a customer to pay from their wallet.",
    slot_taken: "That station is already booked for that time.",
    starts_in_past: "That time has already passed.",
    too_early: "Too early to check in — check-in opens 15 minutes before the booking.",
    booking_over: "This booking has already ended.",
    not_confirmed: "Only a confirmed booking can do that.",
    tier_not_for_sale: "This tier is earned, not sold.",
    sold_tier_needs_duration: "A tier with a price needs a duration in days.",
    code_taken: "That code is already used.",
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
