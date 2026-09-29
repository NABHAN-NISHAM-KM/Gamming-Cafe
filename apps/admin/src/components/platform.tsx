"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { Badge, Card, cx, Empty } from "@/components/ui";
import { ago, STATUS_TONE, type AuditRow, type OrgStatus } from "@/lib/client/platform";

export function StatTile({ label, value, sub, icon: Icon, tone = "accent" }: { label: string; value: ReactNode; sub?: ReactNode; icon: React.ComponentType<{ className?: string }>; tone?: "accent" | "accent-2" | "ok" | "danger" }) {
  const toneCls = { accent: "text-accent", "accent-2": "text-accent-2", ok: "text-ok", danger: "text-danger" }[tone];
  return (
    <Card interactive className="group relative overflow-hidden p-5">
      <div aria-hidden className="absolute -right-10 -top-10 size-32 rounded-full bg-accent/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</span>
        <span className={cx("grid size-9 place-items-center rounded-xl border border-line-strong bg-panel-2", toneCls)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="tabular relative mt-3 font-display text-3xl font-semibold">{value}</p>
      {sub && <p className="relative mt-1 text-xs text-ink-3">{sub}</p>}
    </Card>
  );
}

export function OrgStatusBadge({ status }: { status: OrgStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status.replace("_", " ").toLowerCase()}</Badge>;
}

const ACTION_LABEL: Record<string, string> = {
  "platform.login": "signed in to the platform",
  "platform.org.create": "created the organization",
  "platform.org.status": "changed the organization status",
  "platform.subscription.update": "changed the subscription",
  "platform.feature.override": "overrode a feature",
  "platform.feature.reset": "reset a feature to its plan",
  "platform.plan.update": "edited a plan",
  "platform.plan.feature": "changed a plan's features",
};

export function ActivityList({ rows, showOrg = true, empty = "Nothing recorded yet." }: { rows: AuditRow[] | undefined; showOrg?: boolean; empty?: string }) {
  if (!rows) return <div className="grid gap-2.5 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>;
  if (rows.length === 0) return <Empty icon={<Activity />} title={empty} />;
  return (
    <ol className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-3 px-5 py-3 text-sm">
          <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", r.actorType === "PLATFORM_ADMIN" ? "bg-accent-2" : "bg-accent")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-ink-2">
              <span className="font-medium text-ink">{r.actor ?? r.actorType.toLowerCase().replace("_", " ")}</span> {ACTION_LABEL[r.action] ?? <code className="font-mono text-xs">{r.action}</code>}
              {showOrg && r.organization && (
                <>
                  {" · "}
                  <Link href={`/platform/organizations/${r.organizationId}`} className="text-accent hover:underline">{r.organization}</Link>
                </>
              )}
            </p>
            {r.reason && <p className="mt-0.5 truncate text-xs text-ink-3">“{r.reason}”</p>}
          </div>
          <time className="shrink-0 text-xs text-ink-3" dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>{ago(r.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}
