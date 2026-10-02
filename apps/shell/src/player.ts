import { useEffect, useState } from "react";
import { bridge, player } from "./bridge";

/** What the venue knows about the player at this PC (see PlayerService on the server). */
export interface Challenge { id: string; name: string; rewardPoints: number; type: string; target: number; progress: number; earnedAt: string | null }
export interface Overview {
  pcBookedAt: string | null;
  help: { status: string; at: string } | null;
  customer: {
    name: string;
    tier: string | null;
    points: number;
    wallet: { currency: string; total: string; bonus: string; frozen: boolean };
    savedMinutes: number;
    minutesLeftToday: number | null;
    prefs: Prefs;
    visible: boolean;
    unread: number;
    favorites: string[];
    recent: string[];
    booking: { reference: string; startsAt: string } | null;
    tournaments: Array<{ id: string; name: string; status: string; startsAt: string }>;
    challenges: Challenge[];
  } | null;
}
export interface Prefs { mouseSpeed?: number; enhancePointerPrecision?: boolean; volume?: number; lang?: "en" | "ar" }

let current: Overview | null = null;
let sessionId: string | null = null;
let appliedFor: string | null = null;
const subs = new Set<(o: Overview | null) => void>();
const langSubs = new Set<(l: "en" | "ar") => void>();
const publish = () => subs.forEach((f) => f(current));

/** Restores the player's own settings once per session: mouse, volume, language. */
function applyPrefs(p: Prefs) {
  if (p.mouseSpeed !== undefined || p.enhancePointerPrecision !== undefined) bridge.send({ type: "pointer_apply", mouseSpeed: p.mouseSpeed, enhancePointerPrecision: p.enhancePointerPrecision });
  if (p.volume !== undefined) bridge.send({ type: "volume_set", level: p.volume });
  if (p.lang) chooseLang(p.lang);
}

export async function refreshOverview() {
  if (!sessionId) return;
  const forSession = sessionId;
  try {
    const o = await player<Overview>("overview");
    if (forSession !== sessionId) return;
    current = o;
    if (o.customer && appliedFor !== forSession) {
      appliedFor = forSession;
      applyPrefs(o.customer.prefs ?? {});
    }
    publish();
  } catch {
    /* offline: keep what we had */
  }
}

/** Called when a session starts or ends; refreshes every 30 s while one runs. */
let timer: ReturnType<typeof setInterval> | undefined;
export function setSession(id: string | null) {
  if (id === sessionId) return;
  sessionId = id;
  current = null;
  publish();
  clearInterval(timer);
  if (id) {
    void refreshOverview();
    timer = setInterval(() => void refreshOverview(), 30_000);
  }
}

export function useOverview() {
  const [o, setO] = useState(current);
  useEffect(() => {
    subs.add(setO);
    setO(current);
    return () => void subs.delete(setO);
  }, []);
  return o;
}

/** The language a signed-in player chose, restored on any PC. */
export const onLangPref = (f: (l: "en" | "ar") => void) => {
  langSubs.add(f);
  return () => void langSubs.delete(f);
};

/** Remembers a setting on the player's account (no-op for guests). Sliders send many changes: saved once they settle. */
let pending: Prefs = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function savePref(patch: Prefs) {
  if (!current?.customer) return;
  current = { ...current, customer: { ...current.customer, prefs: { ...current.customer.prefs, ...patch } } };
  pending = { ...pending, ...patch };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const send = pending;
    pending = {};
    void player("prefs_set", send as Record<string, unknown>).catch(() => undefined);
  }, 800);
}

/** The Shell's language, so the account window can show and change it. */
let lang: "en" | "ar" = "en";
export const currentLang = () => lang;
export function chooseLang(l: "en" | "ar") {
  lang = l;
  langSubs.forEach((f) => f(l));
}

/** Favourite on/off, shown at once and saved on the account. */
export async function toggleFavorite(gameId: string) {
  if (!current?.customer) return;
  const on = !current.customer.favorites.includes(gameId);
  current = { ...current, customer: { ...current.customer, favorites: on ? [...current.customer.favorites, gameId] : current.customer.favorites.filter((g) => g !== gameId) } };
  publish();
  await player("favorite", { gameId, on }).catch(() => void refreshOverview());
}

/** The session that just ended here, for the "thanks" card on the lock screen. */
export let lastEnded: { id: string; at: number } | null = null;
export const rememberEnded = (id: string) => (lastEnded = { id, at: Date.now() });
