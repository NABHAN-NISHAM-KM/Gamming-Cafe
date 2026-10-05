"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { Check, CheckCircle2, Copy, CreditCard, Globe, KeyRound, Moon, Smartphone, Store } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCanOrg, useMe } from "@/lib/client/me";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, PasswordInput, toast } from "@/components/ui";
import { ShellLook } from "@/components/shell-look";

export default function SettingsPage() {
  const me = useMe();
  const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(me.user.mfaEnabled);
  const [copied, setCopied] = useState(false);

  const start = useAction(async () => {
    const r = await api<{ secret: string; otpauthUrl: string }>("/auth/mfa/totp/setup", { method: "POST" });
    const qr = await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 220, color: { dark: "#0b0e14", light: "#ffffff" } });
    setEnrol({ secret: r.secret, qr });
  });
  const confirm = useAction(async () => {
    await api("/auth/mfa/totp/confirm", { method: "POST", body: { code } });
    setEnabled(true);
    setEnrol(null);
    setCode("");
  });

  return (
    <>
      <PageHeader title="Settings" subtitle="Your venue and account security." />
      <Card className="mb-4 max-w-2xl p-6">
        <div className="flex items-start gap-3">
          <Store className="mt-0.5 size-5 text-accent" />
          <div className="flex-1">
            <h2 className="font-semibold">Venue code</h2>
            <p className="mt-1 text-sm text-ink-2">Customers enter this code in the Arena app to find {me.organization.displayName}. Accounts they create belong to this venue only.</p>
            <div className="mt-4 flex items-center gap-2">
              <span className="select-all rounded-lg border border-line bg-panel-2 px-4 py-2 font-mono text-lg">{me.organization.slug}</span>
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(me.organization.slug).then(() => setCopied(true))}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {me.organization.status !== "ACTIVE" && (
              <p className="mt-3 text-sm text-reserved">The app only opens active venues — this one is {me.organization.status.toLowerCase()}. Ask ArenaOS to activate it.</p>
            )}
          </div>
        </div>
      </Card>
      <PublicPage />
      <CardGateway />
      <MinorCurfew />
      <ShellLook />
      <ChangePassword />
      <CounterPin />
      <Card className="max-w-2xl p-6">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 size-5 text-accent" />
          <div className="flex-1">
            <h2 className="flex items-center gap-2 font-semibold">
              2-step sign-in {enabled ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              After your password, you'll enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Strongly
              recommended for owners, managers and anyone who handles money.
            </p>

            {!enrol && (
              <div className="mt-4">
                <Button variant={enabled ? "secondary" : "primary"} pending={start.pending} onClick={() => void start.run()}>
                  {enabled ? "Replace authenticator" : "Set up authenticator app"}
                </Button>
                <ErrorNote>{start.error}</ErrorNote>
              </div>
            )}

            {enrol && (
              <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enrol.qr} alt="QR code for your authenticator app" className="size-[180px] rounded-lg" />
                <form
                  className="grid content-start gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirm.run();
                  }}
                >
                  <ol className="list-decimal space-y-1 pl-4 text-sm text-ink-2">
                    <li>Scan the QR code with your authenticator app.</li>
                    <li>Enter the 6-digit code it shows.</li>
                  </ol>
                  <p className="text-xs text-ink-3">
                    Can't scan? Key: <span className="select-all break-all font-mono text-ink-2">{enrol.secret}</span>
                  </p>
                  <Field label="Code">
                    <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="max-w-40 text-center font-mono tracking-[0.4em]" autoFocus />
                  </Field>
                  <ErrorNote>{confirm.error}</ErrorNote>
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" pending={confirm.pending} disabled={code.length !== 6}>
                      <CheckCircle2 className="size-4" /> Turn on
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEnrol(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

function ChangePassword() {
  const me = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const mismatch = again !== "" && next !== again;
  const save = useAction(async () => {
    await api("/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
    setCurrent("");
    setNext("");
    setAgain("");
    toast("Password changed. Your other devices were signed out.");
  });
  return (
    <Card className="mb-4 max-w-2xl p-6">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 text-accent" />
        <form
          className="grid flex-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) void save.run();
          }}
        >
          <div>
            <h2 className="font-semibold">Password</h2>
            <p className="mt-1 text-sm text-ink-2">Change the password for {me.user.email}. You stay signed in here; other devices are signed out.</p>
          </div>
          <input type="text" autoComplete="username" value={me.user.email ?? ""} readOnly hidden />
          <Field label="Current password">
            <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 12 characters.">
            <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required />
          </Field>
          <Field label="New password again">
            <PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
          </Field>
          {mismatch && <p className="text-sm text-reserved">The new passwords don't match.</p>}
          <ErrorNote>{save.error}</ErrorNote>
          <div>
            <Button type="submit" variant="primary" pending={save.pending} disabled={mismatch || next.length < 12 || !current}>Change password</Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

/** A 4–8 digit PIN so a colleague can hand the counter PC over to you (Switch staff, top bar). */
function CounterPin() {
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const save = useAction(async () => {
    await api("/auth/pin", { method: "POST", body: { password, pin } });
    setPassword("");
    setPin("");
    toast("Counter PIN saved. Colleagues can now hand the counter to you with \"Switch staff\".");
  });
  return (
    <Card className="mb-4 max-w-2xl p-6">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 text-accent" />
        <form
          className="grid flex-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run();
          }}
        >
          <div>
            <h2 className="font-semibold">My counter PIN</h2>
            <p className="mt-1 text-sm text-ink-2">
              On a shared counter PC, press <strong>Switch staff</strong> at the top, pick your name and type this PIN — no need to sign the last person out. People with 2-step sign-in turned on still sign in with their password and code.
            </p>
          </div>
          <Field label="New PIN" hint="4 to 8 digits. Don't reuse your bank PIN.">
            <Input type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,8}" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
          </Field>
          <Field label="Your password" hint="To confirm it's you.">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <ErrorNote>{save.error}</ErrorNote>
          <div>
            <Button type="submit" variant="primary" pending={save.pending} disabled={pin.length < 4 || !password}>Save PIN</Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

/** The venue's page on the ArenaOS website (/v/<code>): hours, free stations, prices, tournaments. Never who is playing. */
function PublicPage() {
  const me = useMe();
  const canOrg = useCanOrg();
  const { data: org, setData } = useApi<{ settings: Record<string, unknown> | null }>("/organization");
  const on = !!org?.settings?.["publicPage"];
  const toggle = useAction(async () => {
    // PATCH replaces the whole settings object, so send the rest of it back unchanged.
    const saved = await api<{ settings: Record<string, unknown> | null }>("/organization", { method: "PATCH", body: { settings: { ...(org?.settings ?? {}), publicPage: !on } } });
    setData(saved);
    toast(!on ? "Your venue page is live" : "Your venue page is hidden");
  });
  if (!org) return null;
  return (
    <Card className="mb-4 max-w-2xl p-6">
      <div className="flex items-start gap-3">
        <Globe className="mt-0.5 size-5 text-accent" />
        <div className="flex-1">
          <h2 className="flex items-center gap-2 font-semibold">Public venue page {on ? <Badge tone="ok">Live</Badge> : <Badge>Hidden</Badge>}</h2>
          <p className="mt-1 text-sm text-ink-2">A page on the ArenaOS website at <span className="font-mono">/v/{me.organization.slug}</span> showing your opening hours, how many stations are free right now, your prices and upcoming public tournaments — with a link to your app. It never shows who is playing.</p>
          <ErrorNote>{toggle.error}</ErrorNote>
          {canOrg("org.manage") ? (
            <Button className="mt-4" variant={on ? "secondary" : "primary"} onClick={() => void toggle.run()} disabled={toggle.pending}>{on ? "Hide the page" : "Publish the page"}</Button>
          ) : (
            <p className="mt-3 text-sm text-ink-3">Only someone who can manage the organization can change this.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Card top-ups in the customer app go through the venue's own Stripe account. Secrets stay on the server. */
function CardGateway() {
  const canOrg = useCanOrg();
  const may = canOrg("payment.gateway_manage");
  const { data, setData } = useApi<{ gateway: { mode: "TEST" | "LIVE"; credentialsRef: string; webhookSecretRef: string; isActive: boolean; secretFound: boolean; webhookSecretFound: boolean } | null; webhookPath: string }>(may ? "/payments/gateway" : null);
  const [f, setF] = useState<{ mode: "TEST" | "LIVE"; key: string; hook: string; isActive: boolean } | null>(null);
  const cur = f ?? (data ? { mode: data.gateway?.mode ?? "TEST", key: data.gateway?.credentialsRef ?? "env:STRIPE_SECRET_KEY", hook: data.gateway?.webhookSecretRef ?? "env:STRIPE_WEBHOOK_SECRET", isActive: data.gateway?.isActive ?? false } : null);
  const save = useAction(async () => {
    setData(await api("/payments/gateway", { method: "PUT", body: { provider: "STRIPE", mode: cur!.mode, credentialsRef: cur!.key.trim(), webhookSecretRef: cur!.hook.trim(), isActive: cur!.isActive }, action: "Save card payments", done: "Card payments saved." }));
    setF(null);
  });
  if (!may || !data || !cur) return null;
  const g = data.gateway;
  return (
    <Card className="mb-4 max-w-2xl p-6">
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 size-5 text-accent" />
        <div className="flex-1">
          <h2 className="flex items-center gap-2 font-semibold">Card top-ups in the app {g?.isActive && g.secretFound && g.webhookSecretFound ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</h2>
          <p className="mt-1 text-sm text-ink-2">Customers top up their wallet by card from their phone, through your Stripe account. Keys never go in here: put them in the server's settings and name them below.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Secret key" hint={g ? (g.secretFound ? "Found on the server" : "Not found on the server") : undefined}><Input value={cur.key} onChange={(e) => setF({ ...cur, key: e.target.value })} placeholder="env:STRIPE_SECRET_KEY" /></Field>
            <Field label="Webhook signing secret" hint={g ? (g.webhookSecretFound ? "Found on the server" : "Not found on the server") : undefined}><Input value={cur.hook} onChange={(e) => setF({ ...cur, hook: e.target.value })} placeholder="env:STRIPE_WEBHOOK_SECRET" /></Field>
          </div>
          <p className="mt-3 text-xs text-ink-3">In Stripe, send the <b>checkout.session.completed</b> event to <span className="select-all font-mono">{`<your API address>${data.webhookPath}`}</span>.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={cur.mode === "TEST"} onChange={() => setF({ ...cur, mode: "TEST" })} /> Test mode</label>
            <label className="flex items-center gap-2"><input type="radio" checked={cur.mode === "LIVE"} onChange={() => setF({ ...cur, mode: "LIVE" })} /> Live</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={cur.isActive} onChange={(e) => setF({ ...cur, isActive: e.target.checked })} /> Turned on</label>
            <Button className="ml-auto" pending={save.pending} onClick={() => void save.run()}>Save</Button>
          </div>
          <ErrorNote>{save.error}</ErrorNote>
        </div>
      </div>
    </Card>
  );
}

/** Players under an age can't play at night: sign-in is refused during the curfew and sessions stop when it starts. */
function MinorCurfew() {
  const canOrg = useCanOrg();
  const { data: org, setData } = useApi<{ settings: Record<string, unknown> | null }>("/organization");
  const saved = (org?.settings?.["minorCurfew"] ?? null) as { from: string; to: string; underAge: number } | null;
  const [f, setF] = useState<{ on: boolean; from: string; to: string; underAge: string } | null>(null);
  const cur = f ?? { on: !!saved, from: saved?.from ?? "22:00", to: saved?.to ?? "07:00", underAge: String(saved?.underAge ?? 18) };
  const save = useAction(async () => {
    const rest = { ...(org?.settings ?? {}) };
    delete rest["minorCurfew"];
    const settings = cur.on ? { ...rest, minorCurfew: { from: cur.from, to: cur.to, underAge: Number(cur.underAge) || 18 } } : rest;
    setData(await api("/organization", { method: "PATCH", body: { settings }, done: cur.on ? "Curfew saved." : "Curfew turned off." }));
    setF(null);
  });
  if (!org || !canOrg("org.manage")) return null;
  return (
    <Card className="mb-4 max-w-2xl p-6">
      <div className="flex items-start gap-3">
        <Moon className="mt-0.5 size-5 text-accent" />
        <div className="flex-1">
          <h2 className="flex items-center gap-2 font-semibold">Night curfew for young players {saved ? <Badge tone="ok">{saved.from}–{saved.to}</Badge> : <Badge>Off</Badge>}</h2>
          <p className="mt-1 text-sm text-ink-2">Players younger than the age below can't sign in during these hours, and their time stops when the curfew starts. Age comes from the birth date on their account; games rated above their age are already hidden.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
            <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={cur.on} onChange={(e) => setF({ ...cur, on: e.target.checked })} /> Turned on</label>
            <Field label="Under age"><Input type="number" min={10} max={21} value={cur.underAge} onChange={(e) => setF({ ...cur, underAge: e.target.value })} className="w-24" /></Field>
            <Field label="From"><Input type="time" value={cur.from} onChange={(e) => setF({ ...cur, from: e.target.value })} /></Field>
            <Field label="Until"><Input type="time" value={cur.to} onChange={(e) => setF({ ...cur, to: e.target.value })} /></Field>
            <Button className="ml-auto" pending={save.pending} onClick={() => void save.run()}>Save</Button>
          </div>
          <ErrorNote>{save.error}</ErrorNote>
        </div>
      </div>
    </Card>
  );
}
