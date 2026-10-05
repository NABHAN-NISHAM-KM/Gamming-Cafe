"use client";

import { useEffect, useState } from "react";
import { Check, ListOrdered, Smartphone, UserPlus, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table } from "@/components/ui";

interface Board {
  zones: Array<{ id: string; name: string; free: number; nextFreeAt: string | null }>;
  entries: Array<{
    id: string; position: number; name: string; phone: string | null; partySize: number; zoneId: string | null; status: "WAITING" | "NOTIFIED";
    source: "STAFF" | "APP"; offeredDevice: string | null; claimUntil: string | null; createdAt: string; nextFreeAt: string | null;
  }>;
}

const mins = (iso: string | null, now: number) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000)) : null);

/**
 * When the floor is full: take a name, and the first in line is offered a
 * station as soon as one frees up in the zone they asked for. App users join
 * from their phone and get a push; walk-ins are called from here.
 */
export default function WaitlistPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const board = useApi<Board>(branchId ? `/branches/${branchId}/waitlist` : null);
  const [f, setF] = useState({ name: "", phone: "", partySize: "1", zoneId: "" });
  const [now, setNow] = useState(() => Date.now());
  const mayEdit = can("booking.create", branchId ?? undefined);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      void board.reload();
    }, 15_000);
    return () => clearInterval(t);
  }, [board]);

  const add = useAction(async () => {
    const r = await api<Board>(`/branches/${branchId}/waitlist`, { method: "POST", body: { name: f.name.trim(), phone: f.phone.trim() || null, partySize: Number(f.partySize) || 1, zoneId: f.zoneId || null }, done: `${f.name.trim()} is on the list.` });
    board.setData(r);
    setF({ name: "", phone: "", partySize: "1", zoneId: "" });
  });
  const act = useAction(async (id: string, action: "seat" | "cancel") => {
    board.setData(await api<Board>(`/branches/${branchId}/waitlist/${id}/${action}`, { method: "POST" }));
  });
  const zoneName = (id: string | null) => (id ? (board.data?.zones.find((z) => z.id === id)?.name ?? "—") : "Any zone");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Waitlist"
        subtitle="Full floor? Put people in line. When a station frees up in the zone they want, the first in line is offered it for 10 minutes."
        actions={branches.data && branches.data.length > 1 && (
          <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
            {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        )}
      />
      <ErrorNote>{add.error ?? act.error}</ErrorNote>
      {board.data && (
        <div className="flex flex-wrap gap-2">
          {board.data.zones.map((z) => (
            <span key={z.id} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <b className={z.free ? "text-ok" : "text-ink-3"}>{z.free}</b> free · {z.name}
              {!z.free && z.nextFreeAt && <span className="ml-1 text-ink-3">(next in {mins(z.nextFreeAt, now)} min)</span>}
            </span>
          ))}
        </div>
      )}
      {mayEdit && (
        <Card className="p-5">
          <form className="grid items-end gap-3 sm:grid-cols-[2fr_1.5fr_0.7fr_1.5fr_auto]" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) void add.run(); }}>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Who's waiting" maxLength={80} required /></Field>
            <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="To call them back" /></Field>
            <Field label="People"><Input type="number" min={1} max={20} value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} /></Field>
            <Field label="Zone">
              <Select value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })}>
                <option value="">Any zone</option>
                {board.data?.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </Select>
            </Field>
            <Button type="submit" pending={add.pending}><UserPlus className="size-4" /> Add</Button>
          </form>
        </Card>
      )}
      <Card>
        {!board.data ? (
          <Spinner />
        ) : board.data.entries.length === 0 ? (
          <Empty icon={<ListOrdered className="size-8" />} title="Nobody's waiting">People added here, or from the customer app, show up in order.</Empty>
        ) : (
          <Table head={["#", "Who", "People", "Zone", "Waiting", "Status", ""]}>
            {board.data.entries.map((e) => (
              <tr key={e.id} className={e.status === "NOTIFIED" ? "border-t border-line bg-ok/5" : "border-t border-line"}>
                <td className="px-4 py-2 tabular-nums text-ink-3">{e.position}</td>
                <td className="px-4 py-2">
                  <span className="font-medium">{e.name}</span> {e.source === "APP" && <Smartphone className="inline size-3.5 text-accent" aria-label="Joined from the app" />}
                  {e.phone && <a href={`tel:${e.phone}`} className="block text-xs text-accent">{e.phone}</a>}
                </td>
                <td className="px-4 py-2 tabular-nums">{e.partySize}</td>
                <td className="px-4 py-2 text-ink-2">{zoneName(e.zoneId)}</td>
                <td className="px-4 py-2 text-ink-3">{Math.round((now - new Date(e.createdAt).getTime()) / 60_000)} min</td>
                <td className="px-4 py-2">
                  {e.status === "NOTIFIED" ? (
                    <><Badge tone="ok">{e.offeredDevice} is theirs</Badge><span className="block text-[11px] text-ink-3">{mins(e.claimUntil, now)} min to claim</span></>
                  ) : (
                    <><Badge tone="warn">waiting</Badge>{e.nextFreeAt && <span className="block text-[11px] text-ink-3">next free in ~{mins(e.nextFreeAt, now)} min</span>}</>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  {mayEdit && (
                    <>
                      <Button size="sm" variant={e.status === "NOTIFIED" ? "primary" : "secondary"} pending={act.pending} onClick={() => void act.run(e.id, "seat")}><Check className="size-3.5" /> Seated</Button>
                      <Button size="sm" variant="ghost" pending={act.pending} onClick={() => void act.run(e.id, "cancel")} aria-label={`Remove ${e.name}`}><X className="size-3.5" /></Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
