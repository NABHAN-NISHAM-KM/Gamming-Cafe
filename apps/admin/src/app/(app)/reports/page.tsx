"use client";

import { useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

// ── types (mirror apps/api/src/reports) ─────────────────────────────────────

interface Sales {
  currency: string;
  summary: { bills: number; takings: string; discounts: string; tax: string; revenue: string; costOfGoods: string; refunds: string; averageBill: string };
  byDay: Array<{ day: string; bills: number; total: string; tax: string; net: string }>;
  byBranch: Array<{ branch: string; bills: number; total: string }>;
  byType: Array<{ name: string; isRevenue: boolean; quantity: number; net: string; tax: string }>;
  byCategory: Array<{ name: string; quantity: number; net: string }>;
  byMethod: Array<{ method: string; payments: number; amount: string }>;
  refundsByDestination: Array<{ destination: string; refunds: number; amount: string }>;
  topProducts: Array<{ productId: string; name: string; category: string; quantity: number; net: string; cost: string; margin: string | null; marginPct: number | null }>;
  heatmap: string[][];
}
interface Vat { currency: string; output: Array<{ rate: string; ratePercent: number; taxable: string; tax: string }>; outputTax: string; refundAdjustment: string; input: Array<{ source: string; documents: number; tax: string }>; inputTax: string; netPayable: string }
interface Cash {
  currency: string;
  totals: { shifts: number; openingFloats: string; cashSales: string; cashRefunds: string; payIns: string; payOuts: string; safeDrops: string; expenses: string; expected: string; counted: string; variance: string; needingApproval: number };
  shifts: Array<{ id: string; branch: string; drawer: string; cashier: string; status: string; openedAt: string; closedAt: string; openingCash: string; expectedCash: string; countedCash: string; variance: string; approvedBy: string | null }>;
}
interface Station { deviceId: string; name: string; zone: string; branch: string; sessions: number; hours: number; occupancyPct: number | null }
interface Util {
  currency: string; days: number;
  summary: { sessions: number; hoursPlayed: number; stations: number; occupancyPct: number | null; revenue: string };
  zones: Array<{ zoneId: string; zone: string; type: string; branch: string; stations: number; sessions: number; players: number; hours: number; occupancyPct: number | null; revenue: string; revenuePerStationDay: string | null }>;
  busiest: Station[]; idlest: Station[]; heatmap: number[][];
}
interface Staff { currency: string; staff: Array<{ id: string; name: string; code: string; branch: string | null; orders: number; orderValue: string; payments: number; paid: string; refunds: number; refunded: string; voids: number; voided: string; sessions: number; shifts: number; variance: string }> }
interface Branch { id: string; code: string; name: string }

interface Attendance {
  people: Array<{ employee: { id: string; displayName: string }; hours: number; shifts: number }>;
  entries: Array<{ id: string; day: string; employee: { displayName: string }; clockInAt: string; clockOutAt: string | null; hours: number; open: boolean }>;
}

type Tab = "sales" | "vat" | "cash" | "utilization" | "staff" | "attendance";
const TABS: Array<[Tab, string, string]> = [["sales", "Sales", "reports.financial"], ["vat", "VAT", "reports.financial"], ["cash", "Cash & shifts", "reports.financial"], ["utilization", "Gaming utilization", "reports.operational"], ["staff", "Staff", "reports.staff"], ["attendance", "Attendance", "reports.staff"]];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const todayLocal = () => new Date().toLocaleDateString("en-CA");
const fmt = (v: string | number, currency?: string) => {
  const n = Number(v);
  return `${n < 0 ? "−" : ""}${currency ? `${currency} ` : ""}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const qs = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v) as Array<[string, string]>).toString();

export default function ReportsPage() {
  const can = useCan();
  const tabs = TABS.filter(([, , perm]) => can(perm));
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? "sales");
  const [from, setFrom] = useState(`${todayLocal().slice(0, 8)}01`);
  const [to, setTo] = useState(todayLocal());
  const [branchId, setBranchId] = useState("");
  const branches = useApi<Branch[]>("/branches");
  const q = qs({ from, to, branchId: branchId || undefined });
  if (!tabs.length) return <><PageHeader title="Reports" /><Empty icon={<BarChart3 className="size-8" />} title="No reports for your role">Ask a manager for report access.</Empty></>;
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Sales, VAT, cash, gaming utilization and staff — by branch-local day, for the branches you look after." />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Branch">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="min-w-44">
            <option value="">All my branches</option>
            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>{label}</button>
        ))}
      </div>
      {tab === "sales" ? <SalesReport q={q} from={from} to={to} /> : tab === "vat" ? <VatReport q={q} /> : tab === "cash" ? <CashReport q={q} /> : tab === "utilization" ? <UtilReport q={q} /> : tab === "staff" ? <StaffReport q={q} /> : <AttendanceReport branchId={branchId || branches.data?.[0]?.id} from={from} to={to} />}
    </div>
  );
}

function Csv({ path }: { path: string }) {
  const can = useCan();
  if (!can("reports.export")) return null;
  return <a href={`/api/v1${path}&format=csv`} download className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><Download className="size-3.5" /> CSV</a>;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </Card>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>
      {children}
    </Card>
  );
}

/**
 * One series of bars over time: thin marks with rounded tops on a shared
 * baseline, a 2px gap, a quiet max gridline, and a tooltip on hover. The table
 * next to it carries the same numbers for anyone who can't read the chart.
 */
function BarSeries({ points, currency, label }: { points: Array<{ key: string; value: number; note?: string }>; currency: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value));
  if (!points.length || max === 0) return <p className="px-4 py-10 text-center text-sm text-ink-3">No {label.toLowerCase()} in this period.</p>;
  const h = hover === null ? null : points[hover]!;
  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mb-2 flex h-5 items-baseline justify-between text-xs">
        <span className="text-ink-3">max {fmt(max, currency)}</span>
        {h && <span className="tabular-nums text-ink"><span className="text-ink-3">{h.key}</span> · {fmt(h.value, currency)}{h.note && <span className="text-ink-3"> · {h.note}</span>}</span>}
      </div>
      <div className="relative h-40 border-b border-line-strong" role="img" aria-label={`${label}: ${points.length} bars, highest ${fmt(max, currency)}`} onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div className="flex h-full items-end gap-[2px]">
          {points.map((p, i) => (
            <div key={p.key} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
              <div className={cx("mx-auto w-full max-w-7 rounded-t-[4px] bg-accent transition-opacity", hover !== null && hover !== i && "opacity-40")} style={{ height: `${Math.max((p.value / max) * 100, p.value > 0 ? 1.5 : 0)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-3"><span>{points[0]!.key}</span><span>{points[points.length - 1]!.key}</span></div>
    </div>
  );
}

/** Weekday × hour, one hue from faint to full (magnitude only — never a rainbow). */
function Heatmap({ grid, format, label }: { grid: Array<Array<number | string>>; format: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const values = grid.map((r) => r.map(Number));
  const max = Math.max(0, ...values.flat());
  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mb-2 h-5 text-xs text-ink-3">
        {hover ? <span className="text-ink">{DAYS[hover[0]]} {String(hover[1]).padStart(2, "0")}:00 · {format(values[hover[0]]![hover[1]]!)}</span> : `Darker = more ${label}`}
      </div>
      <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}>
        <div className="grid min-w-[560px] grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px]" role="img" aria-label={`${label} by weekday and hour`}>
          {values.map((row, d) => (
            <div key={d} className="contents">
              <span className="pr-2 text-right text-[10px] leading-5 text-ink-3">{DAYS[d]}</span>
              {row.map((v, hIdx) => (
                <div key={hIdx} onMouseEnter={() => setHover([d, hIdx])} className={cx("h-5 rounded-[3px]", v === 0 ? "bg-panel-2" : "bg-accent")} style={v === 0 ? undefined : { opacity: 0.15 + 0.85 * (v / (max || 1)) }} />
              ))}
            </div>
          ))}
          <span />
          {Array.from({ length: 24 }, (_, i) => <span key={i} className="text-center text-[9px] text-ink-3">{i % 3 === 0 ? i : ""}</span>)}
        </div>
      </div>
    </div>
  );
}

