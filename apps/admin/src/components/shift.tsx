"use client";

import { Fragment, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Lock, PiggyBank, Unlock } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { money, type ShiftReport } from "@/lib/client/pos";
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner, Table } from "@/components/ui";

export const useMyShift = (branchId: string | null) => useApi<ShiftReport | null>(branchId ? `/branches/${branchId}/shifts/me` : null);

const MOVE_LABEL: Record<string, string> = { OPENING_FLOAT: "Opening float", SALE: "Cash sales", REFUND: "Cash refunds", PAY_IN: "Pay-ins", PAY_OUT: "Pay-outs", SAFE_DROP: "Safe drops", CHANGE: "Change" };
const STATUS_TONE = { OPEN: "accent", PENDING_APPROVAL: "warn", CLOSED: "ok" } as const;

/** The cashier's own shift: open → X-report and movements → count and close. */
export function ShiftPanel({ branchId, shift }: { branchId: string; shift: ReturnType<typeof useMyShift> }) {
  const can = useCan();
  const [closed, setClosed] = useState<ShiftReport | null>(null);
  if (shift.data === undefined) return shift.error ? <ErrorNote>{shift.error.message}</ErrorNote> : <Spinner />;
  return (
    <div className="grid gap-5">
      {closed && <ClosedNote s={closed} />}
      {shift.data ? <OpenShift s={shift.data} onChange={() => void shift.reload()} onClosed={(s) => { setClosed(s); void shift.reload(); }} /> : <OpenForm branchId={branchId} onOpened={() => { setClosed(null); void shift.reload(); }} />}
      {can("shift.view_all", branchId) && <AllShifts branchId={branchId} />}
    </div>
  );
}

/** A branch needs a cash drawer before anyone can open a shift. Managers add it here. */
function AddDrawer({ branchId, onAdded }: { branchId: string; onAdded: () => void }) {
  const can = useCan();
  const [name, setName] = useState("Front desk");
  const add = useAction(async () => {
    await api(`/branches/${branchId}/cash-drawers`, { method: "POST", body: { name: name.trim() } });
    onAdded();
  });
  if (!can("settings.manage", branchId)) return <Card className="p-5 text-sm text-ink-3">This branch has no cash drawer yet. Ask a manager to add one (POS → My shift).</Card>;
  return (
    <Card className="p-5">
      <p className="mb-4 text-sm text-ink-3">This branch has no cash drawer yet. Add one for each till; cashiers open their shift on it.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
        <Field label="Drawer name" className="min-w-56 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} /></Field>
        <Button type="submit" variant="primary" pending={add.pending}>Add cash drawer</Button>
      </form>
      <div className="mt-3"><ErrorNote>{add.error}</ErrorNote></div>
    </Card>
  );
}

