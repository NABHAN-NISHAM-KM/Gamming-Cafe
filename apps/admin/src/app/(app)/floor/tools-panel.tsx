"use client";

import { useState } from "react";
import { Gamepad2, Headphones, Keyboard, Mouse, Wrench } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, ErrorNote, Select, cx } from "@/components/ui";

interface Tools {
  currentGame: { id: string; title: string; startedAt: string } | null;
  network: { targets: Array<{ name: string; host: string; pingMs: number | null; lossPct: number }>; linkType?: string | null; linkSpeedMbps?: number | null; at?: string } | null;
  boot: { bootStatus: string; bootServer: string | null; imageName: string | null; integration: { name: string; provider: string } | null } | null;
  games: Array<{ gameId: string; title: string; status: string; detectedBy: string | null; lastPlayedAt: string | null }>;
  peripherals: Array<{ id: string; type: string; label: string | null; vendor: string | null; connected: boolean; detected: boolean }>;
}

const REPAIRS: Array<[string, string]> = [
  ["FLUSH_DNS", "Flush DNS cache"],
  ["RENEW_IP", "Renew IP address"],
  ["RESTART_AUDIO", "Restart audio service"],
  ["SYNC_TIME", "Sync the clock"],
  ["CLEAR_TEMP", "Clear old temp files"],
  ["CLOSE_GAMES", "Close all games & launchers"],
  ["RESTART_SHELL", "Reload the Gaming Shell"],
];
const ICON: Record<string, typeof Mouse> = { MOUSE: Mouse, KEYBOARD: Keyboard, HEADSET: Headphones, CONTROLLER: Gamepad2 };
const pingTone = (ms: number | null, loss: number) => (ms === null || loss >= 50 ? "text-danger" : loss >= 10 || ms >= 80 ? "text-reserved" : "text-ok");

/** Phase 5 station tools: what's being played, installed games, gear, connection, boot, repairs. */
export function ToolsPanel({ deviceId, branchId, online }: { deviceId: string; branchId: string; online: boolean }) {
  const can = useCan();
  const tools = useApi<Tools>(`/devices/${deviceId}/tools`);
  const [repair, setRepair] = useState("FLUSH_DNS");
  const [done, setDone] = useState<string | null>(null);
  const run = useAction(async () => {
    const label = REPAIRS.find(([k]) => k === repair)![1];
    const r = await api<{ online: boolean }>(`/devices/${deviceId}/commands`, { method: "POST", action: label, body: { type: "RUN_REPAIR", payload: { action: repair } } });
    setDone(r.online ? `${label}: sent.` : `${label}: queued until the PC is back online.`);
  });
  const t = tools.data;
  if (!t) return null;
  const installed = t.games.filter((g) => g.status !== "NOT_INSTALLED");

  return (
    <>
      {t.currentGame && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Playing</h3>
          <p className="flex items-center gap-2 text-sm"><span className="size-2 animate-pulse rounded-full bg-ok" /> {t.currentGame.title}<span className="text-ink-3">since {new Date(t.currentGame.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></p>
        </section>
      )}

      {can("station.restart", branchId) && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Repair</h3>
          <div className="flex gap-2">
            <Select value={repair} onChange={(e) => setRepair(e.target.value)} className="flex-1">
              {REPAIRS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Button size="sm" onClick={() => void run.run()} pending={run.pending}><Wrench className="size-3.5" /> Run</Button>
          </div>
          {done && <p className="mt-2 text-xs text-ok">{done}</p>}
          <ErrorNote>{run.error}</ErrorNote>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Connection</h3>
        {t.network ? (
          <>
            <ul className="grid gap-1 text-sm">
              {t.network.targets.map((x) => (
                <li key={x.name} className="flex justify-between">
                  <span className="text-ink-2">{x.name}</span>
                  <span className={cx("tabular font-mono", pingTone(x.pingMs, x.lossPct))}>{x.pingMs === null ? "no reply" : `${Math.round(x.pingMs)} ms`}{x.lossPct ? ` · ${x.lossPct}% loss` : ""}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-ink-3">{t.network.linkType === "WIFI" ? "Wi-Fi" : t.network.linkType === "ETHERNET" ? "Ethernet" : ""}{t.network.linkSpeedMbps ? ` · ${t.network.linkSpeedMbps} Mbps` : ""}</p>
          </>
        ) : (
          <p className="text-sm text-ink-3">{online ? "Measuring…" : "No recent measurement."}</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Peripherals</h3>
        {t.peripherals.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing reported yet.</p>
        ) : (
          <ul className="grid gap-1.5 text-sm">
            {t.peripherals.map((p) => {
              const Icon = ICON[p.type] ?? Gamepad2;
              return (
                <li key={p.id} className={cx("flex items-center gap-2", !p.connected && "text-danger")}>
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{p.label ?? p.type.toLowerCase()}</span>
                  {!p.connected && <Badge tone="danger">missing</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Games on this PC ({installed.length})</h3>
        {installed.length === 0 ? (
          <p className="text-sm text-ink-3">No catalog games detected.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {installed.map((g) => (
              <li key={g.gameId} className="flex items-center justify-between gap-2">
                <span className="truncate">{g.title}</span>
                {g.status === "INSTALLED" ? <span className="text-[11px] text-ink-3">{g.detectedBy?.toLowerCase()}</span> : <Badge tone="warn">{g.status === "UPDATE_REQUIRED" ? "update" : g.status.toLowerCase()}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {t.boot && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Boot</h3>
          <p className="text-sm text-ink-2">
            {t.boot.bootStatus === "LOCAL_DISK" ? "Local disk" : t.boot.bootStatus === "BOOTED" ? `Diskless${t.boot.integration ? ` · ${t.boot.integration.name}` : ""}` : "Unknown"}
            {t.boot.bootServer && <span className="block font-mono text-xs text-ink-3">{t.boot.bootServer}</span>}
          </p>
        </section>
      )}
    </>
  );
}
