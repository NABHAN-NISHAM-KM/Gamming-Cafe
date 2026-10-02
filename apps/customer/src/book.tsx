import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, Loader2, Monitor, ShieldCheck, Store, Wrench, X } from "lucide-react";
import { api, key, type Booking, type Me, type Venue } from "./api";
import { locale, t } from "./i18n";
import { cx, hours } from "./ui";

const time = (d: Date | string) => new Date(d).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

interface Station {
  id: string;
  name: string;
  maintenance: boolean;
  busy: Array<{ from: string; to: string }>;
}

const OPEN_MIN = 10 * 60; // first bookable slot 10:00
const CLOSE_MIN = 26 * 60; // last start 02:00 next day
const overlaps = (s: Station, from: number, to: number) => s.busy.some((b) => new Date(b.from).getTime() < to && new Date(b.to).getTime() > from);

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <div className="mb-7">
      <p className="mb-3 flex items-center gap-2 text-sm text-dim">
        <span className={cx("grid size-6 place-items-center rounded-full text-xs font-semibold", done ? "bg-glow text-void" : "border border-rim")}>{done ? <Check className="size-3.5" /> : n}</span>
        {title}
      </p>
      {children}
    </div>
  );
}

/** Zone → day → stations → length → time → pay. */
export function BookScreen({ venue, me, onBooked, toast }: { venue: Venue; me: Me; onBooked: () => void; toast: (t: string, ok?: boolean) => void }) {
  const bookableBranches = venue.branches.filter((b) => b.zones.some((z) => z.stations > 0));
  const [branchId, setBranch] = useState(bookableBranches[0]?.id ?? "");
  const branch = venue.branches.find((b) => b.id === branchId);
  const zones = (branch?.zones ?? []).filter((z) => z.stations > 0 && !["RESTAURANT", "OTHER"].includes(z.type));
  const [zoneId, setZone] = useState(zones[0]?.id ?? "");
  const windowDays = me.membershipTier?.bookingWindowDays ?? 7;
  const days = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Array.from({ length: windowDays }, (_, i) => new Date(d.getTime() + i * 86_400_000));
  }, [windowDays]);
  const [day, setDay] = useState(0);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(120);
  const [slot, setSlot] = useState<number | null>(null);
  const [price, setPrice] = useState<{ currency: string; perStation: string } | null>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setZone((z) => (zones.some((x) => x.id === z) ? z : (zones[0]?.id ?? ""))), [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stations and when they're taken, for the chosen zone and day.
  const dayStart = days[day]!.getTime();
  useEffect(() => {
    setStations(null);
    if (!zoneId) return;
    let live = true;
    const from = new Date(dayStart + OPEN_MIN * 60_000);
    const to = new Date(dayStart + (CLOSE_MIN + 12 * 60) * 60_000);
    api<Station[]>(`/stations?branchId=${branchId}&zoneId=${zoneId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then((s) => live && setStations(s))
      .catch(() => live && setStations([]));
    return () => {
      live = false;
    };
  }, [branchId, zoneId, dayStart]);
  useEffect(() => {
    setPicked([]);
    setSlot(null);
  }, [zoneId, day]);

  const chosen = (stations ?? []).filter((s) => picked.includes(s.id));
  const slots = useMemo(() => {
    const out: Array<{ at: number; free: boolean }> = [];
    for (let m = OPEN_MIN; m <= CLOSE_MIN; m += 30) {
      const at = dayStart + m * 60_000;
      if (at < Date.now() + 10 * 60_000) continue;
      out.push({ at, free: chosen.length > 0 && chosen.every((s) => !overlaps(s, at, at + minutes * 60_000)) });
    }
    return out;
  }, [dayStart, minutes, chosen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (slot !== null && !slots.find((s) => s.at === slot)?.free) setSlot(null);
  }, [slots, slot]);

  useEffect(() => {
    setPrice(null);
    if (slot === null || !zoneId) return;
    let live = true;
    api<{ currency: string; perStation: string }>(`/estimate?branchId=${branchId}&zoneId=${zoneId}&startsAt=${encodeURIComponent(new Date(slot).toISOString())}&minutes=${minutes}`)
      .then((p) => live && setPrice(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slot, minutes, zoneId, branchId]);

  const total = price ? (Number(price.perStation) * chosen.length).toFixed(2) : null;

  const book = async (method: "VENUE" | "DEMO_CARD") => {
    if (slot === null) return;
    setBusy(true);
    try {
      const b = await api<Booking>("/bookings", {
        method: "POST",
        body: { branchId, zoneId, deviceIds: picked, startsAt: new Date(slot).toISOString(), minutes, payment: { method }, idempotencyKey: key() },
      });
      setPaying(false);
      toast(method === "DEMO_CARD" ? t("Paid & booked! {ref}", { ref: b.reference }) : t("Booked! {ref} — pay at the venue", { ref: b.reference }));
      onBooked();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't book."), false);
    } finally {
      setBusy(false);
    }
  };

  // Tiny day timeline under each station: taken periods between 10:00 and 04:00.
  const span = (CLOSE_MIN + 2 * 60 - OPEN_MIN) * 60_000;
  const bar = (s: Station) =>
    s.busy.map((b, i) => {
      const l = Math.max(0, (new Date(b.from).getTime() - (dayStart + OPEN_MIN * 60_000)) / span);
      const r = Math.min(1, (new Date(b.to).getTime() - (dayStart + OPEN_MIN * 60_000)) / span);
      return r > l ? <span key={i} className="absolute inset-y-0 bg-alarm/70" style={{ left: `${l * 100}%`, width: `${(r - l) * 100}%` }} /> : null;
    });

  if (bookableBranches.length === 0) {
    return <section className="mx-auto max-w-lg px-4 pt-6"><h1 className="font-display text-2xl font-semibold">{t("Book a station")}</h1><p className="card mt-5 p-6 text-dim">{t("No stations can be booked online yet. Please call the venue.")}</p></section>;
  }

  return (
    <section className="mx-auto w-full max-w-lg px-4 pb-28 pt-6">
      <h1 className="mb-6 font-display text-2xl font-semibold">{t("Book a station")}</h1>

      <Step n={1} title={t("Where")} done={!!zoneId}>
        {bookableBranches.length > 1 && (
          <select className="field mb-3" value={branchId} onChange={(e) => setBranch(e.target.value)}>
            {bookableBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {zones.map((z) => (
            <button key={z.id} className="chip" aria-pressed={zoneId === z.id} onClick={() => setZone(z.id)}>
              {z.name} <span className="opacity-60">· {z.stations}</span>
            </button>
          ))}
        </div>
      </Step>

      <Step n={2} title={t("Which day")} done>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {days.map((d, i) => (
            <button key={i} className="chip flex flex-col items-center px-4 py-2" aria-pressed={day === i} onClick={() => setDay(i)}>
              <span className="text-[11px] uppercase">{i === 0 ? t("Today") : d.toLocaleDateString(locale(), { weekday: "short" })}</span>
              <span className="font-display text-lg">{d.getDate()}</span>
            </button>
          ))}
        </div>
      </Step>

      <Step n={3} title={picked.length ? t("Stations ({n} selected — one per player)", { n: picked.length }) : t("Pick your station(s)")} done={picked.length > 0}>
        {!stations ? (
          <p className="flex items-center gap-2 text-dim"><Loader2 className="size-4 animate-spin" /> {t("Loading stations…")}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {stations.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    disabled={s.maintenance}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : p.length >= 10 ? p : [...p, s.id]))}
                    className={cx("rounded-2xl border p-3 text-start transition", on ? "border-glow bg-glow/10" : "border-rim bg-deck", s.maintenance && "opacity-40")}
                    aria-pressed={on}
                  >
                    <span className="flex items-center justify-between">
                      <Monitor className={cx("size-5", on ? "text-glow" : "text-dim")} />
                      {on && <Check className="size-4 text-glow" />}
                      {s.maintenance && <Wrench className="size-4 text-warn" />}
                    </span>
                    <span className="mt-2 block font-display font-semibold">{s.name}</span>
                    <span className="relative mt-2 block h-1.5 overflow-hidden rounded-full bg-good/40">{bar(s)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-mute"><span className="me-1 inline-block h-1.5 w-4 rounded-full bg-good/40 align-middle" /> {t("free")} · <span className="mx-1 inline-block h-1.5 w-4 rounded-full bg-alarm/70 align-middle" /> {t("taken (10:00 → 04:00)")}</p>
          </>
        )}
      </Step>

      <Step n={4} title={t("How long")} done>
        <div className="flex flex-wrap gap-2">
          {[60, 120, 180, 240, 300].map((m) => <button key={m} className="chip" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{hours(m)}</button>)}
        </div>
      </Step>

      <Step n={5} title={t("What time")} done={slot !== null}>
        {picked.length === 0 ? (
          <p className="text-sm text-mute">{t("Pick a station first — then you'll see when it's free.")}</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-dim">{t("No more times this day — pick another day.")}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {slots.map((s) => (
              <button key={s.at} disabled={!s.free} className={cx("chip px-0 text-center", !s.free && "line-through opacity-35")} aria-pressed={slot === s.at} onClick={() => setSlot(s.at)}>
                {time(new Date(s.at))}
              </button>
            ))}
          </div>
        )}
      </Step>

      {slot !== null && (
        <div className="card p-5">
          <p className="font-display text-lg font-semibold">{when(new Date(slot).toISOString())} – {time(new Date(slot + minutes * 60_000))}</p>
          <p className="mt-1 text-sm text-dim">{zones.find((z) => z.id === zoneId)?.name} · {chosen.map((s) => s.name).join(", ")} · {hours(minutes)}</p>
          <div className="mt-4 flex items-baseline justify-between border-t border-rim pt-4">
            <span className="text-dim">{t("Total")}{chosen.length > 1 ? ` (${t("{n} stations", { n: chosen.length })})` : ""}</span>
            <span className="tabular font-display text-2xl font-semibold">{total ? `${price!.currency} ${total}` : <Loader2 className="size-5 animate-spin" />}</span>
          </div>
          {venue.demoPayments && (
            <button className="btn btn-primary mt-4 w-full py-4" disabled={busy || !total} onClick={() => setPaying(true)}>
              <CreditCard className="size-5" /> {t("Pay now")} {total ? `· ${price!.currency} ${total}` : ""}
            </button>
          )}
          <button className={cx("btn mt-3 w-full", venue.demoPayments ? "btn-ghost" : "btn-primary py-4")} disabled={busy} onClick={() => void book("VENUE")}>
            {busy && !paying ? <Loader2 className="size-5 animate-spin" /> : <Store className="size-5" />} {t("Book · pay at the venue")}
          </button>
          <p className="mt-3 text-xs text-mute">{t("Arrive up to 15 min early. After 15 min late the stations are released. You can cancel in the app up to 1 hour before.")}</p>
        </div>
      )}

      {paying && total && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center" onClick={() => !busy && setPaying(false)}>
          <div className="w-full max-w-lg rounded-t-3xl border border-rim bg-deck p-6 pb-10 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-xl font-semibold">{t("Pay {amount}", { amount: `${price!.currency} ${total}` })}</p>
              <button onClick={() => setPaying(false)} aria-label={t("Close")} className="text-dim"><X className="size-6" /></button>
            </div>
            <div className="mt-5 rounded-2xl p-5 text-void" style={{ background: "linear-gradient(135deg, var(--color-glow), var(--color-glow-2))" }}>
              <p className="text-xs font-semibold uppercase tracking-widest opacity-70">{t("Demo card")}</p>
              <p className="tabular mt-4 font-mono text-xl tracking-widest" dir="ltr">4242 4242 4242 4242</p>
              <div className="mt-3 flex justify-between text-sm font-semibold"><span>{me.displayName.toUpperCase()}</span><span>12/30</span></div>
            </div>
            <p className="mt-4 flex items-start gap-2 text-sm text-dim">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
              {t("Demo mode — no real card is charged. The amount is added to your wallet for this booking and taken when you check in; if plans change, it stays in your wallet.")}
            </p>
            <button className="btn btn-primary mt-5 w-full py-4 text-lg" disabled={busy} onClick={() => void book("DEMO_CARD")}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : <CreditCard className="size-5" />} {t("Pay {amount}", { amount: `${price!.currency} ${total}` })}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
