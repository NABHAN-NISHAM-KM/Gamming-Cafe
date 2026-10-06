import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * Themed replacement for window.confirm(): `if (!(await askConfirm("…"))) return;`
 * Mounts its own <dialog> (focus trap + Esc for free) and cleans up after.
 */
export function askConfirm(message: string, labels: { ok?: string; cancel?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const done = (v: boolean) => {
      resolve(v);
      root.unmount();
      host.remove();
    };
    root.render(<Confirm message={message} ok={labels.ok ?? "Yes"} cancel={labels.cancel ?? "Cancel"} onDone={done} />);
  });
}

function Confirm({ message, ok, cancel, onDone }: { message: string; ok: string; cancel: string; onDone: (v: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onDone(false); }}
      onClick={(e) => e.target === e.currentTarget && onDone(false)}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-rim bg-deck p-0 text-text shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <div className="grid gap-5 p-5">
        <p className="text-[0.9375rem] leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={() => onDone(false)} className="press rounded-xl border border-rim px-4 py-2.5 text-sm text-dim hover:text-text">{cancel}</button>
          <button autoFocus onClick={() => onDone(true)} className="press brand-gradient rounded-xl px-5 py-2.5 text-sm font-semibold text-void">{ok}</button>
        </div>
      </div>
    </dialog>
  );
}

/** 1–5 stars and an optional comment; resolves null when skipped. */
export function askRating(labels: { title: string; comment: string; send: string; skip: string }): Promise<{ rating: number; comment: string | null } | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const done = (v: { rating: number; comment: string | null } | null) => {
      resolve(v);
      root.unmount();
      host.remove();
    };
    root.render(<Rating labels={labels} onDone={done} />);
  });
}

function Rating({ labels, onDone }: { labels: { title: string; comment: string; send: string; skip: string }; onDone: (v: { rating: number; comment: string | null } | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onDone(null); }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-rim bg-deck p-0 text-text shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <form
        className="grid gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (rating) onDone({ rating, comment: comment.trim() || null });
        }}
      >
        <p className="text-center font-display text-lg font-semibold">{labels.title}</p>
        <div className="flex justify-center gap-1" role="radiogroup" aria-label={labels.title}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} / 5`}
              onClick={() => setRating(n)}
              className={`press grid size-12 place-items-center rounded-xl text-3xl transition ${n <= rating ? "text-warn" : "text-rim hover:text-dim"}`}
            >
              ★
            </button>
          ))}
        </div>
        {rating > 0 && (
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} rows={2} placeholder={labels.comment} className="w-full resize-none rounded-xl border border-rim bg-void/40 px-3 py-2 text-sm text-text placeholder:text-dim focus:border-accent focus:outline-none" />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onDone(null)} className="press rounded-xl border border-rim px-4 py-2.5 text-sm text-dim hover:text-text">{labels.skip}</button>
          <button type="submit" disabled={!rating} className="press brand-gradient rounded-xl px-5 py-2.5 text-sm font-semibold text-void disabled:opacity-40">{labels.send}</button>
        </div>
      </form>
    </dialog>
  );
}
