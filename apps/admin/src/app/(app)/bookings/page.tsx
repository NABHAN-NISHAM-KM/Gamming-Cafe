"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, LogIn, Plus, UserX, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import type { FloorDevice, FloorZone } from "@/lib/client/floor";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { idem } from "@/lib/client/sessions";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx, askText } from "@/components/ui";

interface Booking {
  id: string;
  reference: string;
  status: string;
  source: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  players: number;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  estimatedTotal: string;
  depositAmount: string;
  currency: string;
  customer: { id: string; displayName: string; username: string } | null;
  zone: { id: string; name: string } | null;
  devices: Array<{ id: string; name: string }>;
}

const BOOKABLE = new Set(["PC_STANDARD", "PC_VIP", "BOOTCAMP", "STREAMING", "CONSOLE", "VR", "SIMULATOR", "PRIVATE_ROOM"]);
const TONE: Record<string, "accent" | "ok" | "neutral" | "danger" | "warn"> = { CONFIRMED: "accent", CHECKED_IN: "ok", COMPLETED: "neutral", CANCELLED: "neutral", NO_SHOW: "danger", PENDING: "warn" };
const FIRST_HOUR = 9;
const HOURS = 18; // 09:00 → 03:00
const toLocalDate = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function BookingsPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const [date, setDate] = useState(() => toLocalDate(new Date()));
  const list = useApi<Booking[]>(branchId ? `/branches/${branchId}/bookings?date=${date}` : null);
  const floor = useApi<{ zones: FloorZone[]; devices: FloorDevice[] }>(branchId ? `/branches/${branchId}/floor` : null);
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);

  const dayStart = useMemo(() => {
    const d = new Date(`${date}T00:00:00`);
    d.setHours(FIRST_HOUR);
    return d.getTime();
  }, [date]);
  const zones = (floor.data?.zones ?? []).filter((z) => BOOKABLE.has(z.type));
  const devicesByZone = (zid: string) => (floor.data?.devices ?? []).filter((d) => d.zoneId === zid).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const bookings = (list.data ?? []).filter((b) => toLocalDate(new Date(b.startsAt)) === date || toLocalDate(new Date(b.endsAt)) === date);
  const pos = (iso: string) => ((new Date(iso).getTime() - dayStart) / (HOURS * 3_600_000)) * 100;
  const shift = (days: number) => setDate(toLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() + days * 86_400_000)));
  const nowPct = pos(new Date().toISOString());

  useEffect(() => {
    const t = setInterval(() => void list.reload(), 30_000);
    return () => clearInterval(t);
  }, [list]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bookings"
        subtitle="Reserved stations by day. Check customers in to start their sessions; no-shows are released 15 minutes after the start."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            {can("booking.create", branchId ?? undefined) && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New booking</Button>}
          </div>
        }
      />

      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous day"><ChevronLeft className="size-4" /></Button>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Next day"><ChevronRight className="size-4" /></Button>
        <Button size="sm" variant="ghost" onClick={() => setDate(toLocalDate(new Date()))}>Today</Button>
        <span className="ml-auto text-sm text-ink-3">{bookings.filter((b) => !["CANCELLED", "NO_SHOW"].includes(b.status)).length} bookings</span>
      </div>

      <Card className="overflow-x-auto">
        {!floor.data ? (
          <Spinner />
        ) : zones.length === 0 ? (
          <Empty icon={<CalendarClock className="size-8" />} title="No bookable zones" />
        ) : (
          <div className="min-w-[900px]">
            <div className="sticky top-0 z-10 flex border-b border-line bg-panel text-[11px] text-ink-3">
              <div className="w-28 shrink-0 px-3 py-2">Station</div>
              <div className="relative flex-1">
                {Array.from({ length: HOURS }, (_, i) => (
                  <span key={i} className="absolute top-2" style={{ left: `${(i / HOURS) * 100}%` }}>{String((FIRST_HOUR + i) % 24).padStart(2, "0")}:00</span>
                ))}
              </div>
            </div>
            {zones.map((z) => (
              <div key={z.id}>
                <div className="border-b border-line bg-panel-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">{z.name}</div>
                {devicesByZone(z.id).map((d) => (
                  <div key={d.id} className="flex h-10 border-b border-line/60">
                    <div className="w-28 shrink-0 px-3 py-2.5 text-sm font-medium">{d.name}</div>
                    <div className="relative flex-1" style={{ backgroundImage: "linear-gradient(90deg, var(--color-line) 1px, transparent 1px)", backgroundSize: `${100 / HOURS}% 100%` }}>
                      {nowPct > 0 && nowPct < 100 && <div className="absolute inset-y-0 w-px bg-danger/70" style={{ left: `${nowPct}%` }} />}
                      {bookings.filter((b) => b.devices.some((x) => x.id === d.id)).map((b) => {
                        const l = Math.max(0, pos(b.startsAt));
                        const r = Math.min(100, pos(b.endsAt));
                        if (r <= 0 || l >= 100) return null;
                        const faded = ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(b.status);
                        return (
                          <button
                            key={b.id}
                            onClick={() => setOpen(b)}
                            className={cx("absolute inset-y-1 overflow-hidden rounded-md border px-2 text-left text-[11px] leading-tight", faded ? "border-line bg-panel-2 text-ink-3 line-through" : b.status === "CHECKED_IN" ? "border-ok/50 bg-ok/15" : "border-accent/50 bg-accent/15")}
                            style={{ left: `${l}%`, width: `${r - l}%` }}
                            title={`${b.reference} · ${hm(b.startsAt)}–${hm(b.endsAt)}`}
                          >
                            {Number(b.depositAmount) > 0 && <span className="mr-1 text-ok">●</span>}<span className="font-semibold">{b.customer?.displayName ?? b.contactName}</span> <span className="text-ink-3">{hm(b.startsAt)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Booking ${open.reference}` : ""}>
        {open && <BookingDetail b={open} branchId={branchId!} onDone={() => { setOpen(null); void list.reload(); void floor.reload(); }} />}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="New booking" wide>
        {creating && branchId && <NewBooking branchId={branchId} zones={zones} date={date} onDone={() => { setCreating(false); void list.reload(); }} />}
      </Modal>
    </div>
  );
}

function BookingDetail({ b, branchId, onDone }: { b: Booking; branchId: string; onDone: () => void }) {
  const can = useCan();
  const [method, setMethod] = useState(b.customer ? "WALLET" : "CASH");
  const checkIn = useAction(async () => {
    await api(`/bookings/${b.id}/check-in`, { method: "POST", action: "Check in", body: { payment: { method } } });
    onDone();
  });
  const cancel = useAction(async () => {
    const reason = await askText("Why is it cancelled?");
    if (!reason) return;
    await api(`/bookings/${b.id}/cancel`, { method: "POST", action: "Cancel booking", body: { reason } });
    onDone();
  });
  const noShow = useAction(async () => {
    await api(`/bookings/${b.id}/no-show`, { method: "POST", action: "No-show" });
    onDone();
  });
  const live = b.status === "CONFIRMED";
  return (
    <div className="grid gap-4 text-sm">
      <div className="flex items-center gap-2"><Badge tone={TONE[b.status] ?? "neutral"}>{b.status.replace("_", " ").toLowerCase()}</Badge><span className="text-ink-3">via {b.source.replace("_", " ").toLowerCase()}</span></div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-ink-3">Who</dt><dd>{b.customer ? `${b.customer.displayName} (@${b.customer.username})` : b.contactName}{b.contactPhone ? ` · ${b.contactPhone}` : ""}</dd>
        <dt className="text-ink-3">When</dt><dd>{new Date(b.startsAt).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} – {hm(b.endsAt)} ({b.minutes} min)</dd>
        <dt className="text-ink-3">Stations</dt><dd>{b.zone?.name} · {b.devices.map((d) => d.name).join(", ")}</dd>
        <dt className="text-ink-3">Estimate</dt><dd>{b.currency} {b.estimatedTotal}{Number(b.depositAmount) > 0 && <span className="ml-2 text-ok">· prepaid {b.depositAmount} (in their wallet)</span>}</dd>
        {b.notes && <><dt className="text-ink-3">Notes</dt><dd>{b.notes}</dd></>}
      </dl>
      {live && can("booking.create", branchId) && can("station.start_session", branchId) && (
        <div className="flex items-end gap-2 rounded-lg border border-line p-3">
          <Field label="Paid by" className="flex-1">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              {b.customer && <option value="WALLET">Customer wallet</option>}
              {b.customer && <option value="TIME_BALANCE">Prepaid time</option>}
              <option value="PAY_LATER">Pay at the end</option>
            </Select>
          </Field>
          <Button variant="primary" pending={checkIn.pending} onClick={() => void checkIn.run()}><LogIn className="size-4" /> Check in & start</Button>
        </div>
      )}
      <ErrorNote>{checkIn.error ?? cancel.error ?? noShow.error}</ErrorNote>
      {live && can("booking.cancel", branchId) && (
        <div className="flex gap-2">
          <Button variant="ghost" pending={cancel.pending} onClick={() => void cancel.run()}><X className="size-4" /> Cancel</Button>
          {new Date(b.startsAt) < new Date() && <Button variant="ghost" pending={noShow.pending} onClick={() => void noShow.run()}><UserX className="size-4" /> No-show</Button>}
        </div>
      )}
    </div>
  );
}

function NewBooking({ branchId, zones, date, onDone }: { branchId: string; zones: FloorZone[]; date: string; onDone: () => void }) {
  const [f, setF] = useState({ zoneId: zones[0]?.id ?? "", date, time: "18:00", minutes: "120", players: "1", contactName: "", contactPhone: "", notes: "" });
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{ id: string; displayName: string; username: string } | null>(null);
  const found = useApi<Array<{ id: string; displayName: string; username: string }>>(q.trim().length >= 2 && !customer ? `/customers?q=${encodeURIComponent(q.trim())}` : null);
  const [key] = useState(idem);
  const startsAt = new Date(`${f.date}T${f.time}:00`).toISOString();
  const avail = useApi<Array<{ zoneId: string; free: number; total: number }>>(f.zoneId ? `/branches/${branchId}/availability?zoneId=${f.zoneId}&startsAt=${encodeURIComponent(startsAt)}&minutes=${f.minutes}` : null);
  const free = avail.data?.[0]?.free;
  const save = useAction(async () => {
    await api(`/branches/${branchId}/bookings`, {
      method: "POST",
      action: "Create booking",
      body: {
        zoneId: f.zoneId, startsAt, minutes: Number(f.minutes), players: Number(f.players), customerId: customer?.id ?? null,
        contactName: customer ? null : f.contactName || null, contactPhone: f.contactPhone || null, notes: f.notes || null, source: "STAFF", idempotencyKey: key,
      },
    });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Zone" className="sm:col-span-2">
        <Select value={f.zoneId} onChange={set("zoneId")}>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>
      </Field>
      <Field label="Date"><Input type="date" value={f.date} onChange={set("date")} /></Field>
      <Field label="Time"><Input type="time" step={900} value={f.time} onChange={set("time")} /></Field>
      <Field label="Duration">
        <Select value={f.minutes} onChange={set("minutes")}>{[60, 90, 120, 180, 240, 300, 360].map((m) => <option key={m} value={m}>{m / 60} h</option>)}</Select>
      </Field>
      <Field label="Players / stations"><Input type="number" min={1} max={20} value={f.players} onChange={set("players")} /></Field>
      <div className="flex items-end sm:col-span-2">
        <p className={cx("rounded-lg px-3 py-2 text-sm", free === undefined ? "text-ink-3" : free >= Number(f.players) ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger")}>
          {free === undefined ? "Checking…" : `${free} of ${avail.data?.[0]?.total ?? 0} free`}
        </p>
      </div>
      <div className="sm:col-span-4">
        {customer ? (
          <p className="flex items-center gap-2 text-sm">Customer: <strong>{customer.displayName}</strong> <span className="text-ink-3">@{customer.username}</span> <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>Change</Button></p>
        ) : (
          <Field label="Customer account (optional)" hint="Search by name, username or phone — or just enter a contact below">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
            {found.data && found.data.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line">
                {found.data.slice(0, 6).map((c) => <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-panel-2" onClick={() => setCustomer(c)}>{c.displayName} <span className="text-ink-3">@{c.username}</span></button></li>)}
              </ul>
            )}
          </Field>
        )}
      </div>
      {!customer && (
        <>
          <Field label="Contact name" className="sm:col-span-2"><Input value={f.contactName} onChange={set("contactName")} required={!customer} /></Field>
          <Field label="Phone" className="sm:col-span-2"><Input value={f.contactPhone} onChange={set("contactPhone")} placeholder="+971…" /></Field>
        </>
      )}
      <Field label="Notes" className="sm:col-span-4"><Input value={f.notes} onChange={set("notes")} placeholder="Birthday group, needs headsets…" /></Field>
      <div className="sm:col-span-4"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-4">
        <Button type="submit" variant="primary" pending={save.pending} disabled={free !== undefined && free < Number(f.players)}><CalendarClock className="size-4" /> Book</Button>
      </div>
    </form>
  );
}
