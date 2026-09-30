"use client";

import { askText } from "@/components/ui";

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
  if (code === "sold_out") return `${body?.product ?? "An item"} is sold out${typeof body?.left === "number" && body.left > 0 ? ` — only ${body.left} left` : ""}.`;
  if (code === "insufficient_stock") return `Not enough ${body?.item ?? "stock"}${body?.onHand ? ` (${Number(body.onHand)} on hand)` : ""}.`;
  if (code === "over_return") return `You can't return more than was received — ${Number(body?.received ?? 0)} of ${body?.item ?? "that item"} arrived.`;
  if (code === "over_receipt") return `More than was ordered — only ${Number(body?.outstanding ?? 0)} of ${body?.item ?? "that item"} is still to come.`;
  if (["modifier_required", "too_many_modifiers", "bad_modifier"].includes(code ?? "")) return body?.message ?? "Check the item options.";
  if (code === "insufficient_cash" || code === "not_enough_cash") return "The cash tendered doesn't cover the amount.";
  if (code === "drawer_in_use") return `That drawer is already open${body?.by ? ` by ${body.by}` : ""}.`;
  if (code === "bad_transition") return `That ticket is already ${String(body?.from ?? "").toLowerCase()}.`;
  if (code === "age_restricted") return `This station is ${body?.minAge}+ — the customer is ${body?.age}.`;
  if (code === "age_confirmation_required") return `Confirm the player is at least ${body?.minAge}.`;
  if (code === "too_many_players") return `This station has ${body?.max} controller(s).`;
  if (code === "wrong_team_size") return `Each team needs exactly ${body?.teamSize} player(s).`;
  if (code === "not_enough_points") return `Not enough points (${body?.balance ?? 0}, needs ${body?.needed ?? "more"}).`;
  if (code === "too_few_teams" && body?.minTeams) return `Only ${body?.teams} team(s) — at least ${body?.minTeams} are needed.`;
  const map: Record<string, string> = {
    promo_code_invalid: "That promo code isn't valid.",
    promo_code_expired: "That promo code has expired.",
    promo_code_used_up: "That promo code has been used up.",
    promo_code_not_yours: "That code belongs to another customer.",
    promo_not_applicable: "That code doesn't apply to this purchase.",
    promo_limit_reached: "That promotion has been fully used.",
    promo_code_taken: "That code already exists.",
    reward_not_found: "That reward is no longer available.",
    reward_out_of_stock: "That reward is out of stock.",
    already_redeemed: "That was already redeemed.",
    registration_closed: "Registration is closed.",
    tournament_full: "The tournament is full.",
    already_registered: "A player is already in another team.",
    team_name_taken: "That team name is taken.",
    payment_required: "An entry fee is due — choose how it's paid.",
    tournament_started: "The tournament has already started.",
    bad_tournament_status: "That can't be done at this stage of the tournament.",
    winner_required: "Knockout matches need a winner.",
    match_not_ready: "Both teams aren't known yet.",
    match_decided: "That match already has a result.",
    score_contradicts_winner: "The score doesn't match the winner.",
    campaign_not_sendable: "That campaign was already sent (or cancelled).",
    segment_built_in: "Built-in segments can't be changed — create your own.",
    segment_is_dynamic: "That segment fills itself from its rules.",
    referral_code_invalid: "That referral code isn't valid.",
    no_power_plug: "Set up this station's smart plug first.",
    no_bridge: "Choose a bridge PC for this branch first (Consoles & VR).",
    bridge_needs_agent: "The bridge must be a PC running the ArenaOS agent.",
    not_cleaning: "That station isn't waiting to be cleaned.",
    not_a_display: "Only TV displays can be paired.",
    display_not_found: "That TV display doesn't exist at this branch.",
    accessory_not_found: "That controller no longer exists.",
    device_name_taken: "A station with that name already exists here.",
    print_not_held: "That print isn't waiting any more.",
    printing_not_set_up: "Printing prices aren't set up (PRINT-BW / PRINT-COLOR).",
    cannot_approve_own_po: "Someone else has to approve an order you raised.",
    po_not_editable: "Only a draft order can be changed.",
    bad_po_status: "That can't be done at this stage of the order.",
    po_busy: "Someone else is receiving this order — reload and try again.",
    po_other_supplier: "That order is from a different supplier.",
    invoice_duplicate: "This supplier's invoice number is already recorded.",
    invoice_closed: "That invoice is already paid or voided.",
    invoice_has_payments: "Payments were recorded against it — it can't be voided.",
    not_disputed: "That invoice isn't disputed.",
    unit_locked: "Stock has moved in this unit — create a new item instead of changing it.",
    warehouse_name_taken: "A store with that name already exists here.",
    branch_required: "Only a central warehouse can be without a branch.",
    same_warehouse: "Pick a different store to transfer to.",
    duplicate_item: "Each item can only appear once.",
    stock_link_needs_stock_item: "Only ready items (cans, snacks) link to one stock item; made-to-order items use a recipe.",
    item_and_quantity_together: "Choose both a stock item and a quantity, or neither.",
    serials_mismatch: "Enter one serial number per unit received.",
    stock_busy: "Stock was changing at the same moment — try again.",
    item_not_found: "That stock item no longer exists.",
    warehouse_not_found: "That store no longer exists.",
    supplier_not_found: "That supplier no longer exists.",
    no_open_shift: "Open a cash shift first (POS → My shift) to take cash.",
    shift_already_open: "You already have a shift open at this branch.",
    shift_not_open: "That shift is already closed.",
    not_your_shift: "Only the cashier who opened this shift (or a manager) can close it.",
    cannot_approve_own_shift: "Another manager has to approve your own shift.",
    nothing_to_approve: "This shift doesn't need approval.",
    bill_settled: "That bill is already paid.",
    bill_void: "That bill was voided.",
    unbalanced: "Debits and credits must be equal.",
    period_locked: "The books are closed for that date — use a later date.",
    lock_in_future: "Only days that are over can be closed.",
    header_account: "That's a heading — post to an account under it.",
    account_inactive: "That account is switched off.",
    account_code_taken: "Another account already uses that code.",
    parent_type_mismatch: "An account goes under a heading of the same type.",
    system_account: "Automatic postings use this account — rename it instead of switching it off.",
    already_reversed: "That entry was already reversed.",
    automatic_entry: "Automatic entries follow their bill, payment or document — correct that instead.",
    is_reversal: "A reversal can't itself be reversed.",
    not_an_expense_account: "Pick an expense account.",
    paid_from_drawer: "Paid from a cash drawer — record a correcting expense instead.",
    drawer_is_cash: "Only cash can come out of the drawer.",
    too_few_lines: "An entry needs at least two lines.",
    bad_line: "Each line has either a debit or a credit.",
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
    in_use: "Other records still use this, so it can't be deleted.",
    wallet_not_empty: "They still have money in their wallet — refund it to them first, then erase.",
    customer_in_session: "They're playing right now — end the session first.",
    customer_has_open_bill: "They have an open bill — settle or void it first.",
    customer_has_bookings: "They have upcoming bookings — cancel them first.",
    customer_erased: "This customer was already erased.",
    po_not_draft: "Only draft orders can be deleted. Cancel it instead, or return received goods to the supplier.",
    system_role: "Built-in roles can't be deleted.",
    campaign_sent: "Only draft campaigns can be deleted.",
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
// Kept on globalThis so a hot reload of this module doesn't forget the themed
// dialog <ReasonProvider/> registered. Never falls back to window.prompt.
const reasonHost = globalThis as { __arenaAskReason?: AskReason };
const askReason: AskReason = (action) => (reasonHost.__arenaAskReason ? reasonHost.__arenaAskReason(action) : askText(`${action} needs a reason (saved in the audit log).`));
export const registerReasonPrompt = (fn: AskReason) => {
  reasonHost.__arenaAskReason = fn;
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
