"use client";

import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Circle, LayoutGrid, ShieldCheck, Users } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import { Card, PageHeader } from "@/components/ui";

interface Branch {
  id: string;
  code: string;
  name: string;
  status: string;
  zones?: unknown[];
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: typeof Users }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-ink-3">
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="tabular mt-3 text-3xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-3">{sub}</p>}
    </Card>
  );
}

export default function Dashboard() {
  const me = useMe();
  const can = useCan();
  const branches = useApi<Branch[]>(can("branch.view") ? "/branches" : null);
  const employees = useApi<unknown[]>(can("employee.view") ? "/employees" : null);

  const firstBranch = branches.data?.[0];
  const zones = useApi<unknown[]>(firstBranch && can("zone.view") ? `/branches/${firstBranch.id}/zones` : null);

  const steps = [
    { done: (branches.data?.length ?? 0) > 0, label: "Create your first branch", href: "/branches" },
    { done: (zones.data?.length ?? 0) > 0, label: "Add zones (Regular, VIP, PS5, VR…)", href: firstBranch ? `/branches/${firstBranch.id}` : "/branches" },
    { done: (employees.data?.length ?? 0) > 1, label: "Invite your staff and assign roles", href: "/employees" },
    { done: me.user.mfaEnabled, label: "Turn on 2-step sign-in for your account", href: "/settings" },
  ];

  const limit = (k: keyof typeof me.limits) => (me.limits[k] === undefined ? "unlimited" : `of ${me.limits[k]}`);

  return (
    <>
      <PageHeader title={`Welcome, ${me.employee.displayName.split(" ")[0]}`} subtitle={`${me.organization.displayName} · ${me.organization.defaultCurrency} · ${me.organization.defaultTimezone}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Branches" value={branches.data?.length ?? "—"} sub={limit("MAX_BRANCHES")} icon={Building2} />
        <Stat label="Zones (first branch)" value={zones.data?.length ?? "—"} sub={firstBranch?.name} icon={LayoutGrid} />
        <Stat label="Staff" value={employees.data?.length ?? "—"} sub={limit("MAX_EMPLOYEES")} icon={Users} />
        <Stat label="Modules enabled" value={me.features.length} sub="from your plan" icon={ShieldCheck} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <h2 className="font-semibold">Get your venue ready</h2>
          <p className="mt-1 text-sm text-ink-2">Stations, sessions and the Live Floor arrive with the Windows client (phase 3).</p>
          <ul className="mt-5 grid gap-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="group flex items-center gap-3 rounded-lg border border-line px-4 py-3 transition hover:border-line-strong hover:bg-panel-2">
                  {s.done ? <CheckCircle2 className="size-5 text-ok" /> : <Circle className="size-5 text-ink-3" />}
                  <span className={s.done ? "text-ink-2 line-through decoration-ink-3" : ""}>{s.label}</span>
                  <ArrowRight className="ml-auto size-4 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold">Your access</h2>
          <ul className="mt-4 grid gap-3">
            {me.grants.map((g, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <p className="text-sm font-medium capitalize">{g.role.replace(/_/g, " ")}</p>
                <p className="text-xs text-ink-3">
                  {g.scope === "ORGANIZATION" ? "All branches" : g.scope === "BRAND" ? "One brand" : `Branch ${branches.data?.find((b) => b.id === g.branchId)?.code ?? ""}`} · {g.permissions.length} permissions
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
