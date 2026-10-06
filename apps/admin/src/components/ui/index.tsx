"use client";

import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, HelpCircle, Info, Loader2, MessageSquareText, X } from "lucide-react";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ── Button ──────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary:
    "brand-gradient text-accent-ink font-semibold shadow-[0_6px_20px_-8px_var(--color-accent)] hover:shadow-glow hover:brightness-110",
  secondary: "bg-panel-2 text-ink border border-line-strong hover:border-accent/50 hover:bg-raised",
  ghost: "text-ink-2 hover:text-ink hover:bg-panel-2",
  danger: "bg-danger/12 text-danger border border-danger/40 hover:bg-danger/20 hover:border-danger/70",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean; size?: "sm" | "md" }>(
  function Button({ variant = "secondary", pending, size = "md", className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          "press inline-flex items-center justify-center gap-2 rounded-lg whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
          VARIANTS[variant],
          className,
        )}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        {...rest}
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

// ── Form controls ───────────────────────────────────────────────────────────

const control =
  "w-full min-w-0 h-10 rounded-lg bg-bg/70 border border-line-strong px-3 text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-3/60 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(control, className)} {...rest} />;
});

/** Eye icon for show/hide password; animations live in @arena/theme (.eye-toggle). */
export function EyeIcon({ shown }: { shown: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g key={String(shown)} className="eye-lid">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle className="eye-pupil" cx={12} cy={12} r={3} />
      </g>
      <path className="eye-slash" d="M3 3l18 18" pathLength={1} />
    </svg>
  );
}

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function PasswordInput({ className, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input ref={ref} type={shown ? "text" : "password"} className={cx(control, "pr-10", className)} {...rest} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="eye-toggle absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-3 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
      >
        <EyeIcon shown={shown} />
      </button>
    </span>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <span className="relative block">
      <select ref={ref} className={cx(control, "appearance-none pr-9", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
    </span>
  );
});

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("grid min-w-0 content-start gap-1.5", className)}>
      <span className="text-xs font-medium tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="animate-enter rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

// ── Surfaces ────────────────────────────────────────────────────────────────

export function Card({ children, className, interactive }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return (
    <section
      className={cx(
        "surface rounded-2xl",
        interactive && "transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>}
        <h1 className="text-[1.75rem] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const BADGE: Record<string, string> = {
  neutral: "border-line-strong text-ink-2 bg-panel-2",
  accent: "border-accent/40 text-accent bg-accent/10",
  ok: "border-ok/40 text-ok bg-ok/10",
  warn: "border-reserved/40 text-reserved bg-reserved/10",
  danger: "border-danger/40 text-danger bg-danger/10",
  maint: "border-maint/40 text-maint bg-maint/10",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", BADGE[tone])}>{children}</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="animate-enter flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && <div className="grid size-12 place-items-center rounded-2xl border border-line-strong bg-panel-2 text-accent [&_svg]:size-5">{icon}</div>}
      <p className="font-display text-base font-semibold">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-ink-3" role="status">
      <Loader2 className="size-4 animate-spin text-accent" /> {label}…
    </div>
  );
}

/** Shimmering placeholder rows; use while a list loads so the layout doesn't jump. */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("grid gap-2.5 p-4", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-9" style={{ opacity: 1 - i * (0.6 / rows) }} />
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-panel-2 px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-3">{children}</kbd>;
}

// ── Table ───────────────────────────────────────────────────────────────────

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-3">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-panel-2/60">{children}</tbody>
      </table>
    </div>
  );
}

// ── Modal (native <dialog>: focus trap, Esc, a11y for free) ──────────────────

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      // React bubbles a nested dialog's close up the component tree: only react to our own.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-2xl border border-line-strong bg-panel p-0 text-ink shadow-2xl shadow-black/60", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="press rounded-lg p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ── Toast (replaces alert(): call toast("…") anywhere, <Toaster /> renders them) ──

