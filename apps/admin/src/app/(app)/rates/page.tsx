"use client";

import { useState } from "react";
import { Moon, Plus, Tag } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useCanOrg, useMe } from "@/lib/client/me";
import type { Branch } from "@/lib/client/types";
import { RecordActions } from "@/components/records";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";

interface Pkg {
  id: string;
  name: string;
  durationMinutes: number;
  price: string;
  bonusMinutes: number;
  isActive: boolean;
}
interface Plan {
  id: string;
  name: string;
  stationClass: string;
  billingMode: string;
  paymentTiming: string;
  rate: string;
  currency: string;
  priority: number;
  isActive: boolean;
  schedule: Array<{ days: string[]; from: string; to: string }>;
  passStartTime: string | null;
  passEndTime: string | null;
  branchId: string | null;
  branch: { code: string; name: string } | null;
  zone: { name: string } | null;
  minMinutes: number;
  roundingMinutes: number;
  pricingPackages: Pkg[];
}

const MODE: Record<string, string> = { PER_HOUR: "per hour", PER_MINUTE: "per minute", NIGHT_PASS: "night pass", DAY_PASS: "day pass", FIXED_DURATION: "fixed", PACKAGE: "packages" };
const CLASS: Record<string, string> = { PC: "PCs", CONSOLE: "Consoles", VR: "VR", SIMULATOR: "Simulators", INTERNET: "Internet PCs", PRIVATE_ROOM: "Private rooms" };
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function NewPlan({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const can = useCan();
  const branches = useApi<Branch[]>("/branches");
  const [f, setF] = useState({ name: "", stationClass: "PC", billingMode: "PER_HOUR", paymentTiming: "PREPAID", rate: "", branchId: "", zoneId: "", priority: 0, passStart: "00:00", passEnd: "06:00", happy: false, days: ["mon", "tue", "wed", "thu"], from: "14:00", to: "18:00", includedPlayers: "2", extraPlayerRate: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const isPass = f.billingMode === "NIGHT_PASS" || f.billingMode === "DAY_PASS";
  const zones = useApi<Array<{ id: string; name: string }>>(f.branchId && can("zone.view", f.branchId) ? `/branches/${f.branchId}/zones` : null);
  const save = useAction(async () => {
    await api("/pricing-plans", {
      method: "POST",
      action: "Create rate",
      body: {
        name: f.name, stationClass: f.stationClass, billingMode: f.billingMode, paymentTiming: isPass ? "PREPAID" : f.paymentTiming, rate: f.rate,
        branchId: f.branchId || null, zoneId: (f.branchId && f.zoneId) || null, priority: Number(f.priority),
        ...(isPass ? { passStartTime: f.passStart, passEndTime: f.passEnd } : {}),
        schedule: f.happy ? [{ days: f.days, from: f.from, to: f.to }] : [],
        ...(f.paymentTiming === "POSTPAID" ? { roundingMinutes: 15, graceMinutes: 3 } : {}),
        ...(f.stationClass === "CONSOLE" && f.extraPlayerRate ? { includedPlayers: Number(f.includedPlayers) || 1, extraPlayerRate: f.extraPlayerRate } : {}),
      },
    });
    onDone();
  });
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2">
        <Input required value={f.name} onChange={set("name")} placeholder="Weekend VIP" />
      </Field>
      <Field label="For">
        <Select value={f.stationClass} onChange={set("stationClass")}>
          {Object.entries(CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="Charged">
        <Select value={f.billingMode} onChange={set("billingMode")}>
          <option value="PER_HOUR">Per hour</option>
          <option value="PER_MINUTE">Per minute</option>
          <option value="NIGHT_PASS">Night pass (flat)</option>
          <option value="DAY_PASS">Day pass (flat)</option>
        </Select>
      </Field>
      <Field label={`Price (${me.organization.defaultCurrency})`} hint={isPass ? "Flat price for the pass" : f.billingMode === "PER_HOUR" ? "Per hour" : "Per minute"}>
        <Input required inputMode="decimal" value={f.rate} onChange={set("rate")} placeholder="15" />
      </Field>
      {!isPass && (
        <Field label="Paid">
          <Select value={f.paymentTiming} onChange={set("paymentTiming")}>
            <option value="PREPAID">Up front</option>
            <option value="POSTPAID">At the end (open session)</option>
          </Select>
        </Field>
      )}
      {f.stationClass === "CONSOLE" && !isPass && (
        <>
          <Field label="Players included" hint="Controllers the price covers">
            <Input type="number" min={1} max={16} value={f.includedPlayers} onChange={set("includedPlayers")} />
          </Field>
          <Field label={`Each extra player (${me.organization.defaultCurrency})`} hint={`${f.billingMode === "PER_MINUTE" ? "Per minute" : "Per hour"} · blank = no charge`}>
            <Input inputMode="decimal" value={f.extraPlayerRate} onChange={set("extraPlayerRate")} placeholder="5" />
          </Field>
        </>
      )}
      <Field label="Applies to">
        <Select value={f.branchId} onChange={(e) => setF((x) => ({ ...x, branchId: e.target.value, zoneId: "" }))}>
          <option value="">All branches</option>
          {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </Select>
      </Field>
      {f.branchId && (
        <Field label="Zone" hint="A zone rate wins over the branch rate (e.g. VIP)">
          <Select value={f.zoneId} onChange={set("zoneId")}>
            <option value="">Whole branch</option>
            {zones.data?.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </Select>
        </Field>
      )}
      {isPass ? (
        <>
          <Field label="Pass starts"><Input type="time" value={f.passStart} onChange={set("passStart")} /></Field>
          <Field label="Pass ends"><Input type="time" value={f.passEnd} onChange={set("passEnd")} /></Field>
        </>
      ) : (
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.happy} onChange={(e) => setF((x) => ({ ...x, happy: e.target.checked, priority: e.target.checked ? 10 : 0 }))} />
            Only at certain times (happy hour, weekends…)
          </label>
          {f.happy && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d) => (
                  <button key={d} type="button" onClick={() => setF((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d] }))}
                    className={`rounded border px-2 py-1 text-xs capitalize ${f.days.includes(d) ? "border-accent bg-accent/15 text-accent" : "border-line-strong text-ink-3"}`}>
                    {d}
                  </button>
                ))}
              </div>
              <Input type="time" value={f.from} onChange={set("from")} />
              <Input type="time" value={f.to} onChange={set("to")} />
            </div>
          )}
        </div>
      )}
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="primary" pending={save.pending}>Create rate</Button>
      </div>
    </form>
  );
}

