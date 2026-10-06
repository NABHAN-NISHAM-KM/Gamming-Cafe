import { useCallback, useEffect, useState, type InputHTMLAttributes } from "react";
import {
  BarChart3, Camera, CalendarClock, Check, ChevronRight, Clock, CreditCard, Crown, Gamepad2, Gift, HeartHandshake, Home, Inbox, KeyRound, Languages, LifeBuoy, Loader2, LogOut,
  Medal, Plus, ReceiptText, ShieldCheck, ShoppingBag, Sparkles, Swords, Trophy, User, Users, UtensilsCrossed, Wallet, X,
} from "lucide-react";
import { BookingExtras, ReceiptsScreen, SeasonScreen, SpendingScreen, TableOrderSheet, TeamsScreen, WaitlistCard } from "./growth";
import { api, ApiError, key, LOCKED_VENUE, setToken, setVenue, signedIn, SLUG_RE, venueSlug, whenSignedOut, type Booking, type LedgerRow, type Me, type Venue } from "./api";
import { BookScreen } from "./book";
import { InboxScreen, RewardsScreen, ScreenshotsScreen, TournamentsScreen } from "./engage";
import { askConfirm } from "./confirm";
import { dir, getLang, locale, setLang, t, useLang } from "./i18n";
import { AddTimeSheet, ClaimSheet, FoodScreen, FriendsScreen, GamesScreen, GiftSheet, HelpScreen, LiveCard, PcLoginSheet, ProfileScreen, SplitSheet, StatsScreen, TopUpSheet } from "./more";
import { cx, ErrorText, hours, Screen, useLoad } from "./ui";

const when = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });

function Toast({ text, tone, onDone }: { text: string; tone: "good" | "bad"; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 3500);
    return () => clearTimeout(id);
  }, [text, onDone]);
  return (
    <div role="status" className={cx("glass animate-pop fixed inset-x-4 top-4 z-[60] mx-auto max-w-lg rounded-2xl border px-4 py-3 text-sm shadow-2xl", tone === "good" ? "border-good/40 text-good" : "border-alarm/50 text-alarm")}>
      {text}
    </div>
  );
}

// ── password field with an animated show/hide eye (.eye-toggle in @arena/theme) ──

function PasswordField({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input type={shown ? "text" : "password"} className={cx(className, "pe-14")} {...rest} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={shown ? t("Hide password") : t("Show password")}
        aria-pressed={shown}
        className="eye-toggle absolute inset-y-0 end-1 grid w-12 place-items-center text-mute hover:text-glow focus-visible:text-glow focus-visible:outline-none"
      >
        <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <g key={String(shown)} className="eye-lid">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle className="eye-pupil" cx={12} cy={12} r={3} />
          </g>
          <path className="eye-slash" d="M3 3l18 18" pathLength={1} />
        </svg>
      </button>
    </div>
  );
}

const LangToggle = () => (
  <button onClick={() => setLang(getLang() === "en" ? "ar" : "en")} className="flex min-h-11 items-center gap-1.5 rounded-full border border-rim px-3 text-sm text-dim">
    <Languages className="size-4" /> {getLang() === "en" ? "العربية" : "English"}
  </button>
);

// ── venue picker (APK built without a venue) ────────────────────────────────

