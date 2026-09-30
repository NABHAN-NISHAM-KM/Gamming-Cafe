"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Lock, Plus, ShieldAlert } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import type { PermissionDef, Role } from "@/lib/client/types";
import { QuickEdit, RecordActions } from "@/components/records";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Spinner, cx } from "@/components/ui";

const groupBy = (perms: PermissionDef[]) =>
  perms.reduce<Record<string, PermissionDef[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {});

function RoleCard({ role, catalog, onChanged }: { role: Role; catalog: PermissionDef[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const held = new Set(role.permissions);
  const groups = groupBy(catalog.filter((p) => held.has(p.key)));
  return (
    <Card>
      <div className="flex items-center pr-3">
      <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 px-5 py-4 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium">
            {role.name} {role.isSystem ? <Badge>Template</Badge> : <Badge tone="accent">Custom</Badge>}
          </p>
          {role.description && <p className="mt-0.5 truncate text-xs text-ink-3">{role.description}</p>}
        </div>
        <span className="tabular text-sm text-ink-2">{role.permissions.length}</span>
        <ChevronDown className={cx("size-4 text-ink-3 transition", open && "rotate-180")} />
      </button>
      {!role.isSystem && role.organizationId && <RecordActions kind="role" id={role.id} name={role.name} onEdit={() => setEditing(true)} onDone={onChanged} />}
      </div>
      <QuickEdit
        title={`Edit ${role.name}`} open={editing} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); }}
        fields={[{ key: "name", label: "Name", required: true }, { key: "description", label: "Description" }]}
        initial={{ name: role.name, description: role.description ?? "" }}
        save={(v) => api(`/roles/${role.id}`, { method: "PATCH", action: "Edit role", body: { name: v["name"]!.trim(), description: v["description"]?.trim() || null } })}
      />
      {open && (
        <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(groups).map(([mod, perms]) => (
            <div key={mod}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{mod}</p>
              <ul className="grid gap-0.5 text-sm">
                {perms.map((p) => (
                  <li key={p.key} className="flex items-center gap-1.5 text-ink-2" title={p.description}>
                    {p.sensitive && <ShieldAlert className="size-3 text-reserved" aria-label="sensitive" />}
                    {p.key.split(".")[1]!.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function NewRole({ catalog, onDone }: { catalog: PermissionDef[]; onDone: () => void }) {
  const me = useMe();
  // UI hint: only offer what the creator holds organization-wide (the API enforces it).
  const mine = useMemo(() => new Set(me.grants.filter((g) => g.scope === "ORGANIZATION").flatMap((g) => g.permissions)), [me]);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setPicked((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const create = useAction(async () => {
    await api("/roles", { method: "POST", action: "Create role", body: { key, name, description: description || undefined, permissions: [...picked] } });
    onDone();
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void create.run();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40));
            }}
            placeholder="Night shift lead"
          />
        </Field>
        <Field label="Key">
          <Input required value={key} onChange={(e) => setKey(e.target.value)} pattern="[a-z][a-z0-9_]{2,40}" className="font-mono" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="grid max-h-[45vh] gap-4 overflow-y-auto rounded-lg border border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(groupBy(catalog)).map(([mod, perms]) => (
          <fieldset key={mod}>
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{mod}</legend>
            {perms.map((p) => {
              const allowed = mine.has(p.key);
              return (
                <label key={p.key} className={cx("flex items-center gap-2 py-0.5 text-sm", allowed ? "text-ink-2" : "text-ink-3/50")} title={allowed ? p.description : "You don't hold this permission, so you can't grant it."}>
                  <input type="checkbox" disabled={!allowed} checked={picked.has(p.key)} onChange={() => toggle(p.key)} className="accent-[var(--color-accent)]" />
                  {p.key.split(".")[1]!.replace(/_/g, " ")}
                  {!allowed && <Lock className="size-3" />}
                  {p.sensitive && allowed && <ShieldAlert className="size-3 text-reserved" />}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      <ErrorNote>{create.error}</ErrorNote>
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-3">{picked.size} selected</span>
        <Button type="submit" variant="primary" pending={create.pending} disabled={!picked.size}>
          Create role
        </Button>
      </div>
    </form>
  );
}

export default function RolesPage() {
  const can = useCan();
  const roles = useApi<Role[]>("/roles");
  const catalog = useApi<PermissionDef[]>("/permissions");
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="Templates cover common jobs. Custom roles let you tailor access — you can only include permissions you hold."
        actions={
          can("employee.roles_manage") && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Custom role
            </Button>
          )
        }
      />
      {!roles.data || !catalog.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-3">
          {roles.data.map((r) => (
            <RoleCard key={r.id} role={r} catalog={catalog.data!} onChanged={() => void roles.reload()} />
          ))}
        </div>
      )}
      <ErrorNote>{roles.error?.message}</ErrorNote>
      <Modal open={creating} onClose={() => setCreating(false)} title="New custom role" wide>
        {creating && catalog.data && (
          <NewRole
            catalog={catalog.data}
            onDone={() => {
              setCreating(false);
              void roles.reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}
