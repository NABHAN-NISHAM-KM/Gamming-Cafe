"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Gamepad2, KeyRound } from "lucide-react";
import { describeError, session } from "@/lib/client/api";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

type Step = { kind: "credentials" } | { kind: "org"; orgs: Array<{ slug: string; name: string }> } | { kind: "mfa"; mfaToken: string };

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = () => router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

  async function submitCredentials(organizationSlug?: string) {
    setPending(true);
    setError(null);
    const { status, data } = await session("login", { email, password, organizationSlug });
    setPending(false);
    if (status === 200 && data.mfaRequired) return setStep({ kind: "mfa", mfaToken: data.mfaToken });
    if (status === 200) return done();
    if (status === 409 && data.error === "organization_required") return setStep({ kind: "org", orgs: data.organizations });
    setError(describeError(status, data));
  }

  async function submitCode() {
    if (step.kind !== "mfa") return;
    setPending(true);
    setError(null);
    const { status, data } = await session("mfa", { mfaToken: step.mfaToken, code });
    setPending(false);
    if (status === 200) return done();
    if (data.error === "invalid_mfa_token") {
      setStep({ kind: "credentials" });
      return setError("The sign-in attempt expired. Please sign in again.");
    }
    setError(describeError(status, data));
  }

  return (
    <div className="w-full max-w-sm">
      {step.kind === "credentials" && (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCredentials();
          }}
        >
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" pending={pending} className="mt-2">
            Sign in
          </Button>
        </form>
      )}

      {step.kind === "org" && (
        <div className="grid gap-3">
          <p className="text-sm text-ink-2">Your account belongs to several organizations. Choose one:</p>
          {step.orgs.map((o) => (
            <button
              key={o.slug}
              onClick={() => void submitCredentials(o.slug)}
              disabled={pending}
              className="flex items-center gap-3 rounded-lg border border-line-strong bg-panel-2 px-4 py-3 text-left transition hover:border-accent"
            >
              <Building2 className="size-4 text-accent" />
              <span className="font-medium">{o.name}</span>
              <span className="ml-auto font-mono text-xs text-ink-3">{o.slug}</span>
            </button>
          ))}
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {step.kind === "mfa" && (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
        >
          <p className="flex gap-2 text-sm text-ink-2">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-accent" />
            Enter the 6-digit code from your authenticator app.
          </p>
          <Field label="Code">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center font-mono text-lg tracking-[0.5em]"
              autoFocus
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" pending={pending} disabled={code.length !== 6}>
            Verify
          </Button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-panel lg:block">
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Gamepad2 className="size-6 text-accent" /> ArenaOS
          </div>
          <div>
            <p className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
              Every station, session and order — <span className="text-accent">one console.</span>
            </p>
            <div className="mt-8 grid max-w-md grid-cols-6 gap-2" aria-hidden>
              {["ok", "busy", "busy", "ok", "reserved", "busy", "ending", "ok", "busy", "maint", "busy", "offline"].map((s, i) => (
                <div key={i} className="aspect-square rounded-md border border-line-strong" style={{ background: `color-mix(in oklab, var(--color-${s}) 22%, transparent)`, borderColor: `var(--color-${s})` }} />
              ))}
            </div>
          </div>
          <p className="text-xs text-ink-3">Gaming cafés · Esports arenas · Internet cafés · Console & VR · Gaming restaurants</p>
        </div>
      </aside>
      <section className="flex flex-col items-center justify-center gap-8 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold lg:hidden">
            <Gamepad2 className="size-5 text-accent" /> ArenaOS
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-ink-2">Staff access to your organization.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
