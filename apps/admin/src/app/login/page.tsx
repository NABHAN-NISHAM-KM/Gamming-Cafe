"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, Gamepad2, KeyRound, ShieldCheck } from "lucide-react";
import { describeError, session } from "@/lib/client/api";
import { describePlatformError, platformSession } from "@/lib/client/platform";
import { Button, ErrorNote, Field, Input, PasswordInput } from "@/components/ui";
import { CodeInput, MfaEnrol } from "@/components/mfa";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, IS_DEMO } from "@/components/demo";

/**
 * One sign-in page for everyone. Venue staff and owners go to the admin
 * console; ArenaOS operators (Super Admins) continue here to the platform's
 * mandatory two-step step and land in /platform. The two backends and
 * sessions stay separate — only this page is shared.
 */
type Step =
  | { kind: "credentials" }
  | { kind: "org"; orgs: Array<{ slug: string; name: string }> }
  | { kind: "mfa"; mfaToken: string }
  | { kind: "platform-code"; mfaToken: string }
  | { kind: "platform-enrol"; mfaToken: string; secret: string; otpauthUrl: string };

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : null);

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const wantsPlatform = !!next?.startsWith("/platform");
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Demo build: /login?as=owner (manager, cashier, super) signs straight in — used by the website's live frames.
  const as = useSearchParams().get("as");
  useEffect(() => {
    if (!IS_DEMO || !as) return;
    const acct = DEMO_ACCOUNTS.find((a) => a.label.toLowerCase().replace(/\s+/g, "") === as.toLowerCase());
    if (!acct) return;
    setEmail(acct.email);
    setPassword(DEMO_PASSWORD);
    setAuto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [as]);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (auto && email && password) {
      setAuto(false);
      void submitCredentials();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, email, password]);

  const doneStaff = () => router.replace(next && !wantsPlatform ? next : "/");
  const donePlatform = () => router.replace(wantsPlatform ? next! : "/platform");
  const restart = (msg?: string) => {
    setStep({ kind: "credentials" });
    setCode("");
    setError(msg ?? null);
  };

  /** Staff sign-in. Returns true if the account turned out to be platform-only. */
  async function tryStaff(organizationSlug?: string): Promise<"platform" | void> {
    const { status, data } = await session("login", { email, password, organizationSlug });
    if (status === 200 && data.mfaRequired) return void setStep({ kind: "mfa", mfaToken: data.mfaToken });
    if (status === 200) return doneStaff();
    if (status === 409 && data.error === "organization_required") return void setStep({ kind: "org", orgs: data.organizations });
    // Right password, no venue: this may be an ArenaOS operator.
    if (status === 403 && data.error === "no_membership") return "platform";
    setError(describeError(status, data));
  }

  /** Platform sign-in. Returns true if the account isn't a platform admin. */
  async function tryPlatform(): Promise<"staff" | void> {
    const { status, data } = await platformSession("login", { email, password });
    setCode("");
    if (status === 200 && data.mfaRequired) return void setStep({ kind: "platform-code", mfaToken: data.mfaToken });
    if (status === 200 && data.mfaSetupRequired) return void setStep({ kind: "platform-enrol", mfaToken: data.mfaToken, secret: data.secret, otpauthUrl: data.otpauthUrl });
    if (status === 200 && data.ok) return donePlatform();
    if (status === 403 && data.error === "not_platform_admin") return "staff";
    setError(describePlatformError(status, data));
  }

  async function submitCredentials(organizationSlug?: string) {
    setPending(true);
    setError(null);
    try {
      // Only the first check can fail on the password, so a wrong password is never counted twice.
      if (wantsPlatform && !organizationSlug) {
        if ((await tryPlatform()) === "staff" && (await tryStaff()) === "platform") setError(describeError(403, { error: "no_membership" }));
      } else if ((await tryStaff(organizationSlug)) === "platform") {
        if ((await tryPlatform()) === "staff") setError(describeError(403, { error: "no_membership" }));
      }
    } finally {
      setPending(false);
    }
  }

  async function submitCode() {
    if (step.kind === "credentials" || step.kind === "org") return;
    setPending(true);
    setError(null);
    const platform = step.kind !== "mfa";
    const { status, data } = platform
      ? await platformSession("mfa", { mfaToken: step.mfaToken, code })
      : await session("mfa", { mfaToken: step.mfaToken, code });
    setPending(false);
    if (status === 200) return platform ? donePlatform() : doneStaff();
    if (data.error === "invalid_mfa_token") return restart("The sign-in attempt expired. Please sign in again.");
    setError(platform ? describePlatformError(status, data) : describeError(status, data));
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
            <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" pending={pending} className="mt-2">
            Sign in
          </Button>
          {IS_DEMO && (
            <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">Try the live demo as…</p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="press rounded-lg border border-line-strong bg-panel-2 px-3 py-2 text-left hover:border-accent/60"
                  >
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="block text-[11px] text-ink-3">{a.hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-3">Pick one, then Sign in. Password for all: <span className="font-mono">{DEMO_PASSWORD}</span></p>
            </div>
          )}
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

      {(step.kind === "mfa" || step.kind === "platform-code" || step.kind === "platform-enrol") && (
        <form
          className="animate-enter grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
        >
          {step.kind !== "mfa" && (
            <p className="flex items-center gap-2 rounded-lg border border-accent-2/40 bg-accent-2/10 px-3 py-2 text-xs font-medium text-accent-2">
              <ShieldCheck className="size-4" /> ArenaOS platform · Super Admin sign-in
            </p>
          )}
          {step.kind === "platform-enrol" ? (
            <MfaEnrol
              secret={step.secret}
              otpauthUrl={step.otpauthUrl}
              intro="Two-step sign-in is required for platform access. Scan this with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the code it shows."
            />
          ) : (
            <p className="flex gap-2 text-sm text-ink-2">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-accent" />
              Enter the 6-digit code from your authenticator app.
            </p>
          )}
          <Field label="Code">
            <CodeInput value={code} onChange={setCode} />
          </Field>
          {IS_DEMO && step.kind !== "mfa" && <p className="-mt-2 text-xs text-ink-3">Demo: type any 6 digits, e.g. <span className="font-mono">123456</span>.</p>}
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" pending={pending} disabled={code.length !== 6}>
            {step.kind === "platform-enrol" ? "Turn on & sign in" : "Verify"}
          </Button>
          <button type="button" onClick={() => restart()} className="press mx-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" /> Use a different account
          </button>
        </form>
      )}
    </div>
  );
}

