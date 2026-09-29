"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Archive, ArrowLeft, Car, Coffee, DoorClosed, Gamepad2, Glasses, Globe, Monitor, Pencil, Plus, Radio, Sparkles, Swords, Tv } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { STATUS_TONE, statusLabel, type Branch } from "@/lib/client/types";
import { useRouteId } from "@/lib/client/route-id";

const ZONE_TYPES = {
  PC_STANDARD: { label: "Regular PCs", icon: Monitor },
  PC_VIP: { label: "VIP PCs", icon: Sparkles },
  BOOTCAMP: { label: "Bootcamp", icon: Swords },
  STREAMING: { label: "Streaming", icon: Radio },
  CONSOLE: { label: "Consoles", icon: Gamepad2 },
  VR: { label: "VR", icon: Glasses },
  SIMULATOR: { label: "Simulators", icon: Car },
  INTERNET: { label: "Internet / office", icon: Globe },
  RESTAURANT: { label: "Restaurant", icon: Coffee },
  PRIVATE_ROOM: { label: "Private room", icon: DoorClosed },
  OTHER: { label: "Other", icon: Tv },
} as const;
type ZoneType = keyof typeof ZONE_TYPES;

interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  color: string | null;
  isActive: boolean;
  minAge: number | null;
  sortOrder: number;
  _count?: { devices: number };
}

