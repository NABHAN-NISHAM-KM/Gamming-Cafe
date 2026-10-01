"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, BellRing, CircleHelp, Cpu, Gamepad2, LayoutGrid, Megaphone, Move, Plus, RotateCcw, Wifi, WifiOff, Wrench } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useBranch } from "@/lib/client/branch";
import { useCan } from "@/lib/client/me";
import { STATUS, fmtTemp, useLiveFloor, type Alert, type DeviceStatus, type FloorDevice, type FloorZone } from "@/lib/client/floor";
import type { Branch } from "@/lib/client/types";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Select, Spinner, cx } from "@/components/ui";
import { StationDrawer } from "./station-drawer";
import { fmtCountdown, remaining, useTick } from "@/lib/client/sessions";
import { useT, type TKey } from "@/lib/client/i18n";

/** Floor filter: a status, or one of the shortcuts the Counter links to (?show=free|busy|ending|attention). */
type Filter = DeviceStatus | "free" | "busy" | "ending" | "attention" | null;
const isHot = (d: FloorDevice) => (d.metrics?.cpuTempC ?? 0) >= 90 || (d.metrics?.gpuTempC ?? 0) >= 88;
function matches(d: FloorDevice, f: Filter, alerted: Set<string>) {
  if (!f) return true;
  if (f === "free") return d.displayStatus === "AVAILABLE";
  if (f === "busy") return !!d.session;
  if (f === "ending") return !!d.session?.expiresAt && (remaining(d.session.expiresAt) ?? 0) <= 10 * 60_000;
  if (f === "attention") return alerted.has(d.id) || d.status === "MAINTENANCE" || isHot(d);
  return d.displayStatus === f;
}

const CELL = 76; // px per grid cell

