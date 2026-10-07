"use client";

import { useState } from "react";
import { CreditCard, Link2, Mail, Megaphone, Bell, Check, Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Skeleton, toast } from "@/components/ui";
import { can, platformApi, usePlatform, type PlatformError } from "@/lib/client/platform";
import { usePlatformMe } from "@/lib/client/platform-me";

interface Setting {
  key: string; group: "mail" | "payments" | "links" | "push" | "growth"; label: string; help: string; type: "text" | "number" | "url" | "email" | "choice";
  choices: string[] | null; placeholder: string | null; secret: boolean; live: boolean; source: "saved" | "server" | "unset"; set: boolean; value: string | null;
}
interface Data { settings: Setting[]; envOnly: Array<{ keys: string; why: string }> }

const GROUPS = [
  { id: "mail", title: "Mail", icon: Mail, blurb: "The outgoing mail server. Used for password-reset codes and for telling you about new leads." },
  { id: "payments", title: "Payments", icon: CreditCard, blurb: "Your own Stripe account, so venues can pay their ArenaOS plan by card. Venues add their own Stripe keys in their own Settings." },
  { id: "links", title: "Addresses", icon: Link2, blurb: "Where each app lives on the internet. Used in QR codes, receipts, referral links and return links after paying." },
  { id: "push", title: "Phone notifications", icon: Bell, blurb: "Keys for web push. Generate a pair with `npm run keys -w @arena/api`." },
  { id: "growth", title: "Sales & sign-ups", icon: Megaphone, blurb: "How new leads reach you and how free trials start." },
] as const;

const sourceBadge = (s: Setting) =>
  s.source === "saved" ? <Badge tone="ok">saved here</Badge> : s.source === "server" ? <Badge>from the server</Badge> : <Badge tone="warn">not set</Badge>;

/** Everything an operator may change without touching the server's files. Secrets are encrypted and never shown again. */
export default function SettingsPage() {
  const me = usePlatformMe();
  const allowed = can(me.roles, "SUPER_ADMIN");
  const { data, error, reload } = usePlatform<Data>(allowed ? "/settings" : null);
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [mailTo, setMailTo] = useState("");
  const [mailBusy, setMailBusy] = useState(false);

  if (!allowed) return <><PageHeader eyebrow="Platform" title="Settings" /><Card className="p-6 text-sm text-ink-2">Only a Super Admin can change platform settings.</Card></>;

  const dirty = Object.keys(edits).length;
  const save = async () => {
    setBusy(true);
    setErr(null);
    setProblems({});
    try {
      await platformApi("/settings", { method: "PUT", body: { values: edits } });
      setEdits({});
      await reload();
      toast("Settings saved. Changes apply within seconds.");
    } catch (e) {
      const pe = e as PlatformError;
      if (pe.body?.error === "settings_invalid") setProblems(pe.body.problems ?? {});
      setErr(pe.body?.error === "settings_invalid" ? "Some values aren't valid. Fix the marked fields." : pe.message);
    } finally {
      setBusy(false);
    }
  };
  const checkMail = async (to?: string) => {
    setMailBusy(true);
    try {
      const r = await platformApi<{ ok: boolean; error?: string }>("/settings/test-mail", { method: "POST", body: to ? { to } : {} });
      toast(r.ok ? (to ? `Test message sent to ${to}.` : "Connected to the mail server.") : `Failed: ${r.error}`, r.ok ? "ok" : "warn");
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setMailBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Settings"
        subtitle="Mail, payment keys and addresses, kept here instead of in a server file. Secrets are stored encrypted and never shown again."
        actions={<Button pending={busy} disabled={!dirty} onClick={() => void save()}><Check className="size-4" /> Save {dirty ? `(${dirty})` : ""}</Button>}
      />
      <ErrorNote>{err ?? error?.message}</ErrorNote>
      {!data ? <Skeleton rows={8} /> : (
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <Card key={g.id} className="p-6">
              <div className="flex items-start gap-3">
                <g.icon className="mt-0.5 size-5 text-accent" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{g.title}</h2>
                  <p className="mt-1 text-sm text-ink-2">{g.blurb}</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {data.settings.filter((s) => s.group === g.id).map((s) => {
                      const edited = s.key in edits;
                      const cur = edited ? (edits[s.key] ?? "") : (s.secret ? "" : (s.value ?? ""));
                      const set = (v: string) => setEdits((e) => ({ ...e, [s.key]: v }));
                      return (
                        <Field key={s.key} label={s.label} hint={<span className="flex flex-wrap items-center gap-1.5">{sourceBadge(s)}{!s.live && <Badge tone="warn">restart needed</Badge>}</span>}>
                          <div className="flex gap-2">
                            {s.type === "choice" ? (
                              <Select value={edited ? cur : (s.value ?? s.choices![0]!)} onChange={(e) => set(e.target.value)}>{s.choices!.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
                            ) : (
                              <Input
                                type={s.secret ? "password" : s.type === "number" ? "number" : "text"} autoComplete="off" value={cur} onChange={(e) => set(e.target.value)}
                                placeholder={s.secret && s.set ? "••••••••  (set; type to replace)" : (s.placeholder ?? "")} aria-invalid={!!problems[s.key]}
                              />
                            )}
                            {s.source === "saved" && !edited && <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${s.label}`} onClick={() => setEdits((e) => ({ ...e, [s.key]: null }))}><Trash2 className="size-3.5" /></Button>}
                          </div>
                          {edits[s.key] === null && <span className="mt-1 block text-xs text-warn">Will be removed when you save{s.source === "saved" ? "; the server's own value applies again" : ""}.</span>}
                          {problems[s.key] && <span className="mt-1 block text-xs text-bad">{problems[s.key]}</span>}
                          <span className="mt-1 block text-xs text-ink-3">{s.help}</span>
                        </Field>
                      );
                    })}
                  </div>
                  {g.id === "mail" && (
                    <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                      <p className="basis-full text-xs text-ink-3">Save first, then check. Both buttons use what is saved.</p>
                      <Button variant="secondary" pending={mailBusy} onClick={() => void checkMail()}>Check connection</Button>
                      <Field label="Send a test message to" className="min-w-56 flex-1"><Input type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="you@example.com" /></Field>
                      <Button variant="secondary" pending={mailBusy} disabled={!mailTo.includes("@")} onClick={() => void checkMail(mailTo)}><Send className="size-4" /> Send test</Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
          <Card className="p-6">
            <h2 className="font-semibold">Stays on the server</h2>
            <p className="mt-1 text-sm text-ink-2">These must exist before ArenaOS can start, or decide who can sign in, so they can't be changed from a web page.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {data.envOnly.map((e) => <li key={e.keys}><span className="font-mono text-xs">{e.keys}</span><span className="block text-ink-3">{e.why}</span></li>)}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