function ZoneForm({ branchId, zone, onDone }: { branchId: string; zone?: Zone; onDone: () => void }) {
  const [name, setName] = useState(zone?.name ?? "");
  const [type, setType] = useState<ZoneType>(zone?.type ?? "PC_STANDARD");
  const [color, setColor] = useState(zone?.color ?? "#a07cff");
  const [minAge, setMinAge] = useState(zone?.minAge?.toString() ?? "");
  const save = useAction(async () => {
    const body = { name, type, color, minAge: minAge ? Number(minAge) : null };
    if (zone) await api(`/zones/${zone.id}`, { method: "PATCH", body, action: "Update zone" });
    else await api(`/branches/${branchId}/zones`, { method: "POST", body, action: "Create zone" });
    onDone();
  });
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <Field label="Name" className="sm:col-span-2">
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="VIP Arena" />
      </Field>
      <Field label="Type">
        <Select value={type} onChange={(e) => setType(e.target.value as ZoneType)}>
          {Object.entries(ZONE_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Minimum age" hint="Leave empty for none">
        <Input type="number" min={0} max={99} value={minAge} onChange={(e) => setMinAge(e.target.value)} />
      </Field>
      <Field label="Map colour">
        <div className="flex items-center gap-2">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-line-strong bg-bg" />
          <span className="font-mono text-xs text-ink-3">{color}</span>
        </div>
      </Field>
      <div className="sm:col-span-2">
        <ErrorNote>{save.error}</ErrorNote>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" pending={save.pending}>
          {zone ? "Save zone" : "Add zone"}
        </Button>
      </div>
    </form>
  );
}

function EditBranch({ branch, onDone }: { branch: Branch; onDone: () => void }) {
  const [form, setForm] = useState({ name: branch.name, city: branch.city ?? "", phone: branch.phone ?? "", status: branch.status });
  const save = useAction(async () => {
    await api(`/branches/${branch.id}`, { method: "PATCH", body: { ...form, city: form.city || null, phone: form.phone || null }, action: "Update branch" });
    onDone();
  });
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <Field label="Name" className="sm:col-span-2">
        <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="City">
        <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
      </Field>
      <Field label="Phone">
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field label="Status" className="sm:col-span-2">
        <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Branch["status"] })}>
          {["SETUP", "OPEN", "TEMPORARILY_CLOSED", "CLOSED"].map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <ErrorNote>{save.error}</ErrorNote>
      </div>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="primary" pending={save.pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

export default function BranchPage({ params }: { params: Promise<{ branchId: string }> }) {
  const branchId = useRouteId(use(params).branchId);
  const can = useCan();
  const branch = useApi<Branch>(`/branches/${branchId}`);
  const zones = useApi<Zone[]>(`/branches/${branchId}/zones`);
  const [modal, setModal] = useState<{ kind: "zone"; zone?: Zone } | { kind: "branch" } | null>(null);
  const archive = useAction(async (z: Zone) => {
    if (!confirm(`Archive zone "${z.name}"? Its history is kept.`)) return;
    await api(`/zones/${z.id}`, { method: "DELETE", action: "Archive zone" });
    await zones.reload();
  });

  if (branch.error) return <ErrorNote>{branch.error.message}</ErrorNote>;
  if (!branch.data) return <Spinner />;
  const b = branch.data;
  const manageZones = can("zone.manage", b.id);
  const active = zones.data?.filter((z) => z.isActive) ?? [];
  const archived = zones.data?.filter((z) => !z.isActive) ?? [];

  return (
    <>
      <Link href="/branches" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Branches
      </Link>
      <PageHeader
        title={b.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{b.code}</span>·<span>{b.city ?? "No city"}</span>·<span>{b.timezone}</span>·<span>{b.currency}</span>
            <Badge tone={STATUS_TONE[b.status]}>{statusLabel(b.status)}</Badge>
          </span>
        }
        actions={
          <>
            {can("branch.manage", b.id) && (
              <Button onClick={() => setModal({ kind: "branch" })}>
                <Pencil className="size-4" /> Edit branch
              </Button>
            )}
            {manageZones && (
              <Button variant="primary" onClick={() => setModal({ kind: "zone" })}>
                <Plus className="size-4" /> Add zone
              </Button>
            )}
          </>
        }
      />

      {zones.loading && !zones.data ? (
        <Spinner />
      ) : active.length === 0 ? (
        <Card>
          <Empty icon={<Monitor className="size-8" />} title="No zones yet">
            Zones like “Regular PCs”, “VIP”, “PS5 Lounge” or “VR” each get their own pricing, hours and booking rules.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((z) => {
            const T = ZONE_TYPES[z.type] ?? ZONE_TYPES.OTHER;
            return (
              <Card key={z.id} className="relative overflow-hidden p-5">
                <div className="absolute inset-y-0 left-0 w-1" style={{ background: z.color ?? "var(--color-line-strong)" }} aria-hidden />
                <div className="flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-lg border border-line-strong bg-panel-2">
                    <T.icon className="size-5" style={{ color: z.color ?? undefined }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{z.name}</p>
                    <p className="text-xs text-ink-3">{T.label}{z.minAge ? ` · ${z.minAge}+` : ""}</p>
                  </div>
                  {manageZones && (
                    <div className="flex gap-1">
                      <button onClick={() => setModal({ kind: "zone", zone: z })} className="rounded p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label={`Edit ${z.name}`}>
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => void archive.run(z)} className="rounded p-1.5 text-ink-3 hover:bg-panel-2 hover:text-danger" aria-label={`Archive ${z.name}`}>
                        <Archive className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <p className="tabular text-2xl font-semibold">{z._count?.devices ?? 0}</p>
                    <p className="text-xs text-ink-3">stations</p>
                  </div>
                  <span className="text-[11px] text-ink-3">Stations are added with the Windows client (phase 3)</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ErrorNote>{archive.error}</ErrorNote>
      {archived.length > 0 && <p className="mt-6 text-xs text-ink-3">{archived.length} archived zone(s) hidden.</p>}

      <Modal open={modal?.kind === "zone"} onClose={() => setModal(null)} title={modal?.kind === "zone" && modal.zone ? `Edit ${modal.zone.name}` : "Add zone"}>
        {modal?.kind === "zone" && (
          <ZoneForm
            branchId={b.id}
            zone={modal.zone}
            onDone={() => {
              setModal(null);
              void zones.reload();
            }}
          />
        )}
      </Modal>
      <Modal open={modal?.kind === "branch"} onClose={() => setModal(null)} title="Edit branch">
        {modal?.kind === "branch" && (
          <EditBranch
            branch={b}
            onDone={() => {
              setModal(null);
              void branch.reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}
