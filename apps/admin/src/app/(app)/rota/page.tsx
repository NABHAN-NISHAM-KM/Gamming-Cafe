"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, askConfirm } from "@/components/ui";

interface Shift {
  id: string;
  employee: { id: string; displayName: string };
  startsAt: string;
  endsAt: string;
  note: string | null;
  clockInAt: string | null;
  lateMinutes: number | null;
  status: "PLANNED" | "ON_TIME" | "LATE" | "MISSED";
}
interface Rota {
  shifts: Shift[];
  people: Array<{ employee: { id: string; displayName: string }; planned: number; late: number; missed: number }>;
}

const STATUS: Record<Shift["status"], { tone: "neutral" | "ok" | "warn" | "danger"; label: string }> = {
  PLANNED: { tone: "neutral", label: "planned" }, ON_TIME: { tone: "ok", label: "on time" }, LATE: { tone: "warn", label: "late" }, MISSED: { tone: "danger", label: "no-show" },
};

/** Monday 00:00 (this browser's time) of the week containing d. */
const monday = (d: Date) => {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};
const day = (d: Date) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The week's rota: who works when, and — once the shift has started — whether they clocked in on time. */
export default function RotaPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const [week, setWeek] = useState(() => monday(new Date()));
  const end = useMemo(() => new Date(week.getTime() + 7 * 86_400_000), [week]);
  const rota = useApi<Rota>(branchId ? `/branches/${branchId}/rota?from=${encodeURIComponent(week.toISOString())}&to=${encodeURIComponent(end.toISOString())}` : null);
  const employees = useApi<Array<{ id: string; displayName: string; status: string }>>("/employees");
  const [f, setF] = useState({ employeeId: "", date: ymd(new Date()), from: "16:00", to: "00:00", note: "" });
  const mayEdit = can("employee.manage", branchId ?? undefined);

  const add = useAction(async () => {
    const startsAt = new Date(`${f.date}T${f.from}`);
    let endsAt = new Date(`${f.date}T${f.to}`);
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000); // an evening shift that ends after midnight
    await api(`/branches/${branchId}/rota`, { method: "POST", body: { employeeId: f.employeeId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), note: f.note.trim() || null }, done: "Shift added." });
    await rota.reload();
  });
  const remove = useAction(async (s: Shift) => {
    if (!(await askConfirm(`Remove ${s.employee.displayName}'s shift on ${day(new Date(s.startsAt))}?`))) return;
    await api(`/branches/${branchId}/rota/${s.id}`, { method: "DELETE" });
    await rota.reload();
  });
  const copy = useAction(async () => {
    const prev = new Date(week.getTime() - 7 * 86_400_000);
    const r = await api<{ copied: number; skipped: number }>(`/branches/${branchId}/rota/copy-week`, { method: "POST", body: { from: prev.toISOString(), to: week.toISOString() } });
    await rota.reload();
    return r;
  });

  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * 86_400_000));
  const active = (employees.data ?? []).filter((e) => e.status === "ACTIVE");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rota"
        subtitle="Plan who works when. Once a shift starts, it shows whether they clocked in on time (5 minutes' grace) or didn't come."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            <Button variant="ghost" size="sm" onClick={() => setWeek(new Date(week.getTime() - 7 * 86_400_000))} aria-label="Previous week"><ChevronLeft className="size-4" /></Button>
            <span className="text-sm text-ink-2">{day(week)} – {day(new Date(end.getTime() - 1))}</span>
            <Button variant="ghost" size="sm" onClick={() => setWeek(new Date(week.getTime() + 7 * 86_400_000))} aria-label="Next week"><ChevronRight className="size-4" /></Button>
            {mayEdit && <Button variant="secondary" size="sm" pending={copy.pending} onClick={() => void copy.run()}><Copy className="size-3.5" /> Copy last week</Button>}
          </div>
        }
      />
      <ErrorNote>{add.error ?? remove.error ?? copy.error}</ErrorNote>
      {mayEdit && (
        <Card className="p-5">
          <form className="grid items-end gap-3 sm:grid-cols-[1.6fr_1.1fr_0.8fr_0.8fr_1.4fr_auto]" onSubmit={(e) => { e.preventDefault(); if (f.employeeId) void add.run(); }}>
            <Field label="Who">
              <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} required>
                <option value="">Choose…</option>
                {active.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
              </Select>
            </Field>
            <Field label="Day"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
            <Field label="From"><Input type="time" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required /></Field>
            <Field label="To"><Input type="time" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required /></Field>
            <Field label="Note (optional)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} placeholder="e.g. Opening, tournament night" /></Field>
            <Button type="submit" pending={add.pending}><Plus className="size-4" /> Add shift</Button>
          </form>
        </Card>
      )}
      {!rota.data ? (
        <Spinner />
      ) : rota.data.shifts.length === 0 ? (
        <Card><Empty icon={<CalendarDays className="size-8" />} title="No shifts planned this week">Add shifts above, or copy last week's.</Empty></Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-7">
            {days.map((d) => {
              const list = rota.data!.shifts.filter((s) => new Date(s.startsAt).toDateString() === d.toDateString());
              return (
                <Card key={d.toISOString()} className="p-3">
                  <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${d.toDateString() === new Date().toDateString() ? "text-accent" : "text-ink-3"}`}>{day(d)}</p>
                  <div className="grid gap-2">
                    {list.length === 0 && <p className="text-xs text-ink-3">—</p>}
                    {list.map((s) => (
                      <div key={s.id} className="rounded-lg border border-line bg-panel-2 p-2 text-sm">
                        <div className="flex items-start justify-between gap-1">
                          <span className="font-medium">{s.employee.displayName}</span>
                          {mayEdit && s.status === "PLANNED" && <button onClick={() => void remove.run(s)} className="text-ink-3 hover:text-danger" aria-label="Remove shift"><Trash2 className="size-3.5" /></button>}
                        </div>
                        <p className="tabular-nums text-ink-2">{time(s.startsAt)}–{time(s.endsAt)}</p>
                        <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}{s.status === "LATE" ? ` ${s.lateMinutes} min` : ""}</Badge>
                        {s.note && <p className="mt-1 text-[11px] text-ink-3">{s.note}</p>}
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
          <Card>
            <Table head={["Person", "Hours planned", "Late", "No-shows"]}>
              {rota.data.people.map((p) => (
                <tr key={p.employee.id} className="border-t border-line">
                  <td className="px-4 py-2 font-medium">{p.employee.displayName}</td>
                  <td className="px-4 py-2 tabular-nums">{p.planned}</td>
                  <td className="px-4 py-2 tabular-nums">{p.late ? <Badge tone="warn">{p.late}</Badge> : 0}</td>
                  <td className="px-4 py-2 tabular-nums">{p.missed ? <Badge tone="danger">{p.missed}</Badge> : 0}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
