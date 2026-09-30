"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/hooks";
import type { Branch, Employee } from "@/lib/client/types";
import { Button, ErrorNote, Field, Input, Modal, Select } from "./ui";

/** Full edit of an employee's details: name, job title and home branch. */
export function EditEmployee({ employee, branches, onClose, onDone }: { employee: Employee | null; branches: Branch[]; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={!!employee} onClose={onClose} title={employee ? `Edit ${employee.displayName}` : ""}>
      {employee && <EditForm e={employee} branches={branches} onDone={onDone} onCancel={onClose} />}
    </Modal>
  );
}

function EditForm({ e, branches, onDone, onCancel }: { e: Employee; branches: Branch[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ displayName: e.displayName, jobTitle: e.jobTitle ?? "", homeBranchId: e.homeBranchId ?? "" });
  const save = useAction(async () => {
    const body: Record<string, unknown> = { displayName: f.displayName.trim(), jobTitle: f.jobTitle.trim() || null };
    if ((e.homeBranchId ?? "") !== f.homeBranchId) body["homeBranchId"] = f.homeBranchId || null;
    await api(`/employees/${e.id}`, { method: "PATCH", body, action: `Update ${f.displayName.trim()}`, done: `${f.displayName.trim()} updated.` });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); void save.run(); }}>
      <Field label="Full name">
        <Input required minLength={2} maxLength={80} value={f.displayName} onChange={(ev) => setF({ ...f, displayName: ev.target.value })} autoFocus />
      </Field>
      <Field label="Job title" hint="Shown on their profile, e.g. Evening cashier.">
        <Input maxLength={80} value={f.jobTitle} onChange={(ev) => setF({ ...f, jobTitle: ev.target.value })} />
      </Field>
      <Field label="Home branch" hint="Where they normally work.">
        <Select value={f.homeBranchId} onChange={(ev) => setF({ ...f, homeBranchId: ev.target.value })}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </Select>
      </Field>
      <p className="text-xs text-ink-3">Email and employee code ({e.employeeCode}) can't be changed. Roles and PIN are managed on the employee page.</p>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" pending={save.pending}>Save changes</Button>
      </div>
    </form>
  );
}
