"use client";

import { useState } from "react";
import { Copy, Plug, Play, RefreshCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Spinner, askConfirm, toast } from "@/components/ui";

interface Delivery { id: string; eventType: string; status: "PENDING" | "DELIVERED" | "FAILED"; attempts: number; lastStatus: number | null; lastError: string | null; createdAt: string }
interface Endpoint { id: string; url: string; events: string[]; description: string | null; isActive: boolean; disabledReason: string | null; failureCount: number; lastDeliveryAt: string | null; deliveries: Delivery[] }
interface Data { events: string[]; endpoints: Endpoint[] }

const tone = { DELIVERED: "ok", PENDING: "warn", FAILED: "bad" } as const;

/**
 * Webhooks: ArenaOS calls the venue's own address when something happens
 * (a sale, a booking, a session). Each call is signed, so the receiver can
 * check it came from here, and is retried if the address doesn't answer.
 */
export default function IntegrationsPage() {
  const list = useApi<Data>("/webhooks");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>(["*"]);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);

  const toggle = (e: string) => setPicked((p) => (e === "*" ? ["*"] : [...p.filter((x) => x !== "*" && x !== e), ...(p.includes(e) ? [] : [e])]));
  const create = useAction(async () => {
    const r = await api<{ url: string; secret: string }>("/webhooks", { method: "POST", action: "Add webhook", body: { url: url.trim(), events: picked.length ? picked : ["*"], description: description.trim() || null }, done: "Webhook added." });
    setSecret({ url: r.url, secret: r.secret });
    setUrl("");
    setDescription("");
    void list.reload();
  });
  const act = useAction(async (path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, done?: string) => {
    const r = await api<{ secret?: string } | null>(path, { method, body, action: "Change webhook", done: done ?? false });
    if (r?.secret) setSecret({ url: "the new signing secret", secret: r.secret });
    void list.reload();
  });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.");
    } catch {
      toast("Couldn't copy: select it and copy by hand.", "warn");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Webhooks" subtitle="Tell your own systems when something happens here. Every call is signed with a secret only you hold, and retried if your address doesn't answer." />
      <ErrorNote>{create.error ?? act.error}</ErrorNote>
      {secret && (
        <Card className="space-y-3 border-ok p-5">
          <p className="text-sm text-ink-2">Signing secret for <b>{secret.url}</b>. <b>This is the only time it is shown.</b> Keep it where your receiver can read it.</p>
          <p className="select-all break-all font-mono text-lg" data-testid="webhook-secret">{secret.secret}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy(secret.secret)}><Copy className="size-3.5" /> Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>Done</Button>
          </div>
        </Card>
      )}
      <Card className="space-y-4 p-5">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void create.run(); }}>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Address to call" hint="Must start with https://"><Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/arena-hook" required maxLength={500} /></Field>
            <Field label="Note (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Accounting sync" maxLength={120} /></Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">What to send</legend>
            <div className="flex flex-wrap gap-2">
              {["*", ...(list.data?.events ?? [])].map((e) => (
                <label key={e} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${picked.includes(e) ? "border-accent bg-accent/10" : "border-line bg-panel"}`}>
                  <input type="checkbox" className="sr-only" checked={picked.includes(e)} onChange={() => toggle(e)} />
                  {e === "*" ? "Everything" : e.replace(".*", "")}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" pending={create.pending}><Plug className="size-4" /> Add webhook</Button>
        </form>
      </Card>
      {!list.data ? (
        <Spinner />
      ) : list.data.endpoints.length === 0 ? (
        <Card><Empty icon={<Plug className="size-8" />} title="No webhooks yet">Add an address above and every sale, booking and session reaches it within seconds.</Empty></Card>
      ) : (
        list.data.endpoints.map((e) => (
          <Card key={e.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="break-all font-mono text-sm">{e.url}</p>
                <p className="text-xs text-ink-3">{e.description ? `${e.description} · ` : ""}{e.events.includes("*") ? "everything" : e.events.map((x) => x.replace(".*", "")).join(", ")}</p>
                {e.disabledReason && <p className="mt-1 text-xs text-bad">{e.disabledReason}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={e.isActive ? "ok" : "bad"}>{e.isActive ? "on" : "off"}</Badge>
                <Button size="sm" variant="secondary" pending={act.pending} onClick={() => void act.run(`/webhooks/${e.id}/test`, "POST", undefined, "Test event sent.")}><Play className="size-3.5" /> Send test</Button>
                <Button size="sm" variant="secondary" pending={act.pending} onClick={() => void act.run(`/webhooks/${e.id}`, "PUT", { isActive: !e.isActive }, e.isActive ? "Switched off." : "Switched on.")}>{e.isActive ? "Turn off" : "Turn on"}</Button>
                <Button size="sm" variant="secondary" pending={act.pending} onClick={async () => { if (await askConfirm("Make a new secret? The old one stops working straight away.")) void act.run(`/webhooks/${e.id}/rotate-secret`, "POST"); }}><RefreshCcw className="size-3.5" /> New secret</Button>
                <Button size="sm" variant="ghost" pending={act.pending} aria-label="Delete webhook" onClick={async () => { if (await askConfirm("Delete this webhook and its history?")) void act.run(`/webhooks/${e.id}`, "DELETE", undefined, "Webhook deleted."); }}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
            {e.deliveries.length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {e.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span><Badge tone={tone[d.status]}>{d.status.toLowerCase()}</Badge> <span className="ml-1 font-mono text-xs">{d.eventType}</span></span>
                    <span className="text-xs text-ink-3">
                      {d.lastStatus ? `HTTP ${d.lastStatus}` : (d.lastError ?? "")} · {d.attempts} {d.attempts === 1 ? "try" : "tries"} · {new Date(d.createdAt).toLocaleTimeString()}
                      {d.status === "FAILED" && <Button size="sm" variant="ghost" className="ml-2" pending={act.pending} onClick={() => void act.run(`/webhooks/deliveries/${d.id}/retry`, "POST", undefined, "Queued again.")}>Try again</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