function EditPlan({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const [f, setF] = useState({ name: plan.name, rate: String(Number(plan.rate)), priority: String(plan.priority) });
  const save = useAction(async () => {
    await api(`/pricing-plans/${plan.id}`, { method: "PATCH", action: "Edit rate", body: { name: f.name.trim(), rate: f.rate, priority: Number(f.priority) || 0 } });
    onDone();
  });
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
      <Field label={`Rate (${plan.currency} ${MODE[plan.billingMode]})`}><Input required inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
      <Field label="Priority" hint="Higher wins when rates overlap"><Input type="number" min={-100} max={100} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>Save</Button></div>
    </form>
  );
}

function AddPackage({ plan, pkg, onDone }: { plan: Plan; pkg?: Pkg; onDone: () => void }) {
  const [f, setF] = useState(pkg ? { name: pkg.name, hours: String(pkg.durationMinutes / 60), price: String(Number(pkg.price)), bonus: String(pkg.bonusMinutes) } : { name: "", hours: "3", price: "", bonus: "0" });
  const save = useAction(async () => {
    const body = { name: f.name || `${f.hours} hours`, durationMinutes: Math.round(Number(f.hours) * 60), price: f.price, bonusMinutes: Number(f.bonus) };
    await api(`/pricing-plans/${plan.id}/packages${pkg ? `/${pkg.id}` : ""}`, { method: pkg ? "PATCH" : "POST", action: pkg ? "Edit package" : "Add package", body });
    onDone();
  });
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Hours"><Input required inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
      <Field label={`Price (${plan.currency})`}><Input required inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="40" /></Field>
      <Field label="Bonus minutes"><Input inputMode="numeric" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} /></Field>
      <Field label="Name (optional)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={`${f.hours} hours`} /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>{pkg ? "Save" : "Add package"}</Button></div>
    </form>
  );
}

