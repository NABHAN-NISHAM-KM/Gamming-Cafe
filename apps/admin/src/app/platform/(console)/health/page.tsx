"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card, Empty, ErrorNote, PageHeader, Skeleton, Table } from "@/components/ui";
import { ago, usePlatform } from "@/lib/client/platform";

interface Venue { id: string; slug: string; name: string; status: string; plan: string | null; stations: number; online: number; lastSession: string | null; sessions7d: number; drops7d: number; openAlerts: number; flags: string[] }

/** Every venue at a glance — and the ones that need a call: trials that never connected a PC, venues gone quiet, stations dropping off. */
export default function HealthPage() {
  const { data, error } = usePlatform<{ venues: Venue[]; attention: number }>("/health");
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const rows = (data?.venues ?? []).filter((v) => !onlyFlagged || v.flags.length);
  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Venue health"
        subtitle={data ? `${data.attention} of ${data.venues.length} venues need a look.` : "Loading…"}
        actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only those needing a look</label>}
      />
      <ErrorNote>{error?.message}</ErrorNote>
      <Card>
        {!data ? <Skeleton rows={6} /> : rows.length === 0 ? <Empty title="All venues look healthy." /> : (
          <Table head={["Venue", "Stations online", "Sessions (7 days)", "Last session", "Drop-offs (7 days)", "Needs a look"]}>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3"><Link href={`/platform/organizations/${v.id}`} className="font-medium hover:text-accent">{v.name}</Link><span className="block text-xs text-ink-3">{v.status.toLowerCase()}{v.plan ? ` · ${v.plan}` : ""}</span></td>
                <td className="tabular px-4 py-3">{v.online} / {v.stations}</td>
                <td className="tabular px-4 py-3">{v.sessions7d}</td>
                <td className="px-4 py-3 text-ink-2">{v.lastSession ? ago(v.lastSession) : "never"}</td>
                <td className="tabular px-4 py-3">{v.drops7d}</td>
                <td className="px-4 py-3">{v.flags.length ? v.flags.map((f) => <Badge key={f} tone="warn">{f}</Badge>) : <span className="text-ok">OK</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
