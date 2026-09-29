"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, Ban, Building2, CalendarPlus, Cpu, Mail, PlayCircle, RotateCcw, Store, UsersRound, XCircle } from "lucide-react";
import { Badge, Button, Card, cx, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Skeleton, Table } from "@/components/ui";
import { ActivityList, OrgStatusBadge, SectionTitle, StatTile } from "@/components/platform";
import { ago, can, platformApi, usePlatform, type OrgDetail, type OrgStatus, type Plan } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";
import { useRouteId } from "@/lib/client/route-id";

const relDays = (iso: string) => {
  const d = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return d === 0 ? "today" : d > 0 ? `in ${d} day${d === 1 ? "" : "s"}` : `${-d} day${d === -1 ? "" : "s"} ago`;
};

type Tab = "overview" | "subscription" | "features" | "activity";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "subscription", label: "Subscription" },
  { id: "features", label: "Features" },
  { id: "activity", label: "Activity" },
];

function StatusDialog({ org, target, onClose, onDone }: { org: OrgDetail; target: OrgStatus | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = target === "SUSPENDED" || target === "CANCELLED";
  const copy: Partial<Record<OrgStatus, { title: string; text: string; cta: string; danger?: boolean }>> = {
    SUSPENDED: { title: `Suspend ${org.displayName}?`, text: "Every staff member is signed out now and can't sign in again until you reactivate. Stations keep running their current sessions.", cta: "Suspend", danger: true },
    CANCELLED: { title: `Cancel ${org.displayName}?`, text: "The organization is closed and its staff are signed out. Data is kept; you can reactivate later.", cta: "Cancel organization", danger: true },
    ACTIVE: { title: `Reactivate ${org.displayName}?`, text: "Staff can sign in again straight away.", cta: "Reactivate" },
  };
  const c = target ? copy[target] : null;
  const submit = async () => {
    if (!target) return;
    setPending(true);
    setError(null);
    try {
      await platformApi(`/organizations/${org.id}/status`, { method: "PATCH", body: { status: target, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      onDone();
      onClose();
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={!!target} onClose={onClose} title={c?.title ?? ""}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-sm text-ink-2">{c?.text}</p>
        <Field label={needsReason ? "Reason (required, kept in the audit log)" : "Note (optional)"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason} minLength={needsReason ? 3 : undefined} autoFocus placeholder={needsReason ? "e.g. Unpaid invoice INV-2026-0142" : ""} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Keep as is</Button>
          <Button type="submit" variant={c?.danger ? "danger" : "primary"} pending={pending}>{c?.cta}</Button>
        </div>
      </form>
    </Modal>
  );
}

function SubscriptionPanel({ org, onSaved, editable }: { org: OrgDetail; onSaved: () => void; editable: boolean }) {
  const sub = org.subscription;
  const plans = usePlatform<{ plans: Plan[] }>("/plans");
  const [f, setF] = useState(() => ({
    planId: sub?.plan.id ?? "",
    status: sub?.status ?? "ACTIVE",
    maxBranches: sub?.maxBranches?.toString() ?? "",
    maxDevices: sub?.maxDevices?.toString() ?? "",
    maxEmployees: sub?.maxEmployees?.toString() ?? "",
  }));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!sub) return <Empty icon={<Building2 />} title="No subscription on record." />;

  const limit = (v: string) => (v.trim() === "" ? null : Number(v));
  const send = async (body: Record<string, unknown>, key: string) => {
    setPending(key);
    setError(null);
    setSaved(false);
    try {
      await platformApi(`/organizations/${org.id}/subscription`, { method: "PATCH", body });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setPending(null);
    }
  };
  const plan = plans.data?.plans.find((p) => p.id === f.planId) ?? sub.plan;
  const inherit = (k: "maxBranches" | "maxDevices" | "maxEmployees") => `Plan: ${plan[k] ?? "unlimited"}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <SectionTitle>Plan & limits</SectionTitle>
        <form className="grid gap-4 p-5" onSubmit={(e) => { e.preventDefault(); void send({ planId: f.planId, status: f.status, maxBranches: limit(f.maxBranches), maxDevices: limit(f.maxDevices), maxEmployees: limit(f.maxEmployees) }, "save"); }}>
          <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan">
              <Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
                {(plans.data?.plans ?? [sub.plan as unknown as Plan]).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.currency} {Number(p.price).toFixed(0)}</option>)}
              </Select>
            </Field>
            <Field label="Subscription status">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
              </Select>
            </Field>
            <Field label="Max branches" hint={`Blank = ${inherit("maxBranches")}`}><Input type="number" min={0} value={f.maxBranches} onChange={(e) => setF({ ...f, maxBranches: e.target.value })} /></Field>
            <Field label="Max stations" hint={`Blank = ${inherit("maxDevices")}`}><Input type="number" min={0} value={f.maxDevices} onChange={(e) => setF({ ...f, maxDevices: e.target.value })} /></Field>
            <Field label="Max staff" hint={`Blank = ${inherit("maxEmployees")}`}><Input type="number" min={0} value={f.maxEmployees} onChange={(e) => setF({ ...f, maxEmployees: e.target.value })} /></Field>
          </fieldset>
          <ErrorNote>{error}</ErrorNote>
          {editable && (
            <div className="flex items-center justify-end gap-3">
              {saved && <span className="text-sm text-ok">Saved.</span>}
              <Button type="submit" variant="primary" pending={pending === "save"}>Save changes</Button>
            </div>
          )}
        </form>
      </Card>
      <Card>
        <SectionTitle>Billing period</SectionTitle>
        <div className="grid gap-4 p-5 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-ink-3">Started</dt><dd>{new Date(sub.currentPeriodStart).toLocaleDateString()}</dd>
            <dt className="text-ink-3">Renews / ends</dt><dd>{new Date(sub.currentPeriodEnd).toLocaleDateString()} <span className="text-ink-3">({relDays(sub.currentPeriodEnd)})</span></dd>
            <dt className="text-ink-3">Price</dt><dd>{sub.plan.currency} {Number(sub.plan.price).toFixed(2)} / {sub.plan.interval === "YEARLY" ? "year" : "month"}</dd>
          </dl>
          {editable && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Extend the period</p>
              <div className="flex flex-wrap gap-2">
                {[7, 14, 30, 90].map((d) => (
                  <Button key={d} size="sm" pending={pending === `ext${d}`} onClick={() => void send({ extendDays: d }, `ext${d}`)}>
                    <CalendarPlus className="size-3.5" /> +{d} days
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function FeaturesPanel({ org, onSaved, editable }: { org: OrgDetail; onSaved: () => void; editable: boolean }) {
  const [editing, setEditing] = useState<OrgDetail["features"][number] | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const override = async () => {
    if (!editing) return;
    setPending("save");
    setError(null);
    try {
      await platformApi(`/organizations/${org.id}/features/${editing.key}`, { method: "PUT", body: { enabled: !editing.enabled, reason: reason.trim() } });
      setEditing(null);
      setReason("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setPending(null);
    }
  };
  const reset = async (key: string) => {
    setPending(key);
    try {
      await platformApi(`/organizations/${org.id}/features/${key}`, { method: "DELETE" });
      onSaved();
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <SectionTitle>Modules</SectionTitle>
      <p className="border-b border-line px-5 py-3 text-xs text-ink-3">Modules come from the plan. An override turns one on or off for this organization only, and wins over the plan.</p>
      <ul className="divide-y divide-line">
        {org.features.map((f) => (
          <li key={f.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className={cx("size-2.5 shrink-0 rounded-full", f.enabled ? "bg-ok shadow-[0_0_8px_var(--color-ok)]" : "bg-offline")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{f.label}</p>
              <p className="font-mono text-[11px] text-ink-3">
                {f.key} · plan {f.plan ? "on" : "off"}
                {f.override && <span className="text-accent-2"> · override: {f.override.enabled ? "on" : "off"}{f.override.reason ? ` (“${f.override.reason}”)` : ""}</span>}
              </p>
            </div>
            <Badge tone={f.enabled ? "ok" : "neutral"}>{f.enabled ? "On" : "Off"}</Badge>
            {editable && (
              <div className="flex gap-1.5">
                {f.override && <Button size="sm" variant="ghost" pending={pending === f.key} onClick={() => void reset(f.key)} title="Back to the plan's setting"><RotateCcw className="size-3.5" /> Plan default</Button>}
                <Button size="sm" onClick={() => { setEditing(f); setReason(""); setError(null); }}>{f.enabled ? "Turn off" : "Turn on"}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `${editing.enabled ? "Turn off" : "Turn on"} ${editing.label}` : ""}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void override(); }}>
          <p className="text-sm text-ink-2">This applies to {org.displayName} only, whatever its plan says.</p>
          <Field label="Reason (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} autoFocus placeholder="e.g. Pilot for the diskless beta" /></Field>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" pending={pending === "save"}>Save override</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

export default function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const orgId = useRouteId(use(params).orgId);
  const me = usePlatformMe();
  const { data: org, error, reload } = usePlatform<OrgDetail>(`/organizations/${orgId}`);
  const [tab, setTab] = useState<Tab>("overview");
  const [target, setTarget] = useState<OrgStatus | null>(null);

  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (!org) return <Skeleton rows={8} />;

  const superAdmin = can(me.roles, "SUPER_ADMIN");
  const canStatus = can(me.roles, "SUPER_ADMIN", "PLATFORM_SUPPORT");
  const canBilling = can(me.roles, "SUPER_ADMIN", "PLATFORM_BILLING");
  const suspended = org.status === "SUSPENDED" || org.status === "CANCELLED";

  return (
    <>
      <Link href="/platform/organizations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4" /> Organizations</Link>
      <PageHeader
        eyebrow={org.slug}
        title={org.displayName}
        subtitle={<span className="flex flex-wrap items-center gap-2"><OrgStatusBadge status={org.status} /> {org.legalName} · {org.countryCode} · {org.defaultCurrency} · {org.defaultTimezone} · joined {new Date(org.createdAt).toLocaleDateString()}</span>}
        actions={
          canStatus && (
            <>
              {suspended ? (
                <Button variant="primary" onClick={() => setTarget("ACTIVE")}><PlayCircle className="size-4" /> Reactivate</Button>
              ) : (
                <Button variant="danger" onClick={() => setTarget("SUSPENDED")}><Ban className="size-4" /> Suspend</Button>
              )}
              {superAdmin && org.status !== "CANCELLED" && <Button variant="ghost" onClick={() => setTarget("CANCELLED")}><XCircle className="size-4" /> Cancel</Button>}
            </>
          )
        }
      />
      {org.status === "SUSPENDED" && (
        <p className="mb-5 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          Suspended {org.suspendedAt ? ago(org.suspendedAt) : ""}{org.suspendReason ? ` — “${org.suspendReason}”` : ""}. Staff can't sign in.
        </p>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx("relative whitespace-nowrap px-4 py-2.5 text-sm transition-colors", tab === t.id ? "font-medium text-ink" : "text-ink-3 hover:text-ink")}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-2 shadow-[0_0_10px_var(--color-accent-2)]" />}
          </button>
        ))}
      </div>

      <div key={tab} className="animate-enter">
        {tab === "overview" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Branches" icon={Store} value={org.counts.branches} sub={org.subscription ? `limit ${org.subscription.maxBranches ?? org.subscription.plan.maxBranches ?? "∞"}` : undefined} />
              <StatTile label="Stations" icon={Cpu} tone="accent-2" value={`${org.counts.online} / ${org.counts.devices}`} sub="online now / total" />
              <StatTile label="Staff" icon={UsersRound} value={org.counts.staff} sub={org.subscription ? `limit ${org.subscription.maxEmployees ?? org.subscription.plan.maxEmployees ?? "∞"}` : undefined} />
              <StatTile label="Customers" icon={UsersRound} tone="ok" value={org.counts.customers.toLocaleString()} sub={org.subscription ? `${org.subscription.plan.name} plan` : undefined} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <Card>
                <SectionTitle>Branches</SectionTitle>
                {org.branches.length === 0 ? (
                  <Empty icon={<Store />} title="No branches yet." >The owner adds them from the admin console.</Empty>
                ) : (
                  <Table head={["Branch", "Status", "Stations", "Time zone"]}>
                    {org.branches.map((b) => (
                      <tr key={b.id}>
                        <td className="px-4 py-3"><span className="font-medium">{b.name}</span><span className="ml-2 font-mono text-xs text-ink-3">{b.code}</span>{b.city && <span className="block text-xs text-ink-3">{b.city}</span>}</td>
                        <td className="px-4 py-3"><Badge tone={b.status === "OPEN" ? "ok" : b.status === "SETUP" ? "accent" : "neutral"}>{b.status.replace("_", " ").toLowerCase()}</Badge></td>
                        <td className="tabular px-4 py-3">{b.devices}</td>
                        <td className="px-4 py-3 text-ink-2">{b.timezone}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
              <Card>
                <SectionTitle>Owners & billing</SectionTitle>
                <ul className="divide-y divide-line">
                  {org.owners.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised font-display text-xs font-bold text-accent">{o.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.name}</p>
                        <p className="truncate text-xs text-ink-3">{o.email} · last sign-in {ago(o.lastLoginAt)}</p>
                      </div>
                      <Badge tone={o.status === "ACTIVE" ? "ok" : "neutral"}>{o.status.toLowerCase()}</Badge>
                    </li>
                  ))}
                  <li className="flex items-center gap-3 px-5 py-3 text-sm text-ink-2"><Mail className="size-4 text-ink-3" /> Billing: <span className="font-mono text-xs">{org.billingEmail}</span></li>
                </ul>
              </Card>
            </div>
          </>
        )}
        {tab === "subscription" && <SubscriptionPanel org={org} onSaved={() => void reload()} editable={canBilling} />}
        {tab === "features" && <FeaturesPanel org={org} onSaved={() => void reload()} editable={superAdmin} />}
        {tab === "activity" && (
          <Card>
            <SectionTitle>Recent activity</SectionTitle>
            <ActivityList rows={org.activity} showOrg={false} />
          </Card>
        )}
      </div>

      <StatusDialog org={org} target={target} onClose={() => setTarget(null)} onDone={() => void reload()} />
    </>
  );
}
