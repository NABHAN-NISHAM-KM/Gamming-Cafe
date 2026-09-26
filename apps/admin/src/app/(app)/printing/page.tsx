"use client";

import { useEffect, useState } from "react";
import { Ban, Check, Printer, Settings2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

interface Job {
  id: string;
  status: "QUEUED" | "HELD" | "PRINTING" | "COMPLETED" | "FAILED" | "CANCELLED";
  device: string;
  customer: string | null;
  document: string | null;
  printer: string | null;
  pages: number;
  copies: number;
  color: boolean;
  unitPrice: string;
  total: string;
  payWith: "BILL" | "WALLET" | null;
  failureReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  waitingFor: "CUSTOMER" | "STAFF" | null;
}
interface Settings {
  requireApproval: boolean;
  maxPages: number;
  bw: { productId: string; price: string; available: boolean } | null;
  color: { productId: string; price: string; available: boolean } | null;
}

const TONE: Record<Job["status"], "accent" | "warn" | "ok" | "danger" | "neutral"> = { QUEUED: "warn", HELD: "warn", PRINTING: "accent", COMPLETED: "ok", FAILED: "danger", CANCELLED: "neutral" };
const REASON: Record<string, string> = { no_session: "no session", not_set_up: "printing not set up", too_many_pages: "too many pages", timeout: "not confirmed in time", customer: "cancelled by customer" };

export default function PrintingPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const [open, setOpen] = useState(true);
  const jobs = useApi<Job[]>(branchId ? `/branches/${branchId}/print-jobs${open ? "?open=1" : ""}` : null);
  const settings = useApi<Settings>(branchId ? `/branches/${branchId}/print-settings` : null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      void jobs.reload();
    }, 5000);
    return () => clearInterval(t);
  }, [jobs]);

  const release = useAction(async (j: Job, payWith?: "BILL" | "WALLET") => {
    const r = await api<{ result: string }>(`/print-jobs/${j.id}/release`, { method: "POST", body: payWith ? { payWith } : {} });
    if (r.result === "session_ended") alert("The customer's session has ended — the job was cancelled.");
    await jobs.reload();
  });
  const cancel = useAction(async (j: Job) => {
    const reason = prompt("Why cancel this print?");
    if (!reason || reason.trim().length < 3) return;
    await api(`/print-jobs/${j.id}/cancel`, { method: "POST", body: { reason: reason.trim() } });
    await jobs.reload();
  });
  const mayRelease = can("print.release", branchId ?? undefined);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Printing"
        subtitle="Every print from a customer's PC is held until they approve the price on screen (added to their bill or paid from their wallet). Jobs needing staff approval wait here."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            <Select value={open ? "open" : "all"} onChange={(e) => setOpen(e.target.value === "open")} className="w-auto">
              <option value="open">Waiting & printing</option>
              <option value="all">Last 24 hours</option>
            </Select>
          </div>
        }
      />
      <ErrorNote>{release.error ?? cancel.error}</ErrorNote>
      <Card>
        {!jobs.data ? (
          <Spinner />
        ) : jobs.data.length === 0 ? (
          <Empty icon={<Printer className="size-8" />} title={open ? "Nothing waiting" : "No prints in the last 24 hours"}>Prints from customers' PCs appear here.</Empty>
        ) : (
          <Table head={["When", "PC", "Who", "Document", "Pages", "Total", "Status", ""]}>
            {jobs.data.map((j) => (
              <tr key={j.id} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2 text-ink-3">{new Date(j.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                <td className="px-4 py-2 font-medium">{j.device}</td>
                <td className="px-4 py-2 text-ink-2">{j.customer ?? "Guest"}</td>
                <td className="max-w-56 truncate px-4 py-2 text-ink-2" title={j.document ?? ""}>{j.document ?? "—"}<span className="block text-[11px] text-ink-3">{j.printer}</span></td>
                <td className="px-4 py-2 tabular-nums">{j.pages * j.copies}{j.color && <Badge tone="accent">colour</Badge>}</td>
                <td className="px-4 py-2 tabular-nums">{j.total}{j.payWith && <span className="block text-[11px] text-ink-3">{j.payWith === "WALLET" ? "wallet" : "on bill"}</span>}</td>
                <td className="px-4 py-2">
                  <Badge tone={TONE[j.status]}>{j.status === "HELD" ? (j.waitingFor === "STAFF" ? "needs release" : "customer deciding") : j.status.toLowerCase()}</Badge>
                  {j.status === "HELD" && j.expiresAt && <span className="block text-[11px] text-ink-3">cancels in {Math.max(0, Math.round((new Date(j.expiresAt).getTime() - now) / 60_000))} min</span>}
                  {j.failureReason && <span className="block text-[11px] text-ink-3">{REASON[j.failureReason] ?? j.failureReason}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  {mayRelease && j.status === "HELD" && (
                    <>
                      <Button size="sm" variant={j.waitingFor === "STAFF" ? "primary" : "secondary"} pending={release.pending} onClick={() => void release.run(j)}><Check className="size-3.5" /> Release</Button>
                      <Button size="sm" variant="ghost" pending={cancel.pending} onClick={() => void cancel.run(j)} aria-label="Cancel print"><Ban className="size-3.5" /></Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {settings.data && branchId && <PrintSettings branchId={branchId} s={settings.data} canEdit={can("settings.manage", branchId)} onSaved={() => void settings.reload()} />}
    </div>
  );
}

function PrintSettings({ branchId, s, canEdit, onSaved }: { branchId: string; s: Settings; canEdit: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ requireApproval: s.requireApproval, maxPages: String(s.maxPages) });
  const save = useAction(async () => {
    await api(`/branches/${branchId}/print-settings`, { method: "PUT", body: { requireApproval: f.requireApproval, maxPages: Number(f.maxPages) || 100 } });
    onSaved();
  });
  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><Settings2 className="size-4 text-accent" /> Print rules</h2>
      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-ink-3">Price per page</p>
          <p className="mt-1">Black & white <strong className="tabular-nums">{s.bw?.price ?? "—"}</strong> · colour <strong className="tabular-nums">{s.color?.price ?? "—"}</strong></p>
          <p className="mt-1 text-xs text-ink-3">Change them in Restaurant → Menu (Services: “Printing”). {(!s.bw || !s.color) && <span className="text-danger">Missing — printing is refused until both exist.</span>}</p>
        </div>
        <label className={cx("flex items-start gap-2", !canEdit && "opacity-60")}>
          <input type="checkbox" className="mt-1" disabled={!canEdit} checked={f.requireApproval} onChange={(e) => setF({ ...f, requireApproval: e.target.checked })} />
          <span>Staff release every print<span className="block text-xs text-ink-3">After the customer confirms, the job waits here until someone at the desk releases it.</span></span>
        </label>
        <Field label="Most pages per job" hint="Bigger jobs are refused — ask staff">
          <Input type="number" min={1} max={2000} disabled={!canEdit} value={f.maxPages} onChange={(e) => setF({ ...f, maxPages: e.target.value })} />
        </Field>
      </div>
      <ErrorNote>{save.error}</ErrorNote>
      {canEdit && <div className="mt-3 flex justify-end"><Button variant="primary" pending={save.pending} onClick={() => void save.run()}>Save rules</Button></div>}
    </Card>
  );
}
