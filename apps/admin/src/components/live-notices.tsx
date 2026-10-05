"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Check, LifeBuoy, ListOrdered, ReceiptText, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { ORDER_TYPE, money } from "@/lib/client/pos";
import { Button } from "@/components/ui";

type Help = { kind: "help"; key: string; alertId: string; title: string; topic: string; note: string | null; device: string | null; customer: string | null; at: number };
type Order = { kind: "order"; key: string; number: string; type: string; channel: string; deliverTo: string | null; customer: string | null; total: string; currency: string; notes: string | null; items: Array<{ name: string; quantity: number }>; at: number };
type Wait = { kind: "wait"; key: string; name: string; partySize: number; device: string; at: number };
type Notice = Help | Order | Wait;

const TOPIC: Record<string, string> = { general: "General help", game: "Help with a game", peripheral: "Mouse, keyboard or headset", network: "Internet / connection", payment: "Payment or time" };
const CHANNEL: Record<string, string> = { SHELL: "from the PC", WAITER: "from a waiter", QR_TABLE: "from a table QR", WEB: "online", MOBILE: "from the app", KIOSK: "from the kiosk" };

/** Live events for the selected branch, re-broadcast so any page can refresh itself ("arena:live"). */
export const LIVE_EVENT = "arena:live";

/**
 * Always on, every admin page: pops up (with a sound) when a player asks for help
 * from the Shell, or an order comes in from a PC, table, app or kiosk.
 */
