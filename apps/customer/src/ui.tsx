import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Loader2, X } from "lucide-react";
import { dir, t } from "./i18n";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
export type Toast = (text: string, ok?: boolean) => void;

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fn().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function Screen({ title, children, back, action }: { title: string; children: ReactNode; back?: () => void; action?: ReactNode }) {
  return (
    <section className="animate-enter mx-auto w-full max-w-lg px-4 pb-28 pt-6">
      <div className="mb-5 flex items-center gap-2">
        {back && (
          <button onClick={back} className="-ms-2 p-2 text-dim" aria-label={t("Back")}>
            <ChevronLeft className={cx("size-6", dir() === "rtl" && "rotate-180")} />
          </button>
        )}
        <h1 className="flex-1 font-display text-[1.75rem] font-semibold">{title}</h1>
        {action}
      </div>
      {children}
    </section>
  );
}

export const Loading = () => (
  <div className="grid place-items-center py-16">
    <Loader2 className="size-7 animate-spin text-glow" />
  </div>
);

/** A bottom sheet on phones, a centred card on wider screens. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="animate-pop max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-rim bg-deck p-6 pb-10 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <p className="font-display text-xl font-semibold">{title}</p>
          <button onClick={onClose} aria-label={t("Close")} className="text-dim"><X className="size-6" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const ErrorText = ({ children }: { children: ReactNode }) =>
  children ? <p role="alert" className="rounded-xl border border-alarm/40 bg-alarm/10 px-4 py-3 text-sm text-alarm">{children}</p> : null;

export const hours = (min: number) => (min >= 60 ? t("{h} h{m}", { h: Math.floor(min / 60), m: min % 60 ? ` ${min % 60} ${t("min")}` : "" }) : `${min} ${t("min")}`);
