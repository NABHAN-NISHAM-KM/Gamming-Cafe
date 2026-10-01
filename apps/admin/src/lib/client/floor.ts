"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { setServerTime, type SessionSummary } from "./sessions";

export type DeviceStatus = "AVAILABLE" | "OCCUPIED" | "RESERVED" | "MAINTENANCE" | "OFFLINE" | "CLEANING" | "STARTING" | "SESSION_ENDING";

export interface Metrics {
  cpuPct?: number | null;
  gpuPct?: number | null;
  ramPct?: number | null;
  diskPct?: number | null;
  cpuTempC?: number | null;
  gpuTempC?: number | null;
  pingMs?: number | null;
  fps?: number | null;
  uptimeSec?: number | null;
}

export interface FloorDevice {
  id: string;
  name: string;
  kind: string;
  status: DeviceStatus;
  displayStatus: DeviceStatus;
  isOnline: boolean;
  zoneId: string;
  branchId: string;
  mapX: number;
  mapY: number;
  ipAddress: string | null;
  macAddress: string | null;
  hostname: string | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  metrics: Metrics | null;
  metricsAt: string | null;
  removed?: boolean;
  session?: SessionSummary | null;
  /** What the customer is playing right now (from the agent). */
  currentGame?: { id: string; title: string; startedAt: string } | null;
  /** Marked out of order by staff (status MAINTENANCE): why, when, by whom. */
  outOfOrder?: { reason: string; at: string; by: string } | null;
  /** Confirmed booking starting within the next 2 hours. */
  nextBooking?: { id: string; reference: string; startsAt: string; name: string | null } | null;
}

export interface FloorZone {
  id: string;
  name: string;
  type: string;
  color: string | null;
}

export interface Alert {
  id: string;
  deviceId: string | null;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  title: string;
  openedAt: string;
  detail?: Record<string, unknown>;
}

export interface CommandRow {
  id: string;
  deviceId: string;
  type: string;
  status: string;
  issuedAt?: string;
  completedAt?: string | null;
  errorMessage?: string | null;
}

/** Status palette from the brief: 🟢 available · 🔴 in use · 🟡 reserved · 🟠 ending · ⚫ offline · 🔧 maintenance. */
export const STATUS: Record<DeviceStatus, { label: string; color: string }> = {
  AVAILABLE: { label: "Available", color: "var(--color-ok)" },
  OCCUPIED: { label: "In use", color: "var(--color-busy)" },
  RESERVED: { label: "Reserved", color: "var(--color-reserved)" },
  SESSION_ENDING: { label: "Ending soon", color: "var(--color-ending)" },
  OFFLINE: { label: "Offline", color: "var(--color-offline)" },
  MAINTENANCE: { label: "Maintenance", color: "var(--color-maint)" },
  CLEANING: { label: "Cleaning", color: "var(--color-accent)" },
  STARTING: { label: "Starting", color: "var(--color-accent)" },
};

export const CMD_TONE: Record<string, "ok" | "danger" | "warn" | "neutral" | "accent"> = {
  SUCCEEDED: "ok",
  FAILED: "danger",
  EXPIRED: "warn",
  CANCELLED: "warn",
  PENDING: "neutral",
  SENT: "accent",
  RECEIVED: "accent",
  EXECUTING: "accent",
};

/**
 * Floor snapshot + live updates over Server-Sent Events. The stream only
 * carries changes; a reconnect re-fetches the snapshot so nothing is missed.
 */
export function useLiveFloor(branchId: string | null) {
  const [devices, setDevices] = useState<Record<string, FloorDevice>>({});
  const [zones, setZones] = useState<FloorZone[]>([]);
  const [alerts, setAlerts] = useState<Record<string, Alert>>({});
  const [commands, setCommands] = useState<Record<string, CommandRow>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      const snap = await api<{ zones: FloorZone[]; devices: FloorDevice[]; alerts: Alert[]; serverTime: string }>(`/branches/${branchId}/floor`);
      setServerTime(snap.serverTime);
      setZones(snap.zones);
      setDevices(Object.fromEntries(snap.devices.map((d) => [d.id, d])));
      setAlerts(Object.fromEntries(snap.alerts.map((a) => [a.id, a])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the floor");
    }
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    void load();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const es = new EventSource(`/api/v1/branches/${branchId}/floor/events`);
      esRef.current = es;
      es.addEventListener("ready", () => {
        setConnected(true);
        void load(); // resync after (re)connect
      });
      es.addEventListener("device", (ev) => {
        const { device } = JSON.parse((ev as MessageEvent).data) as { device: FloorDevice };
        setDevices((all) => {
          if (device.removed) {
            const { [device.id]: _, ...rest } = all;
            return rest;
          }
          return { ...all, [device.id]: { ...all[device.id], ...device } };
        });
      });
      es.addEventListener("metrics", (ev) => {
        const m = JSON.parse((ev as MessageEvent).data) as { deviceId: string; metrics: Metrics; at: string };
        setDevices((all) => (all[m.deviceId] ? { ...all, [m.deviceId]: { ...all[m.deviceId]!, metrics: m.metrics, metricsAt: m.at, isOnline: true } } : all));
      });
      es.addEventListener("booking", () => void load()); // a booking changed: refetch (rare, cheap)
      es.addEventListener("activity", (ev) => {
        const a = JSON.parse((ev as MessageEvent).data) as { deviceId: string; game: FloorDevice["currentGame"] };
        setDevices((all) => (all[a.deviceId] ? { ...all, [a.deviceId]: { ...all[a.deviceId]!, currentGame: a.game } } : all));
      });
      es.addEventListener("alert", (ev) => {
        const { alert } = JSON.parse((ev as MessageEvent).data) as { alert: Alert };
        setAlerts((all) => {
          if (alert.status === "RESOLVED") {
            const { [alert.id]: _, ...rest } = all;
            return rest;
          }
          return { ...all, [alert.id]: alert };
        });
      });
      es.addEventListener("command", (ev) => {
        const { command } = JSON.parse((ev as MessageEvent).data) as { command: CommandRow };
        setCommands((all) => ({ ...all, [command.id]: { ...all[command.id], ...command } }));
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        retry = setTimeout(open, 3000);
      };
    };
    open();
    return () => {
      clearTimeout(retry);
      esRef.current?.close();
    };
  }, [branchId, load]);

  return { devices, setDevices, zones, alerts, commands, connected, error, reload: load };
}

export const fmtPct = (v?: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
export const fmtTemp = (v?: number | null) => (v == null ? "—" : `${Math.round(v)}°`);
export const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
