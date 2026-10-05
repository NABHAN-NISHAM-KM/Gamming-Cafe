"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Skeleton, Table } from "@/components/ui";
import { can, platformApi, usePlatform } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

interface Announcement { id: string; title: string; body: string; severity: "INFO" | "WARNING"; startsAt: string; endsAt: string | null; reads: number; venues: number }

/** A message on every venue's admin console: maintenance windows, new features. Staff dismiss it once read. */
export default function AnnouncementsPage() {
  const me = usePlatformMe();
  const edit = can(me.roles, "SUPER_ADMIN", "PLATFORM_SUPPORT");
  const { data, error, reload } = usePlatform<Announcement[]>("/announcements");
  const [f, setF] = useState({ title: "", body: "", severity: "INFO", endsAt: "" });
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const publish = () =>
    run(async () => {
      await platformApi("/announcements", { method: "POST", body: { title: f.title.trim(), body: f.body.trim(), severity: f.severity, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null } });
      setF({ title: "", body: "", severity: "INFO", endsAt: "" });
    });
  const live = (a: Announcement) => new Date(a.startsAt) <= new Date() && (!a.endsAt || new Date(a.endsAt) > new Date());

  return (
    <>
      <PageHeader eyebrow="Platform" title="Announcements" subtitle="Shown at the top of every venue's admin console until each person dismisses it, or until it ends." />
      <ErrorNote>{error?.message ?? err}</ErrorNote>
      {edit && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Megaphone className="size-4 text-accent" /> New announcement</h2>
          <div className="grid gap-3 md:grid-cols-[1.2fr_2fr_0.8fr_1fr_auto]">
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} placeholder="Maintenance on Sunday" /></Field>
            <Field label="Message"><Input value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={2000} placeholder="3:00–3:10 am, stations keep running." /></Field>
            <Field label="Kind"><Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="INFO">Info</option><option value="WARNING">Warning</option></Select></Field>
            <Field label="Ends (optional)"><Input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
            <div className="flex items-end"><Button disabled={!f.title.trim() || !f.body.trim()} onClick={() => void publish()}>Publish</Button></div>
          </div>
        </Card>
      )}
      <Card>
        {!data ? <Skeleton rows={3} /> : data.length === 0 ? <Empty title="No announcements yet." /> : (
          <Table head={["Announcement", "Seen by", "Status", ""]}>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3"><span className="font-medium">{a.title}</span> {a.severity === "WARNING" && <Badge tone="warn">warning</Badge>}<span className="block max-w-xl text-xs text-ink-3">{a.body}</span></td>
                <td className="px-4 py-3 text-ink-2">{a.reads} people · {a.venues} venues</td>
                <td className="px-4 py-3">{live(a) ? <Badge tone="ok">showing</Badge> : <Badge>ended</Badge>}</td>
                <td className="px-4 py-3 text-right">{edit && live(a) && <Button size="sm" variant="ghost" onClick={() => void run(() => platformApi(`/announcements/${a.id}/end`, { method: "POST" }))}>End now</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
