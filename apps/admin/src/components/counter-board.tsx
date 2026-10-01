"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, Boxes, Check, ChefHat, Clock, NotebookPen, Plus, Wrench } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { useLiveFloor } from "@/lib/client/floor";
import { fmtCountdown, remaining, useTick } from "@/lib/client/sessions";
import { useT } from "@/lib/client/i18n";
import { LIVE_EVENT } from "@/components/live-notices";
import { Button, Card, ErrorNote, Input, cx } from "@/components/ui";

interface Note {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}
interface Ticket {
  id: string;
  status: string;
  createdAt: string;
  deliverTo: string | null;
  order: { number: string; customer: string | null };
  items: Array<{ id: string; nameSnapshot: string; quantity: number }>;
}
interface LowStock {
  alerts: Array<{ itemId: string; name: string; quantity: string; minStock: string; baseUnit: string; status: string }>;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Refetch when the branch's live stream says something changed (kitchen / order events). */
function useLiveReload(types: string[], reload: () => void) {
  useEffect(() => {
    const on = (e: Event) => types.includes((e as CustomEvent<{ type: string }>).detail.type) && reload();
    addEventListener(LIVE_EVENT, on);
    return () => removeEventListener(LIVE_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);
}

/**
 * What the counter needs to see at a glance: whose time is running out, food
 * waiting, anything that needs attention, notes from the last shift, and low stock.
 * Each card only shows when the person may act on it.
 */
export function CounterBoard({ branchId }: { branchId: string }) {
  const can = useCan();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {can("station.view", branchId) && <FloorCards branchId={branchId} />}
      {can("kds.view", branchId) && <FoodWaiting branchId={branchId} />}
      <HandoverNotes branchId={branchId} />
      {can("inventory.view", branchId) && <LowStockCard branchId={branchId} />}
    </div>
  );
}

function CardHead({ icon, title, count, href }: { icon: React.ReactNode; title: string; count?: number; href?: string }) {
  const head = (
    <h2 className="flex items-center gap-2 text-sm font-semibold">
      {icon} {title}
      {!!count && <span className="rounded-full bg-accent/15 px-2 text-xs tabular-nums text-accent">{count}</span>}
    </h2>
  );
  return <div className="mb-3 flex items-center justify-between">{href ? <Link href={href} className="hover:text-accent">{head}</Link> : head}</div>;
}

function FloorCards({ branchId }: { branchId: string }) {
  useTick(15_000);
  const t = useT();
  const floor = useLiveFloor(branchId);
  const devices = Object.values(floor.devices);
  const ending = devices
    .filter((d) => d.session?.expiresAt && (remaining(d.session.expiresAt) ?? 0) <= 10 * 60_000)
    .sort((a, b) => Date.parse(a.session!.expiresAt!) - Date.parse(b.session!.expiresAt!));
  const alerts = Object.values(floor.alerts).filter((a) => a.status !== "RESOLVED");
  const broken = devices.filter((d) => d.status === "MAINTENANCE");
  const attention = alerts.length + broken.length;
  const name = (id: string | null) => (id ? (floor.devices[id]?.name ?? "") : "");

  return (
    <>
      <Card className="p-4">
        <CardHead icon={<Clock className="size-4 text-ending" />} title={t("board.ending")} count={ending.length} href="/floor?show=ending" />
        {ending.length === 0 ? (
          <p className="text-sm text-ink-3">{t("board.ending.none")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {ending.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <span className="w-16 font-semibold">{d.name}</span>
                <span className="flex-1 truncate text-ink-2">{d.session!.customer?.displayName ?? d.session!.guestLabel ?? "Guest"}</span>
                <span className="font-mono tabular-nums text-ending">{fmtCountdown(remaining(d.session!.expiresAt), false)}</span>
                <Link href={`/floor?station=${d.id}`}>
                  <Button size="sm"><Plus className="size-3.5" /> {t("board.addtime")}</Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className={cx("p-4", attention > 0 && "border-reserved/40")}>
        <CardHead icon={<AlertTriangle className="size-4 text-reserved" />} title={t("board.attention")} count={attention} href="/floor?show=attention" />
        {attention === 0 ? (
          <p className="text-sm text-ink-3">{t("board.attention.none")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {alerts.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                {a.type === "HELP_REQUESTED" ? <BellRing className="size-4 shrink-0 text-reserved" /> : <AlertTriangle className={cx("size-4 shrink-0", a.severity === "CRITICAL" ? "text-danger" : "text-reserved")} />}
                <span className="flex-1">{a.title}</span>
                <span className="text-xs text-ink-3">{time(a.openedAt)}</span>
              </li>
            ))}
            {broken.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2">
                <Wrench className="size-4 shrink-0 text-danger" />
                <span className="flex-1">
                  <strong>{d.name}</strong> — {t("status.MAINTENANCE").toLowerCase()}
                  {d.outOfOrder?.reason ? `: ${d.outOfOrder.reason}` : ""}
                </span>
                <Link href={`/floor?station=${d.id}`} className="text-xs text-accent hover:underline">{name(d.id) && "→"}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function FoodWaiting({ branchId }: { branchId: string }) {
  const t = useT();
  const board = useApi<{ tickets: Ticket[] }>(`/branches/${branchId}/kitchen`);
  useLiveReload(["kitchen", "order"], () => void board.reload());
  const waiting = (board.data?.tickets ?? []).filter((x) => x.status !== "SERVED");
  return (
    <Card className="p-4">
      <CardHead icon={<ChefHat className="size-4 text-accent" />} title={t("board.food")} count={waiting.length} href="/kitchen" />
      {waiting.length === 0 ? (
        <p className="text-sm text-ink-3">{t("board.food.none")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {waiting.slice(0, 6).map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-2">
              <span className="w-14 font-mono text-xs text-ink-3">#{k.order.number.slice(-4)}</span>
              <span className="flex-1 truncate">{k.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(", ")}</span>
              {k.deliverTo && <span className="text-xs text-ink-2">→ {k.deliverTo}</span>}
              <span className={cx("rounded-full px-2 text-[11px]", k.status === "READY" ? "bg-ok/15 text-ok" : "bg-panel-2 text-ink-2")}>{k.status.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HandoverNotes({ branchId }: { branchId: string }) {
  const t = useT();
  const notes = useApi<Note[]>(`/branches/${branchId}/handover-notes`);
  const [text, setText] = useState("");
  const add = useAction(async () => {
    await api(`/branches/${branchId}/handover-notes`, { method: "POST", body: { body: text.trim() } });
    setText("");
    await notes.reload();
  });
  const done = useAction(async (id: string) => {
    await api(`/handover-notes/${id}/resolve`, { method: "POST" });
    await notes.reload();
  });
  const open = (notes.data ?? []).filter((n) => !n.resolvedAt);
  const closed = (notes.data ?? []).filter((n) => n.resolvedAt).slice(0, 3);
  return (
    <Card className="p-4">
      <CardHead icon={<NotebookPen className="size-4 text-accent" />} title={t("board.notes")} count={open.length} />
      <p className="-mt-2 mb-3 text-xs text-ink-3">{t("board.notes.hint")}</p>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void add.run();
        }}
      >
        <Input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={t("board.notes.placeholder")} aria-label={t("board.notes.add")} />
        <Button type="submit" variant="primary" pending={add.pending} disabled={!text.trim()}>{t("board.notes.add")}</Button>
      </form>
      <ErrorNote>{add.error ?? done.error}</ErrorNote>
      {open.length === 0 ? (
        <p className="text-sm text-ink-3">{t("board.notes.none")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {open.map((n) => (
            <li key={n.id} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
                <p className="text-xs text-ink-3">{n.author} · {new Date(n.createdAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <Button size="sm" onClick={() => void done.run(n.id)} aria-label={`${t("board.notes.done")}: ${n.body}`}>
                <Check className="size-3.5" /> {t("board.notes.done")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <ul className="mt-2 grid gap-1 border-t border-line pt-2 text-xs text-ink-3">
          {closed.map((n) => (
            <li key={n.id} className="line-through decoration-ink-3/60">{n.body} <span className="no-underline">· {n.resolvedBy}</span></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LowStockCard({ branchId }: { branchId: string }) {
  const t = useT();
  const o = useApi<LowStock>(`/inventory/overview?branchId=${branchId}`);
  if (o.error) return null;
  const rows = o.data?.alerts ?? [];
  return (
    <Card className="p-4">
      <CardHead icon={<Boxes className="size-4 text-reserved" />} title={t("board.lowstock")} count={rows.length} href="/inventory" />
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">{t("board.lowstock.none")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.slice(0, 6).map((r) => (
            <li key={r.itemId} className="flex items-center gap-3 py-2">
              <span className="flex-1 truncate">{r.name}</span>
              <span className={cx("tabular-nums", r.status === "LOW" ? "text-reserved" : "text-danger")}>
                {Number(r.quantity)} {r.baseUnit} <span className="text-ink-3">/ min {Number(r.minStock)}</span>
              </span>
            </li>
          ))}
          {rows.length > 6 && <li className="pt-2 text-xs text-ink-3">+{rows.length - 6} more</li>}
        </ul>
      )}
    </Card>
  );
}
