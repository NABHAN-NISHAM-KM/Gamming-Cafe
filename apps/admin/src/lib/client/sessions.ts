"use client";

import { useEffect, useState } from "react";

export interface SessionSummary {
  id: string;
  status: string;
  startedAt: string | null;
  expiresAt: string | null;
  paymentTiming: "PREPAID" | "POSTPAID";
  amountDue: string;
  currency: string;
  customer: { id: string; displayName: string } | null;
  guestLabel: string | null;
  planName: string | null;
}

export interface SessionView extends SessionSummary {
  deviceId: string;
  deviceName: string;
  fundedBy: string | null;
  allocatedMinutes: number | null;
  endedAt: string | null;
  endReason: string | null;
  bill: { id: string; number: string; total: string; paidTotal: string; status: string } | null;
}

export interface QuoteResponse {
  currency: string;
  minorUnit: number;
  stationClass: string;
  station?: { agentless: boolean; minAge: number | null; controllerCount: number | null; kind: string };
  customer: { id: string; displayName: string; timeBalanceMinutes: number; tierName: string | null; age?: number | null } | null;
  plans: Array<{
    id: string;
    name: string;
    billingMode: string;
    paymentTiming: string;
    rateMinor: number;
    minMinutes: number;
    passEndTime: string | null;
    includedPlayers?: number;
    extraPlayerRateMinor?: number | null;
    packages: Array<{ id: string; name: string; durationMinutes: number; priceMinor: number; bonusMinutes: number }>;
  }>;
  quote: { totalMinor: number; grossMinor: number; membershipDiscountMinor: number; manualDiscountMinor: number; minutes: number | null; expiresAt: string | null; lines: string[]; planName: string } | null;
  error: string | null;
}

export const money = (minor: number, unit: number, currency: string) => `${currency} ${(minor / 10 ** unit).toFixed(unit)}`;

/** Server clock offset so countdowns show the server's truth, not the browser's clock. */
let offsetMs = 0;
export const setServerTime = (iso: string) => {
  offsetMs = new Date(iso).getTime() - Date.now();
};
export const serverNow = () => Date.now() + offsetMs;

export function remaining(expiresAt: string | null | undefined) {
  if (!expiresAt) return null;
  return Math.max(0, new Date(expiresAt).getTime() - serverNow());
}

export function fmtCountdown(ms: number | null, withSeconds = true) {
  if (ms === null) return "Open";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(sec)}` : h ? `${h}h ${pad(m)}m` : `${m}m`;
}

/** Re-renders every second while mounted. */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export const idem = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
