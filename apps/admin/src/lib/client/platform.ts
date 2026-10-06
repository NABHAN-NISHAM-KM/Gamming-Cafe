"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, describeError } from "./api";
import { useRefresh } from "./hooks";

const PLATFORM_ERRORS: Record<string, string> = {
  not_platform_admin: "This account isn't a platform administrator.",
  platform_unreachable: "Can't reach the platform service. Start it with: npm run dev:platform -w @arena/api",
  reason_required: "Give a reason for this change.",
  slug_taken: "That slug is already used by another organization.",
  session_ended: "Your session ended. Please sign in again.",
  invalid_mfa_token: "The sign-in attempt expired. Please start again.",
};

export const describePlatformError = (status: number, body: any) => PLATFORM_ERRORS[body?.error] ?? describeError(status, body);

export class PlatformError extends ApiError {
  constructor(status: number, body: any) {
    super(status, body);
    this.message = describePlatformError(status, body);
  }
}

/** Calls the Super Admin service through the BFF (/api/platform/v1). */
export async function platformApi<T = any>(path: string, opts: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/platform/v1${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", "x-arena-csrf": "1" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new PlatformError(401, body);
  }
  if (!res.ok) throw new PlatformError(res.status, body);
  return body as T;
}

export async function platformSession(action: "login" | "mfa" | "logout", body?: unknown) {
  const res = await fetch(`/api/platform/session/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-arena-csrf": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** `refreshMs`: quiet refetch while visible (see useApi). */
export function usePlatform<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<PlatformError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const reload = useCallback(async (quiet = false) => {
    if (!path) return;
    const mine = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const d = await platformApi<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof PlatformError ? e : new PlatformError(0, null));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useRefresh(path ? reload : null, refreshMs);
  return { data, error, loading, reload, setData };
}

// ── Shapes returned by the platform service ─────────────────────────────────

export type PlatformRole = "SUPER_ADMIN" | "PLATFORM_SUPPORT" | "PLATFORM_BILLING" | "PLATFORM_READONLY";
export type OrgStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";

export interface PlatformMe {
  user: { id: string; email: string; displayName: string; lastLoginAt: string | null };
  roles: PlatformRole[];
}

export interface AuditRow {
  id: string;
  organizationId: string | null;
  organization: string | null;
  actorType: string;
  actor: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

export interface Overview {
  organizations: { total: number; byStatus: Partial<Record<OrgStatus, number>> };
  branches: number;
  devices: { total: number; online: number };
  employees: number;
  customers: number;
  mrr: Array<{ currency: string; amount: number }>;
  planMix: Array<{ planId: string; name: string; code: string; count: number }>;
  signups: Array<{ month: string; count: number }>;
  recent: Array<{ id: string; slug: string; displayName: string; status: OrgStatus; countryCode: string; createdAt: string }>;
  activity: AuditRow[];
}

export interface OrgRow {
  id: string;
  slug: string;
  displayName: string;
  status: OrgStatus;
  countryCode: string;
  defaultCurrency: string;
  billingEmail: string;
  createdAt: string;
  subscription: { status: string; currentPeriodEnd: string; plan: { name: string; code: string } } | null;
  counts: { branches: number; customers: number; devices: number; online: number; staff: number };
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  interval: "MONTHLY" | "YEARLY";
  maxBranches: number | null;
  maxDevices: number | null;
  maxEmployees: number | null;
  isPublic: boolean;
  isActive: boolean;
  subscribers: number;
  features: Record<string, boolean>;
}

export interface OrgDetail {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  status: OrgStatus;
  countryCode: string;
  defaultCurrency: string;
  defaultTimezone: string;
  billingEmail: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
  subscription: {
    id: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    maxBranches: number | null;
    maxDevices: number | null;
    maxEmployees: number | null;
    plan: Omit<Plan, "features" | "subscribers">;
  } | null;
  features: Array<{ key: string; label: string; plan: boolean; enabled: boolean; override: { enabled: boolean; reason: string | null } | null }>;
  branches: Array<{ id: string; code: string; name: string; status: string; city: string | null; currency: string; timezone: string; devices: number }>;
  counts: { branches: number; devices: number; online: number; staff: number; customers: number };
  owners: Array<{ id: string; name: string; status: string; email: string; lastLoginAt: string | null }>;
  activity: AuditRow[];
}

export const STATUS_TONE: Record<OrgStatus, "ok" | "accent" | "warn" | "danger" | "neutral"> = {
  ACTIVE: "ok",
  TRIAL: "accent",
  PAST_DUE: "warn",
  SUSPENDED: "danger",
  CANCELLED: "neutral",
};

export const roleLabel = (r: string) => r.replace(/^PLATFORM_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const can = (roles: PlatformRole[] | undefined, ...allowed: PlatformRole[]) => !!roles?.some((r) => allowed.includes(r));
export const money = (amount: number | string, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
export const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString();
};
