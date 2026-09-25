"use client";

import { useEffect, useState } from "react";
import { Lock, Megaphone, Power, RotateCcw, Sunrise, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { CMD_TONE, STATUS, ago, fmtPct, fmtTemp, type Alert, type CommandRow, type FloorDevice } from "@/lib/client/floor";
import { Badge, Button, ErrorNote, Field, Input, cx } from "@/components/ui";
import { SessionPanel } from "./session-panel";
import { ToolsPanel } from "./tools-panel";

interface Detail extends FloorDevice {
  zone: { name: string };
  hardware: { cpu: string | null; gpu: string | null; ramMb: number | null; osVersion: string | null; motherboard: string | null; disks: Array<{ model?: string; sizeGb?: number }>; nics: Array<{ name?: string; mac?: string; speedMbps?: number }> } | null;
  commands: CommandRow[];
  alerts: Alert[];
}

function Meter({ label, value, warn = 85 }: { label: string; value?: number | null; warn?: number }) {
  const v = value ?? null;
  return (
    <div>
      <div className="flex justify-between text-[11px] text-ink-3">
        <span>{label}</span>
        <span className="tabular text-ink-2">{fmtPct(v)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className={cx("h-full rounded-full transition-all", v != null && v >= warn ? "bg-ending" : "bg-accent")} style={{ width: `${Math.min(100, v ?? 0)}%` }} />
      </div>
    </div>
  );
}

/** The station control drawer from the brief: hardware, network, live metrics, remote actions. */
export function StationDrawer({ device, allDevices, liveCommands, alerts, onClose, onChange }: { device: FloorDevice; allDevices: FloorDevice[]; liveCommands: Record<string, CommandRow>; alerts: Alert[]; onClose: () => void; onChange: () => void }) {
  const can = useCan();
  const detail = useApi<Detail>(`/devices/${device.id}`);
  const [msg, setMsg] = useState("");
  const [showMsg, setShowMsg] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setNotice(null), [device.id]);

  const send = useAction(async (type: string, payload: Record<string, unknown> = {}, label: string = type) => {
    const r = await api<{ status: string; online: boolean }>(`/devices/${device.id}/commands`, { method: "POST", body: { type, payload }, action: label });
    setNotice(r.online === false && type !== "WAKE_ON_LAN" ? `${label} queued — the PC is offline and will receive it when it reconnects.` : `${label} sent.`);
    void detail.reload();
  });

  const ack = useAction(async (alertId: string) => {
    await api(`/alerts/${alertId}/ack`, { method: "POST", action: "Acknowledge" });
    onChange();
  });

  const m = device.metrics;
  const st = STATUS[device.displayStatus] ?? STATUS.OFFLINE;
  const b = device.branchId;
  const commands = (detail.data?.commands ?? []).map((c) => ({ ...c, ...liveCommands[c.id] }));

  const act = (type: string, label: string, confirmText?: string, payload?: Record<string, unknown>) => () => {
    if (confirmText && !confirm(confirmText)) return;
    void send.run(type, payload, label);
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-line bg-panel shadow-2xl" aria-label={`${device.name} details`}>
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="size-3 rounded-full" style={{ background: st.color }} />
        <div className="min-w-0">
          <h2 className="font-semibold">{device.name}</h2>
          <p className="text-xs text-ink-3">
            {st.label} · {detail.data?.zone.name ?? "…"}
          </p>
        </div>
        <button onClick={onClose} className="ml-auto rounded p-1 text-ink-3 hover:text-ink" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Session</h3>
          <SessionPanel device={device} allDevices={allDevices} onChange={onChange} />
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Station</h3>
          <div className="grid grid-cols-2 gap-2">
            {can("station.message", b) && (
              <Button size="sm" onClick={() => setShowMsg((v) => !v)}>
                <Megaphone className="size-3.5" /> Message
              </Button>
            )}
            {can("station.lock", b) && (
              <Button size="sm" onClick={act("LOCK", "Lock")}>
                <Lock className="size-3.5" /> Lock
              </Button>
            )}
            {can("station.restart", b) && (
              <Button size="sm" onClick={act("RESTART", "Restart", `Restart ${device.name}? Anyone using it will be interrupted.`)}>
                <RotateCcw className="size-3.5" /> Restart
              </Button>
            )}
            {can("station.shutdown", b) &&
              (device.isOnline ? (
                <Button size="sm" variant="danger" onClick={act("SHUTDOWN", "Shut down", `Shut down ${device.name}?`)}>
                  <Power className="size-3.5" /> Shut down
                </Button>
              ) : (
                <Button size="sm" onClick={act("WAKE_ON_LAN", "Wake up")}>
                  <Sunrise className="size-3.5" /> Wake up
                </Button>
              ))}
          </div>
          {showMsg && (
            <form
              className="mt-3 grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send.run("SEND_MESSAGE", { title: "Message from staff", message: msg }, "Message").then(() => {
                  setMsg("");
                  setShowMsg(false);
                });
              }}
            >
              <Field label="Message on screen">
                <Input required maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Your burger is on its way!" autoFocus />
              </Field>
              <Button size="sm" type="submit" variant="primary" pending={send.pending}>
                Send
              </Button>
            </form>
          )}
          {notice && <p className="mt-3 text-xs text-ok">{notice}</p>}
          <ErrorNote>{send.error}</ErrorNote>
        </section>

        {alerts.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Alerts</h3>
            <ul className="grid gap-1.5">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Badge tone={a.severity === "CRITICAL" ? "danger" : "warn"}>{a.severity.toLowerCase()}</Badge>
                  <span className="flex-1">{a.title}</span>
                  {a.status === "OPEN" && (
                    <button onClick={() => void ack.run(a.id)} className="text-xs text-ink-3 hover:text-accent">{a.type === "HELP_REQUESTED" ? "On my way" : "Acknowledge"}</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <ToolsPanel key={device.id} deviceId={device.id} branchId={b} online={device.isOnline} />

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Live</h3>
          {device.isOnline && m ? (
            <div className="grid gap-3">
              <Meter label="CPU" value={m.cpuPct} />
              <Meter label="GPU" value={m.gpuPct} warn={101} />
              <Meter label="RAM" value={m.ramPct} />
              <Meter label="Disk" value={m.diskPct} warn={90} />
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  ["CPU °C", fmtTemp(m.cpuTempC)],
                  ["GPU °C", fmtTemp(m.gpuTempC)],
                  ["Ping", m.pingMs != null ? `${Math.round(m.pingMs)}ms` : "—"],
                  ["FPS", m.fps != null ? String(Math.round(m.fps)) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border border-line py-2">
                    <p className="tabular text-sm font-semibold">{v}</p>
                    <p className="text-[10px] text-ink-3">{k}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-3">Offline · last seen {ago(device.lastSeenAt)}</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Network</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-3">IP</dt>
            <dd className="font-mono">{device.ipAddress ?? "—"}</dd>
            <dt className="text-ink-3">MAC</dt>
            <dd className="font-mono">{device.macAddress ?? "—"}</dd>
            <dt className="text-ink-3">Host</dt>
            <dd className="font-mono">{device.hostname ?? "—"}</dd>
            <dt className="text-ink-3">Agent</dt>
            <dd>{device.agentVersion ?? "—"}</dd>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Hardware</h3>
          {detail.data?.hardware ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">CPU</dt>
              <dd>{detail.data.hardware.cpu ?? "—"}</dd>
              <dt className="text-ink-3">GPU</dt>
              <dd>{detail.data.hardware.gpu ?? "—"}</dd>
              <dt className="text-ink-3">RAM</dt>
              <dd>{detail.data.hardware.ramMb ? `${Math.round(detail.data.hardware.ramMb / 1024)} GB` : "—"}</dd>
              <dt className="text-ink-3">Board</dt>
              <dd>{detail.data.hardware.motherboard ?? "—"}</dd>
              <dt className="text-ink-3">OS</dt>
              <dd>{detail.data.hardware.osVersion ?? "—"}</dd>
              {detail.data.hardware.disks.map((d, i) => (
                <div key={i} className="contents">
                  <dt className="text-ink-3">Disk</dt>
                  <dd>
                    {d.model} {d.sizeGb ? `· ${d.sizeGb} GB` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-ink-3">Reported when the agent connects.</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Recent commands</h3>
          {commands.length === 0 ? (
            <p className="text-sm text-ink-3">None yet.</p>
          ) : (
            <ul className="grid gap-1.5">
              {commands.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{c.type}</span>
                  <Badge tone={CMD_TONE[c.status] ?? "neutral"}>{c.status.toLowerCase()}</Badge>
                  <span className="ml-auto text-xs text-ink-3">{ago(c.issuedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
