"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, BellRing, ChefHat, Clock, Monitor, Utensils } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useCan } from "@/lib/client/me";
import { ORDER_TYPE, type KitchenBoard, type Ticket, type TicketStatus } from "@/lib/client/pos";
import { Badge, Button, Empty, ErrorNote, PageHeader, Select, Spinner, askText, cx } from "@/components/ui";

const FILTERS: Array<{ id: string; title: string; statuses: TicketStatus[] }> = [
  { id: "all", title: "All", statuses: [] },
  { id: "new", title: "New", statuses: ["NEW", "ACCEPTED"] },
  { id: "cooking", title: "Cooking", statuses: ["PREPARING"] },
  { id: "ready", title: "Ready to serve", statuses: ["READY"] },
];
const NEXT: Partial<Record<TicketStatus, { to: TicketStatus; label: string }>> = {
  NEW: { to: "PREPARING", label: "Start cooking" },
  ACCEPTED: { to: "PREPARING", label: "Start cooking" },
  PREPARING: { to: "READY", label: "Food is ready" },
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
  const [filter, setFilter] = useState("all");
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

  const cancel = async (t: Ticket) => {
    const reason = await askText(`Cancel order ${t.order.number}? The kitchen stops working on it.`);
    if (!reason) return;
    setBusy(t.id);
    try {
      await api(`/orders/${t.order.id}/cancel`, { method: "POST", body: { reason }, reason, action: `Cancel order ${t.order.number}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel the order.");
    } finally {
      setBusy(null);
      await load();
    }
  };

  const serverNow = now + skew;
  const tickets = board?.tickets ?? [];
  const active = tickets.filter((t) => t.status !== "SERVED");
  const inFilter = (t: Ticket, id: string) => id === "all" || FILTERS.find((f) => f.id === id)!.statuses.includes(t.status);
  const shown = active.filter((t) => inFilter(t, filter));
  const served = tickets.filter((t) => t.status === "SERVED").slice(-6).reverse();
  const canBump = can("kds.bump", branchId ?? undefined);
  const canCancel = can("restaurant.cancel_order", branchId ?? undefined);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kitchen"
        subtitle="Move each ticket along — the customer's PC is told when food is on its way."
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
          </div>
        }
      />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter tickets">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cx("press flex h-9 items-center gap-2 rounded-full border px-4 text-sm", filter === f.id ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-ink-2 hover:border-line-strong hover:text-ink")}
          >
            {f.title} <span className="rounded-full bg-panel-2 px-2 text-xs tabular-nums text-ink-2">{active.filter((t) => inFilter(t, f.id)).length}</span>
          </button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!board ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <Empty icon={<ChefHat className="size-8" />} title="All clear">New tickets appear here the moment they're ordered.</Empty>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
          {shown.map((t) => <TicketCard key={t.id} t={t} now={serverNow} busy={busy === t.id} canBump={canBump} canCancel={canCancel} showStation={!station} onBump={(to) => void bump(t, to)} onCancel={() => void cancel(t)} />)}
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

const STATUS: Record<TicketStatus, { label: string; tone: "accent" | "warn" | "ok" | "neutral" }> = {
  NEW: { label: "New", tone: "accent" },
  ACCEPTED: { label: "New", tone: "accent" },
  PREPARING: { label: "Cooking", tone: "warn" },
  READY: { label: "Ready", tone: "ok" },
  SERVED: { label: "Served", tone: "neutral" },
};

function TicketCard({ t, now, busy, canBump, canCancel, showStation, onBump, onCancel }: { t: Ticket; now: number; busy: boolean; canBump: boolean; canCancel: boolean; showStation: boolean; onBump: (to: TicketStatus) => void; onCancel: () => void }) {
  const age = since(t.createdAt, now);
  const late = t.status !== "READY" && age > LATE_MIN * 60;
  const next = NEXT[t.status];
  const Where = t.order.type === "GAMING_SEAT" ? Monitor : Utensils;
  const st = STATUS[t.status];
  return (
    <article className={cx("surface flex flex-col rounded-2xl p-4", late && "!border-danger/60", t.status === "READY" && "!border-ok/50")}>
      <header className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="font-display text-xl font-bold text-accent">{t.order.number}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-ink-2"><Where className="size-3.5 shrink-0" />{t.deliverTo ?? "—"}</p>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className={cx("flex items-center gap-1 text-xs tabular-nums", late ? "font-semibold text-danger" : "text-ink-3")}><Clock className="size-3" />{clock(age)}</span>
        </div>
      </header>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{ORDER_TYPE[t.order.type] ?? t.order.type}</Badge>
        {t.order.channel === "SHELL" && <Badge tone="accent">in-seat</Badge>}
        {showStation && <Badge>{t.station.name}</Badge>}
      </div>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-bg/40">
        {t.items.map((x) => (
          <li key={x.id} className="px-3 py-2">
            <p className="text-[15px]"><strong className="tabular-nums text-accent">{x.quantity}×</strong> {x.nameSnapshot}</p>
            {x.modifiers?.length ? <p className="pl-6 text-xs text-ink-3">+ {x.modifiers.map((m) => m.name).join(" · ")}</p> : null}
            {x.notes && <p className="pl-6 text-xs text-reserved">“{x.notes}”</p>}
          </li>
        ))}
      </ul>
      {(t.order.notes || t.notes) && <p className="mt-2 rounded-md bg-reserved/10 px-2 py-1 text-xs text-reserved">{t.order.notes ?? t.notes}</p>}
      <footer className="mt-auto flex items-center gap-2 pt-4">
        {canCancel && t.status !== "READY" && (
          <Button size="sm" variant="danger" disabled={busy} onClick={onCancel}><Ban className="size-3.5" />Cancel</Button>
        )}
        {canBump && next && (
          <Button size="sm" variant={t.status === "READY" ? "secondary" : "primary"} className="ml-auto" pending={busy} onClick={() => onBump(next.to)}>
            {t.status === "READY" && <BellRing className="size-3.5" />}{next.label}
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