function Tile({ d, selected, editing, help, dim, onPointerDown, onClick }: { d: FloorDevice; selected: boolean; editing: boolean; help?: boolean; dim?: boolean; onPointerDown?: (e: ReactPointerEvent) => void; onClick: () => void }) {
  const t = useT();
  const st = STATUS[d.displayStatus] ?? STATUS.OFFLINE;
  const label = t(`status.${d.displayStatus}` as TKey);
  const hot = isHot(d);
  return (
    <button
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={`${d.name}, ${label}${d.currentGame ? `, playing ${d.currentGame.title}` : ""}${help ? ", needs help" : ""}`}
      title={d.outOfOrder ? `${label}: ${d.outOfOrder.reason}` : d.currentGame ? `Playing ${d.currentGame.title}` : t(`help.${d.displayStatus}` as TKey)}
      className={cx(
        "group relative flex size-[68px] flex-col items-center justify-center rounded-lg border-2 text-center transition",
        editing ? "cursor-grab active:cursor-grabbing" : "hover:-translate-y-0.5",
        selected && "ring-2 ring-ink ring-offset-2 ring-offset-bg",
        dim && "opacity-25",
      )}
      style={{ borderColor: st.color, background: `color-mix(in oklab, ${st.color} ${d.isOnline ? 16 : 6}%, var(--color-panel))` }}
    >
      <span className="text-[13px] font-bold leading-tight">{d.name}</span>
      {d.session ? (
        <>
          <span className="tabular mt-0.5 font-mono text-[11px] font-semibold">{d.session.expiresAt ? fmtCountdown(remaining(d.session.expiresAt), false) : "open"}</span>
          <span className="max-w-[60px] truncate text-[9px] text-ink-2">{d.session.customer?.displayName ?? d.session.guestLabel ?? "Guest"}</span>
        </>
      ) : (
        <span className="mt-0.5 text-[10px] text-ink-2">{d.isOnline && d.displayStatus === "AVAILABLE" && d.metrics?.gpuPct != null ? `GPU ${Math.round(d.metrics.gpuPct)}%` : label}</span>
      )}
      {!d.session && d.isOnline && d.metrics?.cpuTempC != null && <span className={cx("text-[9px] tabular", hot ? "text-danger font-semibold" : "text-ink-3")}>{fmtTemp(d.metrics.cpuTempC)}</span>}
      {hot && <AlertTriangle className="absolute -right-1.5 -top-1.5 size-4 rounded-full bg-bg text-danger" />}
      {d.status === "MAINTENANCE" && <Wrench className="absolute -right-1.5 -top-1.5 size-4 rounded-full bg-bg p-0.5 text-danger" />}
      {help && <BellRing className="absolute -left-1.5 -top-1.5 size-5 animate-bounce rounded-full bg-reserved p-0.5 text-bg" />}
      {d.currentGame && <Gamepad2 className="absolute -bottom-1.5 -right-1.5 size-4 rounded-full bg-bg p-0.5 text-ok" />}
      {!d.session && d.nextBooking && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-accent/50 bg-bg px-1.5 text-[9px] text-accent" title={`Booked by ${d.nextBooking.name ?? "a customer"} (${d.nextBooking.reference})`}>
          {new Date(d.nextBooking.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </button>
  );
}

function ZoneSection({
  zone,
  devices,
  selectedId,
  onSelect,
  editing,
  onMove,
  canMass,
  helpIds,
  dimmed,
}: {
  helpIds: Set<string>;
  dimmed: (d: FloorDevice) => boolean;
  zone: FloorZone;
  devices: FloorDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  editing: boolean;
  onMove: (id: string, x: number, y: number) => void;
  canMass: boolean;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [mass, setMass] = useState<"message" | "restart" | null>(null);
  const cols = Math.max(8, ...devices.map((d) => d.mapX + 2));
  const rows = Math.max(2, ...devices.map((d) => d.mapY + 2));
  const online = devices.filter((d) => d.isOnline).length;

  const toCell = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - r.left) / CELL))), y: Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - r.top) / CELL))) };
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className="size-2.5 rounded-full" style={{ background: zone.color ?? "var(--color-line-strong)" }} />
        <h2 className="font-semibold">{zone.name}</h2>
        <span className="text-xs text-ink-3">
          {online}/{devices.length} online
        </span>
        {canMass && devices.length > 0 && !editing && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setMass("message")}>
              <Megaphone className="size-3.5" /> Message zone
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMass("restart")}>
              <RotateCcw className="size-3.5" /> Restart zone
            </Button>
          </div>
        )}
      </div>
      {devices.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-3">No stations in this zone yet.</p>
      ) : (
        <div className="overflow-x-auto p-4">
          <div
            ref={grid}
            className="relative"
            style={{
              width: cols * CELL,
              height: rows * CELL,
              backgroundImage: editing ? "radial-gradient(var(--color-line-strong) 1px, transparent 1px)" : undefined,
              backgroundSize: `${CELL}px ${CELL}px`,
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const { x, y } = toCell(e);
              onMove(drag, x, y);
            }}
            onPointerUp={() => setDrag(null)}
            onPointerLeave={() => setDrag(null)}
          >
            {devices.map((d) => (
              <div key={d.id} className="absolute p-1 transition-[left,top] duration-100" style={{ left: d.mapX * CELL, top: d.mapY * CELL }}>
                <Tile
                  d={d}
                  dim={!editing && dimmed(d)}
                  help={helpIds.has(d.id)}
                  selected={selectedId === d.id}
                  editing={editing}
                  onClick={() => !editing && onSelect(d.id)}
                  onPointerDown={
                    editing
                      ? (e) => {
                          e.preventDefault();
                          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                          setDrag(d.id);
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <MassAction zone={zone} kind={mass} count={devices.length} onClose={() => setMass(null)} />
    </Card>
  );
}

function MassAction({ zone, kind, count, onClose }: { zone: FloorZone; kind: "message" | "restart" | null; count: number; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const run = useAction(async () => {
    const body = kind === "message" ? { type: "SEND_MESSAGE", payload: { title: "Message from staff", message } } : { type: "RESTART" };
    const r = await api<{ count: number; online: number }>(`/zones/${zone.id}/commands`, { method: "POST", body, action: kind === "message" ? "Message zone" : "Restart zone" });
    setDone(`Sent to ${r.count} station(s) — ${r.online} online now, the rest will receive it when they reconnect.`);
  });
  const close = () => {
    setDone(null);
    setMessage("");
    onClose();
  };
  return (
    <Modal open={!!kind} onClose={close} title={kind === "message" ? `Message everyone in ${zone.name}` : `Restart all PCs in ${zone.name}?`}>
      {done ? (
        <div className="grid gap-4">
          <p className="text-sm text-ink-2">{done}</p>
          <div className="flex justify-end">
            <Button onClick={close}>Close</Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run.run();
          }}
        >
          {kind === "message" ? (
            <Field label="Message">
              <Input required maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We close in 15 minutes — please save your game." autoFocus />
            </Field>
          ) : (
            <p className="text-sm text-ink-2">
              All <strong className="text-ink">{count}</strong> stations in this zone will restart. Anyone playing will be interrupted.
            </p>
          )}
          <ErrorNote>{run.error}</ErrorNote>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant={kind === "restart" ? "danger" : "primary"} pending={run.pending}>
              {kind === "message" ? "Send" : `Restart ${count} PCs`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function AlertsBar({ alerts, devices, onSelect }: { alerts: Alert[]; devices: Record<string, FloorDevice>; onSelect: (id: string) => void }) {
  if (!alerts.length) return null;
  return (
    <Card className="mb-4 border-danger/30">
      <ul className="divide-y divide-line">
        {alerts.slice(0, 5).map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <AlertTriangle className={cx("size-4", a.severity === "CRITICAL" ? "text-danger" : "text-reserved")} />
            <button className="font-medium hover:text-accent" onClick={() => a.deviceId && onSelect(a.deviceId)}>
              {a.deviceId ? (devices[a.deviceId]?.name ?? "Station") : "Branch"}
            </button>
            <span className="text-ink-2">{a.title}</span>
            {a.status === "ACKNOWLEDGED" && <Badge>acknowledged</Badge>}
            <span className="ml-auto text-xs text-ink-3">{new Date(a.openedAt).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
      {alerts.length > 5 && <p className="border-t border-line px-4 py-2 text-xs text-ink-3">+{alerts.length - 5} more</p>}
    </Card>
  );
}

export default function LiveFloorPage() {
  useTick(15_000); // keep tile countdowns fresh
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();

  const floor = useLiveFloor(branchId);
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(null);
  const [legend, setLegend] = useState(false);
  // Links from the Counter: ?show=free|busy|ending|attention and ?station=<id>.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const show = q.get("show");
    if (show && ["free", "busy", "ending", "attention"].includes(show)) setFilter(show as Filter);
    if (q.get("station")) setSelected(q.get("station"));
  }, []);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const devices = useMemo(() => Object.values(floor.devices), [floor.devices]);
  const byZone = useMemo(() => {
    const m = new Map<string, FloorDevice[]>();
    for (const d of devices) m.set(d.zoneId, [...(m.get(d.zoneId) ?? []), d]);
    return m;
  }, [devices]);
  const counts = useMemo(() => {
    const c: Partial<Record<DeviceStatus, number>> = {};
    for (const d of devices) c[d.displayStatus] = (c[d.displayStatus] ?? 0) + 1;
    return c;
  }, [devices]);
  const alerts = Object.values(floor.alerts).sort((a, b) => (a.severity === "CRITICAL" ? -1 : 1) - (b.severity === "CRITICAL" ? -1 : 1));
  const helpIds = new Set(alerts.filter((a) => a.type === "HELP_REQUESTED" && a.status === "OPEN" && a.deviceId).map((a) => a.deviceId!));
  const alerted = new Set(alerts.filter((a) => a.deviceId).map((a) => a.deviceId!));
  const attention = devices.filter((d) => matches(d, "attention", alerted)).length;
  const dimmed = (d: FloorDevice) => !matches(d, filter, alerted);
  const chip = (on: boolean) => cx("press flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition", on ? "border-accent bg-accent/15 text-ink" : "border-line bg-panel hover:border-line-strong");

  const move = (id: string, x: number, y: number) => {
    const d = floor.devices[id];
    if (!d || (d.mapX === x && d.mapY === y)) return;
    if (devices.some((o) => o.id !== id && o.zoneId === d.zoneId && o.mapX === x && o.mapY === y)) return; // occupied cell
    floor.setDevices((all) => ({ ...all, [id]: { ...all[id]!, mapX: x, mapY: y } }));
    setDirty((s) => new Set(s).add(id));
  };
  const saveLayout = useAction(async () => {
    const zonesTouched = new Set([...dirty].map((id) => floor.devices[id]!.zoneId));
    for (const zoneId of zonesTouched) {
      const positions = [...dirty].map((id) => floor.devices[id]!).filter((d) => d.zoneId === zoneId).map((d) => ({ deviceId: d.id, mapX: d.mapX, mapY: d.mapY }));
      await api(`/zones/${zoneId}/layout`, { method: "PUT", body: { positions }, action: "Save floor layout" });
    }
    setDirty(new Set());
    setEditing(false);
  });

  if (branches.data && branches.data.length === 0) return <Empty icon={<LayoutGrid className="size-8" />} title="No branches yet" />;

  return (
    <div className={cx(selected && "xl:pr-[400px]")}>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("floor.title")}</h1>
        {branches.data && branches.data.length > 1 && (
          <Select value={branchId ?? ""} onChange={(e) => { setBranchId(e.target.value); setSelected(null); }} className="w-auto">
            {branches.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.name}
              </option>
            ))}
          </Select>
        )}
        <span className={cx("flex items-center gap-1.5 text-xs", floor.connected ? "text-ok" : "text-ink-3")}>
          {floor.connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {floor.connected ? "Live" : "Connecting…"}
        </span>
        <div className="ml-auto flex gap-2">
          {can("station.manage", branchId ?? undefined) &&
            (editing ? (
              <>
                <Button variant="ghost" onClick={() => { setEditing(false); setDirty(new Set()); void floor.reload(); }}>
                  Cancel
                </Button>
                <Button variant="primary" pending={saveLayout.pending} disabled={!dirty.size} onClick={() => void saveLayout.run()}>
                  Save layout
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => { setEditing(true); setSelected(null); }}>
                  <Move className="size-4" /> Edit layout
                </Button>
                <Link href="/computers">
                  <Button variant="primary">
                    <Plus className="size-4" /> Add stations
                  </Button>
                </Link>
              </>
            ))}
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-2" role="toolbar" aria-label="Filter stations">
        <button className={chip(!filter)} aria-pressed={!filter} onClick={() => setFilter(null)}>
          {t("floor.all")} <span className="tabular font-semibold">{devices.length}</span>
        </button>
        <button className={cx(chip(filter === "attention"), attention > 0 && filter !== "attention" && "border-reserved/50 text-reserved")} aria-pressed={filter === "attention"} onClick={() => setFilter(filter === "attention" ? null : "attention")}>
          <AlertTriangle className="size-3" /> {t("floor.attention")} <span className="tabular font-semibold">{attention}</span>
        </button>
        {(Object.keys(STATUS) as DeviceStatus[]).filter((s) => counts[s]).map((s) => (
          <button key={s} className={chip(filter === s)} aria-pressed={filter === s} title={t(`help.${s}` as TKey)} onClick={() => setFilter(filter === s ? null : s)}>
            <span className="size-2 rounded-full" style={{ background: STATUS[s].color }} />
            {t(`status.${s}` as TKey)}
            <span className="tabular font-semibold">{counts[s] ?? 0}</span>
          </button>
        ))}
        {filter && ["free", "busy", "ending"].includes(filter) && (
          <button className={chip(true)} onClick={() => setFilter(null)} aria-label="Clear filter">{filter === "free" ? t("status.AVAILABLE") : filter === "busy" ? t("status.OCCUPIED") : t("board.ending")} ✕</button>
        )}
        <button className="press flex items-center gap-1 rounded-full px-2 py-1 text-xs text-ink-3 hover:text-ink" aria-expanded={legend} onClick={() => setLegend((v) => !v)}>
          <CircleHelp className="size-3.5" /> {t("floor.legend")}
        </button>
      </div>
      {legend && (
        <Card className="mb-5 p-4">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(Object.keys(STATUS) as DeviceStatus[]).map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-1 size-3 shrink-0 rounded-sm border-2" style={{ borderColor: STATUS[s].color }} />
                <span><strong>{t(`status.${s}` as TKey)}</strong> — <span className="text-ink-2">{t(`help.${s}` as TKey)}</span></span>
              </li>
            ))}
            <li className="flex items-start gap-2"><BellRing className="mt-0.5 size-4 shrink-0 text-reserved" /><span className="text-ink-2">The player pressed &quot;Call staff&quot; on the PC.</span></li>
            <li className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /><span className="text-ink-2">The PC is running too hot.</span></li>
          </ul>
        </Card>
      )}
      {!legend && <div className="mb-2" />}

      <ErrorNote>{floor.error ?? saveLayout.error}</ErrorNote>
      {editing && <p className="mb-4 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">Drag stations to match your venue, then save.</p>}
      <AlertsBar alerts={alerts} devices={floor.devices} onSelect={setSelected} />

      {!branchId || (!floor.zones.length && !floor.error) ? (
        <Spinner />
      ) : devices.length === 0 ? (
        <Card>
          <Empty icon={<Cpu className="size-8" />} title="No stations yet">
            Install the ArenaOS agent on your PCs and enrol them with a code from <Link href="/computers" className="text-accent">Computers → Add stations</Link>.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4">
          {floor.zones.filter((z) => editing || byZone.has(z.id)).map((z) => (
            <ZoneSection
              key={z.id}
              zone={z}
              devices={byZone.get(z.id) ?? []}
              selectedId={selected}
              onSelect={setSelected}
              editing={editing}
              onMove={move}
              canMass={can("station.mass_action", branchId)}
              helpIds={helpIds}
              dimmed={dimmed}
            />
          ))}
          {!editing && floor.zones.some((z) => !byZone.has(z.id)) && (
            <p className="text-xs text-ink-3">
              Zones without stations: {floor.zones.filter((z) => !byZone.has(z.id)).map((z) => z.name).join(" · ")}
            </p>
          )}
        </div>
      )}

      {selected && floor.devices[selected] && (
        <StationDrawer device={floor.devices[selected]!} allDevices={devices} liveCommands={floor.commands} alerts={alerts.filter((a) => a.deviceId === selected)} onClose={() => setSelected(null)} onChange={() => void floor.reload()} />
      )}
    </div>
  );
}
