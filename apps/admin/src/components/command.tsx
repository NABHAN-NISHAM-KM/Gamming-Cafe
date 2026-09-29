"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { cx, Kbd } from "@/components/ui";

export interface Command {
  id: string;
  label: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  run?: () => void;
  keywords?: string;
}

/** Ctrl/⌘ K palette: jump to any page or run an action from the keyboard. */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setSel(0);
      d.showModal();
      requestAnimationFrame(() => input.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    return commands
      .map((c) => {
        const hay = `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
        const score = c.label.toLowerCase().startsWith(t) ? 0 : hay.includes(t) ? 1 : t.split("").every((ch) => hay.includes(ch)) ? 2 : 9;
        return { c, score };
      })
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c);
  }, [q, commands]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const go = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    if (c.run) c.run();
    else if (c.href) router.push(c.href);
  };

  let lastGroup = "";
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label="Command palette"
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-panel p-0 text-ink shadow-2xl shadow-black/70"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter") { e.preventDefault(); go(shown[sel]); }
          }}
          placeholder="Jump to a page or action…"
          className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={shown[sel] ? `cmdk-${shown[sel].id}` : undefined}
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul ref={list} id="cmdk-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
        {shown.length === 0 && <li className="px-3 py-10 text-center text-sm text-ink-3">No matches for “{q}”.</li>}
        {shown.map((c, i) => {
          const header = !q && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <li key={c.id} role="presentation">
              {header && <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3 first:pt-1">{header}</p>}
              <button
                id={`cmdk-${c.id}`}
                data-i={i}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => setSel(i)}
                onClick={() => go(c)}
                className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm", i === sel ? "bg-accent-soft text-ink" : "text-ink-2")}
              >
                <c.icon className={cx("size-4", i === sel ? "text-accent" : "text-ink-3")} />
                <span className="flex-1">{c.label}</span>
                {q && <span className="text-xs text-ink-3">{c.group}</span>}
                {i === sel && <CornerDownLeft className="size-3.5 text-ink-3" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd> open</span>
      </div>
    </dialog>
  );
}