type ToastTone = "ok" | "info" | "warn";
type ToastMsg = { id: number; text: string; tone: ToastTone };
let toasts: ToastMsg[] = [];
let nextToast = 1;
const toastListeners = new Set<(t: ToastMsg[]) => void>();
const emitToasts = (next: ToastMsg[]) => { toasts = next; toastListeners.forEach((l) => l(toasts)); };
const dismissToast = (id: number) => emitToasts(toasts.filter((t) => t.id !== id));

export function toast(text: string, tone: ToastTone = "ok") {
  const id = nextToast++;
  emitToasts([...toasts, { id, text, tone }].slice(-4));
  setTimeout(() => dismissToast(id), tone === "warn" ? 8000 : 5000);
}

const TOAST_TONE: Record<ToastTone, { icon: ReactNode; ring: string }> = {
  ok: { icon: <CheckCircle2 className="size-4 text-ok" />, ring: "border-ok/35" },
  info: { icon: <Info className="size-4 text-accent" />, ring: "border-accent/35" },
  warn: { icon: <AlertTriangle className="size-4 text-reserved" />, ring: "border-reserved/40" },
};

export function Toaster() {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => void toastListeners.delete(setList);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[100] grid w-[min(24rem,calc(100vw-2rem))] gap-2">
      {list.map((t) => (
        <div key={t.id} role="status" className={cx("animate-enter pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel/95 px-4 py-3 text-sm text-ink shadow-2xl shadow-black/60 backdrop-blur", TOAST_TONE[t.tone].ring)}>
          <span className="mt-0.5 shrink-0">{TOAST_TONE[t.tone].icon}</span>
          <p className="min-w-0 flex-1">{t.text}</p>
          <button onClick={() => dismissToast(t.id)} className="press -mr-1 rounded p-0.5 text-ink-3 hover:text-ink" aria-label="Dismiss"><X className="size-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

// ── Dialogs (replace confirm()/prompt(): `if (!(await askConfirm("…"))) return;`) ──

type DialogReq = { kind: "confirm" | "text"; message: string; optional?: boolean; resolve: (v: string | null) => void };
let openDialog: ((d: DialogReq) => void) | null = null;
const request = (d: Omit<DialogReq, "resolve">) =>
  new Promise<string | null>((resolve) => (openDialog ? openDialog({ ...d, resolve }) : resolve(null)));

/** Themed yes/no question. */
export const askConfirm = async (message: string) => (await request({ kind: "confirm", message })) !== null;
/** Themed text question; resolves the trimmed answer (≥ 3 chars unless optional), or null if cancelled. */
export const askText = (message: string, opts: { optional?: boolean } = {}) => request({ kind: "text", message, ...opts });

export function Dialogs() {
  const [d, setD] = useState<DialogReq | null>(null);
  const [text, setText] = useState("");
  const current = useRef<DialogReq | null>(null);
  const show = (next: DialogReq | null) => { current.current = next; setText(""); setD(next); };
  useEffect(() => {
    openDialog = (next) => { current.current?.resolve(null); show(next); }; // a newer question cancels the older one
    return () => void (openDialog = null);
  }, []);
  const finish = (v: string | null) => { current.current?.resolve(v); show(null); };
  const valid = d?.kind !== "text" || d.optional || text.trim().length >= 3;
  return (
    <Modal open={!!d} onClose={() => finish(null)} title={d?.kind === "text" ? "Add a note" : "Please confirm"}>
      {d && (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) finish(d.kind === "text" ? text.trim() : "yes"); }}>
          <p className="flex gap-2.5 text-sm text-ink-2">
            {d.kind === "text" ? <MessageSquareText className="mt-0.5 size-4 shrink-0 text-accent" /> : <HelpCircle className="mt-0.5 size-4 shrink-0 text-reserved" />}
            <span className="text-ink">{d.message}</span>
          </p>
          {d.kind === "text" && (
            <Field label={d.optional ? "Note (optional)" : "Reason"}>
              <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={d.optional ? "" : "At least 3 characters"} />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => finish(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!valid} autoFocus={d.kind === "confirm"}>{d.kind === "text" ? "Continue" : "Confirm"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
