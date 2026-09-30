import { useEffect, useRef } from "react";
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
