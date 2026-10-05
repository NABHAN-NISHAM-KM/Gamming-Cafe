"use client";

import { useState } from "react";
import { Pause, Play, Rocket, Upload } from "lucide-react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Skeleton, Table, askConfirm } from "@/components/ui";
import { can, platformApi, usePlatform } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

interface Release {
  id: string; component: string; channel: string; version: string; artifactUrl: string; sha256: string; releaseNotes: string | null;
  rolloutPercent: number; pausedAt: string | null; publishedAt: string | null; isRevoked: boolean; createdAt: string;
}
const COMPONENTS = ["WINDOWS_AGENT", "WINDOWS_SHELL", "EDGE_SERVER", "KDS", "POS"];
const label = (c: string) => c.replace(/_/g, " ").toLowerCase().replace(/^\w/, (x) => x.toUpperCase());

/**
 * Client builds for the stations. A new build is published to a share of
 * stations first (a stable slice, so raising the share only adds stations),
 * then widened — or paused or revoked if something's wrong.
 */
export default function ReleasesPage() {
  const me = usePlatformMe();
  const edit = can(me.roles, "SUPER_ADMIN");
  const { data, error, reload } = usePlatform<Release[]>("/releases");
  const [f, setF] = useState({ component: "WINDOWS_AGENT", version: "", artifactUrl: "", sha256: "", signature: "", releaseNotes: "", rolloutPercent: "10" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = () => run(async () => {
    await platformApi("/releases", { method: "POST", body: { ...f, releaseNotes: f.releaseNotes.trim() || null, rolloutPercent: Number(f.rolloutPercent) } });
    setF({ ...f, version: "", artifactUrl: "", sha256: "", signature: "", releaseNotes: "" });
  });
  const change = (r: Release, body: Record<string, unknown>) => run(() => platformApi(`/releases/${r.id}`, { method: "PATCH", body }));
  const revoke = async (r: Release) => {
    if (await askConfirm(`Revoke ${label(r.component)} ${r.version}? Stations will never be offered it again.`)) await change(r, { revoke: true });
  };

  return (
    <>
      <PageHeader eyebrow="Platform" title="Client releases" subtitle="Publish a station build to a share of stations, watch it, then widen the rollout — or pause it." />
      <ErrorNote>{error?.message ?? err}</ErrorNote>
      {edit && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Upload className="size-4 text-accent" /> Add a build</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Component"><Select value={f.component} onChange={(e) => setF({ ...f, component: e.target.value })}>{COMPONENTS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
            <Field label="Version"><Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="1.4.2" /></Field>
            <Field label="First rollout %"><Input type="number" min={0} max={100} value={f.rolloutPercent} onChange={(e) => setF({ ...f, rolloutPercent: e.target.value })} /></Field>
            <Field label="Download URL"><Input value={f.artifactUrl} onChange={(e) => setF({ ...f, artifactUrl: e.target.value })} placeholder="https://downloads.example/ArenaOS-Agent-1.4.2.msi" /></Field>
            <Field label="SHA-256" className="md:col-span-2"><Input value={f.sha256} onChange={(e) => setF({ ...f, sha256: e.target.value })} className="font-mono text-xs" /></Field>
            <Field label="Signature" className="md:col-span-2"><Input value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} className="font-mono text-xs" /></Field>
            <Field label="Release notes" className="md:col-span-3"><Input value={f.releaseNotes} onChange={(e) => setF({ ...f, releaseNotes: e.target.value })} /></Field>
            <div className="flex items-end"><Button pending={busy} onClick={() => void add()} disabled={!f.version || !f.artifactUrl || !f.sha256 || !f.signature}>Add (unpublished)</Button></div>
          </div>
        </Card>
      )}
      <Card>
        {!data ? <Skeleton rows={4} /> : data.length === 0 ? <Empty title="No releases yet." /> : (
          <Table head={["Build", "Rollout", "Status", ""]}>
            {data.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3"><span className="font-medium">{label(r.component)} {r.version}</span> <Badge>{r.channel.toLowerCase()}</Badge>{r.releaseNotes && <span className="block max-w-md truncate text-xs text-ink-3">{r.releaseNotes}</span>}</td>
                <td className="px-4 py-3">
                  {edit && r.publishedAt && !r.isRevoked ? (
                    <Select value={String(r.rolloutPercent)} onChange={(e) => void change(r, { rolloutPercent: Number(e.target.value) })} className="w-28">
                      {[...new Set([0, 1, 5, 10, 25, 50, 100, r.rolloutPercent])].sort((a, b) => a - b).map((p) => <option key={p} value={p}>{p}%</option>)}
                    </Select>
                  ) : <span className="tabular">{r.rolloutPercent}%</span>}
                </td>
                <td className="px-4 py-3">
                  {r.isRevoked ? <Badge tone="danger">revoked</Badge> : !r.publishedAt ? <Badge>draft</Badge> : r.pausedAt ? <Badge tone="warn">paused</Badge> : <Badge tone="ok">rolling out</Badge>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {edit && !r.isRevoked && (
                    <>
                      {!r.publishedAt && <Button size="sm" onClick={() => void change(r, { publish: true })}><Rocket className="size-3.5" /> Publish</Button>}
                      {r.publishedAt && (r.pausedAt ? <Button size="sm" variant="secondary" onClick={() => void change(r, { paused: false })}><Play className="size-3.5" /> Resume</Button> : <Button size="sm" variant="secondary" onClick={() => void change(r, { paused: true })}><Pause className="size-3.5" /> Pause</Button>)}
                      <Button size="sm" variant="ghost" onClick={() => void revoke(r)}>Revoke</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
