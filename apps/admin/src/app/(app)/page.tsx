"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Circle, Crown, Minus, Receipt, Sparkles } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import { Card, PageHeader, Select, Spinner, cx } from "@/components/ui";

interface Branch {
  id: string;
  code: string;
  name: string;
}
interface Kpi<T = string | number> {
  value: T;
  previous: T;
  changePct: number | null;
}
interface Overview {
  currency: string;
  today: string;
  live: { playing: number; stations: number; online: number; occupancyPct: number | null; openBills: number; due: string };
  todayVsLastWeek: { revenue: string; revenueLastWeek: string; revenueChangePct: number | null; bills: number; billsLastWeek: number; takings: string };
  advanced: null | {
    days: number;
    kpis: { revenue: Kpi<string>; bills: Kpi<number>; averageBill: Kpi<string>; sessions: Kpi<number>; hoursPlayed: Kpi<number>; activeCustomers: Kpi<number>; newCustomers: Kpi<number> | null };
    customers: { returningPct: number | null; walletFloat: string | null; topSpenders: Array<{ id: string; name: string; spent: string; visits: number }> };
    series: Array<{ day: string; revenue: string; bills: number; sessions: number; hours: number }>;
  };
}

const money = (v: string | number, currency?: string) => `${currency ? `${currency} ` : ""}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const setupLoaded = !branches.loading && !employees.loading;
  const setupDone = steps.every((s) => s.done);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Overview" title={`Welcome, ${me.employee.displayName.split(" ")[0]}`} subtitle={`${me.organization.displayName} · ${me.organization.defaultCurrency} · ${me.organization.defaultTimezone}`} />

      {can("reports.operational") && <Analytics branches={branches.data ?? []} />}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {setupLoaded && !setupDone && (
          <Card className="p-6">
            <h2 className="font-semibold">Finish setting up</h2>
            <ul className="mt-4 grid gap-2">
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
        )}
        <Card className="p-6">
          <h2 className="font-semibold">Your access</h2>
          <ul className="mt-4 grid gap-3">
            {me.grants.map((g, i) => {
              const code = branches.data?.find((b) => b.id === g.branchId)?.code;
              return (
                <li key={i} className="rounded-lg border border-line p-3">
                  <p className="text-sm font-medium capitalize">{g.role.replace(/_/g, " ")}</p>
                  <p className="text-xs text-ink-3">{g.scope === "ORGANIZATION" ? "All branches" : g.scope === "BRAND" ? "One brand" : code ? `Branch ${code}` : "One branch"} · {g.permissions.length} permissions</p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ── analytics ───────────────────────────────────────────────────────────────

function Analytics({ branches }: { branches: Branch[] }) {
  const [days, setDays] = useState(30);
  const [branchId, setBranchId] = useState("");
  const o = useApi<Overview>(`/analytics/overview?days=${days}${branchId ? `&branchId=${branchId}` : ""}`);
  if (o.error) return null; // no report access at any branch → the dashboard just skips it
  if (!o.data) return <Spinner />;
  const d = o.data;
  const c = d.currency;
  const a = d.advanced;
  return (
    <div className="grid gap-4">
      {/* right now + today */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Playing now" value={`${d.live.playing} / ${d.live.stations}`} hint={d.live.occupancyPct === null ? "no stations yet" : `${d.live.occupancyPct}% of stations · ${d.live.online} online`} href="/floor" />
        <Tile label="Open tabs" value={String(d.live.openBills)} hint={Number(d.live.due) ? `${money(d.live.due, c)} still to pay` : "nothing outstanding"} />
        <Tile label="Revenue today" value={money(d.todayVsLastWeek.revenue, c)} change={d.todayVsLastWeek.revenueChangePct} hint={`vs ${money(d.todayVsLastWeek.revenueLastWeek)} last ${new Date(`${d.today}T12:00:00`).toLocaleDateString([], { weekday: "long" })}`} />
        <Tile label="Bills today" value={String(d.todayVsLastWeek.bills)} hint={`${d.todayVsLastWeek.billsLastWeek} same day last week · takings ${money(d.todayVsLastWeek.takings)}`} />
      </div>

      {!a ? (
        <Card className="flex items-center gap-3 px-4 py-3 text-sm text-ink-2">
          <Sparkles className="size-4 text-accent" /> Trends, period comparisons and customer insight come with <strong>Advanced analytics</strong> (Pro plan and up).
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Last {a.days} days <span className="font-normal text-ink-3">vs the {a.days} before</span></h2>
            <div className="flex gap-2">
              {branches.length > 1 && (
                <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-auto min-w-40" aria-label="Branch">
                  <option value="">All my branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                </Select>
              )}
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto" aria-label="Period">
                <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Revenue" value={money(a.kpis.revenue.value, c)} change={a.kpis.revenue.changePct} small />
            <Tile label="Bills" value={String(a.kpis.bills.value)} change={a.kpis.bills.changePct} small />
            <Tile label="Average bill" value={money(a.kpis.averageBill.value)} change={a.kpis.averageBill.changePct} small />
            <Tile label="Sessions" value={String(a.kpis.sessions.value)} change={a.kpis.sessions.changePct} small />
            <Tile label="Hours played" value={String(a.kpis.hoursPlayed.value)} change={a.kpis.hoursPlayed.changePct} small />
            <Tile label="Active customers" value={String(a.kpis.activeCustomers.value)} change={a.kpis.activeCustomers.changePct} small hint={a.customers.returningPct === null ? undefined : `${a.customers.returningPct}% returning`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Trend title="Revenue per day" points={a.series.map((p) => ({ key: p.day, value: Number(p.revenue), label: `${money(p.revenue, c)} · ${p.bills} bills` }))} />
            <Trend title="Hours played per day" points={a.series.map((p) => ({ key: p.day, value: p.hours, label: `${p.hours} h · ${p.sessions} sessions` }))} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Crown className="size-4 text-ink-3" /> Top customers</h3>
              {a.customers.topSpenders.length === 0 ? <p className="text-sm text-ink-3">No customer purchases in this period.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {a.customers.topSpenders.map((t, i) => (
                    <li key={t.id} className="flex items-center gap-3 py-2">
                      <span className="w-5 text-ink-3 tabular-nums">{i + 1}</span>
                      <Link href="/customers" className="flex-1 hover:underline">{t.name}</Link>
                      <span className="text-xs text-ink-3">{t.visits} bill{t.visits === 1 ? "" : "s"}</span>
                      <span className="w-28 text-right tabular-nums">{money(t.spent, c)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <div className="grid gap-3">
              {a.kpis.newCustomers && <Tile label="New sign-ups" value={String(a.kpis.newCustomers.value)} change={a.kpis.newCustomers.changePct} />}
              {a.customers.walletFloat !== null && <Tile label="Held in wallets" value={money(a.customers.walletFloat, c)} hint="customers' prepaid money — a liability until spent" />}
              <Link href="/reports" className="flex items-center gap-2 rounded-lg border border-line px-4 py-3 text-sm text-ink-2 hover:border-line-strong hover:text-ink"><Receipt className="size-4" /> Full reports <ArrowRight className="ml-auto size-4" /></Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A stat tile; the change arrow carries an icon and a sign, never colour alone. */
function Tile({ label, value, hint, change, href, small }: { label: string; value: string; hint?: string; change?: number | null; href?: string; small?: boolean }) {
  const body = (
    <Card className={cx("h-full px-4 py-3", href && "transition hover:border-line-strong")}>
      <p className="text-xs text-ink-3">{label}</p>
      <p className={cx("mt-1 font-semibold tabular-nums", small ? "text-base" : "text-xl")}>{value}</p>
      {change !== undefined && (
        <p className={cx("mt-0.5 flex items-center gap-1 text-xs tabular-nums", change === null || change === 0 ? "text-ink-3" : change > 0 ? "text-ok" : "text-danger")}>
          {change === null ? <><Minus className="size-3" /> new</> : change === 0 ? <><Minus className="size-3" /> no change</> : change > 0 ? <><ArrowUpRight className="size-3" /> +{change}%</> : <><ArrowDownRight className="size-3" /> {change}%</>}
        </p>
      )}
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** One series per chart (never two scales on one axis): thin bars, a hover readout, a table-free summary line. */
function Trend({ title, points }: { title: string; points: Array<{ key: string; value: number; label: string }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value));
  const h = hover === null ? null : points[hover];
  return (
    <Card className="p-4">
      <div className="mb-2 flex h-5 items-baseline justify-between gap-2 text-xs">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="truncate tabular-nums text-ink-2">{h ? <><span className="text-ink-3">{h.key}</span> · {h.label}</> : max ? <span className="text-ink-3">peak {points.find((p) => p.value === max)?.label}</span> : null}</span>
      </div>
      {max === 0 ? <p className="py-10 text-center text-sm text-ink-3">Nothing yet in this period.</p> : (
        <>
          <div className="flex h-32 items-end gap-[2px] border-b border-line-strong" role="img" aria-label={`${title}, peak ${points.find((p) => p.value === max)?.label}`} onMouseLeave={() => setHover(null)}>
            {points.map((p, i) => (
              <div key={p.key} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
                <div className={cx("mx-auto w-full max-w-5 rounded-t-[4px] bg-accent transition-opacity", hover !== null && hover !== i && "opacity-40")} style={{ height: `${Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-3"><span>{points[0]?.key}</span><span>{points[points.length - 1]?.key}</span></div>
        </>
      )}
    </Card>
  );
}
