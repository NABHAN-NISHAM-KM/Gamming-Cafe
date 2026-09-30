"use client";

import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Download, Landmark, Lock, Plus, Receipt, RefreshCw, Scale, Trash2, Undo2, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useCanOrg } from "@/lib/client/me";
import { QuickEdit, RecordActions } from "@/components/records";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

// ── types (mirror apps/api/src/accounting) ──────────────────────────────────

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
interface Account { id: string; code: string; name: string; type: AccountType; systemKey: string | null; parentId: string | null; isActive: boolean; isHeader: boolean; isSystem: boolean }
interface Amount { id: string; code: string; name: string; amount: string }
interface Section { accounts: Amount[]; total: string }
interface PL { from: string; to: string; currency: string; revenue: Section; costOfSales: Section; grossProfit: string; operatingExpenses: Section; netProfit: string }
interface BS { asOf: string; currency: string; assets: Section; liabilities: Section; equity: Section & { currentEarnings: string }; balanced: boolean }
interface TB { asOf: string; currency: string; accounts: Array<{ id: string; code: string; name: string; type: AccountType; debit: string; credit: string }>; totalDebit: string; totalCredit: string; balanced: boolean }
interface Entry { id: string; entryDate: string; description: string; sourceType: string; documentId: string | null; reversesId: string | null; branch: string | null; amount: string; lines: Array<{ accountId: string; code: string; name: string; debit: string; credit: string; memo: string | null }> }
interface Journal { currency: string; page: number; pageSize: number; total: number; entries: Entry[] }
interface Ledger { account: { id: string; code: string; name: string }; currency: string; opening: string; closing: string; truncated: boolean; lines: Array<{ entryId: string; entryDate: string; description: string; sourceType: string; debit: string; credit: string; balance: string }> }
interface ExpenseRow { id: string; branch: string; account: { code: string; name: string } | null; description: string | null; amount: string; taxAmount: string; total: string; paidVia: string; fromDrawer: boolean; supplier: string | null; incurredAt: string; createdBy: string }
interface Recon { checkedAt: string; unposted: number; checks: Array<{ key: string; label: string; ledger: string; operational: string; difference: string; ok: boolean }> }
interface Branch { id: string; code: string; name: string }

