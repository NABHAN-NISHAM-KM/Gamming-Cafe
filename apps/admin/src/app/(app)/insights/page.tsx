"use client";

import { useState } from "react";
import { AlertTriangle, Cpu, Info, TrendingUp } from "lucide-react";
import { useBranch } from "@/lib/client/branch";
import { useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Card, Empty, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

interface Forecast {
  stations: number;
  hours: Array<{ at: string; day: string; hour: number; expected: number; bookings: number; occupancyPct: number }>;
  days: Array<{ day: string; peakHour: number; peakOccupancyPct: number; quietHours: number[] }>;
}
interface Anomalies { days: number; findings: Array<{ kind: string; severity: "warning" | "info"; title: string; detail: string }> }
interface Health {
  attention: number;
  stations: Array<{ id: string; name: string; zone: string; online: boolean; maxCpuTempC: number | null; maxGpuTempC: number | null; diskPct: number | null; avgPingMs: number | null; packetLossPct: number | null; droppedThisWeek: number; openAlerts: number; needsAttention: string[] }>;
}

/** Heat colour for an occupancy percentage. */
const heat = (pct: number) => (pct >= 85 ? "bg-danger/70" : pct >= 60 ? "bg-reserved/60" : pct >= 35 ? "bg-accent/45" : pct >= 15 ? "bg-accent/20" : "bg-panel-2");
const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric" });

/** Looking ahead and catching problems early: next week's busy hours, things that look wrong, and stations that need a technician. */
export default function InsightsPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const [days, setDays] = useState(7);
  const b = branchId ?? undefined;
  const forecast = useApi<Forecast>(branchId && can("reports.operational", b) ? `/branches/${branchId}/forecast` : null);
  const anomalies = useApi<Anomalies>(branchId && can("reports.financial", b) ? `/branches/${branchId}/anomalies?days=${days}` : null);
  const health = useApi<Health>(branchId && can("station.view", b) ? `/branches/${branchId}/station-health` : null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Insights"
        subtitle="Next week's busy hours (from the last 8 weeks plus bookings), anything unusual, and stations that need attention."
        actions={branches.data && branches.data.length > 1 && (
          <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
            {branches.data.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
          </Select>
        )}
      />

      {can("reports.operational", b) && (
        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold"><TrendingUp className="size-4 text-accent" /> Expected busy hours</h2>
          <p className="mb-4 text-sm text-ink-3">Share of {forecast.data?.stations ?? "…"} stations expected in use. Plan staff and happy hours around it.</p>
          {!forecast.data ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="text-[10px]">
                <thead>
                  <tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} className="w-6 text-center font-normal text-ink-3">{h % 3 === 0 ? h : ""}</th>)}</tr>
                </thead>
                <tbody>
                  {forecast.data.days.map((d) => (
                    <tr key={d.day}>
                      <th className="whitespace-nowrap pr-2 text-left text-xs font-medium text-ink-2">{dayName(d.day)}</th>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = forecast.data!.hours.find((x) => x.day === d.day && x.hour === h);
                        return <td key={h} className="p-0.5"><div title={cell ? `${h}:00 — ${cell.occupancyPct}% (${cell.expected} stations${cell.bookings ? `, ${cell.bookings} booked` : ""})` : "past"} className={cx("h-5 w-6 rounded-sm", cell ? heat(cell.occupancyPct) : "bg-transparent")} /></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {forecast.data.days.slice(0, 7).map((d) => (
                  <div key={d.day} className="rounded-lg border border-line px-3 py-2">
                    <b>{dayName(d.day)}</b> · busiest at {d.peakHour}:00 ({d.peakOccupancyPct}%)
                    {d.quietHours.length > 0 && <span className="block text-xs text-ink-3">Quiet: {d.quietHours.filter((h) => h >= 10).slice(0, 6).map((h) => `${h}:00`).join(", ") || "early morning"}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {can("reports.financial", b) && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-reserved" /> Worth a look</h2>
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </Select>
          </div>
          {!anomalies.data ? <Spinner /> : anomalies.data.findings.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing unusual: refunds, voids and tills look normal, and no station keeps dropping off.</p>
          ) : (
            <ul className="grid gap-2">
              {anomalies.data.findings.map((x, i) => (
                <li key={i} className={cx("flex gap-3 rounded-lg border px-3 py-2 text-sm", x.severity === "warning" ? "border-reserved/40 bg-reserved/5" : "border-line")}>
                  {x.severity === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-reserved" /> : <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />}
                  <span><b>{x.title}</b><span className="block text-ink-3">{x.detail}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {can("station.view", b) && (
        <Card>
          <h2 className="flex items-center gap-2 p-5 pb-3 font-semibold"><Cpu className="size-4 text-accent" /> Station health (last 24 hours){health.data && health.data.attention > 0 && <Badge tone="warn">{health.data.attention} need attention</Badge>}</h2>
          {!health.data ? <Spinner /> : health.data.stations.length === 0 ? <Empty title="No PCs at this branch" /> : (
            <Table head={["Station", "Hottest", "Disk", "Ping", "Drop-offs (7 days)", "Needs attention"]}>
              {health.data.stations.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-2"><span className="font-medium">{s.name}</span> <span className={s.online ? "text-ok" : "text-ink-3"}>●</span><span className="block text-xs text-ink-3">{s.zone}</span></td>
                  <td className="px-4 py-2 tabular-nums">{s.maxCpuTempC != null || s.maxGpuTempC != null ? `${Math.round(Math.max(s.maxCpuTempC ?? 0, s.maxGpuTempC ?? 0))}°C` : "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{s.diskPct != null ? `${Math.round(s.diskPct)}%` : "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{s.avgPingMs != null ? `${Math.round(s.avgPingMs)} ms` : "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{s.droppedThisWeek}</td>
                  <td className="px-4 py-2">{s.needsAttention.length ? s.needsAttention.map((r) => <Badge key={r} tone="warn">{r}</Badge>) : <span className="text-ok">OK</span>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
