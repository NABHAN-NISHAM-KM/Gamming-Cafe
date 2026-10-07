// Talks to /v1/app/* on the same origin, or on VITE_ARENA_API when set (the
// Android app, whose page origin is https://localhost). The venue is the first
// path segment (arena.example.com/demo), remembered for the next visit;
// the APK has no path, so it falls back to VITE_ARENA_VENUE.
import { t } from "./i18n";

const API = import.meta.env.VITE_ARENA_API ?? "";

const TOKEN = "arena.customer.token";
const VENUE = "arena.customer.venue";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: stays signed in for this tab only */
    }
  },
};

export const SLUG_RE = /^[a-z0-9-]{2,64}$/;
/** Set when the APK was built for one venue: it can't be switched in the app. */
export const LOCKED_VENUE: string | undefined = import.meta.env.VITE_ARENA_VENUE || undefined;

/** The venue in the URL, the one this build is locked to, or the one the customer picked (null: not picked yet). */
export function venueSlug(): string | null {
  const fromPath = location.pathname.split("/").filter(Boolean)[0];
  const slug = (fromPath && SLUG_RE.test(fromPath) ? fromPath : null) ?? LOCKED_VENUE ?? store.get(VENUE) ?? (import.meta.env.VITE_ARENA_API ? null : "demo");
  if (slug) store.set(VENUE, slug);
  return slug;
}

/** Accounts belong to one venue, so switching venue signs out. */
export function setVenue(slug: string | null) {
  store.set(VENUE, slug);
  setToken(null);
}

let token = store.get(TOKEN);
export const signedIn = () => !!token;
export const setToken = (t: string | null) => {
  token = t;
  store.set(TOKEN, t);
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: any,
  ) {
    super(explain(status, body));
  }
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Wrong username or password.",
  account_blocked: "This account can't be used. Please talk to the staff.",
  gift_card_invalid: "That code isn't valid, or it was already used. Check it and try again.",
  too_many_attempts: "Too many attempts. Please wait a few minutes.",
  username_taken: "That username is taken — pick another one.",
  already_registered: "You already have an account — sign in instead.",
  insufficient_funds: "Not enough credit in your wallet. Top up at the counter.",
  wallet_frozen: "Your wallet is on hold. Please talk to the staff.",
  slot_taken: "Someone just booked that. Pick another time.",
  not_enough_free: "Not enough free stations then. Try another time or zone.",
  too_far_ahead: "That's too far ahead to book.",
  starts_in_past: "That time has passed.",
  too_late_to_cancel: "Too late to cancel in the app — please call the venue.",
  venue_not_found: "We couldn't find that venue.",
  online_payment_unavailable: "Online payment isn't available — choose pay at the venue.",
  session_ended: "Please sign in again.",
  invalid_token: "Please sign in again.",
  referral_code_invalid: "That invite code doesn't exist — check it with your friend.",
  not_enough_points: "You don't have enough points for that yet.",
  reward_out_of_stock: "That reward just ran out.",
  reward_not_found: "That reward isn't available any more.",
  already_redeemed: "Already redeemed.",
  registration_closed: "Entries for this tournament are closed.",
  tournament_full: "This tournament is full.",
  wrong_team_size: "Wrong number of players for this tournament.",
  team_name_taken: "That team name is taken in this tournament.",
  player_not_found: "We couldn't find one of those usernames.",
  tournament_not_found: "That tournament isn't available.",
  wrong_password: "That password isn't right.",
  dob_locked: "Your birth date is already set — ask the staff to correct it.",
  contact_taken: "That phone number or email is already used by another account.",
  invalid_code: "That code isn't right or has expired. Ask the staff for a new one.",
  not_playing: "You're not playing right now — sign in at a PC first.",
  not_extendable: "This session can't be extended here.",
  pc_code_expired: "That PC code has expired. Scan the new one on the screen.",
  station_in_use: "That PC is already in use.",
  already_playing: "You're already signed in on another PC.",
  no_time: "You have no saved play time. Buy time first, then sign in.",
  gift_to_self: "You can't send a gift to yourself.",
  bad_amount: "That amount isn't allowed.",
  booking_not_found: "That booking isn't available.",
  booking_not_active: "That booking was cancelled or has finished.",
  wallet_not_empty: "You still have money in your wallet — spend it or ask the staff to refund it first.",
  customer_in_session: "You're playing right now — finish your session first.",
  customer_has_open_bill: "You have a bill to pay at the counter first.",
  customer_has_bookings: "Cancel your upcoming bookings first.",
  daily_limit_reached: "You've reached today's play limit.",
  customer_banned: "This account can't play right now. Please talk to the staff.",
  customer_zone_blocked: "You can't play in this area. Please talk to the staff.",
  customer_restaurant_blocked: "Food & drink orders aren't available on your account.",
  game_not_found: "That game isn't available.",
  venue_closed: "The venue is closed right now.",
  sold_out: "Something in your order just sold out.",
  guest: "Guest sessions are extended at the counter.",
  no_session: "There's no session running.",
};

