"use client";

import { useState } from "react";
import { ClipboardCheck, Gamepad2, Glasses, Link2, Monitor, Pencil, Plug, Plus, Power, PowerOff, Sparkles, Tv, Unlink } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx, toast, askConfirm } from "@/components/ui";

type Accessory = { id: string; type: string; label: string | null; vendor: string | null; model: string | null; serialNumber: string | null; status: string };
type PowerPlug = { kind: "SHELLY" | "SHELLY_GEN1" | "TASMOTA"; host: string; channel: number; offDelaySeconds: number };
interface Station {
  id: string;
  name: string;
  kind: "CONSOLE" | "VR_HEADSET" | "SIMULATOR" | "SMART_TV" | string;
  platform: string;
  status: string;
  displayStatus: string;
  zoneId: string;
  zone: { name: string; type: string };
  controllerCount: number | null;
  cleaningRequired: boolean;
  minAge: number | null;
  linkedDisplayId: string | null;
  powerPlug: PowerPlug | null;
  agentless: boolean;
  isBridge: boolean;
  paired: boolean;
  displayPairExpiresAt: string | null;
  deviceAccessories: Accessory[];
  displayFor: Array<{ id: string; name: string }>;
}
interface Listing {
  stations: Station[];
  bridgeCandidates: Array<{ id: string; name: string; isBridge: boolean }>;
}

const KIND = { CONSOLE: "Console", VR_HEADSET: "VR headset", SIMULATOR: "Simulator", SMART_TV: "TV display" } as Record<string, string>;
const PLATFORMS: Record<string, string[]> = {
  CONSOLE: ["PS5", "PS4", "XBOX_SERIES", "XBOX_ONE", "SWITCH", "OTHER"],
  VR_HEADSET: ["META_QUEST", "PICO", "VALVE_INDEX", "HTC_VIVE", "OTHER"],
  SIMULATOR: ["RACING_RIG", "FLIGHT_SIM", "MOTION_SIM", "OTHER"],
  SMART_TV: ["OTHER"],
};
const ACCESSORY_TYPES = ["CONTROLLER", "HEADSET", "VR_CONTROLLER", "STEERING_WHEEL", "PEDALS", "SHIFTER", "JOYSTICK", "OTHER"];
const ACC_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = { OK: "ok", NEEDS_CHARGE: "warn", NEEDS_CLEANING: "warn", FAULTY: "danger", MISSING: "danger", RETIRED: "neutral" };
const STATUS_TONE: Record<string, "ok" | "accent" | "warn" | "danger" | "neutral"> = { AVAILABLE: "ok", OCCUPIED: "accent", RESERVED: "warn", CLEANING: "warn", MAINTENANCE: "danger" };
const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");
const Icon = ({ kind }: { kind: string }) => (kind === "VR_HEADSET" ? <Glasses className="size-5" /> : kind === "SMART_TV" ? <Tv className="size-5" /> : kind === "SIMULATOR" ? <Monitor className="size-5" /> : <Gamepad2 className="size-5" />);