type Tab = "overview" | "journal" | "accounts" | "expenses" | "close";
const TABS: Array<[Tab, string]> = [["overview", "Overview"], ["journal", "Journal"], ["accounts", "Accounts"], ["expenses", "Expenses"], ["close", "Close & reconcile"]];
const SOURCE_LABEL: Record<string, string> = {
  BILL: "Sale", PAYMENT: "Payment", REFUND: "Refund", WALLET_TX: "Wallet", STOCK_MOVEMENT: "Stock", CASH_MOVEMENT: "Drawer", SHIFT: "Shift close",
  SUPPLIER_INVOICE: "Supplier bill", EXPENSE: "Expense", MANUAL: "Manual",
};
const TYPE_LABEL: Record<AccountType, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", REVENUE: "Revenue", EXPENSE: "Costs & expenses" };
const todayLocal = () => new Date().toLocaleDateString("en-CA");
const monthStart = () => `${todayLocal().slice(0, 8)}01`;
const money = (v: string | number, currency?: string) => {
  const n = Number(v);
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}${currency ? `${currency} ` : ""}${s}`;
};
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export default function FinancePage() {
  const canOrg = useCanOrg();
  const [tab, setTab] = useState<Tab>("overview");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const [branchId, setBranchId] = useState("");
  const [stamp, setStamp] = useState(0); // bumps after "Post now" so every view reloads
  const branches = useApi<Branch[]>("/branches");
  const sync = useAction(async () => {
    for (let i = 0; i < 50; i++) {
      const r = await api<{ more: boolean }>("/accounting/sync", { method: "POST" });
      if (!r.more) break;
    }
    setStamp((s) => s + 1);
  });
  const filter = { from, to, branchId: branchId || undefined, v: stamp };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Finance"
        subtitle="The books keep themselves: every sale, payment, refund, top-up, stock movement, shift and supplier bill is posted to the general ledger automatically."
        actions={<Button onClick={() => void sync.run()} pending={sync.pending} title="Post anything that changed in the last few seconds"><RefreshCw className="size-4" /> Post now</Button>}
      />
      <ErrorNote>{sync.error}</ErrorNote>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Branch">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="min-w-44">
            <option value="">All my branches</option>
            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {TABS.filter(([t]) => t !== "close" || canOrg("accounting.view")).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={cx("-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm", tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>{label}</button>
        ))}
      </div>
      {tab === "overview" ? <Overview {...filter} /> : tab === "journal" ? <JournalTab {...filter} /> : tab === "accounts" ? <Accounts {...filter} /> : tab === "expenses" ? <Expenses {...filter} branches={branches.data ?? []} /> : <Close v={stamp} />}
    </div>
  );
}

type Filter = { from: string; to: string; branchId?: string; v: number };

function CsvLink({ path }: { path: string }) {
  const can = useCan();
  if (!can("reports.export")) return null;
  return (
    <a href={`/api/v1${path}${path.includes("?") ? "&" : "?"}format=csv`} download className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
      <Download className="size-3.5" /> CSV
    </a>
  );
}

// ── overview: P&L + balance sheet ───────────────────────────────────────────

function Overview({ from, to, branchId, v }: Filter) {
  const q = qs({ from, to, branchId });
  const pl = useApi<PL>(`/accounting/profit-and-loss${q}&v=${v}`);
  const bs = useApi<BS>(`/accounting/balance-sheet${qs({ to, branchId })}&v=${v}`);
  if (pl.error) return <ErrorNote>{pl.error.message}</ErrorNote>;
  if (!pl.data || !bs.data) return <Spinner />;
  const p = pl.data;
  const b = bs.data;
  const margin = Number(p.revenue.total) ? (Number(p.netProfit) / Number(p.revenue.total)) * 100 : null;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={money(p.revenue.total, p.currency)} />
        <Stat label="Gross profit" value={money(p.grossProfit, p.currency)} />
        <Stat label="Operating expenses" value={money(p.operatingExpenses.total, p.currency)} />
        <Stat label="Net profit" value={money(p.netProfit, p.currency)} tone={Number(p.netProfit) >= 0 ? "good" : "bad"} hint={margin === null ? undefined : `${margin.toFixed(1)}% margin`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Profit & loss <span className="font-normal text-ink-3">· {from} → {to}</span></h2>
            <CsvLink path={`/accounting/profit-and-loss${q}`} />
          </div>
          <div className="px-4 py-3 text-sm">
            <Statement title="Revenue" s={p.revenue} currency={p.currency} />
            <Statement title="Cost of sales" s={p.costOfSales} currency={p.currency} />
            <Line label="Gross profit" value={money(p.grossProfit, p.currency)} strong />
            <Statement title="Operating expenses" s={p.operatingExpenses} currency={p.currency} />
            <Line label="Net profit" value={money(p.netProfit, p.currency)} strong />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
              <span>Balance sheet <span className="font-normal text-ink-3">· as of {to}</span></span>
              {b.balanced ? <Badge tone="ok">Balanced</Badge> : <Badge tone="danger">Out of balance</Badge>}
            </h2>
            <CsvLink path={`/accounting/balance-sheet${qs({ to, branchId })}`} />
          </div>
          <div className="px-4 py-3 text-sm">
            <Statement title="Assets" s={b.assets} currency={b.currency} />
            <Statement title="Liabilities" s={b.liabilities} currency={b.currency} />
            <Statement title="Equity" s={b.equity} currency={b.currency} extra={[["Current earnings", b.equity.currentEarnings]]} />
            <Line label="Liabilities + equity" value={money(Number(b.liabilities.total) + Number(b.equity.total), b.currency)} strong />
          </div>
        </Card>
      </div>
      {branchId && <p className="text-xs text-ink-3">Filtered to one branch: entries not tied to a branch (e.g. supplier bills without a purchase order) are left out, so the balance sheet can look uneven.</p>}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={cx("mt-1 text-lg font-semibold tabular-nums", tone === "good" && "text-ok", tone === "bad" && "text-danger")}>{value}</p>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </Card>
  );
}

function Statement({ title, s, currency, extra = [] }: { title: string; s: Section; currency: string; extra?: Array<[string, string]> }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</p>
      {s.accounts.length === 0 && extra.length === 0 && <p className="py-0.5 text-ink-3">—</p>}
      {s.accounts.map((a) => <Line key={a.id} label={<><span className="mr-2 font-mono text-xs text-ink-3">{a.code}</span>{a.name}</>} value={money(a.amount)} />)}
      {extra.map(([l, v]) => <Line key={l} label={l} value={money(v)} />)}
      <Line label={`Total ${title.toLowerCase()}`} value={money(s.total, currency)} strong />
    </div>
  );
}

function Line({ label, value, strong }: { label: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-4 py-0.5", strong && "mt-1 border-t border-line pt-1.5 font-semibold")}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ── journal ─────────────────────────────────────────────────────────────────

function JournalTab({ from, to, branchId, v }: Filter) {
  const can = useCan();
  const [page, setPage] = useState(1);
  const [sourceType, setSourceType] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useApi<Journal>(`/accounting/journal${qs({ from, to, branchId, sourceType, search, page })}&v=${v}`);
  const reverse = useAction(async (id: string) => {
    await api(`/accounting/journal/${id}/reverse`, { method: "POST", body: { entryDate: todayLocal() }, action: "Reverse journal entry" });
    await list.reload();
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sourceType} onChange={(e) => { setSourceType(e.target.value); setPage(1); }} className="w-auto">
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Input placeholder="Search descriptions…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-64" />
        {can("accounting.post") && <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" /> Journal entry</Button>}
      </div>
      <ErrorNote>{list.error?.message ?? reverse.error}</ErrorNote>
      <Card>
        {!list.data ? <Spinner /> : list.data.entries.length === 0 ? <Empty icon={<BookOpen className="size-8" />} title="No entries">Nothing was posted in this period.</Empty> : (
          <Table head={["Date", "Description", "Source", "Branch", "Amount", ""]}>
            {list.data.entries.map((e) => (
              <FragmentRow key={e.id} entry={e} currency={list.data!.currency} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)}
                onReverse={can("accounting.post") && e.sourceType === "MANUAL" && !e.reversesId ? () => void reverse.run(e.id) : undefined} />
            ))}
          </Table>
        )}
      </Card>
      {list.data && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-ink-3">Page {page} of {pages}</span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Journal entry" wide>
        {creating && <ManualEntry onDone={() => { setCreating(false); void list.reload(); }} />}
      </Modal>
    </div>
  );
}

function FragmentRow({ entry: e, currency, open, onToggle, onReverse }: { entry: Entry; currency: string; open: boolean; onToggle: () => void; onReverse?: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={onToggle}>
        <td className="whitespace-nowrap px-4 py-2 tabular-nums text-ink-2">{e.entryDate}</td>
        <td className="px-4 py-2">{e.description}{e.reversesId && <Badge tone="warn">Reversal</Badge>}</td>
        <td className="px-4 py-2"><Badge tone={e.sourceType === "MANUAL" ? "accent" : "neutral"}>{SOURCE_LABEL[e.sourceType] ?? e.sourceType}</Badge></td>
        <td className="px-4 py-2 text-ink-3">{e.branch ?? "—"}</td>
        <td className="px-4 py-2 text-right tabular-nums">{money(e.amount, currency)}</td>
        <td className="px-4 py-2 text-right">
          {onReverse && <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); onReverse(); }} title="Post a mirror-image entry"><Undo2 className="size-3.5" /> Reverse</Button>}
        </td>
      </tr>
      {open && (
        <tr className="bg-panel-2/50">
          <td />
          <td colSpan={5} className="px-4 pb-3">
            <table className="w-full text-xs">
              <thead className="text-ink-3"><tr><th className="py-1 text-left font-normal">Account</th><th className="py-1 text-right font-normal">Debit</th><th className="py-1 text-right font-normal">Credit</th></tr></thead>
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i}>
                    <td className={cx("py-0.5", Number(l.credit) > 0 && "pl-6")}><span className="mr-2 font-mono text-ink-3">{l.code}</span>{l.name}{l.memo && <span className="text-ink-3"> · {l.memo}</span>}</td>
                    <td className="py-0.5 text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</td>
                    <td className="py-0.5 text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

type Draft = { key: number; accountId: string; debit: string; credit: string; memo: string };

function ManualEntry({ onDone }: { onDone: () => void }) {
  const accounts = useApi<Account[]>("/accounting/accounts");
  const branches = useApi<Branch[]>("/branches");
  const [date, setDate] = useState(todayLocal());
  const [description, setDescription] = useState("");
  const [branchId, setBranchId] = useState("");
  const [lines, setLines] = useState<Draft[]>([{ key: 1, accountId: "", debit: "", credit: "", memo: "" }, { key: 2, accountId: "", debit: "", credit: "", memo: "" }]);
  const postable = (accounts.data ?? []).filter((a) => !a.isHeader && a.isActive);
  const dr = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  const balanced = dr > 0 && Math.abs(dr - cr) < 0.005;
  const set = (key: number, patch: Partial<Draft>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const save = useAction(async () => {
    await api("/accounting/journal", {
      method: "POST", action: "Post journal entry",
      body: { entryDate: date, description, branchId: branchId || null, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: l.debit || null, credit: l.credit || null, memo: l.memo || null })) },
    });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <p className="text-sm text-ink-3">For what the system can't see — owner's capital, loans, depreciation, accruals. Sales, stock and cash post themselves.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} minLength={3} required placeholder="Owner capital injection" /></Field>
        <Field label="Branch (optional)">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">Whole organization</option>{(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</Select>
        </Field>
      </div>
      <div className="grid gap-2">
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2">
            <Select value={l.accountId} onChange={(e) => set(l.key, { accountId: e.target.value })} aria-label="Account">
              <option value="">Account…</option>
              {postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </Select>
            <Input inputMode="decimal" placeholder="Debit" aria-label="Debit" value={l.debit} onChange={(e) => set(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            <Input inputMode="decimal" placeholder="Credit" aria-label="Credit" value={l.credit} onChange={(e) => set(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} disabled={lines.length <= 2} className="text-ink-3 hover:text-danger disabled:opacity-30" aria-label="Remove line"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <div className="flex items-center gap-3 text-sm">
          <Button type="button" size="sm" variant="ghost" onClick={() => setLines([...lines, { key: Date.now(), accountId: "", debit: "", credit: "", memo: "" }])}><Plus className="size-3.5" /> Line</Button>
          <span className={cx("ml-auto tabular-nums", balanced ? "text-ok" : "text-ink-3")}>Debits {dr.toFixed(2)} · Credits {cr.toFixed(2)}</span>
        </div>
      </div>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button variant="primary" type="submit" pending={save.pending} disabled={!balanced}>Post entry</Button></div>
    </form>
  );
}

// ── accounts: chart + trial balance + ledger ────────────────────────────────

function Accounts({ from, to, branchId, v }: Filter) {
  const can = useCan();
  const accounts = useApi<Account[]>(`/accounting/accounts?v=${v}`);
  const tb = useApi<TB>(`/accounting/trial-balance${qs({ to, branchId })}&v=${v}`);
  const [ledger, setLedger] = useState<Account | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Account | null>(null);
  const bal = useMemo(() => new Map((tb.data?.accounts ?? []).map((a) => [a.id, Number(a.debit) - Number(a.credit)])), [tb.data]);
  if (accounts.error) return <ErrorNote>{accounts.error.message}</ErrorNote>;
  if (!accounts.data || !tb.data) return <Spinner />;
  const naturalDebit = (t: AccountType) => t === "ASSET" || t === "EXPENSE";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="flex items-center gap-2"><Scale className="size-4 text-ink-3" /> Trial balance as of {to}:</span>
        <span className="tabular-nums">Debits {money(tb.data.totalDebit)} · Credits {money(tb.data.totalCredit)}</span>
        {tb.data.balanced ? <Badge tone="ok">Balanced</Badge> : <Badge tone="danger">Out of balance</Badge>}
        <CsvLink path={`/accounting/trial-balance${qs({ to, branchId })}`} />
        {can("accounting.post") && <Button className="ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> Account</Button>}
      </div>
      {(Object.keys(TYPE_LABEL) as AccountType[]).map((type) => (
        <Card key={type}>
          <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">{TYPE_LABEL[type]}</h2>
          <ul className="divide-y divide-line text-sm">
            {accounts.data!.filter((a) => a.type === type).map((a) => {
              const b = (bal.get(a.id) ?? 0) * (naturalDebit(type) ? 1 : -1);
              return (
                <li key={a.id} className="flex items-center pr-2">
                  <button disabled={a.isHeader} onClick={() => setLedger(a)} className={cx("flex min-w-0 flex-1 items-center gap-3 px-4 py-1.5 text-left", a.isHeader ? "bg-panel-2/60 font-medium" : "hover:bg-panel-2", a.parentId && "pl-8", !a.isActive && "opacity-50")}>
                    <span className="w-14 font-mono text-xs text-ink-3">{a.code}</span>
                    <span className="flex-1">{a.name}{!a.isActive && <span className="ml-2 text-xs text-ink-3">(inactive)</span>}</span>
                    {!a.isHeader && <span className={cx("tabular-nums", b === 0 && "text-ink-3")}>{money(b)}</span>}
                  </button>
                  <RecordActions kind="ledger-account" id={a.id} name={`${a.code} ${a.name}`} deletable={!a.systemKey} onEdit={() => setRenaming(a)} onDone={() => void accounts.reload()} />
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <Modal open={!!ledger} onClose={() => setLedger(null)} title={ledger ? `${ledger.code} · ${ledger.name}` : ""} wide>
        {ledger && <LedgerView account={ledger} from={from} to={to} branchId={branchId} />}
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} title="New account">
        {adding && <AccountForm accounts={accounts.data} onDone={() => { setAdding(false); void accounts.reload(); }} />}
      </Modal>
      <QuickEdit
        title={renaming ? `Edit ${renaming.code}` : ""} open={!!renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); void accounts.reload(); }}
        fields={[{ key: "name", label: "Name", required: true }]} initial={{ name: renaming?.name ?? "" }}
        save={(v) => api(`/accounting/accounts/${renaming!.id}`, { method: "PATCH", body: { name: v["name"]!.trim() } })}
      />
    </div>
  );
}

function LedgerView({ account, from, to, branchId }: { account: Account; from: string; to: string; branchId?: string }) {
  const q = qs({ from, to, branchId });
  const l = useApi<Ledger>(`/accounting/accounts/${account.id}/ledger${q}`);
  if (l.error) return <ErrorNote>{l.error.message}</ErrorNote>;
  if (!l.data) return <Spinner />;
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-sm">
        <span>Opening {money(l.data.opening, l.data.currency)} → closing <strong>{money(l.data.closing, l.data.currency)}</strong></span>
        <CsvLink path={`/accounting/accounts/${account.id}/ledger${q}`} />
      </div>
      {l.data.lines.length === 0 ? <Empty title="No movements">Nothing posted to this account in the period.</Empty> : (
        <div className="max-h-[60vh] overflow-auto">
          <Table head={["Date", "Description", "Source", "Debit", "Credit", "Balance"]}>
            {l.data.lines.map((x, i) => (
              <tr key={i} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-ink-2">{x.entryDate}</td>
                <td className="px-4 py-1.5">{x.description}</td>
                <td className="px-4 py-1.5 text-xs text-ink-3">{SOURCE_LABEL[x.sourceType] ?? x.sourceType}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{Number(x.debit) ? money(x.debit) : ""}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{Number(x.credit) ? money(x.credit) : ""}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{money(x.balance)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {l.data.truncated && <p className="text-xs text-ink-3">Showing the first 2,000 lines — narrow the dates or download the CSV.</p>}
    </div>
  );
}

function AccountForm({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [type, setType] = useState<AccountType>("EXPENSE");
  const headers = accounts.filter((a) => a.isHeader && a.type === type);
  const [parentId, setParentId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const save = useAction(async () => {
    await api("/accounting/accounts", { method: "POST", action: "Add ledger account", body: { code, name, type, parentId: parentId || headers[0]?.id || null } });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Type">
        <Select value={type} onChange={(e) => { setType(e.target.value as AccountType); setParentId(""); }}>
          {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
      </Field>
      <Field label="Under"><Select value={parentId} onChange={(e) => setParentId(e.target.value)}>{headers.map((h) => <option key={h.id} value={h.id}>{h.code} · {h.name}</option>)}</Select></Field>
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <Field label="Code" hint="3–6 digits"><Input value={code} onChange={(e) => setCode(e.target.value)} pattern="[0-9]{3,6}" required /></Field>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} required placeholder="Cleaning supplies" /></Field>
      </div>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button variant="primary" type="submit" pending={save.pending}>Add account</Button></div>
    </form>
  );
}

// ── expenses ────────────────────────────────────────────────────────────────

function Expenses({ from, to, branchId, v, branches }: Filter & { branches: Branch[] }) {
  const can = useCan();
  const list = useApi<{ currency: string; total: string; expenses: ExpenseRow[] }>(`/accounting/expenses${qs({ from, to, branchId })}&v=${v}`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const mayRecord = branches.some((b) => can("accounting.expense", b.id));
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        {list.data && <span className="text-sm text-ink-2">Total <strong className="tabular-nums">{money(list.data.total, list.data.currency)}</strong></span>}
        <CsvLink path={`/accounting/expenses${qs({ from, to, branchId })}`} />
        {mayRecord && <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> Record expense</Button>}
      </div>
      <ErrorNote>{list.error?.message}</ErrorNote>
      <Card>
        {!list.data ? <Spinner /> : list.data.expenses.length === 0 ? <Empty icon={<Receipt className="size-8" />} title="No expenses">Rent, utilities, repairs… record them here and they post to the ledger.</Empty> : (
          <Table head={["Date", "Branch", "Account", "Description", "Paid", "Total", ""]}>
            {list.data.expenses.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2 tabular-nums text-ink-2">{e.incurredAt}</td>
                <td className="px-4 py-2 text-ink-3">{e.branch}</td>
                <td className="px-4 py-2">{e.account ? <><span className="mr-2 font-mono text-xs text-ink-3">{e.account.code}</span>{e.account.name}</> : "—"}</td>
                <td className="px-4 py-2 text-ink-2">{e.description ?? "—"}{e.supplier && <span className="text-ink-3"> · {e.supplier}</span>}</td>
                <td className="px-4 py-2 text-xs">{e.fromDrawer ? <Badge tone="warn">From drawer</Badge> : e.paidVia.replace("_", " ").toLowerCase()}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(e.total)}{Number(e.taxAmount) > 0 && <span className="block text-xs text-ink-3">incl. VAT {money(e.taxAmount)}</span>}</td>
                <td className="px-4 py-2 text-right"><RecordActions kind="expense" id={e.id} name="expense" deletable={false} onEdit={() => setEditing(e)} onDone={() => void list.reload()} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <QuickEdit
        title="Fix expense" open={!!editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void list.reload(); }}
        fields={[
          { key: "incurredAt", label: "Date", type: "date", required: true },
          { key: "description", label: "Description" },
          { key: "amount", label: "Amount (before VAT)", required: true, hint: editing?.fromDrawer ? "Paid from the drawer — the amount can't change; record a correcting expense instead." : undefined },
          { key: "taxAmount", label: "VAT" },
        ]}
        initial={editing ? { incurredAt: editing.incurredAt, description: editing.description ?? "", amount: String(Number(editing.amount)), taxAmount: String(Number(editing.taxAmount)) } : {}}
        save={(v) => api(`/accounting/expenses/${editing!.id}`, {
          method: "PATCH",
          body: { incurredAt: v["incurredAt"], description: v["description"] || null, ...(editing!.fromDrawer ? {} : { amount: v["amount"], taxAmount: v["taxAmount"] || "0" }) },
        })}
      />
      <Modal open={adding} onClose={() => setAdding(false)} title="Record expense">
        {adding && <ExpenseForm branches={branches.filter((b) => can("accounting.expense", b.id))} onDone={() => { setAdding(false); void list.reload(); }} />}
      </Modal>
    </div>
  );
}

function ExpenseForm({ branches, onDone }: { branches: Branch[]; onDone: () => void }) {
  const accounts = useApi<Account[]>("/accounting/accounts");
  const suppliers = useApi<Array<{ id: string; name: string; isActive: boolean }>>("/suppliers");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [paidVia, setPaidVia] = useState<"CASH" | "CARD" | "BANK_TRANSFER">("BANK_TRANSFER");
  const [fromDrawer, setFromDrawer] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(todayLocal());
  const expenseAccounts = (accounts.data ?? []).filter((a) => a.type === "EXPENSE" && !a.isHeader && a.isActive && !["COGS", "STOCK_LOSS", "CASH_OVER_SHORT", "ROUNDING", "PROMO_EXPENSE", "PRIZES_EXPENSE", "GOODWILL_EXPENSE", "EQUIPMENT_EXPENSE"].includes(a.systemKey ?? ""));
  const save = useAction(async () => {
    await api("/accounting/expenses", {
      method: "POST", action: "Record expense",
      body: { branchId, accountId, description: description || null, amount, taxAmount: tax || null, paidVia, fromDrawer: paidVia === "CASH" && fromDrawer, supplierId: supplierId || null, incurredAt: date },
    });
    onDone();
  });
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Branch"><Select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      </div>
      <Field label="Expense account">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="">Choose…</option>
          {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </Select>
      </Field>
      <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Internet — September" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (before VAT)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
        <Field label="VAT"><Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid by">
          <Select value={paidVia} onChange={(e) => setPaidVia(e.target.value as typeof paidVia)}>
            <option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Company card</option><option value="CASH">Cash</option>
          </Select>
        </Field>
        <Field label="Supplier (optional)">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{(suppliers.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
      </div>
      {paidVia === "CASH" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} />
          Paid out of my cash drawer (my open shift) — otherwise from the safe
        </label>
      )}
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button variant="primary" type="submit" pending={save.pending}>Record</Button></div>
    </form>
  );
}

// ── close & reconcile ───────────────────────────────────────────────────────

function Close({ v }: { v: number }) {
  const can = useCan();
  const recon = useApi<Recon>(`/accounting/reconciliation?v=${v}`);
  const settings = useApi<{ lockDate: string | null }>("/accounting/settings");
  const [lock, setLock] = useState("");
  const save = useAction(async (lockDate: string | null) => {
    await api("/accounting/lock", { method: "PUT", body: { lockDate }, action: lockDate ? "Close the books" : "Reopen the books" });
    await settings.reload();
    setLock("");
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Landmark className="size-4" /> Reconciliation</h2>
          <Button size="sm" variant="ghost" onClick={() => void recon.reload()}><RefreshCw className="size-3.5" /> Re-check</Button>
        </div>
        {recon.error ? <div className="p-4"><ErrorNote>{recon.error.message}</ErrorNote></div> : !recon.data ? <Spinner /> : (
          <div className="p-4 text-sm">
            <p className="mb-3 text-ink-3">Each control account must equal what the operational side holds. Checked automatically every night; differences are written to the audit log.</p>
            <Table head={["", "Check", "Ledger", "Operations", "Difference"]}>
              {recon.data.checks.map((c) => (
                <tr key={c.key} className="border-t border-line">
                  <td className="px-4 py-2">{c.ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />}</td>
                  <td className="px-4 py-2">{c.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(c.ledger)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(c.operational)}</td>
                  <td className={cx("px-4 py-2 text-right tabular-nums", !c.ok && "text-danger")}>{money(c.difference)}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-ink-3">
              {recon.data.unposted === 0 ? "Everything is posted." : `${recon.data.unposted} document(s) waiting to be posted — use “Post now”.`} A cash-drawer difference usually means cash was taken without an open shift.
            </p>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold"><Lock className="size-4" /> Close the books</h2>
        <div className="grid gap-3 p-4 text-sm">
          <p className="text-ink-3">Once a period is closed nobody can post into it. Changes to old documents are booked on the first open day instead.</p>
          <p>Closed up to: <strong>{settings.data?.lockDate ?? "nothing closed yet"}</strong></p>
          {can("accounting.post") && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save.run(lock); }}>
              <Field label="Close up to and including"><Input type="date" value={lock} max={todayLocal()} onChange={(e) => setLock(e.target.value)} required /></Field>
              <Button variant="primary" type="submit" pending={save.pending}>Close</Button>
              {settings.data?.lockDate && <Button type="button" onClick={() => void save.run(null)}>Reopen</Button>}
            </form>
          )}
          <ErrorNote>{save.error ?? settings.error?.message}</ErrorNote>
        </div>
      </Card>
    </div>
  );
}
