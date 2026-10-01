import { useCallback, useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Camera, CalendarClock, Check, ChevronRight, Clock, Crown, Gamepad2, Gift, Home, Inbox, Loader2, LogOut, ShoppingBag, Sparkles, Trophy, User, Users, Wallet, X } from "lucide-react";
import { api, ApiError, key, LOCKED_VENUE, setToken, setVenue, signedIn, SLUG_RE, venueSlug, whenSignedOut, type Booking, type LedgerRow, type Me, type Venue } from "./api";
import { BookScreen } from "./book";
import { InboxScreen, RewardsScreen, ScreenshotsScreen, TournamentsScreen } from "./engage";
import { askConfirm } from "./confirm";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fn().then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Screen({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="animate-enter mx-auto w-full max-w-lg px-4 pb-28 pt-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-[1.75rem] font-semibold">{title}</h1>
        {action}
      </div>
      {children}
    </section>
  );
}

function Toast({ text, tone, onDone }: { text: string; tone: "good" | "bad"; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return (
    <div role="status" className={cx("glass animate-pop fixed inset-x-4 top-4 z-50 mx-auto max-w-lg rounded-2xl border px-4 py-3 text-sm shadow-2xl", tone === "good" ? "border-good/40 text-good" : "border-alarm/50 text-alarm")}>
      {text}
    </div>
  );
}

// ── password field with an animated show/hide eye (.eye-toggle in @arena/theme) ──

function PasswordField({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input type={shown ? "text" : "password"} className={cx(className, "pr-14")} {...rest} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="eye-toggle absolute inset-y-0 right-1 grid w-12 place-items-center text-mute hover:text-glow focus-visible:text-glow focus-visible:outline-none"
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

// ── venue picker (APK built without a venue) ────────────────────────────────

function VenuePicker({ onPick }: { onPick: (slug: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const slug = code.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return setError("We couldn't find that venue.");
    setBusy(true);
    setError(null);
    try {
      await api(`/${slug}/venue`, { auth: false });
      onPick(slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't find that venue.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-10">
      <h1 className="font-display text-4xl font-semibold leading-tight">Find your venue.</h1>
      <p className="mt-2 text-dim">Enter the venue code from the counter or the café's poster.</p>
      <form className="mt-8 grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input className="field" placeholder="Venue code" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" required />
        {error && <p role="alert" className="rounded-xl border border-alarm/40 bg-alarm/10 px-4 py-3 text-sm text-alarm">{error}</p>}
        <button className="btn btn-primary mt-2 py-4 text-lg" disabled={busy}>
          {busy && <Loader2 className="size-5 animate-spin" />} Continue
        </button>
      </form>
    </main>
  );
}

// ── sign in / sign up ───────────────────────────────────────────────────────

function Auth({ slug, venue, onIn, onChangeVenue }: { slug: string; venue: Venue | undefined; onIn: () => void; onChangeVenue?: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [f, setF] = useState({ username: "", password: "", displayName: "", phone: "", dateOfBirth: "", marketingConsent: false, referralCode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === "in"
          ? await api<{ accessToken: string }>(`/${slug}/login`, { method: "POST", auth: false, body: { username: f.username, password: f.password } })
          : await api<{ accessToken: string }>(`/${slug}/register`, {
              method: "POST",
              auth: false,
              body: { username: f.username, password: f.password, displayName: f.displayName || f.username, phone: f.phone || null, dateOfBirth: f.dateOfBirth || null, marketingConsent: f.marketingConsent, referralCode: f.referralCode.trim() || null },
            });
      setToken(r.accessToken);
      onIn();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? "Please check the details (password: at least 8 characters)." : e instanceof Error ? e.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-1/3 -top-1/4 h-[60vh] w-[90vw] rounded-full opacity-30 blur-[100px]" style={{ background: "radial-gradient(circle, var(--color-glow-2), transparent 60%)" }} />
        <div className="absolute -bottom-1/4 -right-1/3 h-[50vh] w-[80vw] rounded-full opacity-20 blur-[100px]" style={{ background: "radial-gradient(circle, var(--color-glow), transparent 60%)" }} />
      </div>
      <div className="mb-10 flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-2xl brand-gradient shadow-glow font-display text-xl font-bold text-void">{(venue?.name ?? "A").slice(0, 1)}</div>
        <div>
          <p className="font-display text-2xl font-semibold">{venue?.name ?? "…"}</p>
          <p className="text-sm text-dim">{venue?.branches.map((b) => b.name).join(" · ")}</p>
        </div>
      </div>
      <h1 className="font-display text-4xl font-semibold leading-tight">{mode === "in" ? "Welcome back." : "Join in 30 seconds."}</h1>
      <p className="mt-2 text-dim">{mode === "in" ? "Book a station, check your time and top up your game." : "Same login works on every PC at the venue."}</p>
      <form className="mt-8 grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {mode === "up" && <input className="field" placeholder="Your name" value={f.displayName} onChange={set("displayName")} autoComplete="name" />}
        <input className="field" placeholder={mode === "in" ? "Username, email or phone" : "Username"} value={f.username} onChange={set("username")} autoComplete="username" autoCapitalize="none" required />
        <PasswordField className="field" placeholder="Password" value={f.password} onChange={set("password")} autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "up" ? 8 : 1} />
        {mode === "up" && (
          <>
            <input className="field" type="tel" placeholder="Phone (optional)" value={f.phone} onChange={set("phone")} autoComplete="tel" />
            <input className="field uppercase placeholder:normal-case" placeholder="Friend's invite code (optional)" value={f.referralCode} onChange={set("referralCode")} maxLength={16} />
            <label className="grid gap-1.5 text-sm text-dim">
              Date of birth (optional — for age-rated games)
              <input className="field" type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} />
            </label>
            <label className="flex items-center gap-3 text-sm text-dim">
              <input type="checkbox" checked={f.marketingConsent} onChange={(e) => setF((x) => ({ ...x, marketingConsent: e.target.checked }))} className="size-5 accent-[var(--color-glow)]" />
              Tell me about tournaments and offers
            </label>
          </>
        )}
        {error && <p role="alert" className="rounded-xl border border-alarm/40 bg-alarm/10 px-4 py-3 text-sm text-alarm">{error}</p>}
        <button className="btn btn-primary mt-2 py-4 text-lg" disabled={busy}>
          {busy && <Loader2 className="size-5 animate-spin" />} {mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }} className="mt-6 min-h-11 text-center text-sm text-dim">
        {mode === "in" ? <>New here? <span className="text-glow">Create an account</span></> : <>Have an account? <span className="text-glow">Sign in</span></>}
      </button>
      {onChangeVenue && (
        <button onClick={onChangeVenue} className="min-h-11 text-center text-sm text-mute">
          Not {venue?.name ?? "this venue"}? <span className="text-glow">Change venue</span>
        </button>
      )}
    </main>
  );
}

// ── home ────────────────────────────────────────────────────────────────────

function HomeScreen({ me, bookings, go, unread }: { me: Me; bookings: Booking[]; go: (t: Tab) => void; unread: number }) {
  const next = bookings.filter((b) => ["CONFIRMED", "CHECKED_IN"].includes(b.status) && new Date(b.endsAt) > new Date()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const tier = me.membershipTier;
  return (
    <Screen title={`Hi, ${me.displayName.split(" ")[0]}`}>
      <div className="relative overflow-hidden rounded-3xl border border-rim p-6" style={{ background: "radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, var(--color-glow-2) 22%, transparent), transparent 55%), linear-gradient(135deg, color-mix(in oklab, var(--color-glow) 38%, var(--color-deck)), var(--color-deck) 72%)", boxShadow: "var(--shadow-lift)" }}>
        <p className="text-sm text-dim">Wallet</p>
        <p className="tabular mt-1 font-display text-4xl font-semibold">{me.wallet.currency} {me.wallet.total}</p>
        {Number(me.wallet.bonus) > 0 && <p className="mt-1 text-sm text-glow">incl. {me.wallet.bonus} bonus</p>}
        <div className="mt-5 flex items-center gap-2 text-sm">
          <Clock className="size-4 text-glow" /> <span className="tabular">{hours(me.wallet.timeMinutes)}</span> <span className="text-dim">of prepaid play time</span>
        </div>
        {me.wallet.frozen && <p className="mt-3 rounded-xl bg-alarm/15 px-3 py-2 text-sm text-alarm">Your wallet is on hold — please talk to the staff.</p>}
        {tier && (
          <span className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-void" style={{ background: tier.color ?? "var(--color-glow)" }}>
            <Crown className="size-3.5" /> {tier.name}
          </span>
        )}
      </div>

      {me.playingNow && (
        <div className="card mt-4 flex items-center gap-4 border-good/40 p-5">
          <span className="live-dot size-2.5 rounded-full bg-good text-good" />
          <div className="flex-1">
            <p className="font-semibold">Playing on {me.playingNow.station}</p>
            <p className="text-sm text-dim">{me.playingNow.expiresAt ? `Until ${time(me.playingNow.expiresAt)}` : "Open session — pay at the end"}</p>
          </div>
          <Gamepad2 className="size-6 text-good" />
        </div>
      )}

      <button onClick={() => go("bookings")} className="card press hover:border-rim mt-4 flex w-full items-center gap-4 p-5 text-left">
        <CalendarClock className="size-7 text-glow" />
        <div className="flex-1">
          {next ? (
            <>
              <p className="font-semibold">{when(next.startsAt)}</p>
              <p className="text-sm text-dim">{next.zone?.name} · {hours(next.minutes)} · {next.players} {next.players === 1 ? "station" : "stations"} · {next.reference}</p>
            </>
          ) : (
            <>
              <p className="font-semibold">No upcoming booking</p>
              <p className="text-sm text-dim">Reserve your station before you come.</p>
            </>
          )}
        </div>
        <ChevronRight className="size-5 text-mute" />
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={() => go("events")} className="card press hover:border-rim flex flex-col items-center gap-1.5 p-4 text-sm"><Trophy className="size-6 text-warn" /> Tournaments</button>
        <button onClick={() => go("inbox")} className="card press hover:border-rim relative flex flex-col items-center gap-1.5 p-4 text-sm"><Inbox className="size-6 text-glow" /> Inbox{unread > 0 && <span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-alarm text-[11px] font-bold text-white">{unread}</span>}</button>
        <button onClick={() => go("wallet")} className="card press hover:border-rim flex flex-col items-center gap-1.5 p-4 text-sm"><Wallet className="size-6 text-glow-2" /> Wallet</button>
        <button onClick={() => go("screenshots")} className="card press hover:border-rim flex flex-col items-center gap-1.5 p-4 text-sm"><Camera className="size-6 text-good" /> Screenshots</button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button onClick={() => go("book")} className="btn btn-primary py-5"><CalendarClock className="size-5" /> Book</button>
        <button onClick={() => go("shop")} className="btn btn-ghost py-5"><ShoppingBag className="size-5" /> Buy time</button>
      </div>
      {!tier && (
        <button onClick={() => go("shop")} className="card press hover:border-rim mt-4 flex w-full items-center gap-4 p-5 text-left">
          <Sparkles className="size-6 text-glow-2" />
          <div className="flex-1">
            <p className="font-semibold">Become a member</p>
            <p className="text-sm text-dim">Cheaper hours, bonus time, book further ahead.</p>
          </div>
          <ChevronRight className="size-5 text-mute" />
        </button>
      )}
    </Screen>
  );
}

// ── book ────────────────────────────────────────────────────────────────────

function BookingsScreen({ bookings, reload, toast }: { bookings: Booking[]; reload: () => void; toast: (t: string, ok?: boolean) => void }) {
  const upcoming = bookings.filter((b) => ["CONFIRMED", "PENDING", "CHECKED_IN"].includes(b.status) && new Date(b.endsAt) > new Date());
  const past = bookings.filter((b) => !upcoming.includes(b));
  const cancel = async (b: Booking) => {
    if (!(await askConfirm(`Cancel booking ${b.reference}?`, { ok: "Cancel booking", cancel: "Keep it" }))) return;
    try {
      await api(`/bookings/${b.id}/cancel`, { method: "POST" });
      toast("Booking cancelled.");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't cancel.", false);
    }
  };
  const Row = ({ b }: { b: Booking }) => (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{when(b.startsAt)}</p>
          <p className="text-sm text-dim">{b.zone?.name} · {hours(b.minutes)} · {b.players} {b.players === 1 ? "station" : "stations"}</p>
          <p className="mt-1 font-mono text-xs text-mute">{b.reference}{b.devices.length ? ` · ${b.devices.map((d) => d.name).join(", ")}` : ""}</p>
          {Number(b.depositAmount) > 0 && <p className="mt-1 text-xs text-good">Paid {b.currency} {b.depositAmount}</p>}
        </div>
        <span className={cx("rounded-full px-2.5 py-1 text-xs", b.status === "CONFIRMED" ? "bg-glow/15 text-glow" : b.status === "CHECKED_IN" ? "bg-good/15 text-good" : "bg-deck-2 text-dim")}>{b.status.replace("_", " ").toLowerCase()}</span>
      </div>
      {b.status === "CONFIRMED" && <button onClick={() => void cancel(b)} className="mt-4 flex items-center gap-1.5 text-sm text-alarm"><X className="size-4" /> Cancel</button>}
    </div>
  );
  return (
    <Screen title="My bookings">
      <div className="grid gap-3">
        {upcoming.map((b) => <Row key={b.id} b={b} />)}
        {upcoming.length === 0 && <p className="card p-6 text-center text-dim">Nothing booked yet.</p>}
      </div>
      {past.length > 0 && (
        <>
          <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">Earlier</p>
          <div className="grid gap-3 opacity-70">{past.slice(0, 10).map((b) => <Row key={b.id} b={b} />)}</div>
        </>
      )}
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
    if (!(await askConfirm(`Pay for ${what} from your wallet?`, { ok: "Pay" }))) return;
    setBusy(id);
    try {
      await api(path, { method: "POST", body: { branchId, ...body, idempotencyKey: key() } });
      toast(`${what} — done!`);
      onBought();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't buy.", false);
    } finally {
      setBusy(null);
    }
  };
  const cur = me.wallet.currency;
  return (
    <Screen title="Shop" action={<span className="tabular rounded-full bg-deck-2 px-3 py-1.5 text-sm">{cur} {me.wallet.total}</span>}>
      {venue.branches.length > 1 && (
        <select className="field mb-5" value={branchId} onChange={(e) => setBranch(e.target.value)}>
          {venue.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <p className="mb-3 text-sm uppercase tracking-widest text-mute">Play time</p>
      {!shop.data ? <p className="text-dim">Loading…</p> : (
        <div className="grid gap-3">
          {!shop.data.plans.some((p) => p.pricingPackages.length) && <p className="text-dim">No play-time packages here yet — ask at the counter.</p>}
          {shop.data.plans.flatMap((p) =>
            p.pricingPackages.map((k) => (
              <div key={k.id} className="card flex items-center gap-4 p-5">
                <Clock className="size-7 text-glow" />
                <div className="flex-1">
                  <p className="font-semibold">{k.name} · {p.name}</p>
                  <p className="text-sm text-dim">{hours(k.durationMinutes + k.bonusMinutes)}{k.bonusMinutes ? ` (incl. ${k.bonusMinutes} min bonus)` : ""}{p.zone ? ` · ${p.zone.name} only` : ""}</p>
                </div>
                <button className="btn btn-primary px-4 py-2.5" disabled={busy === k.id || me.wallet.frozen} onClick={() => void buy(k.id, "/time", { planId: p.id, packageId: k.id }, `${k.name} of play time`)}>
                  {busy === k.id ? <Loader2 className="size-4 animate-spin" /> : `${cur} ${Number(k.price).toFixed(0)}`}
                </button>
              </div>
            )),
          )}
        </div>
      )}
      {shop.data?.plans.some((p) => p.rate) && (
        <>
          <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">Prices</p>
          <div className="card divide-y divide-rim">
            {shop.data.plans.filter((p) => p.rate).map((p) => {
              const when = [
                ...(p.schedule ?? []).map((w) => `${w.days.map((d) => d[0].toUpperCase() + d.slice(1)).join(", ")} ${w.from}–${w.to}`),
                p.passStartTime && p.passEndTime ? `${p.passStartTime}–${p.passEndTime}` : "",
                p.zone ? `${p.zone.name} only` : "",
                p.membershipTier ? `${p.membershipTier.name} members` : "",
                p.paymentTiming === "POSTPAID" ? "pay after you play" : "",
              ].filter(Boolean).join(" · ");
              const unit = p.billingMode === "PER_HOUR" ? "/hr" : p.billingMode === "PER_MINUTE" ? "/min" : p.billingMode === "DAY_PASS" ? " day pass" : p.billingMode === "NIGHT_PASS" ? " night pass" : "";
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    {when && <p className="text-sm text-dim">{when}</p>}
                  </div>
                  <p className="tabular shrink-0 font-semibold">{p.currency} {Number(p.rate).toFixed(0)}<span className="text-sm font-normal text-dim">{unit}</span></p>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">Membership</p>
      <div className="grid gap-3">
        {shop.data?.tiers.map((t) => {
          const mine = me.membershipTier?.id === t.id;
          return (
            <div key={t.id} className="card overflow-hidden">
              <div className="h-1.5" style={{ background: t.color ?? "var(--color-glow)" }} />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-display text-xl font-semibold"><Crown className="size-5" style={{ color: t.color ?? undefined }} /> {t.name}</p>
                  <p className="tabular font-display text-lg">{cur} {Number(t.price).toFixed(0)}<span className="text-sm text-dim"> / {t.durationDays} days</span></p>
                </div>
                <ul className="mt-3 grid gap-1.5 text-sm text-dim">
                  <li className="flex gap-2"><Check className="size-4 text-good" /> {Number(t.gamingDiscountPct)}% off gaming time</li>
                  {t.bonusMinutesMonthly > 0 && <li className="flex gap-2"><Check className="size-4 text-good" /> {hours(t.bonusMinutesMonthly)} free play time</li>}
                  <li className="flex gap-2"><Check className="size-4 text-good" /> Book up to {t.bookingWindowDays} days ahead</li>
                  {t.priorityBooking && <li className="flex gap-2"><Check className="size-4 text-good" /> Priority booking</li>}
                </ul>
                <button className={cx("btn mt-4 w-full", mine ? "btn-ghost" : "btn-primary")} disabled={busy === t.id || me.wallet.frozen} onClick={() => void buy(t.id, "/memberships", { tierId: t.id }, `${t.name} membership`)}>
                  {busy === t.id && <Loader2 className="size-4 animate-spin" />} {mine ? "Renew" : "Join"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-mute">Top up your wallet at the counter — card and cash.</p>
    </Screen>
  );
}

// ── wallet & me ─────────────────────────────────────────────────────────────

const TX_LABEL: Record<string, string> = { TOPUP: "Top-up", SPEND: "Payment", REFUND: "Refund", ADJUSTMENT: "Adjustment", BONUS_GRANT: "Bonus", BONUS_EXPIRE: "Bonus expired" };

function WalletScreen({ me }: { me: Me }) {
  const w = useLoad(() => api<{ ledger: LedgerRow[] }>("/wallet"));
  return (
    <Screen title="Wallet">
      <div className="grid grid-cols-3 gap-3">
        {[["Cash", me.wallet.cash], ["Bonus", me.wallet.bonus], ["Play time", hours(me.wallet.timeMinutes)]].map(([k, v]) => (
          <div key={k} className="card p-4"><p className="text-xs text-dim">{k}</p><p className="tabular mt-1 font-display text-lg font-semibold">{v}</p></div>
        ))}
      </div>
      <p className="mb-3 mt-8 text-sm uppercase tracking-widest text-mute">History</p>
      <div className="card divide-y divide-rim">
        {w.data?.ledger.map((l) => {
          const n = Number(l.amount);
          return (
            <div key={l.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-medium">{TX_LABEL[l.type] ?? l.type}{l.bucket === "TIME" ? " · time" : l.bucket === "BONUS" ? " · bonus" : ""}</p>
                <p className="text-xs text-mute">{new Date(l.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{l.reason ? ` · ${l.reason}` : ""}</p>
              </div>
              <p className={cx("tabular font-mono", n > 0 ? "text-good" : "text-text")}>{n > 0 ? "+" : ""}{l.bucket === "TIME" ? hours(Math.abs(n)).replace(/^/, n < 0 ? "−" : "") : l.amount}</p>
            </div>
          );
        })}
        {w.data?.ledger.length === 0 && <p className="p-6 text-center text-dim">No transactions yet.</p>}
        {!w.data && <p className="p-6 text-center text-dim">Loading…</p>}
      </div>
    </Screen>
  );
}

function MeScreen({ me, venue, onOut }: { me: Me; venue: Venue; onOut: () => void }) {
  return (
    <Screen title="Me">
      <div className="card flex items-center gap-4 p-5">
        <div className="grid size-14 place-items-center rounded-full brand-gradient font-display text-2xl font-bold text-void">{me.displayName.slice(0, 1)}</div>
        <div>
          <p className="font-display text-xl font-semibold">{me.displayName}</p>
          <p className="text-sm text-dim">@{me.username}</p>
        </div>
      </div>
      <div className="card mt-4 divide-y divide-rim text-sm">
        <div className="flex justify-between px-5 py-4"><span className="text-dim">Venue</span><span>{venue.name}</span></div>
        <div className="flex justify-between px-5 py-4"><span className="text-dim">Membership</span><span>{me.membershipTier ? `${me.membershipTier.name}${me.membership?.expiresAt ? ` · until ${new Date(me.membership.expiresAt).toLocaleDateString()}` : ""}` : "—"}</span></div>
        {me.phone && <div className="flex justify-between px-5 py-4"><span className="text-dim">Phone</span><span>{me.phone}</span></div>}
        {me.referralCode && <div className="flex justify-between px-5 py-4"><span className="text-dim">Invite code</span><span className="font-mono">{me.referralCode}</span></div>}
      </div>
      <p className="mt-4 text-sm text-dim">Use the same username and password at any PC in the venue.</p>
      <button onClick={onOut} className="btn btn-ghost mt-6 w-full text-alarm"><LogOut className="size-5" /> Sign out</button>
    </Screen>
  );
}

// ── root ────────────────────────────────────────────────────────────────────

type Tab = "home" | "book" | "bookings" | "shop" | "wallet" | "me" | "rewards" | "events" | "inbox" | "screenshots";
const NAV: Array<{ id: Tab; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "book", label: "Book", icon: CalendarClock },
  { id: "shop", label: "Shop", icon: ShoppingBag },
  { id: "rewards", label: "Rewards", icon: Gift },
  { id: "me", label: "Me", icon: User },
];

export function App() {
  const [authed, setAuthed] = useState(signedIn());
  const [tab, setTab] = useState<Tab>("home");
  const [toast, setToastState] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const showToast = useCallback((text: string, ok = true) => setToastState({ text, tone: ok ? "good" : "bad" }), []);
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
  useEffect(() => {
    const onFocus = () => void refresh();
    addEventListener("focus", onFocus);
    return () => removeEventListener("focus", onFocus);
  }, [refresh]);

  if (!slug) return <VenuePicker onPick={pick} />;
  if (venue.error)
    return (
      <main className="grid min-h-dvh place-content-center gap-4 p-8 text-center text-dim">
        {venue.error}
        {changeVenue && <button onClick={changeVenue} className="text-glow">Change venue</button>}
      </main>
    );
  if (!authed) return <Auth slug={slug} venue={venue.data} onIn={() => setAuthed(true)} onChangeVenue={changeVenue} />;
  if (!me || !venue.data) return <main className="grid min-h-dvh place-items-center"><Loader2 className="size-8 animate-spin text-glow" /></main>;

  const signOut = async () => {
    await api("/logout", { method: "POST" }).catch(() => undefined);
    setToken(null);
    setAuthed(false);
    setMe(null);
  };

  return (
    <div className="min-h-dvh">
      {toast && <Toast text={toast.text} tone={toast.tone} onDone={() => setToastState(null)} />}
      {tab === "home" && <HomeScreen me={me} bookings={bookings} go={setTab} unread={unread} />}
      {tab === "book" && <BookScreen venue={venue.data} me={me} toast={showToast} onBooked={() => { void refresh(); setTab("bookings"); }} />}
      {tab === "bookings" && <BookingsScreen bookings={bookings} reload={() => void refresh()} toast={showToast} />}
      {tab === "shop" && <ShopScreen venue={venue.data} me={me} toast={showToast} onBought={() => void refresh()} />}
      {tab === "wallet" && <WalletScreen me={me} />}
      {tab === "me" && <MeScreen me={me} venue={venue.data} onOut={() => void signOut()} />}
      {tab === "rewards" && <RewardsScreen toast={showToast} onChanged={() => void refresh()} />}
      {tab === "events" && <TournamentsScreen toast={showToast} onChanged={() => void refresh()} />}
      {tab === "inbox" && <InboxScreen back={() => setTab("home")} onRead={() => void refreshUnread()} />}
      {tab === "screenshots" && <ScreenshotsScreen back={() => setTab("home")} toast={showToast} />}
      <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0" aria-label="Main">
        <div className="mx-auto flex max-w-lg justify-around pt-2">
          {NAV.map((n) => {
            const active = tab === n.id || (n.id === "book" && tab === "bookings");
            return (
              <button key={n.id} onClick={() => setTab(n.id)} className={cx("press relative flex min-h-12 w-16 flex-col items-center gap-1 py-1 text-[11px] font-medium", active ? "text-text" : "text-mute")} aria-current={active ? "page" : undefined}>
                {active && <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-glow shadow-[0_0_10px_var(--color-glow)]" aria-hidden />}
                <n.icon className={cx("size-6 transition-colors", active && "text-glow")} />
                {n.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
