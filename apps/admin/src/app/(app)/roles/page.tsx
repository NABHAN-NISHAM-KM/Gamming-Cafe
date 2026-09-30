"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Lock, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import type { PermissionDef, Role } from "@/lib/client/types";
import { RecordActions } from "@/components/records";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Spinner, cx } from "@/components/ui";

const MODULE_LABEL: Record<string, string> = {
  org: "Organization", branch: "Branches", zone: "Zones & floor", station: "Gaming stations", shell: "PC shell", diskless: "Diskless boot",
  game: "Games & apps", pricing: "Rates & pricing", customer: "Customers", wallet: "Wallet & top-ups", membership: "Memberships", booking: "Bookings",
  pos: "Point of sale", shift: "Cash shifts", restaurant: "Restaurant", kds: "Kitchen screen", print: "Printing", inventory: "Inventory",
  purchasing: "Purchasing", employee: "Staff", tournament: "Tournaments", loyalty: "Loyalty", promotion: "Promotions", crm: "Marketing",
  reports: "Reports", accounting: "Accounting", payment: "Payments", notification: "Notifications", integration: "Integrations",
  audit: "Audit log", support: "Support", settings: "Settings",
};
const moduleLabel = (m: string) => MODULE_LABEL[m] ?? m;

const groupBy = (perms: PermissionDef[]) =>
  perms.reduce<Record<string, PermissionDef[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {});