export function LiveNotices() {
  const { branchId } = useBranch();
  const [notices, setNotices] = useState<Notice[]>([]);
  const push = (n: Notice) => {
    setNotices((all) => [n, ...all.filter((x) => x.key !== n.key)].slice(0, 6));
    chime(n.kind);
  };
  const drop = (key: string) => setNotices((all) => all.filter((x) => x.key !== key));

  useEffect(() => {
    if (!branchId) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const relay = (type: string, data: unknown) => window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: { type, data } }));
    const connect = () => {
      es = new EventSource(`/api/v1/branches/${branchId}/notifications`);
      es.addEventListener("alert", (ev) => {
        const { alert } = JSON.parse((ev as MessageEvent).data) as { alert: { id: string; type: string; status: string; title: string; detail?: Record<string, unknown> } };
        relay("alert", alert);
        if (alert.type !== "HELP_REQUESTED") return;
        if (alert.status !== "OPEN") return drop(`help:${alert.id}`); // someone answered it
        const d = alert.detail ?? {};
        push({ kind: "help", key: `help:${alert.id}`, alertId: alert.id, title: alert.title, topic: String(d["topic"] ?? "general"), note: (d["note"] as string | null) ?? null, device: (d["device"] as string | null) ?? null, customer: (d["customer"] as string | null) ?? null, at: Date.now() });
      });
      es.addEventListener("order", (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as { change: string; order: Omit<Order, "kind" | "key" | "at"> & { id: string } };
        relay("order", e);
        // Staff at the till placed it themselves — no need to tell them.
        if (e.change === "placed" && e.order.channel && e.order.channel !== "POS" && e.order.channel !== "SYSTEM") push({ ...e.order, kind: "order", key: `order:${e.order.id}`, at: Date.now() });
      });
      es.addEventListener("kitchen", (ev) => relay("kitchen", JSON.parse((ev as MessageEvent).data)));
      es.addEventListener("waitlist", (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as { change: string; entry: { id: string; name: string; partySize: number; device?: string | null } };
        relay("waitlist", e);
        if (e.change === "offered" && e.entry.device) push({ kind: "wait", key: `wait:${e.entry.id}`, name: e.entry.name, partySize: e.entry.partySize, device: e.entry.device, at: Date.now() });
      });
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const ack = async (n: Help) => {
    drop(n.key);
    await api(`/alerts/${n.alertId}/ack`, { method: "POST" }).catch(() => undefined);
  };

  if (!notices.length) return null;
  return (
    <div className="fixed right-4 top-20 z-50 grid w-[min(380px,calc(100vw-2rem))] gap-3" role="region" aria-label="Live notifications" aria-live="assertive">
      {notices.map((n) => (
        n.kind === "wait" ? (
          <article key={n.key} className="surface animate-enter rounded-2xl border-2 border-ok/60 p-4 shadow-2xl shadow-black/60">
            <header className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ok/15 text-ok"><ListOrdered className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-bold">Call {n.name}</p>
                <p className="text-sm text-ink-2">{n.device} is free for them{n.partySize > 1 ? ` (${n.partySize} people)` : ""} · 10 minutes to claim</p>
              </div>
              <button onClick={() => drop(n.key)} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Dismiss"><X className="size-4" /></button>
            </header>
            <footer className="mt-3 flex gap-2">
              <Link href="/waitlist" onClick={() => drop(n.key)} className="press brand-gradient inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-accent-ink">Open waitlist</Link>
            </footer>
          </article>
        ) : (
        <article key={n.key} className={`surface animate-enter rounded-2xl border-2 p-4 shadow-2xl shadow-black/60 ${n.kind === "help" ? "border-reserved/70" : "border-accent/60"}`}>
          <header className="flex items-start gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${n.kind === "help" ? "bg-reserved/15 text-reserved" : "bg-accent/15 text-accent"}`}>
              {n.kind === "help" ? <LifeBuoy className="size-5" /> : <ReceiptText className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              {n.kind === "help" ? (
                <>
                  <p className="font-display text-base font-bold">{n.device ?? "A PC"} needs help</p>
                  <p className="text-sm text-ink-2">{n.customer ?? "A guest"} · {TOPIC[n.topic] ?? n.topic}</p>
                </>
              ) : (
                <>
                  <p className="font-display text-base font-bold">New order {n.number}</p>
                  <p className="text-sm text-ink-2">{[n.customer, n.deliverTo].filter(Boolean).join(" · ") || ORDER_TYPE[n.type] || n.type} {CHANNEL[n.channel] ?? ""}</p>
                </>
              )}
            </div>
            <button onClick={() => drop(n.key)} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Dismiss"><X className="size-4" /></button>
          </header>
          {n.kind === "help" ? (
            n.note && <p className="mt-3 rounded-lg bg-bg/50 px-3 py-2 text-sm">“{n.note}”</p>
          ) : (
            <>
              <ul className="mt-3 grid gap-0.5 rounded-lg bg-bg/50 px-3 py-2 text-sm">
                {n.items.map((x, i) => <li key={i}><strong className="text-accent">{x.quantity}×</strong> {x.name}</li>)}
              </ul>
              {n.notes && <p className="mt-2 text-xs text-reserved">“{n.notes}”</p>}
              <p className="mt-2 text-right font-display font-bold tabular-nums">{money(n.total, n.currency)}</p>
            </>
          )}
          <footer className="mt-3 flex gap-2">
            {n.kind === "help" ? (
              <>
                <Button size="sm" variant="primary" onClick={() => void ack(n)}><Check className="size-3.5" />On my way</Button>
                <Link href="/floor" onClick={() => drop(n.key)} className="press inline-flex h-8 items-center rounded-lg px-3 text-xs text-ink-2 hover:bg-panel-2 hover:text-ink">Open Live Floor</Link>
              </>
            ) : (
              <>
                <Link href="/orders" onClick={() => drop(n.key)} className="press brand-gradient inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-accent-ink"><BellRing className="size-3.5" />View order</Link>
                <Link href="/kitchen" onClick={() => drop(n.key)} className="press inline-flex h-8 items-center rounded-lg px-3 text-xs text-ink-2 hover:bg-panel-2 hover:text-ink">Kitchen</Link>
              </>
            )}
          </footer>
        </article>
        )
      ))}
    </div>
  );
}

/** Two notes for an order, three rising notes (twice) for help. Silent until the page has been clicked once (browser rule). */
function chime(kind: Notice["kind"]) {
  try {
    const ctx = new AudioContext();
    const notes = kind === "help" ? [660, 880, 1100, 660, 880, 1100] : kind === "wait" ? [523, 659, 784] : [880, 1320];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.17);
    });
    setTimeout(() => void ctx.close(), notes.length * 180 + 300);
  } catch {
    /* audio unavailable */
  }
}
