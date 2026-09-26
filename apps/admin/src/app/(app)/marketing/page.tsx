"use client";

import { useState } from "react";
import { Gift, Megaphone, Pause, Play, Plus, RefreshCw, Send, Tag, Users } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

type Tab = "promotions" | "loyalty" | "segments" | "campaigns";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");
const TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "accent"> = { DRAFT: "neutral", ACTIVE: "ok", PAUSED: "warn", ARCHIVED: "neutral", EXPIRED: "neutral", SCHEDULED: "accent", SENDING: "accent", SENT: "ok", CANCELLED: "neutral", FAILED: "danger" };

interface Promotion { id: string; name: string; type: string; status: string; conditions: Record<string, unknown>; effects: Array<Record<string, unknown>>; isStackable: boolean; requiresCode: boolean; perCustomerLimit: number | null; totalUsageLimit: number | null; usageCount: number; startsAt: string | null; endsAt: string | null; codes: number; redemptions: number }
interface Segment { id: string; key: string | null; name: string; kind: string; rules: Record<string, unknown>; memberCount: number; lastEvaluatedAt: string | null }

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>("promotions");
  return (
    <div className="space-y-5">
      <PageHeader title="Marketing" subtitle="Promotions that apply by themselves at the till, loyalty points and rewards, customer segments, and campaigns to the customer app and PCs." />
      <div className="flex gap-1 border-b border-line">
        {(["promotions", "loyalty", "segments", "campaigns"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-4 py-2 text-sm capitalize", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>{t}</button>
        ))}
      </div>
      {tab === "promotions" ? <Promotions /> : tab === "loyalty" ? <Loyalty /> : tab === "segments" ? <Segments /> : <Campaigns />}
    </div>
  );
}

// ── promotions ──────────────────────────────────────────────────────────────

const describeEffect = (e: Record<string, unknown>) =>
  e["type"] === "PERCENT_OFF" ? `${e["value"]}% off ${pretty(String(e["target"]))}` : e["type"] === "AMOUNT_OFF" ? `${e["value"]} off ${pretty(String(e["target"]))}` : e["type"] === "BONUS_MINUTES" ? `+${e["minutes"]} free minutes` : "free item";
const describeConditions = (c: Record<string, unknown>) => {
  const all = (c["all"] as Array<Record<string, unknown>> | undefined) ?? [];
  return all.map((x) => {
    const [k, v] = Object.entries(x)[0] ?? ["", ""];
    if (k === "dayOfWeekIn") return (v as string[]).join("/");
    if (k === "timeBetween") return (v as string[]).join("–");
    if (k === "minSpend") return `spend ≥ ${v}`;
    if (k === "firstVisit") return "first visit";
    if (k === "birthday") return "birthday";
    if (k === "tierIn") return `tier ${(v as string[]).join("/")}`;
    if (k === "stationClassIn") return (v as string[]).map(pretty).join("/");
    if (k === "segmentIn") return "segment";
    return pretty(k);
  }).join(" · ") || "always";
};