function RoleCard({ role, roles, catalog, onChanged }: { role: Role; roles: Role[]; catalog: PermissionDef[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const held = new Set(role.permissions);
  const groups = groupBy(catalog.filter((p) => held.has(p.key)));
  return (
    <Card>
      <div className="flex items-center pr-3">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 px-5 py-4 text-left" aria-expanded={open}>
          <span className={cx("grid size-9 shrink-0 place-items-center rounded-lg", role.isSystem ? "bg-panel-2 text-ink-2" : "bg-accent-soft text-accent")}>
            <ShieldCheck className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              {role.name} {role.isSystem ? <Badge>Ready-made</Badge> : <Badge tone="accent">Your role</Badge>}
            </p>
            {role.description && <p className="mt-0.5 truncate text-xs text-ink-3">{role.description}</p>}
          </div>
          <span className="hidden text-xs text-ink-3 sm:inline">{open ? "Hide" : "See"} {role.permissions.length} permissions</span>
          <ChevronDown className={cx("size-4 text-ink-3 transition", open && "rotate-180")} />
        </button>
        {!role.isSystem && role.organizationId && <RecordActions kind="role" id={role.id} name={role.name} onEdit={() => setEditing(true)} onDone={onChanged} />}
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${role.name}`} wide>
        {editing && <RoleForm role={role} roles={roles} catalog={catalog} onDone={() => { setEditing(false); onChanged(); }} />}
      </Modal>
      {open && (
        <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(groups).map(([mod, perms]) => (
            <div key={mod}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{moduleLabel(mod)}</p>
              <ul className="grid gap-1 text-sm">
                {perms.map((p) => (
                  <li key={p.key} className="flex items-start gap-1.5 text-ink-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
                    {p.description}
                    {p.sensitive && <ShieldAlert className="mt-0.5 size-3 shrink-0 text-reserved" aria-label="sensitive" />}
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

/** Create or edit a custom role: tick ready-made jobs (Cashier → all cashier permissions), then optionally fine-tune. */
function RoleForm({ role, roles, catalog, onDone }: { role?: Role; roles: Role[]; catalog: PermissionDef[]; onDone: () => void }) {
  const me = useMe();
  // UI hint: only offer what the creator holds organization-wide (the API enforces it).
  const mine = useMemo(() => new Set(me.grants.filter((g) => g.scope === "ORGANIZATION").flatMap((g) => g.permissions)), [me]);
  const templates = roles.filter((r) => r.isSystem && r.key !== "org_owner");
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(!!role);
  const setMany = (keys: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      keys.filter((k) => mine.has(k)).forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });
  const grantable = (t: Role) => t.permissions.filter((k) => mine.has(k));
  // Jobs the user ticked. Unticking one removes only permissions no other ticked job needs.
  const [jobs, setJobs] = useState<Set<string>>(new Set());
  const toggleTemplate = (t: Role) => {
    const on = !jobs.has(t.id);
    const next = new Set(jobs);
    if (on) next.add(t.id);
    else next.delete(t.id);
    setJobs(next);
    const keep = new Set(templates.filter((x) => next.has(x.id)).flatMap((x) => x.permissions));
    setMany(on ? t.permissions : t.permissions.filter((k) => !keep.has(k)), on);
    if (on && !name) setName(t.name);
  };
  const save = useAction(async () => {
    const body = { name: name.trim(), description: description.trim() || undefined, permissions: [...picked] };
    if (role) {
      await api(`/roles/${role.id}`, { method: "PATCH", action: `Update role ${body.name}`, done: `Role “${body.name}” saved.`, body });
    } else {
      // The key is an internal id; derive it from the name so nobody has to think about it.
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
      const key = `${/^[a-z]/.test(slug) ? slug : `role_${slug}`}_${Date.now().toString(36).slice(-4)}`;
      await api("/roles", { method: "POST", action: `Create role ${body.name}`, done: `Role “${body.name}” created.`, body: { ...body, key } });
    }
    onDone();
  });
  const q = search.trim().toLowerCase();
  const shown = catalog.filter((p) => !q || `${p.description} ${p.key} ${moduleLabel(p.module)}`.toLowerCase().includes(q));

  return (
    <form className="grid gap-6" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <section>
        <p className="text-sm font-semibold">1. What does this person do?</p>
        <p className="mb-3 text-xs text-ink-3">Tick one or more jobs — their permissions are added automatically. Tick again to remove.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const on = jobs.has(t.id);
            const locked = grantable(t).length === 0;
            return (
              <button
                type="button"
                key={t.id}
                disabled={locked}
                onClick={() => toggleTemplate(t)}
                aria-pressed={on}
                className={cx("flex items-start gap-2.5 rounded-lg border p-3 text-left transition disabled:opacity-40", on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
              >
                <span className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded border", on ? "border-accent bg-accent text-white" : "border-line-strong")}>{on && <Check className="size-3" />}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t.name}</span>
                  {t.description && <span className="block text-xs text-ink-3">{t.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm font-semibold sm:col-span-2">2. Give it a name</p>
        <Field label="Role name">
          <Input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Night shift cashier" />
        </Field>
        <Field label="Description (optional)">
          <Input maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" />
        </Field>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">
            3. Fine-tune <span className="font-normal text-ink-3">(optional)</span>
          </p>
          <Badge tone={picked.size ? "accent" : "neutral"}>{picked.size} selected</Badge>
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Hide permissions" : "Show all permissions"} <ChevronDown className={cx("size-3.5 transition", showAll && "rotate-180")} />
          </Button>
        </div>
        {showAll && (
          <>
            <Input placeholder="Search, e.g. refund, booking, stock…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
            <div className="grid max-h-[45vh] gap-3 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2">
              {Object.entries(groupBy(shown)).map(([mod, perms]) => {
                const keys = perms.filter((p) => mine.has(p.key)).map((p) => p.key);
                const all = keys.length > 0 && keys.every((k) => picked.has(k));
                return (
                  <fieldset key={mod} className="rounded-lg bg-panel-2/60 p-2.5">
                    <legend className="sr-only">{moduleLabel(mod)}</legend>
                    <label className="mb-1 flex items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" disabled={!keys.length} checked={all} onChange={() => setMany(keys, !all)} className="accent-[var(--color-accent)]" />
                      {moduleLabel(mod)} <span className="text-xs font-normal text-ink-3">· select all</span>
                    </label>
                    {perms.map((p) => {
                      const allowed = mine.has(p.key);
                      return (
                        <label key={p.key} className={cx("flex items-start gap-2 py-0.5 pl-5 text-sm", allowed ? "text-ink-2" : "text-ink-3/50")} title={allowed ? undefined : "You don't have this permission yourself, so you can't give it."}>
                          <input type="checkbox" disabled={!allowed} checked={picked.has(p.key)} onChange={() => setMany([p.key], !picked.has(p.key))} className="mt-1 accent-[var(--color-accent)]" />
                          <span>{p.description}</span>
                          {!allowed && <Lock className="mt-1 size-3 shrink-0" />}
                          {p.sensitive && allowed && <ShieldAlert className="mt-1 size-3 shrink-0 text-reserved" aria-label="sensitive" />}
                        </label>
                      );
                    })}
                  </fieldset>
                );
              })}
            </div>
          </>
        )}
      </section>

      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-3">{picked.size ? `${picked.size} permissions will be given.` : "Tick at least one job above."}</span>
        <Button type="submit" variant="primary" pending={save.pending} disabled={!picked.size}>
          {role ? "Save changes" : "Create role"}
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
  const mine = (roles.data ?? []).filter((r) => !r.isSystem);
  const ready = (roles.data ?? []).filter((r) => r.isSystem);

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="A role decides what a staff member can do. Use a ready-made role, or create your own by ticking the jobs it covers."
        actions={
          can("employee.roles_manage") && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Create role
            </Button>
          )
        }
      />
      {!roles.data || !catalog.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6">
          {mine.length > 0 && (
            <section className="grid gap-3">
              <h2 className="text-sm font-semibold text-ink-2">Your roles ({mine.length})</h2>
              {mine.map((r) => <RoleCard key={r.id} role={r} roles={roles.data!} catalog={catalog.data!} onChanged={() => void roles.reload()} />)}
            </section>
          )}
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold text-ink-2">Ready-made roles ({ready.length}) <span className="font-normal text-ink-3">— assign these straight away, no setup needed</span></h2>
            {ready.map((r) => <RoleCard key={r.id} role={r} roles={roles.data!} catalog={catalog.data!} onChanged={() => void roles.reload()} />)}
          </section>
        </div>
      )}
      <ErrorNote>{roles.error?.message}</ErrorNote>
      <Modal open={creating} onClose={() => setCreating(false)} title="Create a role" wide>
        {creating && catalog.data && (
          <RoleForm
            roles={roles.data ?? []}
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
