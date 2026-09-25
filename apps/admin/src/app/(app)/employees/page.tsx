"use client";

import Link from "next/link";
import { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { EMP_TONE, statusLabel, type Branch, type Employee, type Role } from "@/lib/client/types";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table } from "@/components/ui";

function InviteModal({ open, onClose, onDone, branches }: { open: boolean; onClose: () => void; onDone: () => void; branches: Branch[] }) {
  const roles = useApi<Role[]>(open ? "/roles" : null);
  const [f, setF] = useState({ email: "", displayName: "", employeeCode: "", jobTitle: "", homeBranchId: "", initialPassword: "", roleId: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const invite = useAction(async () => {
    const branchId = f.homeBranchId || null;
    await api("/employees", {
      method: "POST",
      action: "Add employee",
      body: {
        email: f.email,
        displayName: f.displayName,
        employeeCode: f.employeeCode,
        jobTitle: f.jobTitle || null,
        homeBranchId: branchId,
        initialPassword: f.initialPassword,
        roles: f.roleId ? [{ roleId: f.roleId, scope: branchId ? "BRANCH" : "ORGANIZATION", branchId }] : [],
      },
    });
    setF({ email: "", displayName: "", employeeCode: "", jobTitle: "", homeBranchId: "", initialPassword: "", roleId: "" });
    onDone();
  });

  return (
    <Modal open={open} onClose={onClose} title="Add employee">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void invite.run();
        }}
      >
        <Field label="Full name">
          <Input required value={f.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Employee code">
          <Input required value={f.employeeCode} onChange={set("employeeCode")} pattern="[A-Za-z0-9_\-]{1,20}" placeholder="E015" />
        </Field>
        <Field label="Email" className="sm:col-span-2" hint="If this person already has an ArenaOS account, it is linked (their password is not changed).">
          <Input type="email" required value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Job title">
          <Input value={f.jobTitle} onChange={set("jobTitle")} placeholder="Evening cashier" />
        </Field>
        <Field label="Home branch" hint="Empty = organization-wide">
          <Select value={f.homeBranchId} onChange={set("homeBranchId")}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role" className="sm:col-span-2" hint={f.homeBranchId ? "Granted for the home branch only." : "Granted organization-wide."}>
          <Select value={f.roleId} onChange={set("roleId")}>
            <option value="">No role yet</option>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isSystem ? "" : " (custom)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Initial password" className="sm:col-span-2" hint="At least 12 characters. Share it privately; email invitations arrive with notifications.">
          <Input type="password" autoComplete="new-password" required minLength={12} value={f.initialPassword} onChange={set("initialPassword")} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote>{invite.error}</ErrorNote>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" pending={invite.pending}>
            Add employee
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function EmployeesPage() {
  const can = useCan();
  const employees = useApi<Employee[]>("/employees");
  const branches = useApi<Branch[]>(can("branch.view") ? "/branches" : null);
  const [inviting, setInviting] = useState(false);
  const [q, setQ] = useState("");
  const branchCode = (id: string | null) => (id ? branches.data?.find((b) => b.id === id)?.code ?? "—" : "All");
  const rows = (employees.data ?? []).filter((e) => `${e.displayName} ${e.user.email} ${e.employeeCode}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Staff accounts, their home branch and what they're allowed to do."
        actions={
          can("employee.manage") && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <UserPlus className="size-4" /> Add employee
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <Input placeholder="Search name, email or code…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        </div>
        {employees.loading && !employees.data ? (
          <Spinner />
        ) : employees.error ? (
          <div className="p-5">
            <ErrorNote>{employees.error.message}</ErrorNote>
          </div>
        ) : rows.length === 0 ? (
          <Empty icon={<Users className="size-8" />} title={q ? "No matches" : "No employees visible"} />
        ) : (
          <Table head={["Name", "Code", "Home branch", "Roles", "Status"]}>
            {rows.map((e) => (
              <tr key={e.id} className="transition hover:bg-panel-2">
                <td className="px-4 py-3">
                  <Link href={`/employees/${e.id}`} className="font-medium hover:text-accent">
                    {e.displayName}
                  </Link>
                  <p className="text-xs text-ink-3">{e.user.email}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-2">{e.employeeCode}</td>
                <td className="px-4 py-3 text-ink-2">{branchCode(e.homeBranchId)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {e.employeeRoleAssignments.length ? (
                      e.employeeRoleAssignments.map((a) => (
                        <Badge key={a.id} tone="accent">
                          {a.role.name}
                          {a.scope === "BRANCH" ? ` @${branchCode(a.branchId)}` : ""}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-ink-3">No roles</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={EMP_TONE[e.status]}>{statusLabel(e.status)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <InviteModal
        open={inviting}
        branches={branches.data ?? []}
        onClose={() => setInviting(false)}
        onDone={() => {
          setInviting(false);
          void employees.reload();
        }}
      />
    </>
  );
}
