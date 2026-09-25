"use client";

import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Loader2, X } from "lucide-react";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ── Button ──────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 font-semibold",
  secondary: "bg-panel-2 text-ink border border-line-strong hover:border-ink-3",
  ghost: "text-ink-2 hover:text-ink hover:bg-panel-2",
  danger: "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean; size?: "sm" | "md" }>(
  function Button({ variant = "secondary", pending, size = "md", className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
          size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
          VARIANTS[variant],
          className,
        )}
        disabled={disabled || pending}
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
  "w-full h-9 rounded-md bg-bg border border-line-strong px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none transition";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(control, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(control, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("grid gap-1.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

// ── Surfaces ────────────────────────────────────────────────────────────────

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-xl border border-line bg-panel", className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const BADGE: Record<string, string> = {
  neutral: "border-line-strong text-ink-2",
  accent: "border-accent/40 text-accent bg-accent/10",
  ok: "border-ok/40 text-ok bg-ok/10",
  warn: "border-reserved/40 text-reserved bg-reserved/10",
  danger: "border-danger/40 text-danger bg-danger/10",
  maint: "border-maint/40 text-maint bg-maint/10",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", BADGE[tone])}>{children}</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-ink-3" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-3">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
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
      onClose={onClose}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-xl border border-line-strong bg-panel p-0 text-ink shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-ink-3 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
