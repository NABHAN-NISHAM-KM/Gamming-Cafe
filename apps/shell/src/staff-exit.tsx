import { useEffect, useRef, useState, type FormEvent } from "react";
import { bridge } from "./bridge";

/**
 * Shift+F12 → staff PIN → the agent closes the Shell and opens the Windows
 * desktop. Staff-only, so English only. The agent checks the PIN and locks it
 * after repeated wrong tries; this dialog only collects it.
 */
export function StaffExit() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "F12") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(
    () =>
      bridge.subscribe((m) => {
        if (m.type !== "staff_exit_result" || m.requestId !== pending.current) return;
        pending.current = null;
        setBusy(false);
        setPin("");
        if (!m.ok) setError(m.message ?? "Couldn't open Windows.");
        // On success the agent closes the Shell; nothing else to do here.
      }),
    [],
  );

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    setPin("");
    setError(null);
    setBusy(false);
    pending.current = null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !/^\d{4,12}$/.test(pin)) return;
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setBusy(true);
    setError(null);
    bridge.send({ type: "staff_exit", requestId, pin });
    setTimeout(() => {
      if (pending.current !== requestId) return;
      pending.current = null;
      setBusy(false);
      setError("No answer from this PC's ArenaOS service.");
    }, 15_000);
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); close(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-xs rounded-2xl border border-rim bg-deck p-0 text-text shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <form onSubmit={submit} className="grid gap-4 p-5">
        <div>
          <p className="font-display text-lg font-semibold">Staff exit</p>
          <p className="mt-1 text-sm text-dim">Enter the staff PIN to close the Shell and open Windows.</p>
        </div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          aria-label="Staff PIN"
          className="rounded-xl border border-rim bg-void px-4 py-3 text-center text-xl tracking-[0.4em] outline-none focus:border-glow focus:ring-4 focus:ring-glow/15"
        />
        {error && <p role="alert" className="text-sm text-alarm">{error}</p>}
        {busy && !error && <p className="text-sm text-dim">Checking…</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="press rounded-xl border border-rim px-4 py-2.5 text-sm text-dim hover:text-text">Cancel</button>
          <button type="submit" disabled={busy || pin.length < 4} className="press brand-gradient rounded-xl px-5 py-2.5 text-sm font-semibold text-void disabled:opacity-50">Open Windows</button>
        </div>
      </form>
    </dialog>
  );
}
