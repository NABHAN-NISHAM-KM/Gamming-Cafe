"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Clock, CreditCard, Hourglass, Plus, Search, Square, UserRound, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import type { FloorDevice } from "@/lib/client/floor";
import { fmtCountdown, idem, money, remaining, useTick, type QuoteResponse, type SessionSummary } from "@/lib/client/sessions";
import { Button, ErrorNote, Field, Input, Select, cx, askConfirm } from "@/components/ui";

type Req = { kind: "minutes"; minutes: number } | { kind: "package"; packageId: string } | { kind: "pass" } | { kind: "open" };
type Method = "CASH" | "CARD" | "TIME_BALANCE" | "PAY_LATER";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("rounded-md border px-2.5 py-1.5 text-xs transition", active ? "border-accent bg-accent/15 text-accent" : "border-line-strong text-ink-2 hover:border-ink-3")}
    >
      {children}
    </button>
  );
}

/** Start-session form: who, which rate, how long, how they pay — with a live server quote. */
function StartForm({ device, onStarted }: { device: FloorDevice; onStarted: () => void }) {
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState<{ id: string; displayName: string; username: string } | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [req, setReq] = useState<Req>({ kind: "minutes", minutes: 60 });
  const [method, setMethod] = useState<Method>("CASH");
  const [key] = useState(idem);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [players, setPlayers] = useState(1);
  const [promoCode, setPromoCode] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const search = useApi<Array<{ id: string; displayName: string; username: string; timeBalanceMinutes: number }>>(q.trim().length >= 2 ? `/customers?q=${encodeURIComponent(q.trim())}` : null);

  // Live quote from the server (the only source of prices).
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = await api<QuoteResponse>(`/devices/${device.id}/sessions/quote`, { method: "POST", body: { customerId: customer?.id ?? null, planId, request: method === "TIME_BALANCE" ? undefined : req, players, promoCode: promoCode.trim() || null } }).catch(() => null);
      if (alive && r) {
        setQuote(r);
        if (!planId && r.plans[0]) setPlanId(r.plans[0].id);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [device.id, customer?.id, planId, req, method, players, promoCode]);

  const plan = quote?.plans.find((p) => p.id === planId) ?? quote?.plans[0];
  const unit = quote?.minorUnit ?? 2;
  const cur = quote?.currency ?? "";
  const isTime = plan && ["PER_MINUTE", "PER_HOUR"].includes(plan.billingMode);
  const isPass = plan && ["NIGHT_PASS", "DAY_PASS"].includes(plan.billingMode);
  const balance = quote?.customer?.timeBalanceMinutes ?? 0;

  useEffect(() => {
    if (!plan) return;
    if (plan.paymentTiming === "POSTPAID") {
      setReq({ kind: "open" });
      setMethod("PAY_LATER");
    } else if (isPass) setReq({ kind: "pass" });
    else if (!isTime && plan.packages[0]) setReq({ kind: "package", packageId: plan.packages[0].id });
    else if (req.kind === "open" || req.kind === "pass") setReq({ kind: "minutes", minutes: 60 });
    if (plan.paymentTiming !== "POSTPAID" && method === "PAY_LATER") setMethod("CASH");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  const start = useAction(async () => {
    await api(`/devices/${device.id}/sessions`, {
      method: "POST",
      action: "Start session",
      body: {
        customerId: customer?.id ?? null, planId: plan?.id ?? null, request: method === "TIME_BALANCE" ? { kind: "minutes", minutes: req.kind === "minutes" ? req.minutes : 1440 } : req, payment: { method }, idempotencyKey: key,
        players, ...(needsAgeCheck ? { ageConfirmed } : {}), promoCode: promoCode.trim() || null,
      },
    });
    onStarted();
  });

  const total = method === "TIME_BALANCE" ? 0 : (quote?.quote?.totalMinor ?? 0);
  const minutes = method === "TIME_BALANCE" ? Math.min(balance, req.kind === "minutes" ? req.minutes : balance) : quote?.quote?.minutes;
  // Consoles: how many play (extra controllers may cost more). Stations with a minimum age: check it.
  const maxPlayers = Math.max(1, quote?.station?.controllerCount ?? 1);
  const minAge = quote?.station?.minAge ?? null;
  const customerAge = quote?.customer?.age ?? null;
  const tooYoung = !!minAge && customerAge !== null && customerAge < minAge;
  const needsAgeCheck = !!minAge && customerAge === null;
  const canStart = device.isOnline && !tooYoung && (!needsAgeCheck || ageConfirmed) && (method === "TIME_BALANCE" ? balance > 0 : !!quote?.quote);

  return (
    <div className="grid gap-4">
      <Field label="Customer">
        {customer ? (
          <div className="flex items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm">
            <UserRound className="size-4 text-accent" />
            <span className="font-medium">{customer.displayName}</span>
            <span className="text-ink-3">@{customer.username}</span>
            {quote?.customer && <span className="ml-auto text-xs text-ink-2">{fmtCountdown(balance * 60_000, false)} prepaid</span>}
            <button type="button" className="text-xs text-ink-3 hover:text-ink" onClick={() => { setCustomer(null); if (method === "TIME_BALANCE") setMethod("CASH"); }}>
              change
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-3" />
            <Input className="pl-9" placeholder="Search name, username or phone — or leave empty for a guest" value={q} onChange={(e) => setQ(e.target.value)} />
            {search.data && search.data.length > 0 && q.trim().length >= 2 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line-strong bg-panel shadow-xl">
                {search.data.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-2" onClick={() => { setCustomer(c); setQ(""); }}>
                      {c.displayName} <span className="text-ink-3">@{c.username}</span>
                      {c.timeBalanceMinutes > 0 && <span className="ml-auto text-xs text-ok">{fmtCountdown(c.timeBalanceMinutes * 60_000, false)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>

      {method !== "TIME_BALANCE" && (
        <Field label="Rate">
          <Select value={plan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)}>
            {quote?.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.billingMode === "PER_HOUR" ? `${money(p.rateMinor, unit, cur)}/h` : p.billingMode === "PER_MINUTE" ? `${money(p.rateMinor, unit, cur)}/min` : money(p.rateMinor, unit, cur)}
                {p.paymentTiming === "POSTPAID" ? " · pay later" : ""}
              </option>
            ))}
          </Select>
          {quote && !quote.plans.length && <span className="text-xs text-danger">No rate card applies to this station right now — add one under Rates.</span>}
        </Field>
      )}

      {plan && plan.paymentTiming !== "POSTPAID" && !isPass && (
        <Field label="Time">
          <div className="flex flex-wrap gap-1.5">
            {isTime &&
              [30, 60, 120, 180].map((m) => (
                <Chip key={m} active={req.kind === "minutes" && req.minutes === m} onClick={() => setReq({ kind: "minutes", minutes: m })}>
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </Chip>
              ))}
            {method !== "TIME_BALANCE" &&
              plan.packages.map((k) => (
                <Chip key={k.id} active={req.kind === "package" && req.packageId === k.id} onClick={() => setReq({ kind: "package", packageId: k.id })}>
                  {k.name} · {money(k.priceMinor, unit, cur)}
                </Chip>
              ))}
          </div>
        </Field>
      )}

      {maxPlayers > 1 && (
        <Field label="Players" hint={plan?.extraPlayerRateMinor && (plan.includedPlayers ?? 1) < maxPlayers ? `${plan.includedPlayers ?? 1} included · each extra ${money(plan.extraPlayerRateMinor, unit, cur)}/${plan.billingMode === "PER_MINUTE" ? "min" : "h"}` : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: maxPlayers }, (_, i) => i + 1).map((n) => (
              <Chip key={n} active={players === n} onClick={() => setPlayers(n)}>
                {n}
              </Chip>
            ))}
          </div>
        </Field>
      )}
      {tooYoung && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{customer?.displayName} is {customerAge} — this station is {minAge}+.</p>}
      {needsAgeCheck && (
        <label className="flex items-center gap-2 rounded-lg border border-reserved/40 bg-reserved/10 px-3 py-2 text-sm text-reserved">
          <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} /> I&apos;ve checked the player is {minAge} or older
        </label>
      )}

      {method !== "TIME_BALANCE" && plan?.paymentTiming !== "POSTPAID" && (
        <Field label="Promo code (optional)">
          <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Automatic offers apply by themselves" maxLength={40} />
        </Field>
      )}

      <Field label="Payment">
        <div className="flex flex-wrap gap-1.5">
          {plan?.paymentTiming === "POSTPAID" ? (
            <Chip active onClick={() => undefined}>
              <Hourglass className="mr-1 inline size-3" /> Pay at the end
            </Chip>
          ) : (
            <>
              <Chip active={method === "CASH"} onClick={() => setMethod("CASH")}>
                Cash
              </Chip>
              <Chip active={method === "CARD"} onClick={() => setMethod("CARD")}>
                <CreditCard className="mr-1 inline size-3" /> Card
              </Chip>
              {customer && balance > 0 && (
                <Chip active={method === "TIME_BALANCE"} onClick={() => setMethod("TIME_BALANCE")}>
                  <Wallet className="mr-1 inline size-3" /> Prepaid time
                </Chip>
              )}
            </>
          )}
        </div>
      </Field>

      <div className="rounded-lg border border-line bg-bg p-3">
        {method === "TIME_BALANCE" ? (
          <p className="text-sm">{minutes} min from {customer?.displayName}&apos;s prepaid time · unused time returns to the account</p>
        ) : quote?.quote ? (
          <>
            {quote.quote.lines.map((l) => (
              <p key={l} className="text-xs text-ink-2">
                {l}
              </p>
            ))}
            <p className="mt-1 flex items-baseline justify-between">
              <span className="text-xs text-ink-3">{quote.quote.minutes ? `${quote.quote.minutes} min` : "Open session"}</span>
              <span className="tabular text-xl font-semibold">{money(total, unit, cur)}</span>
            </p>
          </>
        ) : (
          <p className="text-xs text-danger">{quote?.error ?? "Choose a rate"}</p>
        )}
      </div>
      {!device.isOnline && <p className="text-xs text-reserved">This PC is offline — switch it on first.</p>}
      <ErrorNote>{start.error}</ErrorNote>
      <Button variant="primary" pending={start.pending} disabled={!canStart} onClick={() => void start.run()}>
        <Clock className="size-4" /> Start session{method !== "TIME_BALANCE" && quote?.quote && total > 0 ? ` · ${money(total, unit, cur)}` : ""}
      </Button>
    </div>
  );
}

/** Running session: countdown, extend, move, end. */
function RunningSession({ device, session, available, onChange }: { device: FloorDevice; session: SessionSummary; available: FloorDevice[]; onChange: () => void }) {
  useTick();
  const can = useCan();
  const ms = remaining(session.expiresAt);
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState("");
  const extend = useAction(async (minutes: number, method: Method) => {
    await api(`/sessions/${session.id}/extend`, { method: "POST", action: "Extend session", body: { minutes, payment: { method }, idempotencyKey: idem() } });
    onChange();
  });
  const end = useAction(async () => {
    if (!(await askConfirm(`End ${session.customer?.displayName ?? session.guestLabel ?? "this"} session on ${device.name} now?`))) return;
    await api(`/sessions/${session.id}/end`, { method: "POST", action: "End session", body: {} });
    onChange();
  });
  const move = useAction(async () => {
    await api(`/sessions/${session.id}/move`, { method: "POST", action: "Move session", body: { toDeviceId: target } });
    setMoving(false);
    onChange();
  });
  const low = ms !== null && ms <= 5 * 60_000;

  return (
    <div className="grid gap-4">
      <div className={cx("rounded-xl border p-4 text-center", low ? "border-ending/50 bg-ending/10" : "border-busy/40 bg-busy/10")}>
        <p className="text-xs uppercase tracking-wider text-ink-3">{session.expiresAt ? "Time left" : "Running"}</p>
        <p className={cx("tabular mt-1 font-mono text-4xl font-semibold", low && "text-ending")}>
          {session.expiresAt ? fmtCountdown(ms) : fmtCountdown(Date.now() - new Date(session.startedAt ?? Date.now()).getTime())}
        </p>
        <p className="mt-2 text-sm">
          {session.customer?.displayName ?? session.guestLabel ?? "Guest"} · <span className="text-ink-2">{session.planName}</span>
        </p>
        <p className="text-xs text-ink-3">
          {session.paymentTiming === "POSTPAID" ? "Pay at the end" : `Paid ${session.currency} ${session.amountDue}`}
        </p>
      </div>

      {can("station.extend_session", device.branchId) && session.expiresAt && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Add time</p>
          <div className="grid grid-cols-3 gap-2">
            {[30, 60, 120].map((m) => (
              <Button key={m} size="sm" pending={extend.pending} onClick={() => void extend.run(m, "CASH")}>
                <Plus className="size-3.5" /> {m < 60 ? `${m}m` : `${m / 60}h`}
              </Button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-3">Charged at this session&apos;s rate, paid in cash.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {can("station.move_session", device.branchId) && (
          <Button size="sm" onClick={() => setMoving((v) => !v)} disabled={!available.length}>
            <ArrowRightLeft className="size-3.5" /> Move
          </Button>
        )}
        {can("station.end_session", device.branchId) && (
          <Button size="sm" variant="danger" pending={end.pending} onClick={() => void end.run()}>
            <Square className="size-3.5" /> End session
          </Button>
        )}
      </div>
      {moving && (
        <div className="flex gap-2">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="" disabled>
              Move to…
            </option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" disabled={!target} pending={move.pending} onClick={() => void move.run()}>
            Move
          </Button>
        </div>
      )}
      <ErrorNote>{extend.error ?? end.error ?? move.error}</ErrorNote>
    </div>
  );
}

export function SessionPanel({ device, allDevices, onChange }: { device: FloorDevice & { session?: SessionSummary | null }; allDevices: FloorDevice[]; onChange: () => void }) {
  const can = useCan();
  const available = useMemo(() => allDevices.filter((d) => d.id !== device.id && d.isOnline && d.status === "AVAILABLE"), [allDevices, device.id]);
  if (device.session) return <RunningSession device={device} session={device.session} available={available} onChange={onChange} />;
  if (!can("station.start_session", device.branchId)) return <p className="text-sm text-ink-3">Available.</p>;
  if (device.status === "CLEANING") return <MarkCleaned device={device} onDone={onChange} />;
  if (device.status !== "AVAILABLE" && device.status !== "RESERVED") return <p className="text-sm text-ink-3">This station is {device.status.toLowerCase().replace("_", " ")}.</p>;
  return <StartForm device={device} onStarted={onChange} />;
}

/** VR headsets and shared gear are wiped down between players before the next session. */
function MarkCleaned({ device, onDone }: { device: FloorDevice; onDone: () => void }) {
  const done = useAction(async () => {
    await api(`/devices/${device.id}/cleaned`, { method: "POST" });
    onDone();
  });
  return (
    <div className="grid gap-3">
      <p className="rounded-lg border border-reserved/40 bg-reserved/10 px-3 py-2 text-sm text-reserved">Needs cleaning before the next player — wipe the headset and controllers.</p>
      <ErrorNote>{done.error}</ErrorNote>
      <Button variant="primary" pending={done.pending} onClick={() => void done.run()}>Mark cleaned</Button>
    </div>
  );
}