function VenuePicker({ onPick }: { onPick: (slug: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const slug = code.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return setError(t("We couldn't find that venue."));
    setBusy(true);
    setError(null);
    try {
      await api(`/${slug}/venue`, { auth: false });
      onPick(slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("We couldn't find that venue."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-10">
      <div className="mb-8 self-end"><LangToggle /></div>
      <h1 className="font-display text-4xl font-semibold leading-tight">{t("Find your venue.")}</h1>
      <p className="mt-2 text-dim">{t("Enter the venue code from the counter or the café's poster.")}</p>
      <form className="mt-8 grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input className="field" placeholder={t("Venue code")} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" required />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary mt-2 py-4 text-lg" disabled={busy}>
          {busy && <Loader2 className="size-5 animate-spin" />} {t("Continue")}
        </button>
      </form>
    </main>
  );
}

// ── sign in / sign up / forgot password ─────────────────────────────────────

function Auth({ slug, venue, onIn, onChangeVenue, pcCode }: { slug: string; venue: Venue | undefined; onIn: () => void; onChangeVenue?: () => void; pcCode: string | null }) {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [f, setF] = useState({ username: "", password: "", displayName: "", phone: "", dateOfBirth: "", marketingConsent: false, referralCode: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "reset") {
        await api(`/${slug}/reset`, { method: "POST", auth: false, body: { username: f.username, code: f.code, password: f.password } });
        setNotice(t("Password changed — sign in with your new password."));
        setF((x) => ({ ...x, code: "", password: "" }));
        setMode("in");
        return;
      }
      const r =
        mode === "in"
          ? await api<{ accessToken: string }>(`/${slug}/login`, { method: "POST", auth: false, body: { username: f.username, password: f.password } })
          : await api<{ accessToken: string }>(`/${slug}/register`, {
              method: "POST",
              auth: false,
              body: { username: f.username, password: f.password, displayName: f.displayName || f.username, phone: f.phone || null, dateOfBirth: f.dateOfBirth || null, marketingConsent: f.marketingConsent, referralCode: f.referralCode.trim() || null },
            });
      setToken(r.accessToken);
      if (getLang() !== "en") void api("/me", { method: "PATCH", body: { locale: getLang() } }).catch(() => undefined);
      onIn();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? t("Please check the details (password: at least 8 characters).") : e instanceof Error ? e.message : t("Couldn't sign in."));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "in" ? t("Welcome back.") : mode === "up" ? t("Join in 30 seconds.") : t("Forgot your password?");
  const sub = mode === "in" ? t("Book a station, check your time and top up your game.") : mode === "up" ? t("Same login works on every PC at the venue.") : t("Ask the staff for a reset code, then choose a new password here.");
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-1/3 -top-1/4 h-[60vh] w-[90vw] rounded-full opacity-30 blur-[100px]" style={{ background: "radial-gradient(circle, var(--color-glow-2), transparent 60%)" }} />
        <div className="absolute -bottom-1/4 -right-1/3 h-[50vh] w-[80vw] rounded-full opacity-20 blur-[100px]" style={{ background: "radial-gradient(circle, var(--color-glow), transparent 60%)" }} />
      </div>
      <div className="mb-10 flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-2xl brand-gradient shadow-glow font-display text-xl font-bold text-void">{(venue?.name ?? "A").slice(0, 1)}</div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-semibold">{venue?.name ?? "…"}</p>
          <p className="truncate text-sm text-dim">{venue?.branches.map((b) => b.name).join(" · ")}</p>
        </div>
        <LangToggle />
      </div>
      {pcCode && <p className="mb-6 rounded-xl border border-glow/40 bg-glow/10 px-4 py-3 text-sm">{t("Sign in to start playing on the PC you scanned.")}</p>}
      <h1 className="font-display text-4xl font-semibold leading-tight">{title}</h1>
      <p className="mt-2 text-dim">{sub}</p>
      <form className="mt-8 grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {mode === "up" && <input className="field" placeholder={t("Your name")} value={f.displayName} onChange={set("displayName")} autoComplete="name" />}
        <input className="field" placeholder={mode === "up" ? t("Username") : t("Username, email or phone")} value={f.username} onChange={set("username")} autoComplete="username" autoCapitalize="none" required />
        {mode === "reset" && <input className="field tracking-[0.4em]" inputMode="numeric" placeholder={t("6-digit code from the staff")} value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))} required minLength={6} />}
        <PasswordField className="field" placeholder={mode === "reset" ? t("New password") : t("Password")} value={f.password} onChange={set("password")} autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "in" ? 1 : 8} />
        {mode === "up" && (
          <>
            <input className="field" type="tel" dir="ltr" placeholder={t("Phone (optional)")} value={f.phone} onChange={set("phone")} autoComplete="tel" />
            <input className="field uppercase placeholder:normal-case" placeholder={t("Friend's invite code (optional)")} value={f.referralCode} onChange={set("referralCode")} maxLength={16} />
            <label className="grid gap-1.5 text-sm text-dim">
              {t("Date of birth (optional — for age-rated games)")}
              <input className="field" type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} />
            </label>
            <label className="flex items-center gap-3 text-sm text-dim">
              <input type="checkbox" checked={f.marketingConsent} onChange={(e) => setF((x) => ({ ...x, marketingConsent: e.target.checked }))} className="size-5 accent-[var(--color-glow)]" />
              {t("Tell me about tournaments and offers")}
            </label>
          </>
        )}
        {notice && <p role="status" className="rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-sm text-good">{notice}</p>}
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary mt-2 py-4 text-lg" disabled={busy}>
          {busy && <Loader2 className="size-5 animate-spin" />} {mode === "in" ? t("Sign in") : mode === "up" ? t("Create account") : t("Set new password")}
        </button>
      </form>
      {mode === "in" && (
        <button onClick={() => { setMode("reset"); setError(null); setNotice(null); }} className="mt-4 min-h-11 text-center text-sm text-dim">
          <KeyRound className="me-1 inline size-4" /> {t("Forgot password?")}
        </button>
      )}
      <button onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); setNotice(null); }} className="mt-2 min-h-11 text-center text-sm text-dim">
        {mode === "in" ? <>{t("New here?")} <span className="text-glow">{t("Create an account")}</span></> : <>{t("Have an account?")} <span className="text-glow">{t("Sign in")}</span></>}
      </button>
      {onChangeVenue && (
        <button onClick={onChangeVenue} className="min-h-11 text-center text-sm text-mute">
          {t("Not {venue}?", { venue: venue?.name ?? t("this venue") })} <span className="text-glow">{t("Change venue")}</span>
        </button>
      )}
    </main>
  );
}

// ── home ────────────────────────────────────────────────────────────────────

