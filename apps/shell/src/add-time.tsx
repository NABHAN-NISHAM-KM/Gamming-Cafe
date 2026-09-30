import { useEffect, useRef, useState } from "react";
import { Clock, Hourglass, Loader2, Wallet, X } from "lucide-react";
import { request, type TimeOffers } from "./bridge";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const rid = () => crypto.randomUUID();
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

/**
 * "Add time" without walking to the counter: a package of the session's rate
 * paid from the wallet, or the customer's saved minutes. The server prices,
 * charges and extends; the new end time arrives with the next state.
 */
export function AddTime({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const [offers, setOffers] = useState<TimeOffers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
    void request({ type: "time_offers", requestId: rid() }, "time_offers").then((r) => setOffers(r as TimeOffers));
  }, []);

  const buy = async (key: string, body: { packageId: string } | { savedMinutes: 30 | 60 | 120 }, label: string) => {
    setBusy(key);
    setError(null);
    const r = await request({ type: "buy_time", requestId: rid(), ...body }, "buy_time_result");
    setBusy(null);
    if (r.ok) {
      onDone(`${label} added to your session.`);
      onClose();
    } else setError(r.message ?? "Couldn't add time. Please ask at the counter.");
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-rim bg-deck p-0 text-text shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <div className="p-7">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-2 font-display text-2xl font-semibold"><Hourglass className="size-6 text-glow" /> Add time</p>
            <p className="mt-1 text-sm text-dim">Keep playing without leaving your seat.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="press grid size-9 place-items-center rounded-lg text-dim hover:bg-white/10 hover:text-text"><X className="size-5" /></button>
        </div>

        {!offers ? (
          <div className="grid place-items-center py-14 text-dim"><Loader2 className="size-7 animate-spin" /></div>
        ) : !offers.ok ? (
          <p className="mt-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">{offers.message}</p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Balance icon={<Wallet className="size-4" />} label="Wallet" value={offers.wallet === null ? "On hold" : `${offers.currency} ${offers.wallet}`} />
              <Balance icon={<Clock className="size-4" />} label="Saved time" value={dur(offers.savedMinutes)} />
            </div>

            {offers.savedSteps.length > 0 && (
              <>
                <p className="mt-6 mb-2 text-xs uppercase tracking-[0.2em] text-dim">Use saved time</p>
                <div className="flex flex-wrap gap-2">
                  {offers.savedSteps.map((m) => (
                    <button key={m} disabled={!!busy} onClick={() => void buy(`saved-${m}`, { savedMinutes: m }, dur(m))} className="press flex items-center gap-2 rounded-xl border border-rim px-4 py-2.5 hover:border-glow/60 disabled:opacity-50">
                      {busy === `saved-${m}` && <Loader2 className="size-4 animate-spin" />} + {dur(m)}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="mt-6 mb-2 text-xs uppercase tracking-[0.2em] text-dim">Buy with your wallet</p>
            {offers.packages.length === 0 ? (
              <p className="text-sm text-dim">No time packages for this station's rate. Ask at the counter.</p>
            ) : (
              <div className="grid gap-2">
                {offers.packages.map((p) => (
                  <button
                    key={p.id}
                    disabled={!!busy || offers.wallet === null}
                    onClick={() => void buy(p.id, { packageId: p.id }, dur(p.minutes))}
                    className="press flex items-center justify-between gap-4 rounded-xl border border-rim bg-deck-2/50 px-4 py-3 text-left hover:border-glow/60 disabled:opacity-50"
                  >
                    <span>
                      <span className="font-display text-lg">{p.name}</span>
                      <span className="ml-2 text-sm text-dim">{dur(p.minutes)}{p.bonusMinutes ? ` · incl. ${p.bonusMinutes} min bonus` : ""}</span>
                    </span>
                    <span className="flex items-center gap-2 font-semibold">
                      {busy === p.id && <Loader2 className="size-4 animate-spin" />}
                      {offers.currency} {p.price}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {error && <p role="alert" className="mt-4 rounded-xl border border-alarm/40 bg-alarm/10 px-4 py-3 text-sm text-alarm">{error}</p>}
          </>
        )}
      </div>
    </dialog>
  );
}

function Balance({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={cx("rounded-2xl border border-rim bg-deck-2/60 px-4 py-3")}>
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-dim">{icon} {label}</p>
      <p className="tabular mt-1 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}
