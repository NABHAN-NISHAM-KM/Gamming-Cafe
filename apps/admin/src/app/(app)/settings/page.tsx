"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { Check, CheckCircle2, Copy, Smartphone, Store } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/hooks";
import { useMe } from "@/lib/client/me";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader } from "@/components/ui";

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
