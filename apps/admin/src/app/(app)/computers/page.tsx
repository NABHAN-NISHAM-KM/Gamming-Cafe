"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Copy, Cpu, KeyRound, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useBranch } from "@/lib/client/branch";
import { useCan } from "@/lib/client/me";
import { STATUS, ago, fmtTemp, type FloorDevice } from "@/lib/client/floor";
import type { Branch } from "@/lib/client/types";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table } from "@/components/ui";

interface Zone {
  id: string;
  name: string;
  isActive: boolean;
}
interface Token {
  id: string;
  zoneId: string | null;
  label: string | null;
  maxUses: number;
  uses: number;
  expiresAt: string;
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      className="rounded p-1.5 text-ink-3 hover:bg-panel-2 hover:text-ink"
      aria-label="Copy"
    >
      {ok ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    </button>
  );
}

function AddStations({ branch, zones, open, onClose, onCreated }: { branch: Branch; zones: Zone[]; open: boolean; onClose: () => void; onCreated: () => void }) {
  const [zoneId, setZoneId] = useState("");
  const [maxUses, setMaxUses] = useState(10);
  const [hours, setHours] = useState(24);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<(Token & { code: string }) | null>(null);
  useEffect(() => {
    if (open) {
      setCreated(null);
      setZoneId(zones[0]?.id ?? "");
    }
  }, [open, zones]);

  const create = useAction(async () => {
    const t = await api<Token & { code: string }>(`/branches/${branch.id}/enrollment-tokens`, {
      method: "POST",
      action: "Create enrolment code",
      body: { zoneId: zoneId || null, maxUses, expiresInHours: hours, label: label || null },
    });
    setCreated(t);
    onCreated();
  });

  const apiUrl = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:4000` : "http://localhost:4000";
  const installCmd = created ? `ArenaAgent.exe enroll --api ${apiUrl} --code ${created.code}` : "";

  return (
    <Modal open={open} onClose={onClose} title={created ? "Enrolment code ready" : `Add stations to ${branch.name}`} wide={!!created}>
      {!created ? (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create.run();
          }}
        >
          <Field label="Zone" className="sm:col-span-2" hint="New PCs appear in this zone. You can move them later.">
            <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PCs this code can add" hint="One code for a whole install batch.">
            <Input type="number" min={1} max={500} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
          </Field>
          <Field label="Valid for (hours)">
            <Input type="number" min={1} max={72} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
          </Field>
          <Field label="Label (optional)" className="sm:col-span-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VIP room install" />
          </Field>
          <div className="sm:col-span-2">
            <ErrorNote>{create.error}</ErrorNote>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary" pending={create.pending}>
              <KeyRound className="size-4" /> Create code
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-5">
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-5 text-center">
            <p className="text-xs uppercase tracking-wider text-ink-3">Enrolment code</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <p className="select-all font-mono text-xl font-semibold tracking-wide text-accent sm:text-2xl">{created.code}</p>
              <CopyButton text={created.code} />
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Adds up to {created.maxUses} PC(s) · expires {new Date(created.expiresAt).toLocaleString()} · <strong className="text-reserved">shown only once</strong>
            </p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">On each gaming PC (as Administrator):</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
              <li>Copy the ArenaOS agent folder to the PC.</li>
              <li>
                Run:
                <div className="mt-1 flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs">{installCmd}</code>
                  <CopyButton text={installCmd} />
                </div>
              </li>
              <li>
                Then install the service: <code className="font-mono text-xs">install-agent.ps1</code>. The PC appears on the{" "}
                <Link href="/floor" className="text-accent">
                  Live Floor
                </Link>{" "}
                within seconds.
              </li>
            </ol>
            <p className="mt-3 text-xs text-ink-3">
              No PCs yet? Try it with simulated stations: <code className="font-mono">npm run sim -w @arena/api -- --code {created.code} --count {Math.min(created.maxUses, 12)}</code>
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function ComputersPage() {
  const can = useCan();
  const { branches, branchId, setBranchId, branch } = useBranch();
  const manage = can("station.manage", branchId ?? undefined);

  const devices = useApi<FloorDevice[]>(branchId ? `/branches/${branchId}/devices` : null);
  const zones = useApi<Zone[]>(branchId ? `/branches/${branchId}/zones` : null);
  const tokens = useApi<Token[]>(branchId && manage ? `/branches/${branchId}/enrollment-tokens` : null);
  const [adding, setAdding] = useState(false);
  const zoneName = (id: string | null) => (id ? zones.data?.find((z) => z.id === id)?.name ?? "—" : "First zone");

  const revoke = useAction(async (id: string) => {
    await api(`/enrollment-tokens/${id}`, { method: "DELETE", action: "Revoke enrolment code" });
    await tokens.reload();
  });
  const retire = useAction(async (d: FloorDevice) => {
    if (!confirm(`Retire ${d.name}? It will be disconnected and must be re-enrolled to come back. History is kept.`)) return;
    await api(`/devices/${d.id}`, { method: "DELETE", action: "Retire station" });
    await devices.reload();
  });

  useEffect(() => {
    const t = setInterval(() => void devices.reload(), 15_000);
    return () => clearInterval(t);
  }, [devices.reload]);

  const active = (devices.data ?? []).filter((d) => (d as any).isEnabled !== false);

  return (
    <>
      <PageHeader
        title="Computers"
        subtitle="Every enrolled station, its agent and hardware health."
        actions={
          <>
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </Select>
            )}
            {manage && branch && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="size-4" /> Add stations
              </Button>
            )}
          </>
        }
      />
      <ErrorNote>{revoke.error ?? retire.error}</ErrorNote>

      {manage && (tokens.data?.length ?? 0) > 0 && (
        <Card className="mb-4">
          <div className="border-b border-line px-5 py-3 text-sm font-medium">Active enrolment codes</div>
          <ul className="divide-y divide-line">
            {tokens.data!.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <KeyRound className="size-4 text-accent" />
                <span>{t.label ?? "Enrolment code"}</span>
                <span className="text-ink-3">→ {zoneName(t.zoneId)}</span>
                <Badge tone="accent">
                  {t.uses}/{t.maxUses} used
                </Badge>
                <span className="text-xs text-ink-3">expires {new Date(t.expiresAt).toLocaleString()}</span>
                <button onClick={() => void revoke.run(t.id)} className="ml-auto text-xs text-ink-3 hover:text-danger">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        {devices.loading && !devices.data ? (
          <Spinner />
        ) : active.length === 0 ? (
          <Empty icon={<Cpu className="size-8" />} title="No stations enrolled">
            Use <strong>Add stations</strong> to create an enrolment code, then run the ArenaOS agent on each PC.
          </Empty>
        ) : (
          <Table head={["Station", "Zone", "Status", "IP / MAC", "CPU · GPU", "Agent", "Last seen", ""]}>
            {active.map((d) => {
              const st = STATUS[d.displayStatus] ?? STATUS.OFFLINE;
              return (
                <tr key={d.id} className="transition hover:bg-panel-2">
                  <td className="px-4 py-3">
                    <p className="font-medium">{d.name}</p>
                    <p className="font-mono text-[11px] text-ink-3">{d.hostname ?? ""}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{zoneName(d.zoneId)}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className="size-2 rounded-full" style={{ background: st.color }} />
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-2">
                    {d.ipAddress ?? "—"}
                    <br />
                    <span className="text-ink-3">{d.macAddress ?? ""}</span>
                  </td>
                  <td className="tabular px-4 py-3 text-ink-2">{d.isOnline ? `${fmtTemp(d.metrics?.cpuTempC)} · ${fmtTemp(d.metrics?.gpuTempC)}` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-ink-2">{d.agentVersion ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-ink-3">{d.isOnline ? "now" : ago(d.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {manage && (
                      <button onClick={() => void retire.run(d)} className="rounded p-1.5 text-ink-3 hover:bg-panel-2 hover:text-danger" aria-label={`Retire ${d.name}`}>
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {branch && (
        <AddStations
          branch={branch}
          zones={(zones.data ?? []).filter((z) => z.isActive)}
          open={adding}
          onClose={() => setAdding(false)}
          onCreated={() => void tokens.reload()}
        />
      )}
    </>
  );
}
