"use client";

import Link from "next/link";
import { ArrowRight, Building2, Coins, Cpu, UsersRound } from "lucide-react";
import { Card, ErrorNote, PageHeader } from "@/components/ui";
import { ActivityList, OrgStatusBadge, SectionTitle, StatTile } from "@/components/platform";
import { ago, money, usePlatform, type Overview, type OrgStatus } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

const STATUS_ORDER: OrgStatus[] = ["ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED", "CANCELLED"];
const STATUS_COLOR: Record<OrgStatus, string> = {
  ACTIVE: "var(--color-ok)",
  TRIAL: "var(--color-accent)",
  PAST_DUE: "var(--color-reserved)",
  SUSPENDED: "var(--color-danger)",
  CANCELLED: "var(--color-offline)",
};

function StatusBar({ byStatus, total }: { byStatus: Overview["organizations"]["byStatus"]; total: number }) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-panel-2" role="img" aria-label="Organizations by status">
        {STATUS_ORDER.map((s) => {
          const n = byStatus[s] ?? 0;
          return n ? <span key={s} style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: STATUS_COLOR[s] }} className="h-full transition-[width] duration-500" title={`${s}: ${n}`} /> : null;
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {s.replace("_", " ").toLowerCase()} <span className="tabular font-semibold text-ink">{byStatus[s] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Signups({ rows }: { rows: Overview["signups"] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex h-36 items-end gap-3" role="img" aria-label="New organizations per month">
      {rows.map((r) => (
        <div key={r.month} className="flex flex-1 flex-col items-center gap-2">
          <span className="tabular text-xs font-semibold text-ink-2">{r.count}</span>
          <div className="relative w-full flex-1">
            <div
              className="brand-gradient absolute inset-x-0 bottom-0 rounded-t-md opacity-90 transition-[height] duration-700"
              style={{ height: `${Math.max(4, (r.count / max) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-ink-3">{new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString("en", { month: "short" })}</span>
        </div>
      ))}
    </div>
  );
}

export default function PlatformOverview() {
  const me = usePlatformMe();
  const { data, error } = usePlatform<Overview>("/overview", 60_000);

  return (
    <>
      <PageHeader eyebrow="Platform" title={`Good to see you, ${me.user.displayName.split(" ")[0]}`} subtitle="Every organization on ArenaOS, live." />
      <ErrorNote>{error?.message}</ErrorNote>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Organizations" icon={Building2} value={data?.organizations.total ?? "—"} sub={data ? `${data.organizations.byStatus.ACTIVE ?? 0} active · ${data.organizations.byStatus.TRIAL ?? 0} on trial` : " "} />
        <StatTile
          label="Recurring revenue"
          icon={Coins}
          tone="ok"
          value={data ? (data.mrr.length ? data.mrr.map((m) => money(m.amount, m.currency)).join(" + ") : "—") : "—"}
          sub="per month, paying subscriptions"
        />
        <StatTile label="Stations" icon={Cpu} tone="accent-2" value={data ? `${data.devices.online} / ${data.devices.total}` : "—"} sub={data ? `online now · ${data.branches} branches` : " "} />
        <StatTile label="People" icon={UsersRound} value={data ? data.customers.toLocaleString() : "—"} sub={data ? `customers · ${data.employees} staff` : " "} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionTitle>Organizations by status</SectionTitle>
          <div className="p-5">{data ? <StatusBar byStatus={data.organizations.byStatus} total={data.organizations.total} /> : <div className="skeleton h-12" />}</div>
          <div className="border-t border-line p-5">
            <p className="mb-4 text-xs font-medium uppercase tracking-wider text-ink-3">New organizations, last 6 months</p>
            {data ? <Signups rows={data.signups} /> : <div className="skeleton h-36" />}
          </div>
        </Card>
        <Card>
          <SectionTitle>Plan mix</SectionTitle>
          <ul className="grid gap-3 p-5">
            {data?.planMix.map((p) => {
              const total = data.planMix.reduce((n, x) => n + x.count, 0);
              return (
                <li key={p.planId}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="tabular text-ink-2">{p.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                    <div className="brand-gradient h-full rounded-full transition-[width] duration-700" style={{ width: `${(p.count / Math.max(1, total)) * 100}%` }} />
                  </div>
                </li>
              );
            })}
            {data && data.planMix.length === 0 && <p className="text-sm text-ink-3">No live subscriptions.</p>}
            {!data && [0, 1, 2].map((i) => <div key={i} className="skeleton h-8" />)}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle action={<Link href="/platform/organizations" className="flex items-center gap-1 text-xs text-accent hover:underline">All <ArrowRight className="size-3.5" /></Link>}>Newest organizations</SectionTitle>
          <ul className="divide-y divide-line">
            {data?.recent.map((o) => (
              <li key={o.id}>
                <Link href={`/platform/organizations/${o.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-panel-2/60">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised font-display text-sm font-bold text-accent">{o.displayName.slice(0, 1)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{o.displayName}</p>
                    <p className="truncate font-mono text-xs text-ink-3">{o.slug} · {o.countryCode} · {ago(o.createdAt)}</p>
                  </div>
                  <OrgStatusBadge status={o.status} />
                  <ArrowRight className="size-4 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              </li>
            ))}
            {!data && [0, 1, 2].map((i) => <li key={i} className="p-4"><div className="skeleton h-9" /></li>)}
          </ul>
        </Card>
        <Card>
          <SectionTitle action={<Link href="/platform/audit" className="flex items-center gap-1 text-xs text-accent hover:underline">Audit log <ArrowRight className="size-3.5" /></Link>}>Platform activity</SectionTitle>
          <ActivityList rows={data?.activity} empty="No platform actions yet." />
        </Card>
      </div>
    </>
  );
}
