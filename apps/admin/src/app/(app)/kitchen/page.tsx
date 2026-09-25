"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, ChefHat, Clock, Maximize2, Minimize2, Monitor, Utensils } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useCan } from "@/lib/client/me";
import type { KitchenBoard, Ticket, TicketStatus } from "@/lib/client/pos";
import { Badge, Button, Empty, ErrorNote, PageHeader, Select, Spinner, cx } from "@/components/ui";

const COLUMNS: Array<{ id: string; title: string; statuses: TicketStatus[] }> = [
  { id: "new", title: "New", statuses: ["NEW", "ACCEPTED"] },
  { id: "cooking", title: "Cooking", statuses: ["PREPARING"] },
  { id: "ready", title: "Ready to serve", statuses: ["READY"] },
];
const NEXT: Partial<Record<TicketStatus, { to: TicketStatus; label: string }>> = {
  NEW: { to: "PREPARING", label: "Start" },
  ACCEPTED: { to: "PREPARING", label: "Start" },
  PREPARING: { to: "READY", label: "Ready" },
  READY: { to: "SERVED", label: "Served" },
};
const LATE_MIN = 12;
const STATION_KEY = "arena.kds.station";

const since = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function KitchenPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const [station, setStation] = useState("");
  const [board, setBoard] = useState<KitchenBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [skew, setSkew] = useState(0);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      const b = await api<KitchenBoard>(`/branches/${branchId}/kitchen${station ? `?stationId=${station}` : ""}`);
      setSkew(new Date(b.serverTime).getTime() - Date.now());
      // A soft chime for tickets that arrived since the last look.
      const fresh = b.tickets.filter((t) => t.status === "NEW" && !seen.current.has(t.id));
      b.tickets.forEach((t) => seen.current.add(t.id));
      if (fresh.length && !first.current) chime();
      first.current = false;
      setBoard(b);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the kitchen.");
    }
  }, [branchId, station]);

  useEffect(() => {
    first.current = true;
    seen.current = new Set();
    setBoard(null);
    void load();
  }, [load]);

  // Live: any ticket change at this branch → reload the board. Poll as a fallback.
  useEffect(() => {
    if (!branchId) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource(`/api/v1/branches/${branchId}/kitchen/events`);
      es.addEventListener("ready", () => { setLive(true); void load(); });
      es.addEventListener("kitchen", () => void load());
      es.onerror = () => {
        setLive(false);
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      es?.close();
      clearTimeout(retry);
      clearInterval(poll);
    };
  }, [branchId, load]);

  useEffect(() => {
    try {
      setStation(localStorage.getItem(STATION_KEY) ?? "");
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const bump = async (t: Ticket, to: TicketStatus) => {
    setBusy(t.id);
    try {
      await api(`/kitchen-tickets/${t.id}/bump`, { method: "POST", body: { to } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the ticket.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const pickStation = (id: string) => {
    setStation(id);
    try {
      localStorage.setItem(STATION_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const serverNow = now + skew;
  const tickets = board?.tickets ?? [];
  const served = tickets.filter((t) => t.status === "SERVED").slice(-6).reverse();
  const canBump = can("kds.bump", branchId ?? undefined);

  return (
    <div className={cx("space-y-4", full && "fixed inset-0 z-50 overflow-y-auto bg-bg p-4")}>
      <PageHeader
        title="Kitchen"
        subtitle={full ? undefined : "Tickets from the POS, tables and in-seat orders. Tap to move them along — the customer's PC is told when food is on its way."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("flex items-center gap-1.5 text-xs", live ? "text-ok" : "text-ink-3")}><span className={cx("size-2 rounded-full", live ? "bg-ok" : "bg-ink-3")} />{live ? "Live" : "Reconnecting…"}</span>
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            <Select value={station} onChange={(e) => pickStation(e.target.value)} className="w-auto" aria-label="Station">
              <option value="">All stations</option>
              {board?.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setFull(!full)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button>
          </div>
        }
      />
      <ErrorNote>{error}</ErrorNote>
      {!board ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <Empty icon={<ChefHat className="size-8" />} title="All clear">New tickets appear here the moment they're ordered.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = tickets.filter((t) => col.statuses.includes(t.status));
            return (
              <section key={col.id} className="min-w-0">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-3">{col.title} <span className="rounded-full bg-panel-2 px-2 text-xs">{list.length}</span></h2>
                <div className="grid gap-3">
                  {list.map((t) => <TicketCard key={t.id} t={t} now={serverNow} busy={busy === t.id} canBump={canBump} showStation={!station} onBump={(to) => void bump(t, to)} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {served.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Recently served</h2>
          <div className="flex flex-wrap gap-2">
            {served.map((t) => <span key={t.id} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-3">{t.order.number} · {t.deliverTo}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

function TicketCard({ t, now, busy, canBump, showStation, onBump }: { t: Ticket; now: number; busy: boolean; canBump: boolean; showStation: boolean; onBump: (to: TicketStatus) => void }) {
  const age = since(t.createdAt, now);
  const late = t.status !== "READY" && age > LATE_MIN * 60;
  const next = NEXT[t.status];
  const Where = t.order.type === "GAMING_SEAT" ? Monitor : Utensils;
  return (
    <article className={cx("rounded-xl border bg-panel", late ? "border-danger/60" : t.status === "READY" ? "border-ok/50" : "border-line")}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-lg font-bold">{t.order.number}</span>
        <span className="flex min-w-0 items-center gap-1 truncate text-sm text-ink-2"><Where className="size-3.5 shrink-0" />{t.deliverTo}</span>
        <span className={cx("ml-auto flex items-center gap-1 text-sm tabular-nums", late ? "font-semibold text-danger" : "text-ink-3")}><Clock className="size-3.5" />{clock(age)}</span>
      </header>
      <ul className="grid gap-1 px-3 py-2">
        {t.items.map((x) => (
          <li key={x.id}>
            <p className="text-[15px]"><strong className="tabular-nums">{x.quantity}×</strong> {x.nameSnapshot}</p>
            {x.modifiers?.length ? <p className="pl-6 text-xs text-accent">{x.modifiers.map((m) => m.name).join(" · ")}</p> : null}
            {x.notes && <p className="pl-6 text-xs text-reserved">“{x.notes}”</p>}
          </li>
        ))}
      </ul>
      {(t.order.notes || t.notes) && <p className="mx-3 mb-2 rounded-md bg-reserved/10 px-2 py-1 text-xs text-reserved">{t.order.notes ?? t.notes}</p>}
      <footer className="flex items-center gap-2 border-t border-line px-3 py-2">
        {showStation && <Badge>{t.station.name}</Badge>}
        {t.order.channel === "SHELL" && <Badge tone="accent">in-seat</Badge>}
        {t.status === "READY" && <span className="flex items-center gap-1 text-xs text-ok"><BellRing className="size-3.5" /> waiting</span>}
        {canBump && next && (
          <Button size="sm" variant={t.status === "READY" ? "secondary" : "primary"} className="ml-auto" pending={busy} onClick={() => onBump(next.to)}>
            {next.label}
          </Button>
        )}
      </footer>
    </article>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.5);
  } catch {
    /* audio blocked until the page is touched — fine */
  }
}