const FLOOR = ["ok", "busy", "busy", "ok", "reserved", "busy", "ending", "ok", "busy", "maint", "busy", "offline", "busy", "ok", "busy", "busy", "reserved", "ok"];
const STATUS_LABEL: Record<string, string> = { ok: "Available", busy: "In use", reserved: "Reserved", ending: "Ending", maint: "Maintenance", offline: "Offline" };

function Mark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div className={`flex items-center gap-2.5 font-display font-bold tracking-wide ${size === "lg" ? "text-xl" : "text-lg"}`}>
      <span className="brand-gradient grid size-9 place-items-center rounded-xl text-accent-ink shadow-glow">
        <Gamepad2 className="size-5" />
      </span>
      Arena<span className="-ml-2.5 text-accent">OS</span>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-panel lg:block">
        <div aria-hidden className="grid-bg absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_30%_45%,black_15%,transparent_72%)]" />
        <div aria-hidden className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-accent/20 blur-[120px]" />
        <div aria-hidden className="absolute -bottom-48 right-0 size-[28rem] rounded-full bg-accent-2/10 blur-[120px]" />
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <Mark size="lg" />
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Venue operating system</p>
            <p className="max-w-lg font-display text-5xl font-semibold leading-[1.05]">
              Every station, session and order. <span className="gradient-text">One console.</span>
            </p>
            <div className="mt-10 grid max-w-md grid-cols-6 gap-2" aria-hidden>
              {FLOOR.map((s, i) => (
                <div
                  key={i}
                  className="animate-pop aspect-square rounded-lg border"
                  title={STATUS_LABEL[s]}
                  style={{
                    animationDelay: `${i * 35}ms`,
                    background: `color-mix(in oklab, var(--color-${s}) 18%, transparent)`,
                    borderColor: `color-mix(in oklab, var(--color-${s}) 70%, transparent)`,
                    boxShadow: s === "busy" ? `0 0 18px -6px var(--color-${s})` : undefined,
                  }}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-3">
              {["ok", "busy", "reserved", "ending", "maint"].map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: `var(--color-${s})` }} /> {STATUS_LABEL[s]}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-ink-3">Gaming cafés · Esports arenas · Internet cafés · Console & VR · Gaming restaurants</p>
        </div>
      </aside>
      <section className="relative flex flex-col items-center justify-center gap-8 p-6">
        <div className="animate-enter w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Mark />
          </div>
          <h1 className="text-3xl font-semibold">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink-2">Use your ArenaOS account email.</p>
        </div>
        <div className="animate-enter w-full max-w-sm [animation-delay:60ms]">
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-8 border-t border-line pt-5 text-center text-xs text-ink-3">
            One sign-in for venue owners, staff and ArenaOS operators. You'll land in the right console.
          </p>
        </div>
      </section>
    </main>
  );
}
