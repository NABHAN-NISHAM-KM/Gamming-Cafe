"use client";

import { useState } from "react";
import { Check, Pencil, Users } from "lucide-react";
import { Badge, Button, Card, cx, ErrorNote, Field, Input, Modal, PageHeader, Skeleton } from "@/components/ui";
import { SectionTitle } from "@/components/platform";
import { can, money, platformApi, usePlatform, type Plan } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

interface PlansResponse {
  catalog: Array<{ key: string; label: string }>;
  plans: Plan[];
}

function EditPlan({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = (k: keyof Plan) => (k in f ? f[k] : (plan?.[k] ?? "")) as string | boolean;
  const lim = (x: string | boolean) => (x === "" || x === null ? null : Number(x));

  const submit = async () => {
    if (!plan) return;
    setPending(true);
    setError(null);
    try {
      await platformApi(`/plans/${plan.id}`, {
        method: "PATCH",
        body: {
          name: String(v("name")),
          description: String(v("description") ?? "") || null,
          price: Number(v("price")),
          maxBranches: lim(v("maxBranches") as string),
          maxDevices: lim(v("maxDevices") as string),
          maxEmployees: lim(v("maxEmployees") as string),
          isActive: !!v("isActive"),
          isPublic: !!v("isPublic"),
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={!!plan} onClose={() => { setF({}); onClose(); }} title={plan ? `Edit ${plan.name}` : ""}>
      {plan && (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input required value={String(v("name"))} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={`Price (${plan.currency} / ${plan.interval === "YEARLY" ? "year" : "month"})`}><Input required type="number" min={0} step="0.01" value={String(Number(v("price")))} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          </div>
          <Field label="Description"><Input value={String(v("description") ?? "")} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            {(["maxBranches", "maxDevices", "maxEmployees"] as const).map((k) => (
              <Field key={k} label={{ maxBranches: "Branches", maxDevices: "Stations", maxEmployees: "Staff" }[k]} hint="Blank = unlimited">
                <Input type="number" min={0} value={v(k) === null ? "" : String(v(k))} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={!!v("isActive")} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Available for new sign-ups</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={!!v("isPublic")} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Shown on the pricing page</label>
          </div>
          <p className="text-xs text-ink-3">Price changes apply to new and renewing subscriptions. Current limits apply at once to every organization on this plan without its own override.</p>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => { setF({}); onClose(); }}>Cancel</Button>
            <Button type="submit" variant="primary" pending={pending}>Save plan</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function PlansPage() {
  const me = usePlatformMe();
  const { data, error, reload, setData } = usePlatform<PlansResponse>("/plans");
  const [editing, setEditing] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const canEdit = can(me.roles, "SUPER_ADMIN", "PLATFORM_BILLING");
  const canFeatures = can(me.roles, "SUPER_ADMIN");

  const toggle = async (plan: Plan, key: string) => {
    const next = !plan.features[key];
    setBusy(`${plan.id}:${key}`);
    setToggleError(null);
    // Optimistic: flip now, roll back if the server says no.
    setData((d) => d && { ...d, plans: d.plans.map((p) => (p.id === plan.id ? { ...p, features: { ...p.features, [key]: next } } : p)) });
    try {
      await platformApi(`/plans/${plan.id}/features/${key}`, { method: "PUT", body: { enabled: next } });
    } catch (e) {
      setToggleError(e instanceof Error ? e.message : "Couldn't change that.");
      void reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Platform" title="Plans & features" subtitle="What each subscription includes. Organization-level overrides live on the organization." />
      <ErrorNote>{error?.message ?? toggleError}</ErrorNote>
      {!data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {data.plans.map((p, i) => (
              <Card key={p.id} interactive className={cx("relative overflow-hidden p-6", i === 1 && "border-accent/50 shadow-glow")}>
                {i === 1 && <span className="absolute right-4 top-4"><Badge tone="accent">Most popular</Badge></span>}
                <p className="font-mono text-xs text-ink-3">{p.code}</p>
                <h2 className="mt-1 text-xl font-semibold">{p.name}</h2>
                <p className="mt-3 font-display text-4xl font-semibold">
                  {money(p.price, p.currency)}<span className="text-sm font-normal text-ink-3"> / {p.interval === "YEARLY" ? "yr" : "mo"}</span>
                </p>
                {p.description && <p className="mt-2 text-sm text-ink-2">{p.description}</p>}
                <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
                  {([["Branches", p.maxBranches], ["Stations", p.maxDevices], ["Staff", p.maxEmployees]] as const).map(([k, n]) => (
                    <div key={k} className="rounded-lg border border-line bg-panel-2 p-2">
                      <dd className="tabular font-display text-lg font-semibold">{n ?? "∞"}</dd>
                      <dt className="text-[11px] text-ink-3">{k}</dt>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-ink-2"><Users className="size-4 text-accent-2" /> {p.subscribers} subscriber{p.subscribers === 1 ? "" : "s"}</span>
                  <span className="flex gap-1.5">
                    {!p.isActive && <Badge tone="danger">retired</Badge>}
                    {!p.isPublic && <Badge>private</Badge>}
                  </span>
                </div>
                {canEdit && <Button className="mt-5 w-full" onClick={() => setEditing(p)}><Pencil className="size-3.5" /> Edit plan</Button>}
              </Card>
            ))}
          </div>

          <Card className="mt-6">
            <SectionTitle>Modules by plan</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-3">
                    <th className="px-5 py-3 font-medium">Module</th>
                    {data.plans.map((p) => <th key={p.id} className="px-4 py-3 text-center font-medium">{p.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.catalog.map((f) => (
                    <tr key={f.key} className="transition-colors hover:bg-panel-2/60">
                      <td className="px-5 py-2.5">
                        <span className="font-medium">{f.label}</span>
                        <span className="ml-2 font-mono text-[11px] text-ink-3">{f.key}</span>
                      </td>
                      {data.plans.map((p) => {
                        const on = p.features[f.key];
                        return (
                          <td key={p.id} className="px-4 py-2.5 text-center">
                            <button
                              disabled={!canFeatures || busy === `${p.id}:${f.key}`}
                              onClick={() => void toggle(p, f.key)}
                              role="switch"
                              aria-checked={on}
                              aria-label={`${f.label} in ${p.name}`}
                              className={cx("press inline-grid size-7 place-items-center rounded-lg border transition-colors disabled:cursor-default", on ? "border-ok/50 bg-ok/15 text-ok" : "border-line-strong text-transparent", canFeatures && "hover:border-accent")}
                            >
                              <Check className="size-4" />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <EditPlan plan={editing} onClose={() => setEditing(null)} onSaved={() => void reload()} />
    </>
  );
}
