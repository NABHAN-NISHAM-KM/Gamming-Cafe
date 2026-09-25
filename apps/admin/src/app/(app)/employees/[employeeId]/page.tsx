"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import { EMP_TONE, statusLabel, type Branch, type Employee, type Role } from "@/lib/client/types";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";

function GrantRole({ employeeId, branches, onDone }: { employeeId: string; branches: Branch[]; onDone: () => void }) {
  const roles = useApi<Role[]>("/roles");
  const [roleId, setRoleId] = useState("");
  const [branchId, setBranchId] = useState("");
  const grant = useAction(async () => {
    await api(`/employees/${employeeId}/roles`, {
      method: "POST",
      action: "Grant role",
      body: { roleId, scope: branchId ? "BRANCH" : "ORGANIZATION", branchId: branchId || null },
    });
    onDone();
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void grant.run();
      }}
    >
      <Field label="Role">
        <Select required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="" disabled>
            Choose a role…
          </option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {r.permissions.length} permissions
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Where" hint="You can only grant what you hold yourself, where you hold it.">
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">All branches (organization)</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              Only {b.code} · {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorNote>{grant.error}</ErrorNote>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" pending={grant.pending} disabled={!roleId}>
          Grant role
        </Button>
      </div>
    </form>
  );
}

function SetPin({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const [pin, setPin] = useState("");
  const save = useAction(async () => {
    await api(`/employees/${employeeId}/pin`, { method: "POST", body: { pin }, action: "Set staff PIN" });
    onDone();
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <Field label="New PIN" hint="4–8 digits. Used at the POS and for maintenance mode on stations.">
        <Input inputMode="numeric" type="password" pattern="\d{4,8}" maxLength={8} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      </Field>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" pending={save.pending}>
          Save PIN
        </Button>
      </div>
    </form>
  );
}

export default function EmployeePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = use(params);
  const me = useMe();
  const can = useCan();
  const emp = useApi<Employee>(`/employees/${employeeId}`);
  const branches = useApi<Branch[]>(can("branch.view") ? "/branches" : null);
  const [modal, setModal] = useState<"grant" | "pin" | null>(null);

  const setStatus = useAction(async (status: Employee["status"]) => {
    await api(`/employees/${employeeId}`, { method: "PATCH", body: { status }, action: `Set status to ${statusLabel(status)}` });
    await emp.reload();
  });
  const revoke = useAction(async (assignmentId: string) => {
    await api(`/employees/${employeeId}/roles/${assignmentId}`, { method: "DELETE", action: "Revoke role" });
    await emp.reload();
  });

  if (emp.error) return <ErrorNote>{emp.error.message}</ErrorNote>;
  if (!emp.data) return <Spinner />;
  const e = emp.data;
  const isMe = e.id === me.employee.id;
  const branchName = (id: string | null) => (id ? branches.data?.find((b) => b.id === id)?.name ?? "a branch" : "All branches");

  return (
    <>
      <Link href="/employees" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Employees
      </Link>
      <PageHeader
        title={e.displayName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {e.user.email} · <span className="font-mono">{e.employeeCode}</span>
            {e.jobTitle && <>· {e.jobTitle}</>}
            <Badge tone={EMP_TONE[e.status]}>{statusLabel(e.status)}</Badge>
            {isMe && <Badge tone="accent">You</Badge>}
          </span>
        }
        actions={
          can("employee.manage") && (
            <>
              <Button onClick={() => setModal("pin")}>
                <KeyRound className="size-4" /> Set PIN
              </Button>
              {!isMe && e.status === "ACTIVE" && (
                <Button variant="danger" pending={setStatus.pending} onClick={() => void setStatus.run("SUSPENDED")}>
                  Suspend
                </Button>
              )}
              {!isMe && e.status === "SUSPENDED" && (
                <Button pending={setStatus.pending} onClick={() => void setStatus.run("ACTIVE")}>
                  Reactivate
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorNote>{setStatus.error ?? revoke.error}</ErrorNote>

      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Roles</h2>
            <p className="text-xs text-ink-3">Home branch: {branchName(e.homeBranchId)}</p>
          </div>
          {can("employee.assign_roles") && (
            <Button size="sm" variant="primary" onClick={() => setModal("grant")}>
              <Plus className="size-3.5" /> Grant role
            </Button>
          )}
        </div>
        <ul className="divide-y divide-line">
          {e.employeeRoleAssignments.length === 0 && <li className="px-5 py-6 text-sm text-ink-3">No roles — this person can sign in but can't do anything yet.</li>}
          {e.employeeRoleAssignments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <ShieldCheck className="size-4 text-accent" />
              <div>
                <p className="text-sm font-medium">{a.role.name}</p>
                <p className="text-xs text-ink-3">
                  {a.scope === "ORGANIZATION" ? "All branches" : a.scope === "BRANCH" ? `Only ${branchName(a.branchId)}` : "One brand"}
                  {a.expiresAt ? ` · until ${new Date(a.expiresAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              {can("employee.assign_roles") && (
                <button
                  onClick={() => confirm(`Remove ${a.role.name} from ${e.displayName}?`) && void revoke.run(a.id)}
                  className="ml-auto rounded p-1.5 text-ink-3 hover:bg-panel-2 hover:text-danger"
                  aria-label={`Revoke ${a.role.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Modal open={modal === "grant"} onClose={() => setModal(null)} title={`Grant a role to ${e.displayName}`}>
        {modal === "grant" && (
          <GrantRole
            employeeId={e.id}
            branches={branches.data ?? []}
            onDone={() => {
              setModal(null);
              void emp.reload();
            }}
          />
        )}
      </Modal>
      <Modal open={modal === "pin"} onClose={() => setModal(null)} title={`PIN for ${e.displayName}`}>
        {modal === "pin" && <SetPin employeeId={e.id} onDone={() => setModal(null)} />}
      </Modal>
    </>
  );
}
