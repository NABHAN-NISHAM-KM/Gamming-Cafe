"use client";

import { useState } from "react";
import { Badge, Card, Empty, ErrorNote, PageHeader, Select, Skeleton, Table, toast } from "@/components/ui";
import { ago, can, platformApi, usePlatform } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

type Status = "NEW" | "CONTACTED" | "WON" | "LOST";
interface Lead {
  id: string;
  kind: "CONTACT" | "DEMO" | "TRIAL" | "UPGRADE";
  status: Status;
  name: string;
  email: string;
  phone: string | null;
  venue: string | null;
  country: string | null;
  venueType: string | null;
  plan: string | null;
  branches: number | null;
  stations: number | null;
  notes: string | null;
  demoAt: string | null;
  trialOrgId: string | null;
  staffNotes: string | null;
  nextActionAt: string | null;
  createdAt: string;
}

const KIND: Record<Lead["kind"], [string, "accent" | "ok" | "neutral" | "warn"]> = { CONTACT: ["Walkthrough", "neutral"], DEMO: ["Call booked", "accent"], TRIAL: ["Trial", "ok"], UPGRADE: ["Upgrade", "warn"] };
/** A datetime-local value (this browser's time) for an ISO instant. */
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
const STATUS_TONE: Record<Status, "accent" | "warn" | "ok" | "neutral"> = { NEW: "accent", CONTACTED: "warn", WON: "ok", LOST: "neutral" };

export default function LeadsPage() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [due, setDue] = useState(false);
  const qs = new URLSearchParams({ ...(status && { status }), ...(kind && { kind }), ...(due && { due: "1" }) }).toString();
  const { data, error, setData } = usePlatform<Lead[]>(`/leads${qs ? `?${qs}` : ""}`);
  const me = usePlatformMe();
  const canEdit = can(me.roles, "SUPER_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_BILLING");

  const update = async (lead: Lead, body: Partial<Pick<Lead, "status" | "staffNotes" | "nextActionAt">>, done: string) => {
    try {
      const saved = await platformApi<Lead>(`/leads/${lead.id}`, { method: "PATCH", body });
      setData((rows) => rows?.map((r) => (r.id === saved.id ? saved : r)));
      toast(`${lead.name}: ${done}`);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  };
  const move = (lead: Lead, next: Status) => update(lead, { status: next }, next.toLowerCase());

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Leads"
        subtitle="Walkthrough requests, booked calls, free trials and upgrade requests. “To do today” shows follow-ups that are due and calls in the next 24 hours."
        actions={
          <div className="flex gap-2">
            <label className="flex items-center gap-2 whitespace-nowrap text-sm"><input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} /> To do today</label>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
              <option value="">All types</option><option value="CONTACT">Walkthrough</option><option value="DEMO">Call booked</option><option value="TRIAL">Trial</option><option value="UPGRADE">Upgrade</option>
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option><option value="NEW">New</option><option value="CONTACTED">Contacted</option><option value="WON">Won</option><option value="LOST">Lost</option>
            </Select>
          </div>
        }
      />
      <ErrorNote>{error?.message}</ErrorNote>
      <Card>
        {!data ? (
          <Skeleton rows={4} />
        ) : !data.length ? (
          <Empty title="No leads yet">They appear here when someone uses the contact form, books a call or starts a trial on the website.</Empty>
        ) : (
          <Table head={["Who", "Venue", "Type", "Status", "Follow-up", "Received"]}>
            {data.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-4 py-3">
                  <span className="font-medium">{l.name}</span>
                  <a href={`mailto:${l.email}`} className="block text-xs text-accent">{l.email}</a>
                  {l.phone && <span className="block text-xs text-ink-3">{l.phone}</span>}
                </td>
                <td className="px-4 py-3">
                  <span>{l.venue ?? "—"}</span>
                  <span className="block text-xs text-ink-3">{[l.venueType, l.country, l.stations && `${l.stations} stations`, l.branches && l.branches > 1 && `${l.branches} branches`, l.plan].filter(Boolean).join(" · ")}</span>
                  {l.notes && <span className="mt-1 block max-w-md whitespace-pre-line text-xs text-ink-2">{l.notes}</span>}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={KIND[l.kind][1]}>{KIND[l.kind][0]}</Badge>
                  {l.demoAt && <span className="mt-1 block whitespace-nowrap text-xs text-ink-2">{new Date(l.demoAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}
                  {l.trialOrgId && <a href={`/platform/organizations/${l.trialOrgId}`} className="mt-1 block text-xs text-accent">Open organization</a>}
                </td>
                <td className="px-4 py-3">
                  {canEdit ? (
                    <Select value={l.status} onChange={(e) => void move(l, e.target.value as Status)} aria-label={`Status of ${l.name}`}>
                      <option value="NEW">New</option><option value="CONTACTED">Contacted</option><option value="WON">Won</option><option value="LOST">Lost</option>
                    </Select>
                  ) : (
                    <Badge tone={STATUS_TONE[l.status]}>{l.status.toLowerCase()}</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  {canEdit ? (
                    <div className="grid w-56 gap-1">
                      <input type="datetime-local" defaultValue={local(l.nextActionAt)} onBlur={(e) => e.target.value !== local(l.nextActionAt) && void update(l, { nextActionAt: e.target.value ? new Date(e.target.value).toISOString() : null }, "follow-up set")} className={`rounded-md border bg-panel px-2 py-1 text-xs ${l.nextActionAt && new Date(l.nextActionAt) <= new Date() ? "border-reserved text-reserved" : "border-line"}`} aria-label={`Next follow-up for ${l.name}`} />
                      <textarea defaultValue={l.staffNotes ?? ""} rows={2} maxLength={4000} placeholder="Notes for the team" onBlur={(e) => e.target.value !== (l.staffNotes ?? "") && void update(l, { staffNotes: e.target.value || null }, "notes saved")} className="rounded-md border border-line bg-panel px-2 py-1 text-xs" />
                    </div>
                  ) : (
                    <span className="text-xs text-ink-2">{l.nextActionAt ? new Date(l.nextActionAt).toLocaleString() : "—"}{l.staffNotes && <span className="block text-ink-3">{l.staffNotes}</span>}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-3">{ago(l.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
