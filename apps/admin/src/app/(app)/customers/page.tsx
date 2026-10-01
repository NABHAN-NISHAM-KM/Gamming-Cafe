"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, CreditCard, Crown, Download, GitMerge, Gift, KeyRound, Megaphone, Plus, Tag, UserPlus, Users, UserX } from "lucide-react";
import { BranchField, LoyaltyPanel, MembershipPanel, TiersModal, WalletPanel, useBranchPick } from "./account-panels";
import { ActivityPanel, LoginsPanel, MergeForm, NotesPanel, PeoplePanel, ProfileForm, RestrictionsPanel, SummaryStrip, TicketsPanel, Verification, printCard, type Insights, type Profile } from "./customer-file";
import { api, ApiError } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import { fmtCountdown, idem } from "@/lib/client/sessions";
import type { Branch } from "@/lib/client/types";
import { RecordActions } from "@/components/records";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PasswordInput, Modal, PageHeader, Select, Spinner, Table, askConfirm, askText, cx, toast } from "@/components/ui";

interface Customer {
  id: string;
  username: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  status: string;
  timeBalanceMinutes: number;
  walletBalance: string;
  lastVisitAt: string | null;
  membershipTier: { name: string; color: string | null } | null;
  tags: string[];
  loyaltyPoints: number;
  totalSpend: string;
}
interface Detail extends Customer, Profile {
  sessions: Array<{ id: string; status: string; startedAt: string | null; endedAt: string | null; amountDue: string; currency: string; device: { name: string }; endReason: string | null }>;
  timeLedger: Array<{ id: string; type: string; amount: number; balanceAfter: number; reason: string | null; createdAt: string }>;
}
interface Plan {
  id: string;
  name: string;
  stationClass: string;
  billingMode: string;
  paymentTiming: string;
  rate: string;
  currency: string;
  isActive: boolean;
  branchId: string | null;
  pricingPackages: Array<{ id: string; name: string; durationMinutes: number; price: string; bonusMinutes: number; isActive: boolean }>;
}

const hours = (m: number) => fmtCountdown(m * 60_000, false);