function explain(status: number, body: any) {
  const code = body?.error as string | undefined;
  if (code === "already_registered" && body?.player) return t("{player} is already entered in this tournament.", { player: body.player });
  if (code === "player_not_found" && body?.usernames) return t("We couldn't find: {names}.", { names: body.usernames.join(", ") });
  if (code === "too_far_ahead" && body?.maxDays) return t("You can book up to {days} days ahead.", { days: body.maxDays });
  if (code === "daily_limit_reached" && body?.minutesLeft) return t("Only {n} min of play left today.", { n: body.minutesLeft });
  if (code && MESSAGES[code]) return t(MESSAGES[code]!);
  if (body?.hint) return t(body.hint);
  if (body?.message) return t(body.message);
  if (status === 0) return t("Can't reach the venue. Check your connection.");
  return t("Something went wrong. Please try again.");
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/v1/app${path}`, {
      method: opts.method ?? "GET",
      headers: { "content-type": "application/json", ...(opts.auth !== false && token ? { authorization: `Bearer ${token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, null);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (res.status === 401 && opts.auth !== false) {
    setToken(null);
    onSignedOut?.();
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

let onSignedOut: (() => void) | undefined;
export const whenSignedOut = (fn: () => void) => (onSignedOut = fn);

export const key = () => crypto.randomUUID();

// ── types ───────────────────────────────────────────────────────────────────

export interface Venue {
  name: string;
  currency: string;
  /** "Pay now" with a simulated card (demo installs only). */
  demoPayments: boolean;
  branches: Array<{ id: string; name: string; code: string; timezone: string; currency: string; brand: { name: string; logoUrl: string | null }; zones: Array<{ id: string; name: string; type: string; stations: number }> }>;
}
export interface Me {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  referralCode: string | null;
  dateOfBirth: string | null;
  locale: string;
  marketingConsent: boolean;
  showOnLeaderboard: boolean;
  hasPin: boolean;
  membershipTier: { id: string; name: string; code: string; color: string | null; gamingDiscountPct: string; bookingWindowDays: number; priorityBooking: boolean } | null;
  membership: { id: string; expiresAt: string | null; tier: { name: string } } | null;
  wallet: { currency: string; cash: string; bonus: string; total: string; timeMinutes: number; frozen: boolean };
  playingNow: { sessionId: string; station: string; expiresAt: string | null } | null;
}
export interface Booking {
  id: string;
  reference: string;
  status: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  players: number;
  estimatedTotal: string;
  depositAmount: string;
  currency: string;
  zone: { id: string; name: string } | null;
  branchId: string;
  devices: Array<{ id: string; name: string }>;
}
export interface LedgerRow {
  id: string;
  at: string;
  type: string;
  bucket: string;
  reason: string | null;
  amount: string | number;
  balanceAfter: string | number;
  expiresAt: string | null;
}