function HomeScreen({ me, venue, bookings, go, unread, addTime, toast }: { me: Me; venue: Venue; bookings: Booking[]; go: (t: Tab) => void; unread: number; addTime: () => void; toast: (t: string, ok?: boolean) => void }) {
  const next = bookings.filter((b) => ["CONFIRMED", "CHECKED_IN"].includes(b.status) && new Date(b.endsAt) > new Date()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const tier = me.membershipTier;
  const tiles: Array<[Tab, string, typeof Home, string, number?]> = [
    ["events", "Tournaments", Trophy, "text-glow"],
    ["inbox", "Inbox", Inbox, "text-glow-2", unread],
    ["games", "Games", Gamepad2, "text-glow"],
    ["friends", "Friends", Users, "text-glow-2"],
    ["wallet", "Wallet", Wallet, "text-glow"],
    ["screenshots", "Screenshots", Camera, "text-glow-2"],
    ["stats", "My stats", BarChart3, "text-glow"],
    ["help", "Help", LifeBuoy, "text-glow-2"],
    ["season", "Season pass", Medal, "text-glow-2"],
    ["teams", "Find a team", Swords, "text-glow"],
  ];
  return (
    <Screen title={t("Hi, {name}", { name: me.displayName.split(" ")[0] ?? "" })}>
      <div className="relative overflow-hidden rounded-3xl border border-rim p-6" style={{ background: "radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--color-glow-2) 22%, transparent), transparent 55%), linear-gradient(135deg, color-mix(in oklab, var(--color-glow) 38%, var(--color-deck)), var(--color-deck) 72%)", boxShadow: "var(--shadow-lift)" }}>
        <p className="text-sm text-dim">{t("Wallet")}</p>
        <p className="tabular mt-1 font-display text-4xl font-semibold" dir="ltr">{me.wallet.currency} {me.wallet.total}</p>
        {Number(me.wallet.bonus) > 0 && <p className="mt-1 text-sm text-glow">{t("incl. {amount} bonus", { amount: me.wallet.bonus })}</p>}
        <div className="mt-5 flex items-center gap-2 text-sm">
          <Clock className="size-4 text-glow" /> <span className="tabular">{hours(me.wallet.timeMinutes)}</span> <span className="text-dim">{t("of prepaid play time")}</span>
        </div>
        {me.wallet.frozen && <p className="mt-3 rounded-xl bg-alarm/15 px-3 py-2 text-sm text-alarm">{t("Your wallet is on hold — please talk to the staff.")}</p>}
        {tier && (
          <span className="absolute end-5 top-5 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-void" style={{ background: tier.color ?? "var(--color-glow)" }}>
            <Crown className="size-3.5" /> {tier.name}
          </span>
        )}
      </div>

      {me.playingNow && (
        <div className="card mt-4 border-good/40 p-5">
          <div className="flex items-center gap-4">
            <span className="live-dot size-2.5 rounded-full bg-good text-good" />
            <div className="flex-1">
              <p className="font-semibold">{t("Playing on {station}", { station: me.playingNow.station })}</p>
              <p className="text-sm text-dim">{me.playingNow.expiresAt ? t("Until {time}", { time: time(me.playingNow.expiresAt) }) : t("Open session — pay at the end")}</p>
            </div>
            <Gamepad2 className="size-6 text-good" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {me.playingNow.expiresAt && <button onClick={addTime} className="btn btn-ghost py-2.5"><Plus className="size-4" /> {t("Add time")}</button>}
            <button onClick={() => go("food")} className={cx("btn btn-ghost py-2.5", !me.playingNow.expiresAt && "col-span-2")}><UtensilsCrossed className="size-4" /> {t("Order food")}</button>
          </div>
        </div>
      )}

      <button onClick={() => go("bookings")} className="card press hover:border-rim mt-4 flex w-full items-center gap-4 p-5 text-start">
        <CalendarClock className="size-7 text-glow" />
        <div className="flex-1">
          {next ? (
            <>
              <p className="font-semibold">{when(next.startsAt)}</p>
              <p className="text-sm text-dim">{next.zone?.name} · {hours(next.minutes)} · {next.players === 1 ? t("1 station") : t("{n} stations", { n: next.players })} · {next.reference}</p>
            </>
          ) : (
            <>
              <p className="font-semibold">{t("No upcoming booking")}</p>
              <p className="text-sm text-dim">{t("Reserve your station before you come.")}</p>
            </>
          )}
        </div>
        <ChevronRight className={cx("size-5 text-mute", dir() === "rtl" && "rotate-180")} />
      </button>

      {!me.playingNow && <WaitlistCard toast={toast} />}
      {!me.playingNow && <LiveCard multiBranch={venue.branches.length > 1} />}

      <div className="mt-4 grid grid-cols-4 gap-2">
        {tiles.map(([id, label, Icon, tone, badge]) => (
          <button key={id} onClick={() => go(id)} className="card press hover:border-rim relative flex flex-col items-center gap-1.5 px-1 py-3 text-center text-xs">
            <Icon className={cx("size-6", tone)} /> {t(label)}
            {!!badge && <span className="absolute end-2 top-2 grid size-5 place-items-center rounded-full bg-alarm text-[11px] font-bold text-white">{badge}</span>}
          </button>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button onClick={() => go("book")} className="btn btn-primary py-5"><CalendarClock className="size-5" /> {t("Book")}</button>
        <button onClick={() => go("shop")} className="btn btn-ghost py-5"><ShoppingBag className="size-5" /> {t("Buy time")}</button>
      </div>
      {!tier && (
        <button onClick={() => go("shop")} className="card press hover:border-rim mt-4 flex w-full items-center gap-4 p-5 text-start">
          <Sparkles className="size-6 text-glow-2" />
          <div className="flex-1">
            <p className="font-semibold">{t("Become a member")}</p>
            <p className="text-sm text-dim">{t("Cheaper hours, bonus time, book further ahead.")}</p>
          </div>
          <ChevronRight className={cx("size-5 text-mute", dir() === "rtl" && "rotate-180")} />
        </button>
      )}
    </Screen>
  );
}

// ── bookings ────────────────────────────────────────────────────────────────

const BOOKING_STATUS: Record<string, string> = { CONFIRMED: "confirmed", CHECKED_IN: "checked in", PENDING: "pending", CANCELLED: "cancelled", COMPLETED: "completed", NO_SHOW: "no show" };

function BookingsScreen({ bookings, reload, toast }: { bookings: Booking[]; reload: () => void; toast: (t: string, ok?: boolean) => void }) {
  const upcoming = bookings.filter((b) => ["CONFIRMED", "PENDING", "CHECKED_IN"].includes(b.status) && new Date(b.endsAt) > new Date());
  const past = bookings.filter((b) => !upcoming.includes(b));
  const [split, setSplit] = useState<Booking | null>(null);
  const cancel = async (b: Booking) => {
    if (!(await askConfirm(t("Cancel booking {ref}?", { ref: b.reference }), { ok: t("Cancel booking"), cancel: t("Keep it") }))) return;
    try {
      await api(`/bookings/${b.id}/cancel`, { method: "POST" });
      toast(t("Booking cancelled."));
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't cancel."), false);
    }
  };
  const Row = ({ b }: { b: Booking }) => (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{when(b.startsAt)}</p>
          <p className="text-sm text-dim">{b.zone?.name} · {hours(b.minutes)} · {b.players === 1 ? t("1 station") : t("{n} stations", { n: b.players })}</p>
          <p className="mt-1 font-mono text-xs text-mute">{b.reference}{b.devices.length ? ` · ${b.devices.map((d) => d.name).join(", ")}` : ""}</p>
          {Number(b.depositAmount) > 0 && <p className="mt-1 text-xs text-good">{t("Paid {amount}", { amount: `${b.currency} ${b.depositAmount}` })}</p>}
        </div>
        <span className={cx("rounded-full px-2.5 py-1 text-xs", b.status === "CONFIRMED" ? "bg-glow/15 text-glow" : b.status === "CHECKED_IN" ? "bg-good/15 text-good" : "bg-deck-2 text-dim")}>{t(BOOKING_STATUS[b.status] ?? b.status.toLowerCase())}</span>
      </div>
      {["CONFIRMED", "PENDING"].includes(b.status) && (
        <div className="mt-4 flex gap-4">
          <button onClick={() => setSplit(b)} className="flex items-center gap-1.5 text-sm text-glow"><HeartHandshake className="size-4" /> {t("Split with friends")}</button>
          {b.status === "CONFIRMED" && <button onClick={() => void cancel(b)} className="flex items-center gap-1.5 text-sm text-alarm"><X className="size-4" /> {t("Cancel")}</button>}
          <BookingExtras b={b} toast={toast} onChanged={reload} />
        </div>
      )}
    </div>
  );
  return (
    <Screen title={t("My bookings")}>
      <div className="grid gap-3">
        {upcoming.map((b) => <Row key={b.id} b={b} />)}
        {upcoming.length === 0 && <p className="card p-6 text-center text-dim">{t("Nothing booked yet.")}</p>}
      </div>
      {past.length > 0 && (
        <>
          <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">{t("Earlier")}</p>
          <div className="grid gap-3 opacity-70">{past.slice(0, 10).map((b) => <Row key={b.id} b={b} />)}</div>
        </>
      )}
      {split && <SplitSheet booking={split} onClose={() => setSplit(null)} toast={toast} />}
    </Screen>
  );
}

// ── shop ────────────────────────────────────────────────────────────────────

interface Shop {
  plans: Array<{
    id: string; name: string; currency: string; zone: { name: string } | null;
    rate?: string; billingMode?: string; paymentTiming?: string; schedule?: Array<{ days: string[]; from: string; to: string }>;
    passStartTime?: string | null; passEndTime?: string | null; membershipTier?: { name: string } | null;
    pricingPackages: Array<{ id: string; name: string; durationMinutes: number; bonusMinutes: number; price: string }> }>;
  tiers: Array<{ id: string; name: string; code: string; color: string | null; price: string; durationDays: number; gamingDiscountPct: string; bonusMinutesMonthly: number; bookingWindowDays: number; priorityBooking: boolean }>;
}

function ShopScreen({ venue, me, onBought, toast }: { venue: Venue; me: Me; onBought: () => void; toast: (t: string, ok?: boolean) => void }) {
  const [branchId, setBranch] = useState(venue.branches[0]?.id ?? "");
  const shop = useLoad(() => api<Shop>(`/shop?branchId=${branchId}`), [branchId]);
  const [busy, setBusy] = useState<string | null>(null);
  const buy = async (id: string, path: string, body: Record<string, unknown>, what: string) => {
    if (!(await askConfirm(t("Pay for {what} from your wallet?", { what }), { ok: t("Pay"), cancel: t("Cancel") }))) return;
    setBusy(id);
    try {
      await api(path, { method: "POST", body: { branchId, ...body, idempotencyKey: key() } });
      toast(t("{what} — done!", { what }));
      onBought();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't buy."), false);
    } finally {
      setBusy(null);
    }
  };
  const cur = me.wallet.currency;
  const DAYS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  return (
    <Screen title={t("Shop")} action={<span className="tabular rounded-full bg-deck-2 px-3 py-1.5 text-sm" dir="ltr">{cur} {me.wallet.total}</span>}>
      {venue.branches.length > 1 && (
        <select className="field mb-5" value={branchId} onChange={(e) => setBranch(e.target.value)}>
          {venue.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <p className="mb-3 text-sm uppercase tracking-widest text-mute">{t("Play time")}</p>
      {!shop.data ? <p className="text-dim">{t("Loading…")}</p> : (
        <div className="grid gap-3">
          {!shop.data.plans.some((p) => p.pricingPackages.length) && <p className="text-dim">{t("No play-time packages here yet — ask at the counter.")}</p>}
          {shop.data.plans.flatMap((p) =>
            p.pricingPackages.map((k) => (
              <div key={k.id} className="card flex items-center gap-4 p-5">
                <Clock className="size-7 text-glow" />
                <div className="flex-1">
                  <p className="font-semibold">{k.name} · {p.name}</p>
                  <p className="text-sm text-dim">{hours(k.durationMinutes + k.bonusMinutes)}{k.bonusMinutes ? ` (${t("incl. {n} min bonus", { n: k.bonusMinutes })})` : ""}{p.zone ? ` · ${t("{zone} only", { zone: p.zone.name })}` : ""}</p>
                </div>
                <button className="btn btn-primary px-4 py-2.5" disabled={busy === k.id || me.wallet.frozen} onClick={() => void buy(k.id, "/time", { planId: p.id, packageId: k.id }, t("{name} of play time", { name: k.name }))}>
                  {busy === k.id ? <Loader2 className="size-4 animate-spin" /> : `${cur} ${Number(k.price).toFixed(0)}`}
                </button>
              </div>
            )),
          )}
        </div>
      )}
      {shop.data?.plans.some((p) => p.rate) && (
        <>
          <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">{t("Prices")}</p>
          <div className="card divide-y divide-rim">
            {shop.data.plans.filter((p) => p.rate).map((p) => {
              const whenText = [
                ...(p.schedule ?? []).map((w) => `${w.days.map((d) => t(DAYS[d] ?? d)).join(", ")} ${w.from}–${w.to}`),
                p.passStartTime && p.passEndTime ? `${p.passStartTime}–${p.passEndTime}` : "",
                p.zone ? t("{zone} only", { zone: p.zone.name }) : "",
                p.membershipTier ? t("{tier} members", { tier: p.membershipTier.name }) : "",
                p.paymentTiming === "POSTPAID" ? t("pay after you play") : "",
              ].filter(Boolean).join(" · ");
              const unit = p.billingMode === "PER_HOUR" ? t("/hr") : p.billingMode === "PER_MINUTE" ? t("/min") : p.billingMode === "DAY_PASS" ? ` ${t("day pass")}` : p.billingMode === "NIGHT_PASS" ? ` ${t("night pass")}` : "";
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    {whenText && <p className="text-sm text-dim">{whenText}</p>}
                  </div>
                  <p className="tabular shrink-0 font-semibold">{p.currency} {Number(p.rate).toFixed(0)}<span className="text-sm font-normal text-dim">{unit}</span></p>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">{t("Membership")}</p>
      <div className="grid gap-3">
        {shop.data?.tiers.map((tier) => {
          const mine = me.membershipTier?.id === tier.id;
          return (
            <div key={tier.id} className="card overflow-hidden">
              <div className="h-1.5" style={{ background: tier.color ?? "var(--color-glow)" }} />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-display text-xl font-semibold"><Crown className="size-5" style={{ color: tier.color ?? undefined }} /> {tier.name}</p>
                  <p className="tabular font-display text-lg">{cur} {Number(tier.price).toFixed(0)}<span className="text-sm text-dim"> / {t("{n} days", { n: tier.durationDays })}</span></p>
                </div>
                <ul className="mt-3 grid gap-1.5 text-sm text-dim">
                  <li className="flex gap-2"><Check className="size-4 text-good" /> {t("{n}% off gaming time", { n: Number(tier.gamingDiscountPct) })}</li>
                  {tier.bonusMinutesMonthly > 0 && <li className="flex gap-2"><Check className="size-4 text-good" /> {t("{time} free play time", { time: hours(tier.bonusMinutesMonthly) })}</li>}
                  <li className="flex gap-2"><Check className="size-4 text-good" /> {t("Book up to {n} days ahead", { n: tier.bookingWindowDays })}</li>
                  {tier.priorityBooking && <li className="flex gap-2"><Check className="size-4 text-good" /> {t("Priority booking")}</li>}
                </ul>
                <button className={cx("btn mt-4 w-full", mine ? "btn-ghost" : "btn-primary")} disabled={busy === tier.id || me.wallet.frozen} onClick={() => void buy(tier.id, "/memberships", { tierId: tier.id }, t("{name} membership", { name: tier.name }))}>
                  {busy === tier.id && <Loader2 className="size-4 animate-spin" />} {mine ? t("Renew") : t("Join")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-mute">{venue.demoPayments ? t("Top up your wallet in the Wallet screen or at the counter.") : t("Top up your wallet at the counter — card and cash.")}</p>
    </Screen>
  );
}

// ── wallet & me ─────────────────────────────────────────────────────────────

const TX_LABEL: Record<string, string> = { TOPUP: "Top-up", SPEND: "Payment", REFUND: "Refund", ADJUSTMENT: "Adjustment", BONUS_GRANT: "Bonus", BONUS_EXPIRE: "Bonus expired", TRANSFER_IN: "Received", TRANSFER_OUT: "Sent" };

function WalletScreen({ me, venue, back, toast, onChanged }: { me: Me; venue: Venue; back: () => void; toast: (t: string, ok?: boolean) => void; onChanged: () => void }) {
  const w = useLoad(() => api<{ ledger: LedgerRow[] }>("/wallet"), [me]); // reloads with every live refresh of `me`
  const [sheet, setSheet] = useState<"topup" | "gift" | null>(null);
  return (
    <Screen title={t("Wallet")} back={back}>
      <div className="grid grid-cols-3 gap-3">
        {[[t("Cash"), me.wallet.cash], [t("Bonus"), me.wallet.bonus], [t("Play time"), hours(me.wallet.timeMinutes)]].map(([k, v]) => (
          <div key={k} className="card p-4"><p className="text-xs text-dim">{k}</p><p className="tabular mt-1 font-display text-lg font-semibold">{v}</p></div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button className="btn btn-primary" onClick={() => setSheet("topup")} disabled={me.wallet.frozen}><CreditCard className="size-5" /> {t("Top up")}</button>
        <button className="btn btn-ghost" onClick={() => setSheet("gift")} disabled={me.wallet.frozen}><Gift className="size-5" /> {t("Send a gift")}</button>
      </div>
      <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">{t("History")}</p>
      <div className="card divide-y divide-rim">
        {w.data?.ledger.map((l) => {
          const n = Number(l.amount);
          return (
            <div key={l.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-medium">{t(TX_LABEL[l.type] ?? l.type)}{l.bucket === "TIME" ? ` · ${t("time")}` : l.bucket === "BONUS" ? ` · ${t("bonus")}` : ""}</p>
                <p className="text-xs text-mute">{new Date(l.at).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{l.reason ? ` · ${l.reason}` : ""}</p>
              </div>
              <p className={cx("tabular font-mono", n > 0 ? "text-good" : "text-text")} dir="ltr">{n > 0 ? "+" : ""}{l.bucket === "TIME" ? `${n < 0 ? "−" : ""}${hours(Math.abs(n))}` : l.amount}</p>
            </div>
          );
        })}
        {w.data?.ledger.length === 0 && <p className="p-6 text-center text-dim">{t("No transactions yet.")}</p>}
        {!w.data && <p className="p-6 text-center text-dim">{t("Loading…")}</p>}
      </div>
      {sheet === "topup" && <TopUpSheet me={me} venue={venue} onClose={() => setSheet(null)} onDone={() => { setSheet(null); onChanged(); }} toast={toast} />}
      {sheet === "gift" && <GiftSheet me={me} onClose={() => setSheet(null)} onDone={() => { setSheet(null); onChanged(); }} toast={toast} />}
    </Screen>
  );
}

function MeScreen({ me, venue, go, onOut }: { me: Me; venue: Venue; go: (t: Tab) => void; onOut: () => void }) {
  const links: Array<[Tab, string, typeof Home]> = [["profile", "Profile & settings", User], ["wallet", "Wallet", Wallet], ["receipts", "Receipts", ReceiptText], ["spending", "Spending limit", ShieldCheck], ["stats", "My stats", BarChart3], ["friends", "Friends & gifts", Users], ["help", "Help", LifeBuoy]];
  return (
    <Screen title={t("Me")}>
      <div className="card flex items-center gap-4 p-5">
        <div className="grid size-14 place-items-center rounded-full brand-gradient font-display text-2xl font-bold text-void">{me.displayName.slice(0, 1)}</div>
        <div>
          <p className="font-display text-xl font-semibold">{me.displayName}</p>
          <p className="text-sm text-dim" dir="ltr">@{me.username}</p>
        </div>
      </div>
      <div className="card mt-4 divide-y divide-rim text-sm">
        <div className="flex justify-between px-5 py-4"><span className="text-dim">{t("Venue")}</span><span>{venue.name}</span></div>
        <div className="flex justify-between px-5 py-4"><span className="text-dim">{t("Membership")}</span><span>{me.membershipTier ? `${me.membershipTier.name}${me.membership?.expiresAt ? ` · ${t("until {date}", { date: new Date(me.membership.expiresAt).toLocaleDateString(locale()) })}` : ""}` : "—"}</span></div>
        {me.referralCode && <div className="flex justify-between px-5 py-4"><span className="text-dim">{t("Invite code")}</span><span className="font-mono">{me.referralCode}</span></div>}
      </div>
      <div className="card mt-4 divide-y divide-rim">
        {links.map(([id, label, Icon]) => (
          <button key={id} onClick={() => go(id)} className="flex w-full items-center gap-3 px-5 py-4 text-start">
            <Icon className="size-5 text-glow" /><span className="flex-1">{t(label)}</span><ChevronRight className={cx("size-5 text-mute", dir() === "rtl" && "rotate-180")} />
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-dim">{t("Use the same username and password at any PC in the venue.")}</p>
      <button onClick={onOut} className="btn btn-ghost mt-6 w-full text-alarm"><LogOut className="size-5" /> {t("Sign out")}</button>
    </Screen>
  );
}

// ── root ────────────────────────────────────────────────────────────────────

type Tab = "home" | "book" | "bookings" | "shop" | "wallet" | "me" | "rewards" | "events" | "inbox" | "screenshots" | "food" | "games" | "friends" | "help" | "stats" | "profile" | "orders" | "season" | "teams" | "spending" | "receipts";
const NAV: Array<{ id: Tab; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "book", label: "Book", icon: CalendarClock },
  { id: "shop", label: "Shop", icon: ShoppingBag },
  { id: "rewards", label: "Rewards", icon: Gift },
  { id: "me", label: "Me", icon: User },
];
const TABS = new Set<string>(["home", "book", "bookings", "shop", "wallet", "me", "rewards", "events", "inbox", "screenshots", "food", "games", "friends", "help", "stats", "profile", "orders", "season", "teams", "spending", "receipts"]);

// Opened from a PC's QR code (?pc=CODE) or a notification (?screen=…): remembered across signing in.
const params = new URLSearchParams(location.search);
const startPc = params.get("pc")?.toUpperCase().replace(/[^A-Z0-9]/g, "") || sessionStorage.getItem("arena.pc") || null;
const startClaim = params.get("claim")?.toUpperCase().replace(/[^A-Z0-9]/g, "") || sessionStorage.getItem("arena.claim") || null;
const startScreen = params.get("screen");
// A table's QR code (?table=ID) opens its menu; ?topup=done is the card payment page sending them back.
const startTable = params.get("table")?.match(/^[0-9a-f-]{36}$/i)?.[0] || sessionStorage.getItem("arena.table") || null;
const startTopUp = params.get("topup");
if (params.has("pc") || params.has("claim") || params.has("screen") || params.has("table") || params.has("topup")) history.replaceState(null, "", location.pathname);
if (startTable) sessionStorage.setItem("arena.table", startTable);
if (startPc) sessionStorage.setItem("arena.pc", startPc);
if (startClaim) sessionStorage.setItem("arena.claim", startClaim);

export function App() {
  useLang(); // re-render everything when the language changes
  const [authed, setAuthed] = useState(signedIn());
  const [tab, setTabState] = useState<Tab>(startScreen && TABS.has(startScreen) ? (startScreen === "orders" ? "food" : (startScreen as Tab)) : "home");
  const setTab = useCallback((t: Tab) => {
    setTabState(t === "orders" ? "food" : t);
    scrollTo(0, 0);
  }, []);
  const [toast, setToastState] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const showToast = useCallback((text: string, ok = true) => setToastState({ text, tone: ok ? "good" : "bad" }), []);
  const [pcCode, setPcCode] = useState<string | null>(startPc);
  const [claimCode, setClaimCode] = useState<string | null>(startClaim);
  const [addingTime, setAddingTime] = useState(false);
  const [tableId, setTableId] = useState<string | null>(startTable);
  // Back from the card payment page: the wallet is credited once the payment is confirmed (usually within seconds).
  useEffect(() => {
    if (startTopUp === "done") showToast(t("Payment received — your wallet updates in a moment."));
    if (startTopUp === "cancelled") showToast(t("Top-up cancelled."), false);
  }, [showToast]);
  const [slug] = useState(venueSlug);
  // Only the app (hosted API, no venue built in) can switch; on the web the venue is the URL.
  const pick = (s: string | null) => { setVenue(s); location.reload(); };
  const changeVenue = import.meta.env.VITE_ARENA_API && !LOCKED_VENUE ? () => pick(null) : undefined;
  const venue = useLoad(() => (slug ? api<Venue>(`/${slug}/venue`, { auth: false }) : new Promise<Venue>(() => {})));
  const [me, setMe] = useState<Me | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(async () => {
    if (!signedIn()) return;
    const inbox = await api<Array<{ readAt: string | null }>>("/inbox").catch(() => []);
    setUnread(inbox.filter((m) => !m.readAt).length);
  }, []);

  useEffect(() => whenSignedOut(() => { setAuthed(false); setMe(null); }), []);
  const refresh = useCallback(async () => {
    if (!signedIn()) return;
    try {
      const [m, b] = await Promise.all([api<Me>("/me"), api<Booking[]>("/bookings")]);
      setMe(m);
      setBookings(b);
      if ((m.locale === "ar" || m.locale === "en") && m.locale !== getLang()) setLang(m.locale);
    } catch {
      /* 401 handled by whenSignedOut */
    }
  }, []);
  useEffect(() => {
    if (authed) {
      void refresh();
      void refreshUnread();
    }
  }, [authed, refresh, refreshUnread]);
  // Near-live: refresh while the app is on screen and the moment it comes back.
  // ponytail: 10 s polling, a customer event stream if that's not live enough.
  useEffect(() => {
    if (!authed) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      void refreshUnread();
    };
    const id = setInterval(tick, 10_000);
    addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [authed, refresh, refreshUnread]);
  // A tapped notification while the app is open: go to its screen.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const s = (e.data as { screen?: string } | null)?.screen;
      if (s && TABS.has(s)) setTab(s as Tab);
      void refresh();
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [setTab, refresh]);

  if (!slug) return <VenuePicker onPick={pick} />;
  if (venue.error)
    return (
      <main className="grid min-h-dvh place-content-center gap-4 p-8 text-center text-dim">
        {venue.error}
        {changeVenue && <button onClick={changeVenue} className="text-glow">{t("Change venue")}</button>}
      </main>
    );
  if (!authed) return <Auth slug={slug} venue={venue.data} onIn={() => setAuthed(true)} onChangeVenue={changeVenue} pcCode={pcCode ?? claimCode} />;
  if (!me || !venue.data) return <main className="grid min-h-dvh place-items-center"><Loader2 className="size-8 animate-spin text-glow" /></main>;

  const signOut = async () => {
    await api("/logout", { method: "POST" }).catch(() => undefined);
    setToken(null);
    setAuthed(false);
    setMe(null);
  };
  const home = () => setTab("home");
  const closePc = () => {
    sessionStorage.removeItem("arena.pc");
    setPcCode(null);
  };
  const closeClaim = () => {
    sessionStorage.removeItem("arena.claim");
    setClaimCode(null);
  };

  return (
    <div className="min-h-dvh">
      {toast && <Toast text={toast.text} tone={toast.tone} onDone={() => setToastState(null)} />}
      {tab === "home" && <HomeScreen me={me} venue={venue.data} bookings={bookings} go={setTab} unread={unread} addTime={() => setAddingTime(true)} toast={showToast} />}
      {tab === "book" && <BookScreen venue={venue.data} me={me} toast={showToast} onBooked={() => { void refresh(); setTab("bookings"); }} />}
      {tab === "bookings" && <BookingsScreen bookings={bookings} reload={() => void refresh()} toast={showToast} />}
      {tab === "shop" && <ShopScreen venue={venue.data} me={me} toast={showToast} onBought={() => void refresh()} />}
      {tab === "wallet" && <WalletScreen me={me} venue={venue.data} back={home} toast={showToast} onChanged={() => void refresh()} />}
      {tab === "me" && <MeScreen me={me} venue={venue.data} go={setTab} onOut={() => void signOut()} />}
      {tab === "rewards" && <RewardsScreen me={me} toast={showToast} onChanged={() => void refresh()} />}
      {tab === "events" && <TournamentsScreen toast={showToast} onChanged={() => void refresh()} />}
      {tab === "inbox" && <InboxScreen back={home} onRead={() => void refreshUnread()} toast={showToast} onChanged={() => void refresh()} />}
      {tab === "screenshots" && <ScreenshotsScreen back={home} toast={showToast} />}
      {tab === "food" && <FoodScreen me={me} back={home} toast={showToast} onOrdered={() => void refresh()} />}
      {tab === "games" && <GamesScreen venue={venue.data} back={home} toast={showToast} />}
      {tab === "friends" && <FriendsScreen me={me} venue={venue.data} back={home} toast={showToast} onChanged={() => void refresh()} />}
      {tab === "help" && <HelpScreen back={home} toast={showToast} />}
      {tab === "stats" && <StatsScreen me={me} back={home} />}
      {tab === "profile" && <ProfileScreen me={me} back={() => setTab("me")} toast={showToast} onChanged={() => void refresh()} />}
      {tab === "season" && <SeasonScreen back={home} toast={showToast} onChanged={() => void refresh()} />}
      {tab === "teams" && <TeamsScreen back={home} toast={showToast} branches={venue.data.branches} />}
      {tab === "spending" && <SpendingScreen back={() => setTab("me")} toast={showToast} />}
      {tab === "receipts" && <ReceiptsScreen back={() => setTab("me")} />}
      {addingTime && me.playingNow && <AddTimeSheet station={me.playingNow.station} onClose={() => setAddingTime(false)} onDone={() => { setAddingTime(false); void refresh(); }} toast={showToast} />}
      {pcCode && <PcLoginSheet code={pcCode} onClose={closePc} onDone={() => { closePc(); void refresh(); }} toast={showToast} />}
      {tableId && !pcCode && <TableOrderSheet tableId={tableId} me={me} onClose={() => { setTableId(null); sessionStorage.removeItem("arena.table"); void refresh(); }} toast={showToast} />}
      {claimCode && !pcCode && <ClaimSheet code={claimCode} onClose={closeClaim} onDone={() => { closeClaim(); void refresh(); }} toast={showToast} />}
      <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0" aria-label={t("Main")}>
        <div className="mx-auto flex max-w-lg justify-around pt-2">
          {NAV.map((n) => {
            const active = tab === n.id || (n.id === "book" && tab === "bookings") || (n.id === "me" && ["profile", "stats", "friends", "help", "spending", "receipts"].includes(tab));
            return (
              <button key={n.id} onClick={() => setTab(n.id)} className={cx("press relative flex min-h-12 w-16 flex-col items-center gap-1 py-1 text-[11px] font-medium", active ? "text-text" : "text-mute")} aria-current={active ? "page" : undefined}>
                {active && <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-glow shadow-[0_0_10px_var(--color-glow)]" aria-hidden />}
                <n.icon className={cx("size-6 transition-colors", active && "text-glow")} />
                {t(n.label)}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
