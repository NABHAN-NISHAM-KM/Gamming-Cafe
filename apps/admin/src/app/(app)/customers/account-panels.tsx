"use client";

import { useEffect, useState } from "react";
import { Crown, Lock, LockOpen, SlidersHorizontal, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useCanOrg } from "@/lib/client/me";
import { idem } from "@/lib/client/sessions";
import type { Branch } from "@/lib/client/types";
import { QuickEdit, RecordActions } from "@/components/records";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, cx, askConfirm } from "@/components/ui";

export interface WalletView {
  currency: string;
  cash: string;
  bonus: string;
  total: string;
  timeMinutes: number;
  frozen: boolean;
  ledger: Array<{ id: string; at: string; type: string; bucket: string; reason: string | null; referenceType: string | null; amount: string | number; balanceAfter: string | number; expiresAt: string | null }>;
}
interface Tier {
  id: string;
  code: string;
  name: string;
  color: string | null;
  price: string | null;
  durationDays: number | null;
  gamingDiscountPct: string;
  bonusMinutesMonthly: number;
  bookingWindowDays: number;
  isActive: boolean;
  members?: number;
}
interface MembershipRow {
  id: string;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  tier: { id: string; name: string; code: string; color: string | null };
}

const TX: Record<string, string> = { TOPUP: "Top-up", SPEND: "Paid", REFUND: "Refund", ADJUSTMENT: "Adjustment", BONUS_GRANT: "Bonus", BONUS_EXPIRE: "Bonus expired" };

function useBranchPick() {
  const branches = useApi<Branch[]>("/branches");
  const [branchId, setBranchId] = useState("");
  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data.find((b) => b.code === "DXB1")?.id ?? branches.data[0].id);
  }, [branches.data, branchId]);
  return { branches, branchId, setBranchId };
}

