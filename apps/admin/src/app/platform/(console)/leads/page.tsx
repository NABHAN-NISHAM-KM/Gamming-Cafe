"use client";

import { useState } from "react";
import { Badge, Card, Empty, ErrorNote, PageHeader, Select, Skeleton, Table, toast } from "@/components/ui";
import { ago, can, platformApi, usePlatform } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

type Status = "NEW" | "CONTACTED" | "WON" | "LOST";
interface Lead {
  id: string;
  kind: "CONTACT" | "DEMO" | "TRIAL";
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
  createdAt: string;
}

const KIND: Record<Lead["kind"], [string, "accent" | "ok" | "neutral"]> = { CONTACT: ["Walkthrough", "neutral"], DEMO: ["Call booked", "accent"], TRIAL: ["Trial", "ok"] };
const STATUS_TONE: Record<Status, "accent" | "warn" | "ok" | "neutral"> = { NEW: "accent", CONTACTED: "warn", WON: "ok", LOST: "neutral" };

export default function LeadsPage() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const qs = new URLSearchParams({ ...(status && { status }), ...(kind && { kind }) }).toString();
  const { data, error, setData } = usePlatform<Lead[]>(`/leads${qs ? `?${qs}` : ""}`);
  const me = usePlatformMe();
  const canEdit = can(me.roles, "SUPER_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_BILLING");

  const move = async (lead: Lead, next: Status) => {
    try {
      const saved = await platformApi<Lead>(`/leads/${lead.id}`, { method: "PATCH", body: { status: next } });
      setData((rows) => rows?.map((r) => (r.id === saved.id ? saved : r)));
      toast(`${lead.name}: ${next.toLowerCase()}`);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Leads"
        subtitle="Walkthrough requests, booked calls and free trials from the website. Newest first."
        actions={
          <div className="flex gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
              <option value="">All types</option><option value="CONTACT">Walkthrough</option><option value="DEMO">Call booked</option><option value="TRIAL">Trial</option>
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
          <Table head={["Who", "Venue", "Type", "Status", "Received"]}>
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
                <td className="whitespace-nowrap px-4 py-3 text-ink-3">{ago(l.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
