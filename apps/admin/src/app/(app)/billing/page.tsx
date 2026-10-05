"use client";

import { useEffect, useState } from "react";
import { CreditCard, Rocket } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, Table, cx, toast } from "@/components/ui";

interface Billing {
  subscription: { status: string; plan: { id: string; code: string; name: string; price: string; currency: string; interval: string }; periodEnd: string; cancelAtPeriodEnd: boolean } | null;
  plans: Array<{ id: string; code: string; name: string; price: string; currency: string; interval: string; maxBranches: number | null; maxDevices: number | null; maxEmployees: number | null }>;
  invoices: Array<{ id: string; number: string; amount: string; currency: string; status: string; periodStart: string; periodEnd: string; dueAt: string; paidAt: string | null }>;
  cardPayments: boolean;
}
interface Usage {
  status: string | null;
  branches: Row;
  stations: Row;
  staff: Row;
}
type Row = { used: number; max: number | null; pct: number | null; near: boolean; full: boolean };

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "accent" | "neutral"> = { ACTIVE: "ok", TRIALING: "accent", PAST_DUE: "danger", CANCELLED: "neutral", EXPIRED: "neutral" };
const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const lim = (n: number | null) => (n == null ? "Unlimited" : String(n));

/** Your ArenaOS plan: what you use against its limits, paying by card, invoices, and asking for a bigger plan. */
export default function BillingPage() {
  const billing = useApi<Billing>("/billing");
  const usage = useApi<Usage>("/organization/usage");
  const [note, setNote] = useState("");

  useEffect(() => {
    const paid = new URLSearchParams(window.location.search).get("paid");
    if (paid) toast("Thanks — your payment is being confirmed. This page updates in a moment.");
  }, []);

  const pay = useAction(async (path: string, body?: unknown) => {
    const r = await api<{ url: string }>(path, { method: "POST", body: body ?? {} });
    window.location.assign(r.url);
  });
  const ask = useAction(async (plan: string | null) => {
    await api("/organization/upgrade-request", { method: "POST", body: { plan, note: note.trim() || null }, done: "Sent — the ArenaOS team will get in touch." });
    setNote("");
  });

  const sub = billing.data?.subscription;
  const open = billing.data?.invoices.filter((i) => i.status === "OPEN") ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Billing" subtitle="Your ArenaOS plan, how much of it you use, and your invoices." />
      <ErrorNote>{pay.error ?? ask.error}</ErrorNote>
      {!billing.data ? <Spinner /> : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Card className="p-5">
              <h2 className="flex items-center gap-2 font-semibold"><CreditCard className="size-4 text-accent" /> Your plan</h2>
              {sub ? (
                <>
                  <p className="mt-3 font-display text-2xl font-bold">{sub.plan.name} <Badge tone={STATUS_TONE[sub.status] ?? "neutral"}>{sub.status === "TRIALING" ? "free trial" : sub.status.toLowerCase().replace("_", " ")}</Badge></p>
                  <p className="text-sm text-ink-2">{sub.plan.price} {sub.plan.currency} / {sub.plan.interval === "YEARLY" ? "year" : "month"} · {sub.status === "TRIALING" ? "trial ends" : "renews"} {date(sub.periodEnd)}</p>
                  {sub.status === "PAST_DUE" && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">An invoice is overdue. Pay it below to keep everything running.</p>}
                </>
              ) : <p className="mt-3 text-sm text-ink-3">No subscription found.</p>}
              {open.map((i) => (
                <div key={i.id} className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-reserved/40 bg-reserved/5 px-4 py-3">
                  <span className="text-sm">Invoice <b>{i.number}</b> · {i.amount} {i.currency} · due {date(i.dueAt)}</span>
                  {billing.data!.cardPayments ? <Button size="sm" pending={pay.pending} onClick={() => void pay.run(`/billing/invoices/${i.id}/pay`)}>Pay by card</Button> : <span className="text-xs text-ink-3">ArenaOS will send payment details.</span>}
                </div>
              ))}
            </Card>
            {usage.data && (
              <Card className="p-5">
                <h2 className="font-semibold">What you use</h2>
                {(["branches", "stations", "staff"] as const).map((k) => {
                  const r = usage.data![k];
                  return (
                    <div key={k} className="mt-3">
                      <div className="flex justify-between text-sm"><span className="capitalize">{k}</span><span className={cx("tabular-nums", r.full ? "text-danger" : r.near ? "text-reserved" : "text-ink-2")}>{r.used} / {lim(r.max)}</span></div>
                      {r.max != null && <div className="mt-1 h-1.5 rounded-full bg-panel-2"><div className={cx("h-1.5 rounded-full", r.full ? "bg-danger" : r.near ? "bg-reserved" : "bg-accent")} style={{ width: `${Math.min(100, r.pct ?? 0)}%` }} /></div>}
                    </div>
                  );
                })}
                {(usage.data.branches.near || usage.data.stations.near || usage.data.staff.near) && <p className="mt-4 text-sm text-reserved">You're close to your plan's limits — choose a bigger plan below, or ask us.</p>}
              </Card>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {billing.data.plans.map((p) => {
              const current = sub?.plan.id === p.id;
              return (
                <Card key={p.id} className={cx("p-5", current && "border-accent/60")}>
                  <p className="font-display text-lg font-bold">{p.name} {current && <Badge tone="accent">current</Badge>}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{p.price} <span className="text-sm font-normal text-ink-3">{p.currency} / {p.interval === "YEARLY" ? "year" : "month"}</span></p>
                  <p className="mt-2 text-sm text-ink-2">{lim(p.maxBranches)} branches · {lim(p.maxDevices)} stations · {lim(p.maxEmployees)} staff</p>
                  {(!current || sub?.status === "TRIALING" || sub?.status === "PAST_DUE") && (
                    billing.data!.cardPayments
                      ? <Button className="mt-4" variant={current ? "primary" : "secondary"} pending={pay.pending} onClick={() => void pay.run("/billing/plan", { planId: p.id })}>{current ? "Pay and keep this plan" : `Switch to ${p.name}`}</Button>
                      : <Button className="mt-4" variant="secondary" pending={ask.pending} onClick={() => void ask.run(p.code)}>Ask for {p.name}</Button>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Rocket className="size-4 text-accent" /> Need more?</h2>
            <p className="mt-1 text-sm text-ink-2">More branches, stations or staff than any plan here? Tell us what you need and the ArenaOS team will get back to you.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="What do you need?" className="min-w-72 flex-1"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. A second branch with 60 PCs in March" /></Field>
              <Button variant="secondary" pending={ask.pending} onClick={() => void ask.run(null)}>Send</Button>
            </div>
          </Card>

          <Card>
            <h2 className="p-5 pb-3 font-semibold">Invoices</h2>
            {billing.data.invoices.length === 0 ? <p className="px-5 pb-5 text-sm text-ink-3">No invoices yet.</p> : (
              <Table head={["Invoice", "Period", "Amount", "Status", "Paid"]}>
                {billing.data.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">{i.number}</td>
                    <td className="px-4 py-2 text-ink-2">{date(i.periodStart)} – {date(i.periodEnd)}</td>
                    <td className="px-4 py-2 tabular-nums">{i.amount} {i.currency}</td>
                    <td className="px-4 py-2"><Badge tone={i.status === "PAID" ? "ok" : i.status === "OPEN" ? "warn" : "neutral"}>{i.status.toLowerCase()}</Badge></td>
                    <td className="px-4 py-2 text-ink-3">{i.paidAt ? date(i.paidAt) : "—"}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
