// Talks to /v1/app/* on the same origin. The venue is the first path segment
// (arena.example.com/demo), remembered for the next visit.

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

export function venueSlug(): string {
  const fromPath = location.pathname.split("/").filter(Boolean)[0];
  const slug = fromPath && /^[a-z0-9-]{2,64}$/.test(fromPath) ? fromPath : (store.get(VENUE) ?? "demo");
  store.set(VENUE, slug);
  return slug;
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
};

function explain(status: number, body: any) {
  const code = body?.error as string | undefined;
  if (code === "already_registered" && body?.player) return `${body.player} is already entered in this tournament.`;
  if (code === "player_not_found" && body?.usernames) return `We couldn't find: ${body.usernames.join(", ")}.`;
  if (code === "too_far_ahead" && body?.maxDays) return `You can book up to ${body.maxDays} days ahead.`;
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  if (body?.hint) return body.hint;
  if (status === 0) return "Can't reach the venue. Check your connection.";
  return "Something went wrong. Please try again.";
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/v1/app${path}`, {
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