function Promotions() {
  const can = useCan();
  const list = useApi<Promotion[]>("/promotions");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Promotion | null>(null);
  const status = useAction(async (p: Promotion, s: string) => {
    await api(`/promotions/${p.id}/status`, { method: "POST", body: { status: s }, action: `${s === "ACTIVE" ? "Activate" : "Pause"} promotion` });
    await list.reload();
  });
  return (
    <div className="grid gap-4">
      {can("promotion.manage") && <div className="flex justify-end"><Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Promotion</Button></div>}
      <ErrorNote>{status.error}</ErrorNote>
      <Card>
        {!list.data ? <Spinner /> : list.data.length === 0 ? <Empty icon={<Tag className="size-8" />} title="No promotions yet" /> : (
          <Table head={["Promotion", "When", "Gives", "Used", "Status", ""]}>
            {list.data.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-2"><button className="text-left" onClick={() => setOpen(p)}><p className="font-medium">{p.name}</p><p className="text-xs text-ink-3">{pretty(p.type)}{p.requiresCode ? ` · ${p.codes} code${p.codes === 1 ? "" : "s"}` : " · automatic"}{p.isStackable ? " · stacks" : ""}</p></button></td>
                <td className="px-4 py-2 text-ink-2">{describeConditions(p.conditions)}</td>
                <td className="px-4 py-2">{p.effects.map(describeEffect).join(", ")}</td>
                <td className="px-4 py-2 tabular-nums">{p.usageCount}{p.totalUsageLimit ? ` / ${p.totalUsageLimit}` : ""}</td>
                <td className="px-4 py-2"><Badge tone={TONE[p.status] ?? "neutral"}>{pretty(p.status)}</Badge></td>
                <td className="px-4 py-2 text-right">
                  {can("promotion.manage") && (p.status === "ACTIVE"
                    ? <Button size="sm" variant="ghost" pending={status.pending} onClick={() => void status.run(p, "PAUSED")}><Pause className="size-3.5" /> Pause</Button>
                    : ["DRAFT", "PAUSED"].includes(p.status) && <Button size="sm" variant="ghost" pending={status.pending} onClick={() => void status.run(p, "ACTIVE")}><Play className="size-3.5" /> Activate</Button>)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New promotion" wide>
        {creating && <PromotionForm onDone={() => { setCreating(false); void list.reload(); }} />}
      </Modal>
      <Modal open={!!open} onClose={() => { setOpen(null); void list.reload(); }} title={open?.name ?? ""} wide>
        {open && <PromotionDetail id={open.id} />}
      </Modal>
    </div>
  );
}

function PromotionForm({ onDone }: { onDone: () => void }) {
  const tiers = useApi<Array<{ code: string; name: string }>>("/membership-tiers");
  const segments = useApi<Segment[]>("/segments");
  const [f, setF] = useState({
    name: "", type: "AUTOMATIC_DISCOUNT", effect: "PERCENT_OFF", target: "GAMING_TIME", value: "10", days: [] as string[], from: "", to: "", stationClass: "", tier: "", segment: "",
    minSpend: "", firstVisit: false, birthday: false, perCustomer: "", total: "", budget: "", stackable: false, code: "", startsAt: "", endsAt: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useAction(async () => {
    const all: Array<Record<string, unknown>> = [];
    if (f.days.length) all.push({ dayOfWeekIn: f.days });
    if (f.from && f.to) all.push({ timeBetween: [f.from, f.to] });
    if (f.stationClass) all.push({ stationClassIn: [f.stationClass] });
    if (f.tier) all.push({ tierIn: [f.tier] });
    if (f.segment) all.push({ segmentIn: [f.segment] });
    if (f.minSpend) all.push({ minSpend: Number(f.minSpend) });
    if (f.firstVisit) all.push({ firstVisit: true });
    if (f.birthday) all.push({ birthday: true });
    const effect = f.effect === "BONUS_MINUTES" ? { type: "BONUS_MINUTES", minutes: Number(f.value) } : { type: f.effect, target: f.target, value: Number(f.value) };
    const p = await api<{ id: string }>("/promotions", {
      method: "POST",
      action: "Create promotion",
      body: {
        name: f.name.trim(), type: f.code ? "PROMO_CODE" : f.type, conditions: all.length ? { all } : {}, effects: [effect], isStackable: f.stackable, requiresCode: !!f.code,
        perCustomerLimit: f.perCustomer ? Number(f.perCustomer) : null, totalUsageLimit: f.total ? Number(f.total) : null, budgetAmount: f.budget ? Number(f.budget) : null,
        startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      },
    });
    if (f.code) await api(`/promotions/${p.id}/codes`, { method: "POST", action: "Create promo code", body: { code: f.code.trim() } });
    onDone();
  });
  return (
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required minLength={2} placeholder="Student Tuesday" /></Field>
      <Field label="Kind"><Select value={f.type} onChange={set("type")}>{["AUTOMATIC_DISCOUNT", "HAPPY_HOUR", "WEEKEND", "BIRTHDAY", "FIRST_VISIT", "BUNDLE"].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</Select></Field>
      <Field label="Code (optional)" hint="Only with this code"><Input value={f.code} onChange={set("code")} pattern="[A-Za-z0-9-]{3,40}" placeholder="STUDENT20" /></Field>
      <p className="text-xs uppercase tracking-wider text-ink-3 sm:col-span-4">Gives</p>
      <Field label="Effect"><Select value={f.effect} onChange={set("effect")}><option value="PERCENT_OFF">% off</option><option value="AMOUNT_OFF">Amount off</option><option value="BONUS_MINUTES">Free minutes</option></Select></Field>
      {f.effect !== "BONUS_MINUTES" && <Field label="On"><Select value={f.target} onChange={set("target")}><option value="GAMING_TIME">Gaming time</option><option value="ORDER">Food & drink orders</option></Select></Field>}
      <Field label={f.effect === "PERCENT_OFF" ? "Percent" : f.effect === "BONUS_MINUTES" ? "Minutes" : "Amount"}><Input inputMode="decimal" value={f.value} onChange={set("value")} required /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.stackable} onChange={(e) => setF({ ...f, stackable: e.target.checked })} /> Stacks with others</label>
      <p className="text-xs uppercase tracking-wider text-ink-3 sm:col-span-4">When (all must hold)</p>
      <div className="flex flex-wrap gap-1 sm:col-span-2">
        {DAYS.map((d) => <button key={d} type="button" onClick={() => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })} className={cx("rounded border px-2 py-1 text-xs capitalize", f.days.includes(d) ? "border-accent bg-accent/15 text-accent" : "border-line-strong text-ink-3")}>{d}</button>)}
      </div>
      <Field label="From"><Input type="time" value={f.from} onChange={set("from")} /></Field>
      <Field label="Until"><Input type="time" value={f.to} onChange={set("to")} /></Field>
      <Field label="Stations"><Select value={f.stationClass} onChange={set("stationClass")}><option value="">Any</option>{["PC", "CONSOLE", "VR", "SIMULATOR"].map((c) => <option key={c} value={c}>{pretty(c)}</option>)}</Select></Field>
      <Field label="Membership tier"><Select value={f.tier} onChange={set("tier")}><option value="">Anyone</option>{tiers.data?.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</Select></Field>
      <Field label="Segment"><Select value={f.segment} onChange={set("segment")}><option value="">Anyone</option>{segments.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Minimum spend"><Input inputMode="decimal" value={f.minSpend} onChange={set("minSpend")} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.firstVisit} onChange={(e) => setF({ ...f, firstVisit: e.target.checked })} /> First visit only</label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.checked })} /> Around their birthday (±3 days)</label>
      <p className="text-xs uppercase tracking-wider text-ink-3 sm:col-span-4">Limits</p>
      <Field label="Per customer"><Input type="number" min={1} value={f.perCustomer} onChange={set("perCustomer")} placeholder="∞" /></Field>
      <Field label="In total"><Input type="number" min={1} value={f.total} onChange={set("total")} placeholder="∞" /></Field>
      <Field label="Budget"><Input inputMode="decimal" value={f.budget} onChange={set("budget")} placeholder="∞" /></Field>
      <div />
      <Field label="Starts"><Input type="datetime-local" value={f.startsAt} onChange={set("startsAt")} /></Field>
      <Field label="Ends"><Input type="datetime-local" value={f.endsAt} onChange={set("endsAt")} /></Field>
      <div className="sm:col-span-4"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex items-center justify-end gap-3 sm:col-span-4"><span className="text-xs text-ink-3">Created as a draft — activate it when ready.</span><Button type="submit" variant="primary" pending={save.pending}>Create</Button></div>
    </form>
  );
}

function PromotionDetail({ id }: { id: string }) {
  const can = useCan();
  const p = useApi<Promotion & { promoCodes: Array<{ id: string; code: string; uses: number; maxUses: number | null; customerId: string | null; expiresAt: string | null }>; discountGiven: string; bonusMinutesGiven: number; redemptions: number }>(`/promotions/${id}`);
  const [n, setN] = useState("10");
  const gen = useAction(async () => {
    await api(`/promotions/${id}/codes`, { method: "POST", action: "Generate promo codes", body: { count: Number(n) || 1, maxUses: 1 } });
    await p.reload();
  });
  if (!p.data) return <Spinner />;
  const d = p.data;
  return (
    <div className="grid gap-4 text-sm">
      <p className="text-ink-2">{describeEffect(d.effects[0] ?? {})} · {describeConditions(d.conditions)}</p>
      <dl className="grid grid-cols-3 gap-3">
        <Card className="p-3"><dt className="text-xs text-ink-3">Used</dt><dd className="text-xl font-semibold tabular-nums">{d.redemptions}</dd></Card>
        <Card className="p-3"><dt className="text-xs text-ink-3">Discount given</dt><dd className="text-xl font-semibold tabular-nums">{d.discountGiven}</dd></Card>
        <Card className="p-3"><dt className="text-xs text-ink-3">Free minutes given</dt><dd className="text-xl font-semibold tabular-nums">{d.bonusMinutesGiven}</dd></Card>
      </dl>
      {can("promotion.manage") && (
        <div className="flex items-end gap-2">
          <Field label="Generate one-time codes"><Input type="number" min={1} max={1000} value={n} onChange={(e) => setN(e.target.value)} className="w-28" /></Field>
          <Button pending={gen.pending} onClick={() => void gen.run()}><Plus className="size-4" /> Generate</Button>
        </div>
      )}
      <ErrorNote>{gen.error}</ErrorNote>
      {d.promoCodes.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
          <Table head={["Code", "Uses", "Personal", "Expires"]}>
            {d.promoCodes.map((c) => (
              <tr key={c.id} className="border-t border-line"><td className="px-3 py-1.5 font-mono">{c.code}</td><td className="px-3 py-1.5 tabular-nums">{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ""}</td><td className="px-3 py-1.5 text-ink-3">{c.customerId ? "yes" : "—"}</td><td className="px-3 py-1.5 text-ink-3">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td></tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

// ── loyalty ─────────────────────────────────────────────────────────────────

const SOURCE: Record<string, string> = { GAMING: "Gaming", RESTAURANT: "Food & drinks", BOOKING: "Booking kept", TOURNAMENT: "Tournament played", TOPUP: "Wallet top-up", REFERRAL: "Referring a friend", BIRTHDAY: "Birthday" };
const REWARD_FIELDS: Record<string, Array<[string, string]>> = { FREE_MINUTES: [["minutes", "Minutes"]], WALLET_CREDIT: [["amount", "Amount"]], DISCOUNT_PERCENT: [["percent", "Percent"]], DISCOUNT_AMOUNT: [["amount", "Amount"]], PRODUCT: [["productId", "Product id"]] };

function Loyalty() {
  const can = useCan();
  const rules = useApi<Array<{ id: string; source: string; unit: string; pointsPerUnit: string; isActive: boolean }>>("/loyalty/rules");
  const rewards = useApi<Array<{ id: string; name: string; costPoints: number; rewardType: string; value: Record<string, unknown>; stock: number | null; isActive: boolean }>>("/loyalty/rewards");
  const [addingRule, setAddingRule] = useState(false);
  const [addingReward, setAddingReward] = useState(false);
  const edit = useAction(async (id: string, body: Record<string, unknown>) => {
    await api(`/loyalty/rules/${id}`, { method: "PATCH", body });
    await rules.reload();
  });
  const toggleReward = useAction(async (id: string, isActive: boolean) => {
    await api(`/loyalty/rewards/${id}`, { method: "PATCH", body: { isActive } });
    await rewards.reload();
  });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <div className="flex items-center justify-between px-5 pt-4"><h3 className="font-semibold">How points are earned</h3>{can("loyalty.manage") && <Button size="sm" onClick={() => setAddingRule(true)}><Plus className="size-4" /> Rule</Button>}</div>
        <p className="px-5 pt-1 text-xs text-ink-3">Times the customer's tier multiplier. Spend points come when a bill is paid in full; points expire after a year.</p>
        <ErrorNote>{edit.error}</ErrorNote>
        {!rules.data ? <Spinner /> : (
          <Table head={["For", "Points", "On"]}>
            {rules.data.map((r) => (
              <tr key={r.id} className={cx("border-t border-line", !r.isActive && "opacity-50")}>
                <td className="px-4 py-2">{SOURCE[r.source] ?? r.source}</td>
                <td className="px-4 py-2">
                  {can("loyalty.manage") ? <Input className="w-24" inputMode="decimal" defaultValue={Number(r.pointsPerUnit)} onBlur={(e) => Number(e.target.value) !== Number(r.pointsPerUnit) && void edit.run(r.id, { pointsPerUnit: Number(e.target.value) })} aria-label="Points" /> : Number(r.pointsPerUnit)}
                  <span className="ml-1 text-xs text-ink-3">{r.unit === "CURRENCY" ? "per AED" : r.unit === "MINUTE" ? "per minute" : "each time"}</span>
                </td>
                <td className="px-4 py-2">{can("loyalty.manage") && <input type="checkbox" checked={r.isActive} onChange={(e) => void edit.run(r.id, { isActive: e.target.checked })} aria-label="Active" />}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card>
        <div className="flex items-center justify-between px-5 pt-4"><h3 className="font-semibold">Rewards</h3>{can("loyalty.manage") && <Button size="sm" onClick={() => setAddingReward(true)}><Plus className="size-4" /> Reward</Button>}</div>
        <ErrorNote>{toggleReward.error}</ErrorNote>
        {!rewards.data ? <Spinner /> : (
          <Table head={["Reward", "Points", "Stock", ""]}>
            {rewards.data.map((r) => (
              <tr key={r.id} className={cx("border-t border-line", !r.isActive && "opacity-50")}>
                <td className="px-4 py-2"><p className="font-medium">{r.name}</p><p className="text-xs text-ink-3">{pretty(r.rewardType)}</p></td>
                <td className="px-4 py-2 tabular-nums">{r.costPoints}</td>
                <td className="px-4 py-2 tabular-nums">{r.stock ?? "∞"}</td>
                <td className="px-4 py-2">{can("loyalty.manage") && <input type="checkbox" checked={r.isActive} onChange={(e) => void toggleReward.run(r.id, e.target.checked)} aria-label="Active" />}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={addingRule} onClose={() => setAddingRule(false)} title="New points rule">
        {addingRule && <RuleForm onDone={() => { setAddingRule(false); void rules.reload(); }} />}
      </Modal>
      <Modal open={addingReward} onClose={() => setAddingReward(false)} title="New reward">
        {addingReward && <RewardForm onDone={() => { setAddingReward(false); void rewards.reload(); }} />}
      </Modal>
    </div>
  );
}

function RuleForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ source: "GAMING", unit: "CURRENCY", pointsPerUnit: "1" });
  const units = ["GAMING"].includes(f.source) ? ["CURRENCY", "MINUTE"] : ["RESTAURANT", "TOPUP"].includes(f.source) ? ["CURRENCY"] : ["EVENT"];
  const save = useAction(async () => {
    await api("/loyalty/rules", { method: "POST", body: { source: f.source, unit: units.includes(f.unit) ? f.unit : units[0], pointsPerUnit: Number(f.pointsPerUnit) } });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="For"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      {units.length > 1 && <Field label="Per"><Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{units.map((u) => <option key={u} value={u}>{u === "CURRENCY" ? "AED spent" : "minute played"}</option>)}</Select></Field>}
      <Field label="Points"><Input inputMode="decimal" value={f.pointsPerUnit} onChange={(e) => setF({ ...f, pointsPerUnit: e.target.value })} required /></Field>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending}>Add rule</Button></div>
    </form>
  );
}

function RewardForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", description: "", costPoints: "100", rewardType: "FREE_MINUTES", stock: "", target: "ORDER", v: "" });
  const save = useAction(async () => {
    const [field] = REWARD_FIELDS[f.rewardType]![0]!;
    const value: Record<string, unknown> = { [field]: field === "productId" ? f.v : Number(f.v) };
    if (f.rewardType.startsWith("DISCOUNT")) value["target"] = f.target;
    await api("/loyalty/rewards", { method: "POST", body: { name: f.name.trim(), description: f.description || null, costPoints: Number(f.costPoints), rewardType: f.rewardType, value, stock: f.stock ? Number(f.stock) : null } });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required minLength={2} /></Field>
      <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={set("description")} maxLength={300} /></Field>
      <Field label="Type"><Select value={f.rewardType} onChange={set("rewardType")}>{Object.keys(REWARD_FIELDS).map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</Select></Field>
      <Field label={REWARD_FIELDS[f.rewardType]![0]![1]}><Input value={f.v} onChange={set("v")} required /></Field>
      {f.rewardType.startsWith("DISCOUNT") && <Field label="On"><Select value={f.target} onChange={set("target")}><option value="ORDER">Food & drinks</option><option value="GAMING_TIME">Gaming time</option></Select></Field>}
      <Field label="Points"><Input type="number" min={1} value={f.costPoints} onChange={set("costPoints")} required /></Field>
      <Field label="Stock" hint="Blank = unlimited"><Input type="number" min={0} value={f.stock} onChange={set("stock")} /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}><Gift className="size-4" /> Add reward</Button></div>
    </form>
  );
}

// ── segments ────────────────────────────────────────────────────────────────

function Segments() {
  const can = useCan();
  const list = useApi<Segment[]>("/segments");
  const [open, setOpen] = useState<Segment | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = useAction(async () => {
    await api("/segments/refresh", { method: "POST" });
    await list.reload();
  });
  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <Button pending={refresh.pending} onClick={() => void refresh.run()}><RefreshCw className="size-4" /> Refresh now</Button>
        {can("crm.campaign_send") && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Segment</Button>}
      </div>
      <ErrorNote>{refresh.error}</ErrorNote>
      <Card>
        {!list.data ? <Spinner /> : (
          <Table head={["Segment", "Kind", "Members", "Updated"]}>
            {list.data.map((s) => (
              <tr key={s.id} className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={() => setOpen(s)}>
                <td className="px-4 py-2 font-medium">{s.name}{s.key && <Badge>built-in</Badge>}</td>
                <td className="px-4 py-2 text-ink-2">{s.kind === "DYNAMIC" ? "Automatic" : "Hand-picked"}</td>
                <td className="px-4 py-2 tabular-nums">{s.memberCount}</td>
                <td className="px-4 py-2 text-ink-3">{s.lastEvaluatedAt ? new Date(s.lastEvaluatedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""} wide>
        {open && <SegmentMembers s={open} />}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="New segment">
        {creating && <SegmentForm onDone={() => { setCreating(false); void list.reload(); }} />}
      </Modal>
    </div>
  );
}

function SegmentMembers({ s }: { s: Segment }) {
  const members = useApi<Array<{ id: string; displayName: string; username: string; marketingConsent: boolean; loyaltyPoints: number; lastVisitAt: string | null }>>(`/segments/${s.id}/members`);
  if (!members.data) return <Spinner />;
  return members.data.length === 0 ? <p className="text-sm text-ink-3">Nobody in this segment right now.</p> : (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table head={["Customer", "Points", "Last visit", "Marketing"]}>
        {members.data.map((m) => (
          <tr key={m.id} className="border-t border-line text-sm">
            <td className="px-3 py-1.5">{m.displayName} <span className="text-ink-3">@{m.username}</span></td>
            <td className="px-3 py-1.5 tabular-nums">{m.loyaltyPoints}</td>
            <td className="px-3 py-1.5 text-ink-3">{m.lastVisitAt ? new Date(m.lastVisitAt).toLocaleDateString() : "—"}</td>
            <td className="px-3 py-1.5">{m.marketingConsent ? <Badge tone="ok">yes</Badge> : <Badge>no</Badge>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function SegmentForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", kind: "DYNAMIC", minVisits30d: "", minSpend90d: "", inactiveDays: "", minAge: "", maxAge: "", tournamentPlayer: false });
  const save = useAction(async () => {
    const rules: Record<string, unknown> = {};
    for (const k of ["minVisits30d", "minSpend90d", "inactiveDays", "minAge", "maxAge"] as const) if (f[k]) rules[k] = Number(f[k]);
    if (f.tournamentPlayer) rules["tournamentPlayer"] = true;
    await api("/segments", { method: "POST", action: "Create segment", body: { name: f.name.trim(), kind: f.kind, rules: f.kind === "DYNAMIC" ? rules : {} } });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required minLength={2} /></Field>
      <Field label="Kind" className="sm:col-span-2"><Select value={f.kind} onChange={set("kind")}><option value="DYNAMIC">Automatic (by rules, refreshed daily)</option><option value="STATIC">Hand-picked</option></Select></Field>
      {f.kind === "DYNAMIC" && (
        <>
          <Field label="Visits in 30 days (at least)"><Input type="number" min={1} value={f.minVisits30d} onChange={set("minVisits30d")} /></Field>
          <Field label="Spend in 90 days (at least)"><Input inputMode="decimal" value={f.minSpend90d} onChange={set("minSpend90d")} /></Field>
          <Field label="Not seen for (days)"><Input type="number" min={7} value={f.inactiveDays} onChange={set("inactiveDays")} /></Field>
          <div />
          <Field label="Age from"><Input type="number" min={0} value={f.minAge} onChange={set("minAge")} /></Field>
          <Field label="Age to"><Input type="number" min={0} value={f.maxAge} onChange={set("maxAge")} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.tournamentPlayer} onChange={(e) => setF({ ...f, tournamentPlayer: e.target.checked })} /> Played a tournament (180 days)</label>
        </>
      )}
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}><Users className="size-4" /> Create</Button></div>
    </form>
  );
}

// ── campaigns ───────────────────────────────────────────────────────────────

const CHANNEL: Record<string, string> = { IN_APP: "Customer app inbox", SHELL: "On their PC (next login)", EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp" };

function Campaigns() {
  const can = useCan();
  const list = useApi<Array<{ id: string; name: string; channel: string; status: string; scheduledAt: string | null; sentAt: string | null; stats: Record<string, number>; segment: { name: string } | null; promotion: { name: string } | null }>>("/campaigns");
  const [creating, setCreating] = useState(false);
  const send = useAction(async (id: string) => {
    const r = await api<Record<string, unknown>>(`/campaigns/${id}/send`, { method: "POST", action: "Send campaign" });
    if ("targeted" in r) alert(`Sent to ${r["sent"]} · waiting for their next login ${r["queued"]} · failed ${r["failed"]} · no marketing consent ${r["withoutConsent"]}`);
    await list.reload();
  });
  return (
    <div className="grid gap-4">
      <div className="flex justify-end"><Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Campaign</Button></div>
      <ErrorNote>{send.error}</ErrorNote>
      <Card>
        {!list.data ? <Spinner /> : list.data.length === 0 ? <Empty icon={<Megaphone className="size-8" />} title="No campaigns yet" /> : (
          <Table head={["Campaign", "To", "Channel", "Status", "Reach", ""]}>
            {list.data.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-4 py-2"><p className="font-medium">{c.name}</p>{c.promotion && <p className="text-xs text-ink-3">with {c.promotion.name}</p>}</td>
                <td className="px-4 py-2 text-ink-2">{c.segment?.name ?? "All customers"}</td>
                <td className="px-4 py-2 text-ink-2">{CHANNEL[c.channel] ?? c.channel}</td>
                <td className="px-4 py-2"><Badge tone={TONE[c.status] ?? "neutral"}>{pretty(c.status)}</Badge>{c.scheduledAt && c.status !== "SENT" && <span className="block text-[11px] text-ink-3">{new Date(c.scheduledAt).toLocaleString()}</span>}</td>
                <td className="px-4 py-2 text-xs text-ink-2">{c.stats && "targeted" in c.stats ? `${c.stats["sent"] ?? 0} sent · ${c.stats["queued"] ?? 0} waiting · ${c.stats["failed"] ?? 0} failed` : "—"}</td>
                <td className="px-4 py-2 text-right">{c.status === "DRAFT" && can("crm.campaign_send") && <Button size="sm" variant="primary" pending={send.pending} onClick={() => confirm(c.scheduledAt ? "Schedule this campaign?" : "Send this campaign now?") && void send.run(c.id)}><Send className="size-3.5" /> {c.scheduledAt ? "Schedule" : "Send"}</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New campaign" wide>
        {creating && <CampaignForm onDone={() => { setCreating(false); void list.reload(); }} />}
      </Modal>
    </div>
  );
}

function CampaignForm({ onDone }: { onDone: () => void }) {
  const segments = useApi<Segment[]>("/segments");
  const promotions = useApi<Promotion[]>("/promotions");
  const [f, setF] = useState({ name: "", channel: "IN_APP", segmentId: "", promotionId: "", subject: "", body: "Hi {{firstName}}! ", scheduledAt: "" });
  const [aud, setAud] = useState<{ total: number; consenting: number; withoutConsent: number } | null>(null);
  const check = useAction(async (segmentId: string) => setAud(await api("/campaigns/audience", { method: "POST", body: { segmentId: segmentId || null } })));
  const save = useAction(async () => {
    await api("/campaigns", { method: "POST", body: { name: f.name.trim(), channel: f.channel, segmentId: f.segmentId || null, promotionId: f.promotionId || null, subject: f.subject || null, body: f.body, scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null } });
    onDone();
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name"><Input value={f.name} onChange={set("name")} required minLength={2} /></Field>
      <Field label="Channel"><Select value={f.channel} onChange={set("channel")}>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="To"><Select value={f.segmentId} onChange={(e) => { setF({ ...f, segmentId: e.target.value }); void check.run(e.target.value); }}><option value="">All customers</option>{segments.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.memberCount})</option>)}</Select></Field>
      <Field label="Attach a promotion" hint="Each person gets their own one-time code: {{code}}">
        <Select value={f.promotionId} onChange={set("promotionId")}><option value="">None</option>{promotions.data?.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      </Field>
      {aud && <p className="rounded-lg bg-panel-2 px-3 py-2 text-sm sm:col-span-2">Reaches <strong>{aud.consenting}</strong> — {aud.withoutConsent} more didn't agree to marketing and won't be contacted.</p>}
      <Field label="Title" className="sm:col-span-2"><Input value={f.subject} onChange={set("subject")} maxLength={120} /></Field>
      <Field label="Message" hint="{{firstName}} {{points}} {{code}} {{venue}}" className="sm:col-span-2">
        <textarea value={f.body} onChange={set("body")} required maxLength={1000} rows={4} className="w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
      </Field>
      <Field label="Send at (optional)"><Input type="datetime-local" value={f.scheduledAt} onChange={set("scheduledAt")} /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error ?? check.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>Save as draft</Button></div>
    </form>
  );
}
