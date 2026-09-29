"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useEffect, useState } from "react";
import { Building2, Check, Copy, Plus, Search } from "lucide-react";
import { Button, Card, cx, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Skeleton, Table } from "@/components/ui";
import { OrgStatusBadge } from "@/components/platform";
import { ago, can, platformApi, usePlatform, type OrgRow, type OrgStatus, type Plan } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

const FILTERS: Array<{ id: OrgStatus | ""; label: string }> = [
  { id: "", label: "All" },
  { id: "ACTIVE", label: "Active" },
  { id: "TRIAL", label: "Trial" },
  { id: "PAST_DUE", label: "Past due" },
  { id: "SUSPENDED", label: "Suspended" },
  { id: "CANCELLED", label: "Cancelled" },
];
const COUNTRIES = [["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["QA", "Qatar"], ["KW", "Kuwait"], ["BH", "Bahrain"], ["OM", "Oman"], ["IN", "India"], ["GB", "United Kingdom"], ["US", "United States"]];
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

interface Created {
  organization: { id: string; slug: string; displayName: string };
  owner: { email: string; existingAccount: boolean; tempPassword: string | null };
}

function CreateOrg({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const plans = usePlatform<{ plans: Plan[] }>(open ? "/plans" : null);
  const [f, setF] = useState({ displayName: "", slug: "", countryCode: "AE", planId: "", trialDays: "14", ownerName: "", ownerEmail: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!f.planId && plans.data?.plans.length) setF((x) => ({ ...x, planId: plans.data!.plans.find((p) => p.isActive)?.id ?? "" }));
  }, [plans.data, f.planId]);
  useEffect(() => {
    if (!open) {
      setDone(null);
      setError(null);
      setCopied(false);
      setSlugTouched(false);
      setF({ displayName: "", slug: "", countryCode: "AE", planId: "", trialDays: "14", ownerName: "", ownerEmail: "" });
    }
  }, [open]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === "displayName" && !slugTouched ? { slug: slugify(e.target.value) } : {}) }));

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const r = await platformApi<Created>("/organizations", { method: "POST", body: { ...f, trialDays: Number(f.trialDays) } });
      setDone(r);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the organization.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={done ? "Organization created" : "New organization"} wide>
      {done ? (
        <div className="grid gap-4">
          <p className="flex items-center gap-2 text-ok"><Check className="size-5" /> <strong>{done.organization.displayName}</strong> is ready.</p>
          {done.owner.tempPassword ? (
            <div className="rounded-xl border border-reserved/40 bg-reserved/10 p-4 text-sm">
              <p className="font-medium text-reserved">Give the owner these sign-in details. The password is shown only once.</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-ink-3">Sign in at</dt><dd className="font-mono">/login</dd>
                <dt className="text-ink-3">Email</dt><dd className="font-mono">{done.owner.email}</dd>
                <dt className="text-ink-3">Temporary password</dt><dd className="font-mono">{done.owner.tempPassword}</dd>
              </dl>
              <Button size="sm" className="mt-3" onClick={() => void navigator.clipboard.writeText(`${done.owner.email}\n${done.owner.tempPassword}`).then(() => setCopied(true))}>
                <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
              </Button>
              <p className="mt-3 text-xs text-ink-3">They'll be asked to set up two-step sign-in.</p>
            </div>
          ) : (
            <p className="text-sm text-ink-2"><span className="font-mono">{done.owner.email}</span> already had an ArenaOS account and is now the owner. They sign in with their existing password.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Close</Button>
            <Link href={`/platform/organizations/${done.organization.id}`}><Button variant="primary">Open organization</Button></Link>
          </div>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Venue name"><Input required value={f.displayName} onChange={set("displayName")} placeholder="Pixel Arena" autoFocus /></Field>
            <Field label="Slug" hint="Used in the customer app link. Can't be changed later.">
              <Input required value={f.slug} onChange={(e) => { setSlugTouched(true); setF((x) => ({ ...x, slug: e.target.value.toLowerCase() })); }} pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" className="font-mono" />
            </Field>
            <Field label="Country"><Select value={f.countryCode} onChange={set("countryCode")}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select></Field>
            <Field label="Plan">
              <Select value={f.planId} onChange={set("planId")} required>
                {plans.data?.plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.currency} {Number(p.price).toFixed(0)}/{p.interval === "YEARLY" ? "yr" : "mo"}</option>)}
              </Select>
            </Field>
            <Field label="Free trial" hint="0 = start as a paying customer.">
              <Select value={f.trialDays} onChange={set("trialDays")}>{["0", "7", "14", "30"].map((d) => <option key={d} value={d}>{d === "0" ? "No trial" : `${d} days`}</option>)}</Select>
            </Field>
          </div>
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <Field label="Owner name"><Input required value={f.ownerName} onChange={set("ownerName")} autoComplete="off" /></Field>
            <Field label="Owner email"><Input required type="email" value={f.ownerEmail} onChange={set("ownerEmail")} autoComplete="off" /></Field>
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" pending={pending}>Create organization</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Organizations() {
  const me = usePlatformMe();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrgStatus | "">("");
  const dq = useDeferredValue(q.trim());
  const qs = new URLSearchParams({ ...(dq ? { q: dq } : {}), ...(status ? { status } : {}) }).toString();
  const { data, error, reload } = usePlatform<OrgRow[]>(`/organizations${qs ? `?${qs}` : ""}`);
  const creating = params.get("new") === "1" && can(me.roles, "SUPER_ADMIN");

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Organizations"
        subtitle="Every venue operator on ArenaOS."
        actions={can(me.roles, "SUPER_ADMIN") && <Button variant="primary" onClick={() => router.push("/platform/organizations?new=1")}><Plus className="size-4" /> New organization</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <label className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, slug or billing email" className="pl-9" aria-label="Search organizations" />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {FILTERS.map((x) => (
              <button
                key={x.id}
                onClick={() => setStatus(x.id)}
                aria-pressed={status === x.id}
                className={cx("press rounded-full border px-3 py-1.5 text-xs font-medium", status === x.id ? "border-accent bg-accent text-accent-ink" : "border-line-strong text-ink-2 hover:text-ink")}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <ErrorNote>{error?.message}</ErrorNote>
        {!data ? (
          <Skeleton rows={6} />
        ) : data.length === 0 ? (
          <Empty icon={<Building2 />} title={dq || status ? "No organizations match." : "No organizations yet."} />
        ) : (
          <Table head={["Organization", "Status", "Plan", "Branches", "Stations", "Staff", "Customers", "Joined"]}>
            {data.map((o) => (
              <tr key={o.id} className="cursor-pointer" onClick={() => router.push(`/platform/organizations/${o.id}`)}>
                <td className="px-4 py-3">
                  <Link href={`/platform/organizations/${o.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised font-display text-sm font-bold text-accent">{o.displayName.slice(0, 1)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium hover:text-accent">{o.displayName}</span>
                      <span className="block truncate font-mono text-xs text-ink-3">{o.slug} · {o.countryCode}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3"><OrgStatusBadge status={o.status} /></td>
                <td className="px-4 py-3 text-ink-2">{o.subscription ? <>{o.subscription.plan.name}<span className="block text-xs text-ink-3">{o.subscription.status.toLowerCase()} · until {new Date(o.subscription.currentPeriodEnd).toLocaleDateString()}</span></> : "—"}</td>
                <td className="tabular px-4 py-3">{o.counts.branches}</td>
                <td className="tabular px-4 py-3">
                  {o.counts.devices}
                  {o.counts.online > 0 && <span className="ml-1.5 text-xs text-ok">{o.counts.online} online</span>}
                </td>
                <td className="tabular px-4 py-3">{o.counts.staff}</td>
                <td className="tabular px-4 py-3">{o.counts.customers}</td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-3">{ago(o.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <CreateOrg open={creating} onClose={() => router.replace("/platform/organizations")} onCreated={() => void reload()} />
    </>
  );
}

export default function OrganizationsPage() {
  return (
    <Suspense>
      <Organizations />
    </Suspense>
  );
}