function BranchField({ b }: { b: ReturnType<typeof useBranchPick> }) {
  if (!b.branches.data || b.branches.data.length < 2) return null;
  return (
    <Field label="At">
      <Select value={b.branchId} onChange={(e) => b.setBranchId(e.target.value)}>
        {b.branches.data.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
      </Select>
    </Field>
  );
}

function TopUp({ customerId, currency, onDone }: { customerId: string; currency: string; onDone: () => void }) {
  const can = useCan();
  const b = useBranchPick();
  const [f, setF] = useState({ amount: "", bonus: "", method: "CASH" });
  const [key] = useState(idem);
  const save = useAction(async () => {
    await api(`/customers/${customerId}/wallet/topup`, { method: "POST", action: "Wallet top-up with bonus", body: { branchId: b.branchId, amount: f.amount, bonus: f.bonus || null, payment: { method: f.method }, idempotencyKey: key } });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <BranchField b={b} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${currency})`}>
          <Input required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="100" autoFocus />
        </Field>
        <Field label="Paid by">
          <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
          </Select>
        </Field>
      </div>
      {can("customer.adjust_wallet") && (
        <Field label={`Bonus credit (${currency}, optional)`} hint="Free credit on top — expires in 90 days. Needs a reason.">
          <Input inputMode="decimal" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} placeholder="0" />
        </Field>
      )}
      <ErrorNote>{save.error}</ErrorNote>
      <Button type="submit" variant="primary" pending={save.pending} disabled={!f.amount}>
        <Wallet className="size-4" /> Top up {f.amount ? `${currency} ${f.amount}` : ""}
      </Button>
    </form>
  );
}

function Adjust({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const b = useBranchPick();
  const [f, setF] = useState({ bucket: "CASH", amount: "", reason: "" });
  const [key] = useState(idem);
  const save = useAction(async () => {
    await api(`/customers/${customerId}/wallet/adjust`, { method: "POST", action: "Wallet adjustment", reason: f.reason, body: { branchId: b.branchId, bucket: f.bucket, amount: f.amount, reason: f.reason, idempotencyKey: key } });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <p className="text-sm text-ink-2">Corrections and goodwill credit. Use a minus sign to take credit away. Every adjustment is audited.</p>
      <BranchField b={b} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="What">
          <Select value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value })}>
            <option value="CASH">Cash credit</option>
            <option value="BONUS">Bonus credit</option>
            <option value="TIME">Prepaid minutes</option>
          </Select>
        </Field>
        <Field label={f.bucket === "TIME" ? "Minutes (±)" : "Amount (±)"}>
          <Input required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={f.bucket === "TIME" ? "30" : "10"} />
        </Field>
      </div>
      <Field label="Reason">
        <Input required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="PC crashed mid-game" />
      </Field>
      <ErrorNote>{save.error}</ErrorNote>
      <Button type="submit" variant="primary" pending={save.pending}>Apply adjustment</Button>
    </form>
  );
}

export function WalletPanel({ customerId, onChanged }: { customerId: string; onChanged: () => void }) {
  const can = useCan();
  const w = useApi<WalletView>(can("wallet.view_ledger") ? `/customers/${customerId}/wallet` : null);
  const [modal, setModal] = useState<"topup" | "adjust" | null>(null);
  const freeze = useAction(async (frozen: boolean) => {
    await api(`/customers/${customerId}/wallet/freeze`, { method: "POST", action: frozen ? "Freeze wallet" : "Unfreeze wallet", body: { frozen } });
    await w.reload();
  });
  const done = () => {
    setModal(null);
    void w.reload();
    onChanged();
  };
  if (!w.data) return null;
  const d = w.data;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className={cx("rounded-lg border px-4 py-2", d.frozen ? "border-danger/40 bg-danger/10" : "border-accent/40 bg-accent/10")}>
          <p className="tabular text-xl font-semibold">{d.currency} {d.total}</p>
          <p className="text-[11px] text-ink-3">wallet · {d.cash} cash{Number(d.bonus) ? ` + ${d.bonus} bonus` : ""}{d.frozen ? " · FROZEN" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("wallet.topup") && <Button size="sm" variant="primary" onClick={() => setModal("topup")}><Wallet className="size-3.5" /> Top up</Button>}
          {can("customer.adjust_wallet") && <Button size="sm" onClick={() => setModal("adjust")}><SlidersHorizontal className="size-3.5" /> Adjust</Button>}
          {can("customer.restrict") && (
            <Button size="sm" variant="ghost" pending={freeze.pending} onClick={() => void freeze.run(!d.frozen)}>
              {d.frozen ? <><LockOpen className="size-3.5" /> Unfreeze</> : <><Lock className="size-3.5" /> Freeze</>}
            </Button>
          )}
        </div>
      </div>
      <ErrorNote>{freeze.error}</ErrorNote>
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-ink-3">Wallet &amp; time history</h3>
      {d.ledger.length === 0 ? (
        <p className="text-sm text-ink-3">No transactions yet.</p>
      ) : (
        <ul className="grid max-h-64 gap-1 overflow-y-auto text-sm">
          {d.ledger.map((l) => {
            const n = Number(l.amount);
            return (
              <li key={l.id} className="flex gap-3">
                <span className={cx("tabular w-24 shrink-0", n > 0 ? "text-ok" : "text-ink-2")}>{n > 0 ? "+" : ""}{l.bucket === "TIME" ? `${n} min` : l.amount}</span>
                <span className="w-16 shrink-0 text-xs text-ink-3">{l.bucket.toLowerCase()}</span>
                <span className="truncate text-ink-2">{TX[l.type] ?? l.type}{l.reason ? ` — ${l.reason}` : ""}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-3">{new Date(l.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={modal === "topup"} onClose={() => setModal(null)} title="Top up wallet">
        {modal === "topup" && <TopUp customerId={customerId} currency={d.currency} onDone={done} />}
      </Modal>
      <Modal open={modal === "adjust"} onClose={() => setModal(null)} title="Adjust wallet">
        {modal === "adjust" && <Adjust customerId={customerId} onDone={done} />}
      </Modal>
    </div>
  );
}

function SellMembership({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const b = useBranchPick();
  const tiers = useApi<Tier[]>("/membership-tiers");
  const [tierId, setTierId] = useState("");
  const [method, setMethod] = useState("CASH");
  const [key] = useState(idem);
  const sold = (tiers.data ?? []).filter((t) => t.isActive && t.price !== null);
  const save = useAction(async () => {
    await api(`/customers/${customerId}/memberships`, { method: "POST", action: "Sell membership", body: { branchId: b.branchId, tierId, payment: { method }, idempotencyKey: key } });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <BranchField b={b} />
      <div className="grid gap-2">
        {sold.map((t) => (
          <label key={t.id} className={cx("flex cursor-pointer items-center gap-3 rounded-lg border p-3", tierId === t.id ? "border-accent bg-accent/10" : "border-line")}>
            <input type="radio" name="tier" checked={tierId === t.id} onChange={() => setTierId(t.id)} />
            <Crown className="size-4" style={{ color: t.color ?? undefined }} />
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-ink-3">−{Number(t.gamingDiscountPct)}% gaming · {t.bonusMinutesMonthly} bonus min · book {t.bookingWindowDays} days ahead</span>
            <span className="tabular ml-auto">{Number(t.price).toFixed(2)} / {t.durationDays} d</span>
          </label>
        ))}
      </div>
      <Field label="Paid by">
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="WALLET">Customer wallet</option>
        </Select>
      </Field>
      <ErrorNote>{save.error}</ErrorNote>
      <Button type="submit" variant="primary" pending={save.pending} disabled={!tierId}><Crown className="size-4" /> Sell membership</Button>
    </form>
  );
}

export function MembershipPanel({ customerId, onChanged }: { customerId: string; onChanged: () => void }) {
  const can = useCan();
  const rows = useApi<MembershipRow[]>(`/customers/${customerId}/memberships`);
  const [selling, setSelling] = useState(false);
  const cancel = useAction(async (id: string) => {
    if (!(await askConfirm("End this membership now? No refund is made automatically."))) return;
    await api(`/customers/${customerId}/memberships/${id}/cancel`, { method: "POST", action: "Cancel membership" });
    await rows.reload();
    onChanged();
  });
  const active = rows.data?.find((m) => m.status === "ACTIVE");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {active ? (
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
            <Crown className="size-4" style={{ color: active.tier.color ?? undefined }} />
            <span className="font-medium">{active.tier.name}</span>
            <span className="text-xs text-ink-3">{active.expiresAt ? `until ${new Date(active.expiresAt).toLocaleDateString()}` : "no end date"}</span>
          </div>
        ) : (
          <span className="text-sm text-ink-3">No membership.</span>
        )}
        {can("membership.sell") && <Button size="sm" onClick={() => setSelling(true)}><Crown className="size-3.5" /> {active ? "Renew / change" : "Sell membership"}</Button>}
        {active && can("membership.sell") && <Button size="sm" variant="ghost" pending={cancel.pending} onClick={() => void cancel.run(active.id)}>End</Button>}
      </div>
      {rows.data && rows.data.length > 1 && (
        <ul className="mt-2 grid gap-0.5 text-xs text-ink-3">
          {rows.data.filter((m) => m.id !== active?.id).slice(0, 4).map((m) => (
            <li key={m.id}>{m.tier.name} · {new Date(m.startsAt).toLocaleDateString()} → {m.expiresAt ? new Date(m.expiresAt).toLocaleDateString() : "—"} <Badge tone="neutral">{m.status.toLowerCase()}</Badge></li>
          ))}
        </ul>
      )}
      <ErrorNote>{cancel.error}</ErrorNote>
      <Modal open={selling} onClose={() => setSelling(false)} title="Sell membership" wide>
        {selling && <SellMembership customerId={customerId} onDone={() => { setSelling(false); void rows.reload(); onChanged(); }} />}
      </Modal>
    </div>
  );
}

/** Owner view of the tiers: price, benefits, members. */
export function TiersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const canOrg = useCanOrg();
  const tiers = useApi<Tier[]>(open ? "/membership-tiers" : null);
  const [renaming, setRenaming] = useState<Tier | null>(null);
  const [f, setF] = useState({ code: "", name: "", rank: "15", price: "", durationDays: "30", gamingDiscountPct: "10", bonusMinutesMonthly: "0", bookingWindowDays: "7", color: "#A07CFF" });
  const add = useAction(async () => {
    await api("/membership-tiers", {
      method: "POST",
      action: "Create membership tier",
      body: {
        code: f.code.toUpperCase(), name: f.name, rank: Number(f.rank), color: f.color, price: f.price || null, durationDays: f.price ? Number(f.durationDays) : null,
        gamingDiscountPct: Number(f.gamingDiscountPct), bonusMinutesMonthly: Number(f.bonusMinutesMonthly), bookingWindowDays: Number(f.bookingWindowDays),
      },
    });
    await tiers.reload();
  });
  const toggle = useAction(async (t: Tier) => {
    await api(`/membership-tiers/${t.id}`, { method: "PATCH", action: "Update membership tier", body: { isActive: !t.isActive } });
    await tiers.reload();
  });
  return (
    <Modal open={open} onClose={onClose} title="Membership tiers" wide>
      <div className="grid gap-4">
        <ul className="grid gap-2">
          {tiers.data?.map((t) => (
            <li key={t.id} className={cx("flex items-center gap-3 rounded-lg border border-line p-3 text-sm", !t.isActive && "opacity-50")}>
              <Crown className="size-4" style={{ color: t.color ?? undefined }} />
              <span className="font-medium">{t.name}</span>
              <span className="text-ink-3">{t.price ? `${Number(t.price).toFixed(2)} / ${t.durationDays} d` : "earned, not sold"} · −{Number(t.gamingDiscountPct)}% · {t.bonusMinutesMonthly} bonus min · {t.bookingWindowDays} d booking</span>
              <span className="ml-auto text-ink-3">{t.members ?? 0} members</span>
              {canOrg("membership.manage") && <Button size="sm" variant="ghost" onClick={() => void toggle.run(t)}>{t.isActive ? "Retire" : "Restore"}</Button>}
              <RecordActions kind="membership-tier" id={t.id} name={t.name} onEdit={() => setRenaming(t)} onDone={() => void tiers.reload()} />
            </li>
          ))}
        </ul>
        {renaming && (
          <QuickEdit
            title={`Rename ${renaming.name}`} open onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); void tiers.reload(); }}
            fields={[{ key: "name", label: "Name", required: true }]} initial={{ name: renaming.name }}
            save={(v) => api(`/membership-tiers/${renaming.id}`, { method: "PATCH", action: "Update membership tier", body: { name: v["name"]!.trim() } })}
          />
        )}
        {canOrg("membership.manage") && (
          <form className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
            <p className="text-sm font-medium sm:col-span-4">New tier</p>
            <Field label="Code"><Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="PLATINUM" /></Field>
            <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Platinum" /></Field>
            <Field label="Price" hint="Empty = earned"><Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
            <Field label="Days"><Input inputMode="numeric" value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></Field>
            <Field label="Gaming discount %"><Input inputMode="numeric" value={f.gamingDiscountPct} onChange={(e) => setF({ ...f, gamingDiscountPct: e.target.value })} /></Field>
            <Field label="Bonus minutes"><Input inputMode="numeric" value={f.bonusMinutesMonthly} onChange={(e) => setF({ ...f, bonusMinutesMonthly: e.target.value })} /></Field>
            <Field label="Book ahead (days)"><Input inputMode="numeric" value={f.bookingWindowDays} onChange={(e) => setF({ ...f, bookingWindowDays: e.target.value })} /></Field>
            <Field label="Rank"><Input inputMode="numeric" value={f.rank} onChange={(e) => setF({ ...f, rank: e.target.value })} /></Field>
            <div className="sm:col-span-4"><ErrorNote>{add.error ?? toggle.error}</ErrorNote></div>
            <div className="flex justify-end sm:col-span-4"><Button type="submit" variant="primary" pending={add.pending}>Add tier</Button></div>
          </form>
        )}
      </div>
    </Modal>
  );
}

// ── loyalty ─────────────────────────────────────────────────────────────────

interface LoyaltySummary {
  points: number;
  referralCode: string | null;
  tier: string | null;
  multiplier: number;
  expiringSoon: number;
  history: Array<{ id: string; at: string; type: string; source: string; points: number; balanceAfter: number; reason: string | null }>;
  rewards: Array<{ id: string; name: string; costPoints: number; rewardType: string; stock: number | null; affordable: boolean }>;
}

/** Points: balance, history, redeeming a reward for the customer, and manual adjustments (with a reason). */
export function LoyaltyPanel({ customerId, onChanged }: { customerId: string; onChanged: () => void }) {
  const can = useCan();
  const s = useApi<LoyaltySummary>(`/customers/${customerId}/loyalty`);
  const [result, setResult] = useState<string | null>(null);
  const [adj, setAdj] = useState({ points: "", reason: "" });
  const redeem = useAction(async (rewardId: string, name: string) => {
    if (!(await askConfirm(`Redeem “${name}”?`))) return;
    const r = await api<{ code?: string; minutes?: number; walletCredit?: string; balance: number }>(`/customers/${customerId}/loyalty/redeem`, { method: "POST", body: { rewardId, idempotencyKey: idem() } });
    setResult(r.code ? `Code for the customer: ${r.code}` : r.minutes ? `${r.minutes} minutes added to their time` : r.walletCredit ? `${r.walletCredit} added to their wallet` : "Redeemed");
    await s.reload();
    onChanged();
  });
  const adjust = useAction(async () => {
    await api(`/customers/${customerId}/loyalty/adjust`, { method: "POST", reason: adj.reason, action: "Adjust points", body: { points: Number(adj.points), reason: adj.reason, idempotencyKey: idem() } });
    setAdj({ points: "", reason: "" });
    await s.reload();
  });
  if (!s.data) return null;
  const d = s.data;
  return (
    <div className="rounded-lg border border-line p-4 text-sm">
      <p className="flex items-baseline justify-between">
        <span className="font-medium">Loyalty points</span>
        <span className="text-2xl font-semibold tabular-nums">{d.points}</span>
      </p>
      <p className="text-xs text-ink-3">
        {d.tier ? `${d.tier} · ×${d.multiplier}` : "No tier"}{d.expiringSoon > 0 ? ` · ${d.expiringSoon} expire within 30 days` : ""}{d.referralCode ? ` · referral code ${d.referralCode}` : ""}
      </p>
      {result && <p className="mt-2 rounded bg-ok/10 px-2 py-1 text-ok">{result}</p>}
      <ErrorNote>{redeem.error ?? adjust.error}</ErrorNote>
      {can("loyalty.redeem") && d.rewards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {d.rewards.map((r) => (
            <Button key={r.id} size="sm" variant="secondary" disabled={!r.affordable} pending={redeem.pending} onClick={() => void redeem.run(r.id, r.name)} title={r.affordable ? "" : "Not enough points (or out of stock)"}>
              {r.name} · {r.costPoints}
            </Button>
          ))}
        </div>
      )}
      <ul className="mt-3 max-h-40 divide-y divide-line overflow-y-auto">
        {d.history.slice(0, 20).map((h) => (
          <li key={h.id} className="flex justify-between gap-2 py-1 text-xs">
            <span className="truncate text-ink-2">{h.reason ?? h.source.toLowerCase()} <span className="text-ink-3">· {new Date(h.at).toLocaleDateString()}</span></span>
            <span className={cx("tabular-nums", h.points < 0 ? "text-danger" : "text-ok")}>{h.points > 0 ? "+" : ""}{h.points}</span>
          </li>
        ))}
      </ul>
      {can("customer.adjust_points") && (
        <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void adjust.run(); }}>
          <Field label="Adjust"><Input inputMode="numeric" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} placeholder="+50 / −20" className="w-24" /></Field>
          <Field label="Reason" className="flex-1"><Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} minLength={3} required placeholder="Compensation for a crash…" /></Field>
          <Button type="submit" size="sm" pending={adjust.pending} disabled={!Number(adj.points)}>Save</Button>
        </form>
      )}
    </div>
  );
}
