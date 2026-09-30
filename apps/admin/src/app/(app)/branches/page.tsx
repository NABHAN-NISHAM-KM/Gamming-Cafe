"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import { RecordActions } from "@/components/records";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table } from "@/components/ui";
import { STATUS_TONE, statusLabel, type Branch } from "@/lib/client/types";

function NewBranch({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (b: Branch) => void }) {
  const me = useMe();
  const brands = useApi<Array<{ id: string; name: string }>>(open ? "/brands" : null);
  const [form, setForm] = useState({ brandId: "", code: "", name: "", city: "", countryCode: "AE", currency: me.organization.defaultCurrency, timezone: me.organization.defaultTimezone });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = useAction(async () => {
    const b = await api<Branch>("/branches", { method: "POST", body: { ...form, brandId: form.brandId || brands.data?.[0]?.id, city: form.city || null }, action: "Create branch" });
    onCreated(b);
  });

  return (
    <Modal open={open} onClose={onClose} title="New branch">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create.run();
        }}
      >
        <Field label="Brand" className="sm:col-span-2">
          <Select value={form.brandId || brands.data?.[0]?.id || ""} onChange={set("brandId")}>
            {brands.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Code" hint="Short, uppercase — used on receipts, e.g. DXB2">
          <Input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} pattern="[A-Z0-9]{2,8}" maxLength={8} />
        </Field>
        <Field label="Name">
          <Input required value={form.name} onChange={set("name")} placeholder="Dubai Mall" />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={set("city")} />
        </Field>
        <Field label="Country">
          <Input required value={form.countryCode} onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.toUpperCase() }))} maxLength={2} />
        </Field>
        <Field label="Currency">
          <Input required value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} />
        </Field>
        <Field label="Time zone" hint="IANA name, e.g. Asia/Dubai">
          <Input required value={form.timezone} onChange={set("timezone")} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote>{create.error}</ErrorNote>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" pending={create.pending}>
            Create branch
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function BranchesPage() {
  const can = useCan();
  const { data, loading, error, reload } = useApi<Branch[]>("/branches");
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Branches & zones"
        subtitle="Each branch is a venue. Zones group stations with their own pricing, hours and rules."
        actions={
          can("branch.manage") && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New branch
            </Button>
          )
        }
      />
      <Card>
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <div className="p-5">
            <ErrorNote>{error.message}</ErrorNote>
          </div>
        ) : !data?.length ? (
          <Empty icon={<Building2 className="size-8" />} title="No branches yet">
            Create your first venue to start adding zones and stations.
          </Empty>
        ) : (
          <Table head={["Code", "Branch", "Brand", "City", "Time zone", "Status", ""]}>
            {data.map((b) => (
              <tr key={b.id} className="transition hover:bg-panel-2">
                <td className="px-4 py-3 font-mono text-xs text-ink-2">{b.code}</td>
                <td className="px-4 py-3">
                  <Link href={`/branches/${b.id}`} className="font-medium hover:text-accent">
                    {b.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-2">{b.brand?.name}</td>
                <td className="px-4 py-3 text-ink-2">{b.city ?? "—"}</td>
                <td className="px-4 py-3 text-ink-2">{b.timezone}</td>
                <td className="px-4 py-3">
                  <Badge tone={STATUS_TONE[b.status]}>{statusLabel(b.status)}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {b.status !== "CLOSED" && <RecordActions kind="branch" id={b.id} name={b.name} onEdit={() => router.push(`/branches/${b.id}`)} onDone={() => void reload()} />}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewBranch
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void reload();
        }}
      />
    </>
  );
}