function NewCustomer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (c: Customer) => void }) {
  const [f, setF] = useState({ username: "", displayName: "", phone: "", email: "", password: "", pin: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useAction(async () => {
    const c = await api<Customer>("/customers", {
      method: "POST",
      body: { username: f.username, displayName: f.displayName || f.username, phone: f.phone || null, email: f.email || null, password: f.password || undefined, pin: f.pin || undefined },
    });
    setF({ username: "", displayName: "", phone: "", email: "", password: "", pin: "" });
    onDone(c);
  });
  return (
    <Modal open={open} onClose={onClose} title="New customer">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
        <Field label="Username" hint="Used to log in at the PC">
          <Input required value={f.username} onChange={set("username")} pattern="[a-zA-Z0-9._-]{3,32}" autoFocus />
        </Field>
        <Field label="Display name">
          <Input value={f.displayName} onChange={set("displayName")} placeholder="Shown on the PC" />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={set("phone")} placeholder="+971 50 …" />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Password" hint="6+ characters">
          <PasswordInput value={f.password} onChange={set("password")} minLength={6} />
        </Field>
        <Field label="PIN (optional)" hint="4–8 digits, quick PC login">
          <Input inputMode="numeric" value={f.pin} onChange={(e) => setF((x) => ({ ...x, pin: e.target.value.replace(/\D/g, "") }))} maxLength={8} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote>{save.error}</ErrorNote>
        </div>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary" pending={save.pending} disabled={!f.password && !f.pin}>
            Create customer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SellTime({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const branches = useApi<Branch[]>("/branches");
  const plans = useApi<Plan[]>("/pricing-plans");
  const [branchId, setBranchId] = useState("");
  const [choice, setChoice] = useState(""); // planId:packageId
  const [method, setMethod] = useState<"CASH" | "CARD" | "WALLET">("CASH");
  const [key] = useState(idem);
  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranchId(branches.data.find((b) => b.code === "DXB1")?.id ?? branches.data[0].id);
  }, [branches.data, branchId]);
  const options = (plans.data ?? [])
    .filter((p) => p.isActive && p.paymentTiming === "PREPAID" && (!p.branchId || p.branchId === branchId))
    .flatMap((p) => p.pricingPackages.filter((k) => k.isActive).map((k) => ({ value: `${p.id}:${k.id}`, label: `${p.name} — ${k.name} (${p.currency} ${Number(k.price).toFixed(2)})` })));
  const sell = useAction(async () => {
    const [planId, packageId] = choice.split(":");
    await api(`/customers/${customer.id}/time`, { method: "POST", action: "Sell prepaid time", body: { branchId, planId, packageId, payment: { method }, idempotencyKey: key } });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void sell.run(); }}>
      <p className="text-sm text-ink-2">
        Adds time to <strong className="text-ink">{customer.displayName}</strong>&apos;s account. They log in at any PC with their username and password to use it.
      </p>
      {branches.data && branches.data.length > 1 && (
        <Field label="Sold at">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Package">
        <Select required value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="" disabled>
            Choose…
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Payment">
        <Select value={method} onChange={(e) => setMethod(e.target.value as "CASH" | "CARD" | "WALLET")}>
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="WALLET">Customer wallet</option>
        </Select>
      </Field>
      <ErrorNote>{sell.error}</ErrorNote>
      <Button type="submit" variant="primary" pending={sell.pending} disabled={!choice}>
        <Clock className="size-4" /> Sell time
      </Button>
    </form>
  );
}

function SetCredentials({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const save = useAction(async () => {
    await api(`/customers/${customer.id}/credentials`, { method: "POST", body: { password: password || undefined, pin: pin || undefined } });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="New password" hint="Leave empty to keep">
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} />
      </Field>
      <Field label="New PIN" hint="4–8 digits, leave empty to keep">
        <Input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} maxLength={8} />
      </Field>
      <ErrorNote>{save.error}</ErrorNote>
      <Button type="submit" variant="primary" pending={save.pending} disabled={!password && !pin}>
        Save
      </Button>
    </form>
  );
}

const STATUS_TONE: Record<string, "danger" | "warn" | "neutral"> = { BANNED: "danger", RESTRICTED: "warn", PENDING_VERIFICATION: "neutral" };
type Tab = "overview" | "activity" | "profile" | "restrictions" | "notes" | "logins" | "tickets";
const TABS: Array<[Tab, string]> = [["overview", "Overview"], ["activity", "Activity"], ["profile", "Profile"], ["restrictions", "Restrictions"], ["notes", "Notes"], ["logins", "Logins"], ["tickets", "Tickets"]];

function CustomerDetail({ id, tab: initialTab, onChanged, onErased, onOpen }: { id: string; tab: Tab; onChanged: () => void; onErased: () => void; onOpen: (id: string) => void }) {
  const can = useCan();
  const me = useMe();
  const c = useApi<Detail>(`/customers/${id}`);
  const ins = useApi<Insights>(`/customers/${id}/insights`);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [modal, setModal] = useState<"time" | "credentials" | "merge" | null>(null);
  const changed = () => { void c.reload(); void ins.reload(); onChanged(); };
  const erase = useAction(async () => {
    const who = c.data!.displayName;
    if (!(await askConfirm(`Erase ${who}? Their name, phone, email, birthday and logins are deleted for good and they can't sign in again. Bills, payments and points stay in the books, without their name. This can't be undone.`))) return;
    await api(`/customers/${id}/erase`, { method: "POST", action: `Erase ${who}`, done: false });
    toast(`${who} was erased.`);
    onErased();
  });
  if (!c.data) return <Spinner />;
  const d = c.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {d.displayName}
            {d.status !== "ACTIVE" && <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status.toLowerCase().replace("_", " ")}</Badge>}
            {d.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
          </p>
          <p className="text-sm text-ink-3">
            @{d.username} {d.phone && `· ${d.phone}`} {d.email && `· ${d.email}`}
          </p>
        </div>
        <div className="ml-auto rounded-lg border border-ok/40 bg-ok/10 px-4 py-2 text-center">
          <p className="tabular text-xl font-semibold text-ok">{hours(d.timeBalanceMinutes)}</p>
          <p className="text-[11px] text-ink-3">prepaid time</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {can("wallet.topup") && (
          <Button variant="primary" size="sm" onClick={() => setModal("time")}>
            <Plus className="size-3.5" /> Sell time
          </Button>
        )}
        {can("customer.reset_password") && (
          <Button size="sm" onClick={() => setModal("credentials")}>
            <KeyRound className="size-3.5" /> Password / PIN
          </Button>
        )}
        <Button size="sm" onClick={() => void printCard(d, me.organization.displayName)}>
          <CreditCard className="size-3.5" /> Print card
        </Button>
        {can("customer.delete") && (
          <Button size="sm" className="ml-auto" onClick={() => setModal("merge")}>
            <GitMerge className="size-3.5" /> Merge duplicate
          </Button>
        )}
        {can("customer.delete") && (
          <Button size="sm" variant="danger" pending={erase.pending} onClick={() => void erase.run()}>
            <UserX className="size-3.5" /> Erase
          </Button>
        )}
      </div>
      <ErrorNote>{erase.error}</ErrorNote>
      <div role="tablist" className="-mb-2 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === k ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="grid gap-5">
          {ins.data ? <SummaryStrip i={ins.data} /> : <Spinner />}
          <MembershipPanel customerId={d.id} onChanged={changed} />
          <WalletPanel key={d.timeBalanceMinutes} customerId={d.id} onChanged={changed} />
          <LoyaltyPanel customerId={d.id} onChanged={changed} />
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Recent sessions</h3>
            {d.sessions.length === 0 ? (
              <p className="text-sm text-ink-3">None yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {d.sessions.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="w-16 font-medium">{s.device.name}</span>
                    <span className="text-ink-2">{s.startedAt ? new Date(s.startedAt).toLocaleString() : ""}</span>
                    <Badge tone={s.status === "ENDED" ? "neutral" : "accent"}>{s.status.toLowerCase()}</Badge>
                    <span className="tabular ml-auto">
                      {s.currency} {Number(s.amountDue).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {tab === "activity" && <ActivityPanel customerId={d.id} />}
      {tab === "profile" && (
        <div className="grid gap-6">
          {can("customer.edit") && <ProfileForm key={JSON.stringify(d)} c={d} onDone={changed} />}
          <Verification c={d} onChanged={changed} />
          {ins.data && <PeoplePanel i={ins.data} open={onOpen} />}
        </div>
      )}
      {tab === "restrictions" && <RestrictionsPanel customerId={d.id} onChanged={changed} />}
      {tab === "notes" && <NotesPanel customerId={d.id} />}
      {tab === "logins" && (ins.data ? <LoginsPanel i={ins.data} /> : <Spinner />)}
      {tab === "tickets" && <TicketsPanel customerId={d.id} />}
      <Modal open={modal === "time"} onClose={() => setModal(null)} title="Sell prepaid time">
        {modal === "time" && <SellTime customer={d} onDone={() => { setModal(null); changed(); }} />}
      </Modal>
      <Modal open={modal === "credentials"} onClose={() => setModal(null)} title="Password / PIN">
        {modal === "credentials" && <SetCredentials customer={d} onDone={() => setModal(null)} />}
      </Modal>
      <Modal open={modal === "merge"} onClose={() => setModal(null)} title="Merge a duplicate account" wide>
        {modal === "merge" && <MergeForm c={d} suggestions={ins.data?.duplicates ?? []} onDone={() => { setModal(null); changed(); }} />}
      </Modal>
    </div>
  );
}

// ── bulk actions ────────────────────────────────────────────────────────────

/** Goodwill bonus credit for every selected customer, one audited adjustment each. */
function BulkBonus({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const b = useBranchPick();
  const [f, setF] = useState({ amount: "", reason: "" });
  const [batch] = useState(idem);
  const [done, setDone] = useState(0);
  const run = useAction(async () => {
    for (const [i, id] of ids.entries()) {
      // A retry after a failure skips the ones already credited (same key per customer).
      await api(`/customers/${id}/wallet/adjust`, { method: "POST", reason: f.reason, body: { branchId: b.branchId, bucket: "BONUS", amount: f.amount, reason: f.reason, idempotencyKey: `${batch}:${id}` } });
      setDone(i + 1);
    }
    toast(`Bonus credit given to ${ids.length} customer(s).`);
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void run.run(); }}>
      <p className="text-sm text-ink-2">Free credit for {ids.length} customer(s). It expires in 90 days.</p>
      <BranchField b={b} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount each"><Input required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="10" autoFocus /></Field>
        <Field label="Reason"><Input required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Eid gift" /></Field>
      </div>
      <ErrorNote>{run.error && `${run.error} (${done} of ${ids.length} done)`}</ErrorNote>
      <Button type="submit" variant="primary" pending={run.pending}><Gift className="size-4" /> Give {f.amount || "…"} to {ids.length}</Button>
    </form>
  );
}

/** Puts the selection in a hand-picked segment, ready for a campaign in Marketing. */
function BulkSegment({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const segments = useApi<Array<{ id: string; name: string; kind: string }>>("/crm/segments");
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const run = useAction(async () => {
    const id = pick || (await api<{ id: string }>("/crm/segments", { method: "POST", body: { name, kind: "STATIC" } })).id;
    await api(`/crm/segments/${id}/members`, { method: "POST", body: { add: ids } });
    toast(`${ids.length} customer(s) added. Write the message in Marketing → Campaigns.`);
    onDone();
  });
  const fixed = segments.data?.filter((s) => s.kind === "STATIC") ?? [];
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void run.run(); }}>
      <Field label="Segment">
        <Select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">New segment…</option>
          {fixed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      {!pick && <Field label="New segment name"><Input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend regulars" autoFocus /></Field>}
      <ErrorNote>{run.error}</ErrorNote>
      <div className="flex flex-wrap justify-end gap-2">
        <a href="/marketing" className="mr-auto self-center text-sm text-accent hover:underline">Open Marketing</a>
        <Button type="submit" variant="primary" pending={run.pending}><Megaphone className="size-4" /> Add {ids.length} to segment</Button>
      </div>
    </form>
  );
}

/** Downloads the filtered list as CSV; personal data, so it asks for a reason. */
function ExportCsv({ query, onDone }: { query: string; onDone: () => void }) {
  const [consented, setConsented] = useState(true);
  const run = useAction(async () => {
    const reason = await askText("Exporting customer data needs a reason (saved in the audit log).");
    if (!reason) return;
    const res = await fetch(`/api/v1/customers/export?${query}${consented ? "&consented=1" : ""}`, { headers: { "x-arena-csrf": "1", "x-action-reason": encodeURIComponent(reason) }, cache: "no-store" });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await res.blob());
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    onDone();
  });
  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-2">Exports everyone matching the current search and filters (up to 10,000), with contact details.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} /> Only customers who agreed to receive offers
      </label>
      <ErrorNote>{run.error}</ErrorNote>
      <Button variant="primary" pending={run.pending} onClick={() => void run.run()}><Download className="size-4" /> Download CSV</Button>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

const PAGE = 50;

export default function CustomersPage() {
  const can = useCan();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(0), [debounced, status, tag, sort]);
  const filters = new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(status ? { status } : {}), ...(tag ? { tag } : {}), sort }).toString();
  const list = useApi<Customer[]>(`/customers?${filters}&page=${page}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; tab: Tab } | null>(null);
  const [tiers, setTiers] = useState(false);
  const [bulk, setBulk] = useState<"bonus" | "segment" | "export" | null>(null);
  const rows = list.data ?? [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((c) => selected.has(c.id));
  const tagAll = useAction(async () => {
    const t = (await askText(`Tag for ${selected.size} customer(s)`))?.trim();
    if (!t) return;
    const byId = new Map(rows.map((c) => [c.id, c]));
    for (const id of selected) {
      const tags = byId.get(id)?.tags ?? (await api<Customer>(`/customers/${id}`)).tags;
      if (!tags.includes(t)) await api(`/customers/${id}`, { method: "PATCH", body: { tags: [...tags, t] } });
    }
    toast(`Tagged ${selected.size} customer(s) “${t}”.`);
    void list.reload();
  });

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Accounts for the PCs and the customer app: wallet, prepaid time and membership."
        actions={
          <div className="flex gap-2">
            {can("customer.export") && (
              <Button onClick={() => setBulk("export")}>
                <Download className="size-4" /> Export
              </Button>
            )}
            {can("membership.view") && (
              <Button onClick={() => setTiers(true)}>
                <Crown className="size-4" /> Membership tiers
              </Button>
            )}
            {can("customer.create") && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <UserPlus className="size-4" /> New customer
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <Input placeholder="Search name, username, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
            {[["", "All"], ["ACTIVE", "Active"], ["RESTRICTED", "Restricted"], ["BANNED", "Banned"], ["PENDING_VERIFICATION", "Pending"]].map(([k, label]) => (
              <button key={k} onClick={() => setStatus(k!)} aria-pressed={status === k} className={cx("rounded-full border px-3 py-1 text-xs", status === k ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-3 hover:text-ink")}>
                {label}
              </button>
            ))}
          </div>
          <div className="w-28"><Input placeholder="Tag" value={tag} onChange={(e) => setTag(e.target.value.trim())} aria-label="Filter by tag" /></div>
          <div className="w-36"><Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="recent">Newest</option>
            <option value="name">Name</option>
            <option value="spend">Top spend</option>
            <option value="lastVisit">Last visit</option>
            <option value="points">Most points</option>
          </Select></div>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent/5 px-4 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            {can("customer.edit") && <Button size="sm" pending={tagAll.pending} onClick={() => void tagAll.run()}><Tag className="size-3.5" /> Tag</Button>}
            {can("customer.adjust_wallet") && <Button size="sm" onClick={() => setBulk("bonus")}><Gift className="size-3.5" /> Bonus credit</Button>}
            {can("crm.campaign_send") && <Button size="sm" onClick={() => setBulk("segment")}><Megaphone className="size-3.5" /> Add to segment / message</Button>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
            <ErrorNote>{tagAll.error}</ErrorNote>
          </div>
        )}
        {list.loading && !list.data ? (
          <Spinner />
        ) : !rows.length ? (
          <Empty icon={<Users className="size-8" />} title={debounced || status || tag ? "No matches" : page ? "No more customers" : "No customers yet"} />
        ) : (
          <Table head={[<input key="all" type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((c) => (allOnPage ? n.delete(c.id) : n.add(c.id))); return n; })} />, "Customer", "Phone", "Wallet", "Prepaid time", "Spend", "Last visit", ""]}>
            {rows.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-panel-2" onClick={() => setOpen({ id: c.id, tab: "overview" })}>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${c.displayName}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                </td>
                <td className="px-4 py-3">
                  <p className="flex items-center gap-1.5 font-medium">{c.displayName}{c.membershipTier && <Crown className="size-3.5" style={{ color: c.membershipTier.color ?? undefined }} aria-label={c.membershipTier.name} />}</p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-ink-3">@{c.username}{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-2">{c.phone ?? "—"}</td>
                <td className="tabular px-4 py-3">{Number(c.walletBalance) > 0 ? c.walletBalance : <span className="text-ink-3">—</span>}</td>
                <td className="tabular px-4 py-3">{c.timeBalanceMinutes > 0 ? <span className="text-ok">{hours(c.timeBalanceMinutes)}</span> : <span className="text-ink-3">—</span>}</td>
                <td className="tabular px-4 py-3">{Number(c.totalSpend) > 0 ? c.totalSpend : <span className="text-ink-3">—</span>}</td>
                <td className="px-4 py-3 text-xs text-ink-3">{c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : "never"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>{c.status !== "ACTIVE" && <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status.toLowerCase().replace("_", " ")}</Badge>}<RecordActions kind="customer" id={c.id} name={c.displayName} deletable={false} onEdit={() => setOpen({ id: c.id, tab: "profile" })} onDone={() => void list.reload()} /></td>
              </tr>
            ))}
          </Table>
        )}
        {(page > 0 || rows.length === PAGE) && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2 text-sm text-ink-3">
            <span>Page {page + 1}</span>
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
            <Button size="sm" variant="ghost" disabled={rows.length < PAGE} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
          </div>
        )}
      </Card>
      <NewCustomer open={creating} onClose={() => setCreating(false)} onDone={(c) => { setCreating(false); void list.reload(); setOpen({ id: c.id, tab: "overview" }); }} />
      <TiersModal open={tiers} onClose={() => setTiers(false)} />
      <Modal open={!!open} onClose={() => setOpen(null)} title="Customer" wide>
        {open && <CustomerDetail key={open.id} id={open.id} tab={open.tab} onChanged={() => void list.reload()} onErased={() => { setOpen(null); void list.reload(); }} onOpen={(id) => setOpen({ id, tab: "overview" })} />}
      </Modal>
      <Modal open={bulk === "bonus"} onClose={() => setBulk(null)} title="Bonus credit">
        {bulk === "bonus" && <BulkBonus ids={[...selected]} onDone={() => { setBulk(null); setSelected(new Set()); void list.reload(); }} />}
      </Modal>
      <Modal open={bulk === "segment"} onClose={() => setBulk(null)} title="Add to segment">
        {bulk === "segment" && <BulkSegment ids={[...selected]} onDone={() => { setBulk(null); setSelected(new Set()); }} />}
      </Modal>
      <Modal open={bulk === "export"} onClose={() => setBulk(null)} title="Export customers">
        {bulk === "export" && <ExportCsv query={filters} onDone={() => setBulk(null)} />}
      </Modal>
    </>
  );
}