export default function ConsolesPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const list = useApi<Listing>(branchId ? `/branches/${branchId}/stations` : null);
  const zones = useApi<Array<{ id: string; name: string; type: string }>>(branchId && can("zone.view", branchId) ? `/branches/${branchId}/zones` : null);
  const [editing, setEditing] = useState<Station | "new" | null>(null);
  const [checking, setChecking] = useState<Station | null>(null);
  const [pairing, setPairing] = useState<{ station: Station; code: string; expiresAt: string } | null>(null);
  const manage = can("station.manage", branchId ?? undefined);

  const bridge = useAction(async (id: string) => {
    if (id) await api(`/devices/${id}/bridge`, { method: "POST", body: { enabled: true } });
    else {
      const current = list.data?.bridgeCandidates.find((b) => b.isBridge);
      if (current) await api(`/devices/${current.id}/bridge`, { method: "POST", body: { enabled: false } });
    }
    await list.reload();
  });
  const act = useAction(async (path: string, body?: unknown) => {
    await api(path, { method: "POST", body: body ?? {} });
    await list.reload();
  });
  const pair = useAction(async (s: Station) => {
    const r = await api<{ code: string; expiresAt: string }>(`/devices/${s.id}/display-pairing`, { method: "POST" });
    setPairing({ station: s, ...r });
    await list.reload();
  });
  const unpair = useAction(async (s: Station) => {
    if (!(await askConfirm(`Unpair ${s.name}? The TV stops showing times until it's paired again.`))) return;
    await api(`/devices/${s.id}/display-pairing`, { method: "DELETE" });
    await list.reload();
  });

  const stations = (list.data?.stations ?? []).filter((s) => s.agentless);
  const tvs = stations.filter((s) => s.kind === "SMART_TV");
  const playable = stations.filter((s) => s.kind !== "SMART_TV");
  const tvName = (id: string | null) => tvs.find((t) => t.id === id)?.name;
  const bridgeNow = list.data?.bridgeCandidates.find((b) => b.isBridge);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Consoles, VR & simulators"
        subtitle="Stations without the ArenaOS agent. The server keeps their time; the TV next to each one shows the countdown, and a smart plug can switch it off when time's up."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            {manage && <Button variant="primary" onClick={() => setEditing("new")}><Plus className="size-4" /> Station</Button>}
          </div>
        }
      />

      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <Plug className="size-4 text-accent" />
        <span className="font-medium">Bridge PC</span>
        <span className="text-ink-3">An ordinary station on this branch's network switches the smart plugs.</span>
        {manage ? (
          <Select value={bridgeNow?.id ?? ""} onChange={(e) => void bridge.run(e.target.value)} className="ml-auto w-auto" aria-label="Bridge PC">
            <option value="">None — no automatic power switching</option>
            {list.data?.bridgeCandidates.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        ) : (
          <span className="ml-auto">{bridgeNow?.name ?? "None"}</span>
        )}
      </Card>
      <ErrorNote>{bridge.error ?? act.error ?? pair.error ?? unpair.error}</ErrorNote>

      {!list.data ? (
        <Spinner />
      ) : playable.length === 0 ? (
        <Empty icon={<Gamepad2 className="size-8" />} title="No consoles, VR or simulators yet">Add one to sell time on it like a PC.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {playable.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-accent-soft text-accent"><Icon kind={s.kind} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-xs text-ink-3">{KIND[s.kind] ?? s.kind} · {pretty(s.platform)} · {s.zone.name}</p>
                </div>
                <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{pretty(s.status)}</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                {s.controllerCount != null && <><dt className="text-ink-3">Controllers</dt><dd>{s.controllerCount}</dd></>}
                {s.minAge && <><dt className="text-ink-3">Minimum age</dt><dd>{s.minAge}+</dd></>}
                <dt className="text-ink-3">TV display</dt><dd>{tvName(s.linkedDisplayId) ?? <span className="text-ink-3">—</span>}</dd>
                <dt className="text-ink-3">Smart plug</dt><dd>{s.powerPlug ? `${pretty(s.powerPlug.kind)} · ${s.powerPlug.host}` : <span className="text-ink-3">—</span>}</dd>
                {s.cleaningRequired && <><dt className="text-ink-3">Between players</dt><dd>cleaned</dd></>}
              </dl>
              {s.deviceAccessories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.deviceAccessories.map((a) => <Badge key={a.id} tone={ACC_TONE[a.status] ?? "neutral"}>{a.label ?? pretty(a.type)}{a.status !== "OK" ? ` · ${pretty(a.status)}` : ""}</Badge>)}
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                {s.status === "CLEANING" && can("station.start_session", branchId ?? undefined) && <Button size="sm" variant="primary" pending={act.pending} onClick={() => void act.run(`/devices/${s.id}/cleaned`)}><Sparkles className="size-3.5" /> Mark cleaned</Button>}
                {s.deviceAccessories.length > 0 && can("station.start_session", branchId ?? undefined) && <Button size="sm" onClick={() => setChecking(s)}><ClipboardCheck className="size-3.5" /> Check gear</Button>}
                {s.powerPlug && can("station.shutdown", branchId ?? undefined) && (
                  <>
                    <Button size="sm" variant="ghost" pending={act.pending} onClick={() => void act.run(`/devices/${s.id}/power`, { on: true })} title="Switch on"><Power className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" pending={act.pending} onClick={async () => (await askConfirm(`Switch ${s.name} off now?`)) && void act.run(`/devices/${s.id}/power`, { on: false })} title="Switch off"><PowerOff className="size-3.5" /></Button>
                  </>
                )}
                {manage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}><Pencil className="size-3.5" /></Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {list.data && (
        <Card>
          <h2 className="flex items-center gap-2 px-5 pt-4 font-semibold"><Tv className="size-4 text-accent" /> TV station displays</h2>
          <p className="px-5 pt-1 text-sm text-ink-3">Open <span className="font-mono text-ink-2">/display.html</span> of the customer app in the TV&apos;s browser, then pair it with a code. Each TV shows the stations linked to it.</p>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {tvs.map((tv) => (
              <div key={tv.id} className="rounded-lg border border-line p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">{tv.name} {tv.paired ? <Badge tone="ok"><Link2 className="size-3" /> paired</Badge> : <Badge>not paired</Badge>}</p>
                <p className="mt-1 text-xs text-ink-3">Shows: {tv.displayFor.map((d) => d.name).join(", ") || "nothing yet — link stations to it"}</p>
                {manage && (
                  <div className="mt-2 flex gap-1.5">
                    <Button size="sm" pending={pair.pending} onClick={() => void pair.run(tv)}>{tv.paired ? "Re-pair" : "Pair display"}</Button>
                    {tv.paired && <Button size="sm" variant="ghost" pending={unpair.pending} onClick={() => void unpair.run(tv)}><Unlink className="size-3.5" /> Unpair</Button>}
                  </div>
                )}
              </div>
            ))}
            {tvs.length === 0 && <p className="text-sm text-ink-3">No TVs yet — add a station of kind “TV display”.</p>}
          </div>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New station" : editing ? `Edit ${editing.name}` : ""} wide>
        {editing && branchId && <StationForm branchId={branchId} station={editing === "new" ? null : editing} zones={zones.data ?? []} tvs={tvs} onDone={() => { setEditing(null); void list.reload(); }} />}
      </Modal>
      <Modal open={!!checking} onClose={() => setChecking(null)} title={checking ? `Check gear · ${checking.name}` : ""}>
        {checking && <GearCheck station={checking} onDone={() => { setChecking(null); void list.reload(); }} />}
      </Modal>
      <Modal open={!!pairing} onClose={() => setPairing(null)} title={pairing ? `Pair ${pairing.station.name}` : ""}>
        {pairing && (
          <div className="grid gap-4 text-center">
            <p className="text-sm text-ink-2">On the TV, open the customer app&apos;s <span className="font-mono">/display.html</span> and type:</p>
            <p className="font-mono text-5xl font-semibold tracking-[0.2em] text-accent">{pairing.code}</p>
            <p className="text-xs text-ink-3">Valid until {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · works once</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function StationForm({ branchId, station, zones, tvs, onDone }: { branchId: string; station: Station | null; zones: Array<{ id: string; name: string; type: string }>; tvs: Station[]; onDone: () => void }) {
  const [f, setF] = useState({
    name: station?.name ?? "", kind: station?.kind ?? "CONSOLE", platform: station?.platform ?? "PS5", zoneId: station?.zoneId ?? zones.find((z) => z.type === "CONSOLE")?.id ?? zones[0]?.id ?? "",
    controllerCount: String(station?.controllerCount ?? 2), minAge: station?.minAge ? String(station.minAge) : "", cleaningRequired: station?.cleaningRequired ?? false,
    linkedDisplayId: station?.linkedDisplayId ?? "", plug: !!station?.powerPlug, plugKind: station?.powerPlug?.kind ?? "SHELLY", plugHost: station?.powerPlug?.host ?? "",
    plugChannel: String(station?.powerPlug?.channel ?? 0), offDelay: String(station?.powerPlug?.offDelaySeconds ?? 60),
  });
  const [acc, setAcc] = useState({ type: "CONTROLLER", label: "" });
  const isTv = f.kind === "SMART_TV";
  const save = useAction(async () => {
    const body = {
      name: f.name.trim(), zoneId: f.zoneId, platform: f.platform,
      ...(isTv ? {} : {
        controllerCount: f.controllerCount ? Number(f.controllerCount) : null, minAge: f.minAge ? Number(f.minAge) : null, cleaningRequired: f.cleaningRequired, linkedDisplayId: f.linkedDisplayId || null,
        powerPlug: f.plug ? { kind: f.plugKind, host: f.plugHost.trim(), channel: Number(f.plugChannel) || 0, offDelaySeconds: Number(f.offDelay) || 0 } : null,
      }),
    };
    if (station) await api(`/devices/${station.id}/station`, { method: "PATCH", body });
    else await api(`/branches/${branchId}/stations`, { method: "POST", body: { ...body, kind: f.kind } });
    onDone();
  });
  const addAcc = useAction(async () => {
    await api(`/devices/${station!.id}/accessories`, { method: "POST", body: { type: acc.type, label: acc.label || null } });
    setAcc({ ...acc, label: "" });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="grid gap-5">
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <Field label="Name"><Input value={f.name} onChange={set("name")} required pattern="[A-Za-z0-9 _-]{1,24}" placeholder="PS5-04" /></Field>
        <Field label="Kind">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, platform: PLATFORMS[e.target.value]![0]!, cleaningRequired: e.target.value === "VR_HEADSET" })} disabled={!!station}>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Model"><Select value={f.platform} onChange={set("platform")}>{(PLATFORMS[f.kind] ?? ["OTHER"]).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</Select></Field>
        <Field label="Zone"><Select value={f.zoneId} onChange={set("zoneId")}>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select></Field>
        {!isTv && (
          <>
            <Field label="Controllers" hint="Most players at once"><Input type="number" min={0} max={16} value={f.controllerCount} onChange={set("controllerCount")} /></Field>
            <Field label="Minimum age" hint="Blank = none"><Input type="number" min={3} max={21} value={f.minAge} onChange={set("minAge")} /></Field>
            <Field label="TV display" className="sm:col-span-2">
              <Select value={f.linkedDisplayId} onChange={set("linkedDisplayId")}><option value="">None</option>{tvs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={f.cleaningRequired} onChange={(e) => setF({ ...f, cleaningRequired: e.target.checked })} /> Must be cleaned between players (VR headsets)</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={f.plug} onChange={(e) => setF({ ...f, plug: e.target.checked })} /> Switched by a smart plug</label>
            {f.plug && (
              <>
                <Field label="Plug type"><Select value={f.plugKind} onChange={set("plugKind")}><option value="SHELLY">Shelly (Gen 2+)</option><option value="SHELLY_GEN1">Shelly Gen 1</option><option value="TASMOTA">Tasmota</option></Select></Field>
                <Field label="Address" hint="LAN only, e.g. 192.168.1.61"><Input value={f.plugHost} onChange={set("plugHost")} required={f.plug} /></Field>
                <Field label="Channel"><Input type="number" min={0} max={7} value={f.plugChannel} onChange={set("plugChannel")} /></Field>
                <Field label="Off after time's up (s)"><Input type="number" min={0} max={600} value={f.offDelay} onChange={set("offDelay")} /></Field>
              </>
            )}
          </>
        )}
        <div className="sm:col-span-4"><ErrorNote>{save.error}</ErrorNote></div>
        <div className="flex justify-end sm:col-span-4"><Button type="submit" variant="primary" pending={save.pending}>{station ? "Save" : "Add station"}</Button></div>
      </form>
      {station && !isTv && (
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-sm font-medium">Controllers & gear</p>
          <div className="mb-3 flex flex-wrap gap-1">{station.deviceAccessories.map((a) => <Badge key={a.id} tone={ACC_TONE[a.status] ?? "neutral"}>{a.label ?? pretty(a.type)}</Badge>)}</div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void addAcc.run(); }}>
            <Field label="Type"><Select value={acc.type} onChange={(e) => setAcc({ ...acc, type: e.target.value })}>{ACCESSORY_TYPES.map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</Select></Field>
            <Field label="Label"><Input value={acc.label} onChange={(e) => setAcc({ ...acc, label: e.target.value })} placeholder="Controller 3" maxLength={40} /></Field>
            <Button type="submit" pending={addAcc.pending}><Plus className="size-4" /> Add</Button>
          </form>
          <ErrorNote>{addAcc.error}</ErrorNote>
        </div>
      )}
    </div>
  );
}

/** After a session: were all the controllers handed back? Missing or broken gear raises a floor alert. */
function GearCheck({ station, onDone }: { station: Station; onDone: () => void }) {
  const [status, setStatus] = useState<Record<string, string>>(() => Object.fromEntries(station.deviceAccessories.map((a) => [a.id, a.status === "MISSING" ? "MISSING" : a.status])));
  const [note, setNote] = useState("");
  const save = useAction(async () => {
    const r = await api<{ problems: Array<{ name: string; status: string }> }>(`/devices/${station.id}/accessory-check`, { method: "POST", body: { items: Object.entries(status).map(([accessoryId, s]) => ({ accessoryId, status: s })), note: note || null } });
    if (r.problems.length) toast(`Flagged on the floor: ${r.problems.map((p) => `${p.name} ${pretty(p.status)}`).join(", ")}`, "warn");
    onDone();
  });
  return (
    <div className="grid gap-3 text-sm">
      {station.deviceAccessories.map((a) => (
        <div key={a.id} className="flex items-center gap-3">
          <span className="flex-1">{a.label ?? pretty(a.type)}</span>
          <div className="flex gap-1">
            {["OK", "NEEDS_CHARGE", "NEEDS_CLEANING", "FAULTY", "MISSING"].map((s) => (
              <button key={s} type="button" onClick={() => setStatus({ ...status, [a.id]: s })} className={cx("rounded-md border px-2 py-1 text-xs", status[a.id] === s ? (s === "OK" ? "border-ok bg-ok/15 text-ok" : s === "MISSING" || s === "FAULTY" ? "border-danger bg-danger/15 text-danger" : "border-reserved bg-reserved/15 text-reserved") : "border-line text-ink-3")}>
                {s === "OK" ? "OK" : pretty(s).replace("needs ", "")}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={200} />
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button variant="primary" pending={save.pending} onClick={() => void save.run()}><ClipboardCheck className="size-4" /> Save check</Button></div>
    </div>
  );
}
