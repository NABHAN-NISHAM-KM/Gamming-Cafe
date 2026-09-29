"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LogOut, RotateCcw, Sparkles } from "lucide-react";

/** True in the static demo build (NEXT_PUBLIC_ARENA_DEMO=1); inlined at build time. */
export const IS_DEMO = process.env["NEXT_PUBLIC_ARENA_DEMO"] === "1";

/**
 * Demo build only: installs the in-browser ArenaOS backend before the app
 * renders, so every screen talks to the simulated venue instead of a server.
 * In normal builds this renders its children untouched and the demo code is
 * never bundled.
 */
export function DemoBoot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!IS_DEMO);
  useEffect(() => {
    if (!IS_DEMO) return;
    void import("@arena/demo").then((m) => m.installDemo("admin")).then(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status">
        <div className="flex flex-col items-center gap-4">
          <span className="brand-gradient size-12 animate-pulse rounded-2xl shadow-glow" />
          <span className="text-sm text-ink-3">Starting the ArenaOS demo…</span>
        </div>
      </div>
    );
  }
  return (
    <>
      {children}
      {IS_DEMO && <DemoBar />}
    </>
  );
}

function DemoBar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-1 rounded-full border border-accent/40 bg-panel/90 p-1 text-xs shadow-glow backdrop-blur-xl">
      <button onClick={() => setOpen(!open)} className="press flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold text-accent" aria-expanded={open}>
        <Sparkles className="size-3.5" /> Live demo
      </button>
      {open && (
        <>
          <span className="hidden px-1 text-ink-3 sm:inline">Everything works — data is saved on this device.</span>
          <button onClick={() => (window as any).__ARENA_DEMO__?.reset()} className="press flex items-center gap-1 rounded-full px-2.5 py-1.5 text-ink-2 hover:bg-panel-2 hover:text-ink" title="Start the demo venue fresh">
            <RotateCcw className="size-3.5" /> Reset
          </button>
          <button onClick={() => (window as any).__ARENA_DEMO__?.signOut()} className="press flex items-center gap-1 rounded-full px-2.5 py-1.5 text-ink-2 hover:bg-panel-2 hover:text-ink">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </>
      )}
    </div>
  );
}

export const DEMO_ACCOUNTS = [
  { label: "Owner", email: "owner@demo.test", hint: "Everything in the venue" },
  { label: "Manager", email: "manager@demo.test", hint: "Dubai Marina branch" },
  { label: "Cashier", email: "cashier@demo.test", hint: "Floor, POS, customers" },
  { label: "Super Admin", email: "super@arenaos.test", hint: "The whole platform" },
] as const;
export const DEMO_PASSWORD = "ArenaDemo!2026";
