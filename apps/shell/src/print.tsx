import { useEffect, useState } from "react";
import { Printer, Receipt, Wallet, X } from "lucide-react";
import { bridge, type PrintQuote } from "./bridge";
import type { Notify } from "./screens";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/**
 * Anything the customer prints is held until they approve the price here:
 * added to their bill or paid from their wallet. Several jobs queue up;
 * unanswered ones are cancelled by the venue after a few minutes.
 */
export function PrintApproval({ notify }: { notify: Notify }) {
  const [queue, setQueue] = useState<PrintQuote[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    () =>
      bridge.subscribe((m) => {
        if (m.type === "print_quote") {
          setQueue((q) => [...q.filter((x) => x.jobKey !== m.quote.jobKey), m.quote]);
          setBusy(null);
        }
        if (m.type === "print_status") {
          setQueue((q) => q.filter((x) => x.jobKey !== m.jobKey));
          setBusy(null);
          notify(m.message, m.status === "FAILED" || (m.status === "CANCELLED" && !m.message.startsWith("Print cancelled")) ? "warn" : "good");
        }
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!queue.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queue.length]);

  const job = queue[0];
  if (!job) return null;
  const secondsLeft = Math.max(0, Math.round((new Date(job.expiresAt).getTime() - now) / 1000));
  const sheets = job.pages * job.copies;
  const confirm = (payWith: "BILL" | "WALLET") => {
    setBusy(job.jobKey);
    bridge.send({ type: "print_confirm", jobKey: job.jobKey, payWith });
  };
  const cancel = () => {
    setBusy(job.jobKey);
    bridge.send({ type: "print_cancel", jobKey: job.jobKey });
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-void/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="print-title">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-2xl">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-glow/15 text-glow"><Printer className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="print-title" className="font-display text-2xl font-semibold">Print this?</h2>
            <p className="mt-1 truncate text-dim">{job.document ?? "Document"}</p>
          </div>
          <button onClick={cancel} disabled={busy === job.jobKey} className="text-dim hover:text-text" aria-label="Cancel print"><X className="size-6" /></button>
        </div>
        <div className="mt-6 flex items-baseline justify-between rounded-2xl bg-deck-2/60 px-5 py-4">
          <span className="text-dim">
            {sheets} page{sheets === 1 ? "" : "s"} · {job.color ? "colour" : "black & white"}
            <span className="block text-xs">{job.currency} {job.unitPrice} per page</span>
          </span>
          <span className="tabular font-display text-3xl font-semibold">{job.currency} {job.total}</span>
        </div>
        {job.notice && <p className="mt-3 rounded-xl bg-warn/10 px-4 py-2 text-sm text-warn">{job.notice}</p>}
        {job.needsStaff && <p className="mt-3 text-sm text-dim">Staff will release it at the front desk after you confirm.</p>}
        <div className={cx("mt-6 grid gap-3", job.canPayWithWallet ? "grid-cols-2" : "grid-cols-1")}>
          <button disabled={busy === job.jobKey} onClick={() => confirm("BILL")} className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-glow to-glow-2 py-3.5 font-display font-semibold text-void disabled:opacity-50">
            <Receipt className="size-5" /> Add to my bill
          </button>
          {job.canPayWithWallet && (
            <button disabled={busy === job.jobKey} onClick={() => confirm("WALLET")} className="flex items-center justify-center gap-2 rounded-xl border border-glow/60 py-3.5 font-display font-semibold text-glow disabled:opacity-50">
              <Wallet className="size-5" /> Pay from wallet
            </button>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-mute">
          Nothing prints until you confirm · cancelled automatically in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          {queue.length > 1 && ` · ${queue.length - 1} more waiting`}
        </p>
      </div>
    </div>
  );
}