// ── sales ───────────────────────────────────────────────────────────────────

/** Every day in the range, so quiet days show as gaps rather than disappearing. */
function everyDay(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function SalesReport({ q, from, to }: { q: string; from: string; to: string }) {
  const r = useApi<Sales>(`/reports/sales?${q}`);
  if (r.error) return <ErrorNote>{r.error.message}</ErrorNote>;
  if (!r.data) return <Spinner />;
  const s = r.data;
  const c = s.currency;
  const margin = Number(s.summary.costOfGoods) > 0 ? `${(((Number(s.summary.revenue) - Number(s.summary.costOfGoods)) / Number(s.summary.revenue)) * 100).toFixed(1)}% after cost of goods` : undefined;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Revenue (excl. VAT)" value={fmt(s.summary.revenue, c)} hint={margin} />
        <Tile label="Taken in (cash & card)" value={fmt(s.summary.takings, c)} hint={`${s.summary.bills} bills · avg ${fmt(s.summary.averageBill)}`} />
        <Tile label="VAT collected" value={fmt(s.summary.tax, c)} hint={Number(s.summary.discounts) ? `Discounts ${fmt(s.summary.discounts)}` : undefined} />
        <Tile label="Refunds" value={fmt(s.summary.refunds, c)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel title="Takings by day" action={<Csv path={`/reports/sales/daily?${q}`} />}>
          <BarSeries label="Takings" currency={c} points={everyDay(from, to).map((day) => { const d = s.byDay.find((x) => x.day === day); return { key: day, value: d ? Number(d.total) : 0, note: `${d?.bills ?? 0} bills` }; })} />
        </Panel>
        <Panel title="By what was sold">
          <Table head={["", "Qty", "Net"]}>
            {s.byType.map((t) => (
              <tr key={t.name} className="border-t border-line">
                <td className="px-4 py-1.5">{t.name}{!t.isRevenue && <span className="ml-2"><Badge>not revenue</Badge></span>}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{t.quantity}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmt(t.net)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Payments by method">
          <Table head={["", "Count", "Amount"]}>
            {s.byMethod.map((m) => <tr key={m.method} className="border-t border-line"><td className="px-4 py-1.5 capitalize">{m.method.toLowerCase().replace("_", " ")}</td><td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{m.payments}</td><td className="px-4 py-1.5 text-right tabular-nums">{fmt(m.amount)}</td></tr>)}
            {s.refundsByDestination.map((m) => <tr key={`r-${m.destination}`} className="border-t border-line text-ink-2"><td className="px-4 py-1.5">Refunds · {m.destination.toLowerCase().replace("_", " ")}</td><td className="px-4 py-1.5 text-right tabular-nums">{m.refunds}</td><td className="px-4 py-1.5 text-right tabular-nums">−{fmt(m.amount)}</td></tr>)}
          </Table>
        </Panel>
        <Panel title="By branch">
          <Table head={["", "Bills", "Takings"]}>
            {s.byBranch.map((b) => <tr key={b.branch} className="border-t border-line"><td className="px-4 py-1.5">{b.branch}</td><td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{b.bills}</td><td className="px-4 py-1.5 text-right tabular-nums">{fmt(b.total)}</td></tr>)}
          </Table>
        </Panel>
        <Panel title="By menu category">
          <Table head={["", "Qty", "Net"]}>
            {s.byCategory.map((b) => <tr key={b.name} className="border-t border-line"><td className="px-4 py-1.5">{b.name}</td><td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{b.quantity}</td><td className="px-4 py-1.5 text-right tabular-nums">{fmt(b.net)}</td></tr>)}
          </Table>
        </Panel>
      </div>
      <Panel title="Top products · margin after stock cost" action={<Csv path={`/reports/sales?${q}`} />}>
        {s.topProducts.length === 0 ? <p className="px-4 py-6 text-sm text-ink-3">No sales in this period.</p> : (
          <Table head={["Product", "Category", "Qty", "Net", "Cost", "Margin"]}>
            {s.topProducts.map((p) => (
              <tr key={p.productId} className="border-t border-line">
                <td className="px-4 py-1.5">{p.name}</td>
                <td className="px-4 py-1.5 text-ink-3">{p.category}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{p.quantity}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmt(p.net)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{Number(p.cost) ? fmt(p.cost) : "—"}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{p.marginPct === null ? "—" : `${p.marginPct}%`}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Panel title="When customers pay — takings by weekday and hour">
        <Heatmap grid={s.heatmap} label="takings" format={(v) => fmt(v, c)} />
      </Panel>
    </div>
  );
}

// ── VAT ─────────────────────────────────────────────────────────────────────

function VatReport({ q }: { q: string }) {
  const r = useApi<Vat>(`/reports/vat?${q}`);
  if (r.error) return <ErrorNote>{r.error.message}</ErrorNote>;
  if (!r.data) return <Spinner />;
  const v = r.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Output VAT (on sales)" action={<Csv path={`/reports/vat?${q}`} />}>
        <Table head={["Rate", "Taxable", "VAT"]}>
          {v.output.map((o) => <tr key={o.rate + o.ratePercent} className="border-t border-line"><td className="px-4 py-1.5">{o.rate}{o.ratePercent ? ` · ${o.ratePercent}%` : ""}</td><td className="px-4 py-1.5 text-right tabular-nums">{fmt(o.taxable)}</td><td className="px-4 py-1.5 text-right tabular-nums">{fmt(o.tax)}</td></tr>)}
          <tr className="border-t border-line text-ink-2"><td className="px-4 py-1.5">Refunds (VAT given back)</td><td /><td className="px-4 py-1.5 text-right tabular-nums">−{fmt(v.refundAdjustment)}</td></tr>
        </Table>
      </Panel>
      <Panel title="Input VAT (on purchases)">
        <Table head={["Source", "Documents", "VAT"]}>
          {v.input.map((i) => <tr key={i.source} className="border-t border-line"><td className="px-4 py-1.5">{i.source}</td><td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{i.documents}</td><td className="px-4 py-1.5 text-right tabular-nums">{fmt(i.tax)}</td></tr>)}
        </Table>
      </Panel>
      <Card className="px-4 py-4 lg:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-ink-2">Output {fmt(v.outputTax)} − refunds {fmt(v.refundAdjustment)} − input {fmt(v.inputTax)}</p>
          <p className="text-lg font-semibold tabular-nums">{Number(v.netPayable) >= 0 ? "VAT payable" : "VAT reclaimable"}: {fmt(Math.abs(Number(v.netPayable)), v.currency)}</p>
        </div>
        <p className="mt-1 text-xs text-ink-3">A working figure for your return — your accountant files it. Wallet top-ups and gift cards carry no VAT until they're spent.</p>
      </Card>
    </div>
  );
}

// ── cash ────────────────────────────────────────────────────────────────────

function CashReport({ q }: { q: string }) {
  const r = useApi<Cash>(`/reports/cash?${q}`);
  if (r.error) return <ErrorNote>{r.error.message}</ErrorNote>;
  if (!r.data) return <Spinner />;
  const t = r.data.totals;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Shifts closed" value={String(t.shifts)} hint={t.needingApproval ? `${t.needingApproval} waiting for approval` : undefined} />
        <Tile label="Cash sales" value={fmt(t.cashSales, r.data.currency)} hint={`Refunds ${fmt(t.cashRefunds)} · expenses ${fmt(t.expenses)}`} />
        <Tile label="Counted vs expected" value={fmt(t.counted)} hint={`expected ${fmt(t.expected)}`} />
        <Tile label="Total variance" value={fmt(t.variance, r.data.currency)} hint={`Pay-ins ${fmt(t.payIns)} · pay-outs ${fmt(t.payOuts)} · safe drops ${fmt(t.safeDrops)}`} />
      </div>
      <Panel title="Closed shifts" action={<Csv path={`/reports/cash?${q}`} />}>
        {r.data.shifts.length === 0 ? <p className="px-4 py-6 text-sm text-ink-3">No shifts were closed in this period.</p> : (
          <Table head={["Closed", "Branch", "Drawer", "Cashier", "Expected", "Counted", "Variance", "Status"]}>
            {r.data.shifts.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-1.5 text-ink-2">{new Date(s.closedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="px-4 py-1.5 text-ink-3">{s.branch}</td>
                <td className="px-4 py-1.5">{s.drawer}</td>
                <td className="px-4 py-1.5">{s.cashier}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmt(s.expectedCash)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmt(s.countedCash)}</td>
                <td className={cx("px-4 py-1.5 text-right tabular-nums", Number(s.variance) < 0 && "text-danger")}>{fmt(s.variance)}</td>
                <td className="px-4 py-1.5"><Badge tone={s.status === "PENDING_APPROVAL" ? "warn" : "neutral"}>{s.status === "PENDING_APPROVAL" ? "Needs approval" : s.status === "APPROVED" ? `Approved${s.approvedBy ? ` · ${s.approvedBy}` : ""}` : "Closed"}</Badge></td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

// ── utilization ─────────────────────────────────────────────────────────────

function UtilReport({ q }: { q: string }) {
  const r = useApi<Util>(`/reports/utilization?${q}`);
  if (r.error) return <ErrorNote>{r.error.message}</ErrorNote>;
  if (!r.data) return <Spinner />;
  const u = r.data;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  const stationTable = (rows: Station[]) => (
    <Table head={["Station", "Zone", "Sessions", "Hours", "Occupancy"]}>
      {rows.map((x) => <tr key={x.deviceId} className="border-t border-line"><td className="px-4 py-1.5">{x.name}</td><td className="px-4 py-1.5 text-ink-3">{x.branch} · {x.zone}</td><td className="px-4 py-1.5 text-right tabular-nums">{x.sessions}</td><td className="px-4 py-1.5 text-right tabular-nums">{x.hours}</td><td className="px-4 py-1.5 text-right tabular-nums">{pct(x.occupancyPct)}</td></tr>)}
    </Table>
  );
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Sessions" value={String(u.summary.sessions)} />
        <Tile label="Hours played" value={u.summary.hoursPlayed.toLocaleString()} hint={`${u.summary.stations} stations · ${u.days} days`} />
        <Tile label="Occupancy" value={pct(u.summary.occupancyPct)} hint="of all station-hours, round the clock" />
        <Tile label="Gaming revenue" value={fmt(u.summary.revenue, u.currency)} hint="excl. VAT" />
      </div>
      <Panel title="By zone" action={<Csv path={`/reports/utilization?${q}`} />}>
        <Table head={["Zone", "Stations", "Sessions", "Hours", "Occupancy", "Revenue", "Per station-day"]}>
          {u.zones.map((z) => (
            <tr key={z.zoneId} className="border-t border-line">
              <td className="px-4 py-1.5"><span className="text-ink-3">{z.branch} · </span>{z.zone}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{z.stations}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{z.sessions}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{z.hours}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{pct(z.occupancyPct)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(z.revenue)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-ink-2">{z.revenuePerStationDay === null ? "—" : fmt(z.revenuePerStationDay)}</td>
            </tr>
          ))}
        </Table>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Busiest stations">{stationTable(u.busiest)}</Panel>
        <Panel title="Quietest stations">{stationTable(u.idlest)}</Panel>
      </div>
      <Panel title="When people play — sessions started by weekday and hour">
        <Heatmap grid={u.heatmap} label="sessions" format={(v) => `${v} session${v === 1 ? "" : "s"}`} />
      </Panel>
    </div>
  );
}

// ── staff ───────────────────────────────────────────────────────────────────

/** Clock-in / clock-out per person at one branch (staff clock in from the top bar). */
function AttendanceReport({ branchId, from, to }: { branchId?: string; from: string; to: string }) {
  const r = useApi<Attendance>(branchId ? `/branches/${branchId}/attendance?${qs({ from, to })}` : null);
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (r.error) return <ErrorNote>{r.error.status === 400 ? "Pick at most two months at a time." : r.error.message}</ErrorNote>;
  if (!r.data) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <Panel title="Hours per person">
        {r.data.people.length === 0 ? <p className="px-4 py-6 text-sm text-ink-3">Nobody clocked in at this branch in this period. Staff clock in with the button at the top of the screen.</p> : (
          <Table head={["Employee", "Shifts", "Hours"]}>
            {r.data.people.map((p) => (
              <tr key={p.employee.id} className="border-t border-line">
                <td className="px-4 py-1.5">{p.employee.displayName}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{p.shifts}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{p.hours}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Panel title="Clock-ins">
        {r.data.entries.length === 0 ? <p className="px-4 py-6 text-sm text-ink-3">No clock-ins.</p> : (
          <Table head={["Day", "Employee", "In", "Out", "Hours"]}>
            {r.data.entries.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-4 py-1.5 tabular-nums">{e.day}</td>
                <td className="px-4 py-1.5">{e.employee.displayName}</td>
                <td className="px-4 py-1.5 tabular-nums">{time(e.clockInAt)}</td>
                <td className="px-4 py-1.5 tabular-nums">{e.clockOutAt ? time(e.clockOutAt) : <span className="text-ok">on shift</span>}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{e.hours}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

function StaffReport({ q }: { q: string }) {
  const r = useApi<Staff>(`/reports/staff?${q}`);
  if (r.error) return <ErrorNote>{r.error.message}</ErrorNote>;
  if (!r.data) return <Spinner />;
  return (
    <Panel title="Staff activity" action={<Csv path={`/reports/staff?${q}`} />}>
      {r.data.staff.length === 0 ? <p className="px-4 py-6 text-sm text-ink-3">No staff activity in this period.</p> : (
        <Table head={["Employee", "Orders", "Taken", "Refunds", "Voids", "Sessions", "Shifts", "Cash variance"]}>
          {r.data.staff.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="px-4 py-1.5">{s.name}<span className="ml-2 text-xs text-ink-3">{s.code}{s.branch ? ` · ${s.branch}` : ""}</span></td>
              <td className="px-4 py-1.5 text-right tabular-nums">{s.orders}<span className="block text-xs text-ink-3">{fmt(s.orderValue)}</span></td>
              <td className="px-4 py-1.5 text-right tabular-nums">{fmt(s.paid)}<span className="block text-xs text-ink-3">{s.payments} payments</span></td>
              <td className="px-4 py-1.5 text-right tabular-nums">{s.refunds ? <>{s.refunds}<span className="block text-xs text-ink-3">{fmt(s.refunded)}</span></> : "—"}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{s.voids ? <>{s.voids}<span className="block text-xs text-ink-3">{fmt(s.voided)}</span></> : "—"}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{s.sessions || "—"}</td>
              <td className="px-4 py-1.5 text-right tabular-nums">{s.shifts || "—"}</td>
              <td className={cx("px-4 py-1.5 text-right tabular-nums", Number(s.variance) < 0 && "text-danger")}>{s.shifts ? fmt(s.variance) : "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}