function OpenForm({ branchId, onOpened }: { branchId: string; onOpened: () => void }) {
  const drawers = useApi<Array<{ id: string; name: string; shifts: Array<{ id: string; employee: { displayName: string } }> }>>(`/branches/${branchId}/cash-drawers`);
  const [drawer, setDrawer] = useState("");
  const [cash, setCash] = useState("");
  const open = useAction(async () => {
    await api(`/branches/${branchId}/shifts`, { method: "POST", body: { cashDrawerId: drawer || drawers.data?.find((d) => !d.shifts.length)?.id, openingCash: cash || "0" } });
    onOpened();
  });
  if (!drawers.data) return <Spinner />;
  if (!drawers.data.length) return <AddDrawer branchId={branchId} onAdded={() => void drawers.reload()} />;
  return (
    <Card className="p-5">
      <h3 className="mb-1 font-semibold">Open your shift</h3>
      <p className="mb-4 text-sm text-ink-3">Count the float in the drawer. Every cash sale, refund and pay-out is tracked against it until you close.</p>
      <form className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void open.run(); }}>
        <Field label="Drawer">
          <Select value={drawer} onChange={(e) => setDrawer(e.target.value)}>
            {drawers.data.map((d) => <option key={d.id} value={d.id} disabled={d.shifts.length > 0}>{d.name}{d.shifts[0] ? ` — in use by ${d.shifts[0].employee.displayName}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Opening cash"><Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" /></Field>
        <Button type="submit" variant="primary" pending={open.pending}><Unlock className="size-4" /> Open shift</Button>
      </form>
      <div className="mt-3"><ErrorNote>{open.error}</ErrorNote></div>
    </Card>
  );
}

function OpenShift({ s, onChange, onClosed }: { s: ShiftReport; onChange: () => void; onClosed: (s: ShiftReport) => void }) {
  const can = useCan();
  const [mv, setMv] = useState({ type: "PAY_OUT", amount: "", reason: "" });
  const [count, setCount] = useState({ countedCash: "", notes: "" });
  const move = useAction(async () => {
    await api(`/shifts/${s.id}/movements`, { method: "POST", body: mv });
    setMv({ type: mv.type, amount: "", reason: "" });
    onChange();
  });
  const close = useAction(async () => {
    const r = await api<ShiftReport>(`/shifts/${s.id}/close`, { method: "POST", body: { countedCash: count.countedCash, notes: count.notes || null } });
    onClosed(r);
  });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="font-semibold">X-report</h3>
          <Badge tone="accent">open</Badge>
          <span className="ml-auto text-xs text-ink-3">{s.drawer} · since {new Date(s.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <Report s={s} />
      </Card>
      <div className="grid content-start gap-5">
        {can("shift.cash_movement", s.branchId) && (
          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Cash in / out</h3>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void move.run(); }}>
              <Field label="Type">
                <Select value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}>
                  <option value="PAY_OUT">Pay-out (supplier, petty cash)</option>
                  <option value="PAY_IN">Pay-in (more float)</option>
                  <option value="SAFE_DROP">Safe drop</option>
                </Select>
              </Field>
              <Field label="Amount"><Input inputMode="decimal" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} required /></Field>
              <Field label="Reason" className="sm:col-span-2"><Input value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} required minLength={2} placeholder="Ice delivery…" /></Field>
              <div className="sm:col-span-2"><ErrorNote>{move.error}</ErrorNote></div>
              <div className="flex justify-end sm:col-span-2">
                <Button type="submit" pending={move.pending}>{mv.type === "PAY_IN" ? <ArrowDownToLine className="size-4" /> : mv.type === "SAFE_DROP" ? <PiggyBank className="size-4" /> : <ArrowUpFromLine className="size-4" />} Record</Button>
              </div>
            </form>
          </Card>
        )}
        <Card className="p-5">
          <h3 className="mb-1 font-semibold">Close shift</h3>
          <p className="mb-3 text-sm text-ink-3">Count the drawer and enter the total. A difference above the branch limit goes to a manager for approval.</p>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (confirm(`Close the shift with ${count.countedCash} counted?`)) void close.run(); }}>
            <Field label="Counted cash"><Input inputMode="decimal" value={count.countedCash} onChange={(e) => setCount({ ...count, countedCash: e.target.value })} required /></Field>
            <Field label="Notes (optional)"><Input value={count.notes} onChange={(e) => setCount({ ...count, notes: e.target.value })} maxLength={300} /></Field>
            <ErrorNote>{close.error}</ErrorNote>
            <div className="flex justify-end"><Button type="submit" variant="danger" pending={close.pending}><Lock className="size-4" /> Close shift</Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Report({ s }: { s: ShiftReport }) {
  const byType = s.movements.reduce<Record<string, number>>((a, m) => ({ ...a, [m.type]: (a[m.type] ?? 0) + Number(m.amount) }), {});
  return (
    <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
      <dt className="text-ink-3">Orders</dt><dd className="text-right tabular-nums">{s.orders}</dd>
      {Object.entries(s.sales).map(([m, v]) => <Fragment key={m}><dt className="text-ink-3">{m.toLowerCase().replace("_", " ")} sales</dt><dd className="text-right tabular-nums">{v}</dd></Fragment>)}
      <dt className="text-ink-3">Total taken</dt><dd className="text-right font-medium tabular-nums">{money(s.salesTotal, s.currency)}</dd>
      <dt className="text-ink-3">Refunds</dt><dd className="text-right tabular-nums">{s.refunds}</dd>
      <dt className="col-span-2 mt-2 border-t border-line pt-2 text-xs uppercase tracking-wider text-ink-3">Drawer</dt>
      {Object.entries(byType).map(([t, v]) => <Fragment key={t}><dt className="text-ink-3">{MOVE_LABEL[t] ?? t}</dt><dd className="text-right tabular-nums">{v.toFixed(2)}</dd></Fragment>)}
      <dt className="font-medium">Expected cash</dt><dd className="text-right font-semibold tabular-nums">{money(s.expectedCash, s.currency)}</dd>
      {s.countedCash && <><dt className="text-ink-3">Counted</dt><dd className="text-right tabular-nums">{s.countedCash}</dd></>}
      {s.variance && <><dt className="text-ink-3">Difference</dt><dd className={`text-right tabular-nums ${Number(s.variance) === 0 ? "text-ok" : "text-danger"}`}>{Number(s.variance) > 0 ? "+" : ""}{s.variance}</dd></>}
    </dl>
  );
}

function ClosedNote({ s }: { s: ShiftReport }) {
  return (
    <Card className="p-5">
      <p className="mb-3 flex items-center gap-2 font-semibold">
        <CheckCircle2 className="size-5 text-ok" /> Shift closed — Z-report
        {s.status === "PENDING_APPROVAL" && <Badge tone="warn">needs manager approval</Badge>}
      </p>
      <Report s={s} />
    </Card>
  );
}

function AllShifts({ branchId }: { branchId: string }) {
  const can = useCan();
  const list = useApi<ShiftReport[]>(`/branches/${branchId}/shifts`);
  const [open, setOpen] = useState<string | null>(null);
  const approve = useAction(async (id: string) => {
    const note = prompt("Approval note (optional)") ?? "";
    await api(`/shifts/${id}/approve`, { method: "POST", body: { note: note.trim().length >= 2 ? note.trim() : null } });
    void list.reload();
  });
  if (!list.data) return <Spinner />;
  return (
    <Card>
      <h3 className="px-5 pt-4 font-semibold">All shifts at this branch</h3>
      <div className="p-2"><ErrorNote>{approve.error}</ErrorNote></div>
      <Table head={["Cashier", "Drawer", "Opened", "Status", "Taken", "Difference", ""]}>
        {list.data.map((s) => (
          <Fragment key={s.id}>
            <tr className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <td className="px-4 py-2">{s.employee}</td>
              <td className="px-4 py-2 text-ink-2">{s.drawer}</td>
              <td className="px-4 py-2 text-ink-2">{new Date(s.openedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="px-4 py-2"><Badge tone={STATUS_TONE[s.status]}>{s.status.replace("_", " ").toLowerCase()}</Badge></td>
              <td className="px-4 py-2 tabular-nums">{s.salesTotal}</td>
              <td className={`px-4 py-2 tabular-nums ${s.variance && Number(s.variance) !== 0 ? "text-danger" : ""}`}>{s.variance ?? "—"}</td>
              <td className="px-4 py-2 text-right">
                {s.status === "PENDING_APPROVAL" && can("shift.approve", branchId) && <Button size="sm" variant="primary" pending={approve.pending} onClick={(e) => { e.stopPropagation(); void approve.run(s.id); }}>Approve</Button>}
              </td>
            </tr>
            {open === s.id && <tr><td colSpan={7} className="bg-panel-2/50 px-6 py-4"><Report s={s} /></td></tr>}
          </Fragment>
        ))}
      </Table>
    </Card>
  );
}