export default function RatesPage() {
  const can = useCan();
  const plans = useApi<Plan[]>("/pricing-plans");
  const [modal, setModal] = useState<{ kind: "plan" } | { kind: "edit"; plan: Plan } | { kind: "pkg"; plan: Plan; pkg?: Pkg } | null>(null);
  const toggle = useAction(async (p: Plan) => {
    await api(`/pricing-plans/${p.id}`, { method: "PATCH", action: p.isActive ? "Disable rate" : "Enable rate", body: { isActive: !p.isActive } });
    await plans.reload();
  });
  const groups = Object.entries(CLASS).map(([k, label]) => ({ k, label, items: (plans.data ?? []).filter((p) => p.stationClass === k) })).filter((g) => g.items.length);
  const manage = can("pricing.manage");
  const canOrg = useCanOrg();
  // Branch/zone rates are checked against their branch; "All branches" rates need organization-wide access.
  const mayEdit = (p: Plan) => (p.branchId ? can("pricing.manage", p.branchId) : canOrg("pricing.manage"));

  return (
    <>
      <PageHeader
        title="Rates"
        subtitle="What gaming time costs. The most specific rate wins: zone over branch over all branches, then time-limited offers by priority."
        actions={manage && <Button variant="primary" onClick={() => setModal({ kind: "plan" })}><Plus className="size-4" /> New rate</Button>}
      />
      <ErrorNote>{toggle.error}</ErrorNote>
      {!plans.data ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <Card><Empty icon={<Tag className="size-8" />} title="No rates yet">Create a rate so staff can start sessions.</Empty></Card>
      ) : (
        <div className="grid gap-6">
          {groups.map((g) => (
            <section key={g.k}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{g.label}</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {g.items.map((p) => (
                  <Card key={p.id} className={`p-5 ${p.isActive ? "" : "opacity-50"}`}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {p.billingMode === "NIGHT_PASS" && <Moon className="size-4 text-maint" />}
                          {p.name}
                          {p.paymentTiming === "POSTPAID" && <Badge tone="warn">pay later</Badge>}
                          {p.schedule.length > 0 && <Badge tone="accent">{p.schedule.map((w) => `${w.days.join(" ")} ${w.from}–${w.to}`).join(", ")}</Badge>}
                          {!p.isActive && <Badge>disabled</Badge>}
                        </p>
                        <p className="text-xs text-ink-3">
                          {p.zone ? `Zone ${p.zone.name}` : p.branch ? `${p.branch.code} only` : "All branches"}
                          {p.billingMode.endsWith("PASS") && ` · ${p.passStartTime}–${p.passEndTime}`}
                        </p>
                      </div>
                      <RecordActions kind="pricing-plan" id={p.id} name={p.name} onEdit={() => setModal({ kind: "edit", plan: p })} onDone={() => void plans.reload()} />
                      <p className="text-right">
                        <span className="tabular text-xl font-semibold">{p.currency} {Number(p.rate).toFixed(2)}</span>
                        <span className="block text-xs text-ink-3">{MODE[p.billingMode]}</span>
                      </p>
                    </div>
                    {p.pricingPackages.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {p.pricingPackages.map((k) => (
                          <span key={k.id} className="inline-flex items-center gap-1 rounded-md border border-line-strong py-1 pl-2 pr-1 text-xs">
                            <span>{k.name} · <span className="tabular">{p.currency} {Number(k.price).toFixed(2)}</span>{k.bonusMinutes > 0 && <span className="text-ok"> +{k.bonusMinutes}m</span>}</span>
                            <RecordActions kind="pricing-package" id={k.id} name={k.name} onEdit={() => setModal({ kind: "pkg", plan: p, pkg: k })} onDone={() => void plans.reload()} />
                          </span>
                        ))}
                      </div>
                    )}
                    {mayEdit(p) && (
                      <div className="mt-4 flex gap-2">
                        {["PER_HOUR", "PER_MINUTE"].includes(p.billingMode) && p.paymentTiming === "PREPAID" && (
                          <Button size="sm" onClick={() => setModal({ kind: "pkg", plan: p })}><Plus className="size-3.5" /> Package</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void toggle.run(p)}>{p.isActive ? "Disable" : "Enable"}</Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={modal?.kind === "plan"} onClose={() => setModal(null)} title="New rate" wide>
        {modal?.kind === "plan" && <NewPlan onDone={() => { setModal(null); void plans.reload(); }} />}
      </Modal>
      <Modal open={modal?.kind === "pkg"} onClose={() => setModal(null)} title={modal?.kind === "pkg" ? `${modal.pkg ? "Edit package" : "Package"} for ${modal.plan.name}` : ""}>
        {modal?.kind === "pkg" && <AddPackage plan={modal.plan} pkg={modal.pkg} onDone={() => { setModal(null); void plans.reload(); }} />}
      </Modal>
      <Modal open={modal?.kind === "edit"} onClose={() => setModal(null)} title={modal?.kind === "edit" ? `Edit ${modal.plan.name}` : ""}>
        {modal?.kind === "edit" && <EditPlan plan={modal.plan} onDone={() => { setModal(null); void plans.reload(); }} />}
      </Modal>
    </>
  );
}
