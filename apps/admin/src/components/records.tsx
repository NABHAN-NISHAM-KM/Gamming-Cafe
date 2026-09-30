"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Button, ErrorNote, Field, Input, Modal, toast } from "./ui";

/** Owner/admin-only: edit and delete any setup record. */
export const useCanManageRecords = () => useCan()("org.records_manage");

/**
 * Edit / delete buttons for a table row, shown only to owners and admins.
 * Delete asks for a reason (audited); rows still used by history are archived
 * instead of removed, so reports stay intact.
 */
export function RecordActions({ kind, id, name, onEdit, onDone, deletable = true }: { kind: string; id: string; name: string; onEdit?: () => void; onDone: () => void; deletable?: boolean }) {
  const allowed = useCanManageRecords();
  const del = useAction(async () => {
    const r = await api<{ result: "deleted" | "archived" }>(`/records/${kind}/${id}`, { method: "DELETE", action: `Delete ${name}` });
    toast(r.result === "deleted" ? `Deleted ${name}.` : `${name} is used by past records, so it was archived instead of deleted.`, r.result === "deleted" ? "ok" : "info");
    onDone();
  });
  if (!allowed) return null;
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
      {onEdit && <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${name}`} title="Edit"><Pencil className="size-3.5" /></Button>}
      {deletable && <Button size="sm" variant="ghost" pending={del.pending} onClick={() => void del.run()} aria-label={`Delete ${name}`} title={del.error ?? "Delete"} className={del.error ? "text-danger" : "hover:text-danger"}><Trash2 className="size-3.5" /></Button>}
      {del.error && <span role="alert" className="max-w-48 truncate text-xs text-danger" title={del.error}>{del.error}</span>}
    </span>
  );
}

type QuickField = { key: string; label: string; type?: "text" | "number" | "date" | "datetime-local"; hint?: string; required?: boolean };

/** A small edit dialog for records whose edit is just a few plain fields. */
export function QuickEdit({ title, open, fields, initial, save, onClose, onDone }: {
  title: string; open: boolean; fields: QuickField[]; initial: Record<string, string>;
  save: (v: Record<string, string>) => Promise<unknown>; onClose: () => void; onDone: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {open && <QuickEditForm fields={fields} initial={initial} save={save} onDone={onDone} />}
    </Modal>
  );
}

function QuickEditForm({ fields, initial, save, onDone }: { fields: QuickField[]; initial: Record<string, string>; save: (v: Record<string, string>) => Promise<unknown>; onDone: () => void }) {
  const [v, setV] = useState(initial);
  const run = useAction(async () => {
    await save(v);
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void run.run(); }}>
      {fields.map((f, i) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <Input type={f.type ?? "text"} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} required={f.required} autoFocus={i === 0} />
        </Field>
      ))}
      <ErrorNote>{run.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={run.pending}>Save</Button></div>
    </form>
  );
}
