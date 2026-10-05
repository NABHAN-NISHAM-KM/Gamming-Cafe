"use client";

import Link from "next/link";
import { AlertTriangle, Info, LifeBuoy, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useCanOrg, useMe } from "@/lib/client/me";
import { Button } from "@/components/ui";

interface Announcement { id: string; title: string; body: string; severity: "INFO" | "WARNING" }
type Row = { near: boolean; full: boolean };

/**
 * Above every admin page: ArenaOS support signed in as this venue (with a way
 * to end it), messages from the platform, and the plan running out or unpaid.
 */
export function AccountBanners() {
  const me = useMe();
  const canOrg = useCanOrg();
  const news = useApi<Announcement[]>("/announcements");
  const usage = useApi<{ status: string | null; branches: Row; stations: Row; staff: Row }>(canOrg("org.billing") ? "/organization/usage" : null);

  const dismiss = async (id: string) => {
    news.setData((all) => all?.filter((a) => a.id !== id));
    await api(`/announcements/${id}/read`, { method: "POST" }).catch(() => undefined);
  };
  const endSupport = async () => {
    await fetch("/api/platform/impersonate/end", { method: "POST", headers: { "x-arena-csrf": "1" } }).catch(() => undefined);
    window.location.assign("/platform");
  };
  const u = usage.data;
  const full = u && (["branches", "stations", "staff"] as const).filter((k) => u[k].full);
  const near = u && (["branches", "stations", "staff"] as const).filter((k) => u[k].near && !u[k].full);

  return (
    <div className="grid gap-2 px-4 pt-4 lg:px-8">
      {me.impersonatedBy && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-reserved/60 bg-reserved/15 px-4 py-2 text-sm">
          <LifeBuoy className="size-4 text-reserved" />
          <span className="flex-1">ArenaOS support is signed in as <b>{me.employee.displayName}</b>. Everything done here is recorded.</span>
          <Button size="sm" variant="secondary" onClick={() => void endSupport()}>End support session</Button>
        </div>
      )}
      {u?.status === "PAST_DUE" && (
        <div className="flex items-center gap-3 rounded-xl border border-danger/50 bg-danger/10 px-4 py-2 text-sm">
          <AlertTriangle className="size-4 text-danger" /><span className="flex-1">An ArenaOS invoice is overdue.</span>
          <Link href="/billing" className="font-semibold text-accent">Pay now</Link>
        </div>
      )}
      {full && full.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-reserved/50 bg-reserved/10 px-4 py-2 text-sm">
          <AlertTriangle className="size-4 text-reserved" /><span className="flex-1">You've reached your plan's limit for {full.join(" and ")}.</span>
          <Link href="/billing" className="font-semibold text-accent">See plans</Link>
        </div>
      )}
      {!full?.length && near && near.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2 text-sm">
          <Info className="size-4 text-accent" /><span className="flex-1">You're using over 80% of your plan's {near.join(" and ")}.</span>
          <Link href="/billing" className="font-semibold text-accent">See plans</Link>
        </div>
      )}
      {news.data?.map((a) => (
        <div key={a.id} className={`flex items-start gap-3 rounded-xl border px-4 py-2 text-sm ${a.severity === "WARNING" ? "border-reserved/50 bg-reserved/10" : "border-accent/40 bg-accent/10"}`}>
          {a.severity === "WARNING" ? <AlertTriangle className="mt-0.5 size-4 text-reserved" /> : <Info className="mt-0.5 size-4 text-accent" />}
          <span className="flex-1"><b>{a.title}</b> — {a.body}</span>
          <button onClick={() => void dismiss(a.id)} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Dismiss"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
