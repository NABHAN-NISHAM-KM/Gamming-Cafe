"use client";

import { useEffect, useState } from "react";
import { Clock, Crown, KeyRound, Plus, UserPlus, Users, UserX } from "lucide-react";
import { LoyaltyPanel, MembershipPanel, TiersModal, WalletPanel } from "./account-panels";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { fmtCountdown, idem } from "@/lib/client/sessions";
import type { Branch } from "@/lib/client/types";
import { QuickEdit, RecordActions } from "@/components/records";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PasswordInput, Modal, PageHeader, Select, Spinner, Table, askConfirm, toast } from "@/components/ui";

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
}
interface Detail extends Customer {
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

function CustomerDetail({ id, onChanged, onErased }: { id: string; onChanged: () => void; onErased: () => void }) {
  const can = useCan();
  const c = useApi<Detail>(`/customers/${id}`);
  const [modal, setModal] = useState<"time" | "credentials" | null>(null);
  const erase = useAction(async () => {
    const who = c.data!.displayName;
    if (!(await askConfirm(`Erase ${who}? Their name, phone, email, birthday and logins are deleted for good and they can't sign in again. Bills, payments and points stay in the books, without their name. This can't be undone.`))) return;
    await api(`/customers/${id}/erase`, { method: "POST", action: `Erase ${who}` });
    toast(`${who} was erased.`);
    onErased();
  });
  if (!c.data) return <Spinner />;
  const d = c.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-lg font-semibold">{d.displayName}</p>
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
        {can("customer.delete") && (
          <Button size="sm" variant="danger" className="ml-auto" pending={erase.pending} onClick={() => void erase.run()}>
            <UserX className="size-3.5" /> Erase customer
          </Button>
        )}
      </div>
      <ErrorNote>{erase.error}</ErrorNote>
      <div className="grid gap-5 border-t border-line pt-5">
        <MembershipPanel customerId={d.id} onChanged={() => { void c.reload(); onChanged(); }} />
        <WalletPanel key={d.timeBalanceMinutes} customerId={d.id} onChanged={() => { void c.reload(); onChanged(); }} />
        <LoyaltyPanel customerId={d.id} onChanged={() => { void c.reload(); onChanged(); }} />
      </div>
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
      <Modal open={modal === "time"} onClose={() => setModal(null)} title="Sell prepaid time">
        {modal === "time" && <SellTime customer={d} onDone={() => { setModal(null); void c.reload(); onChanged(); }} />}
      </Modal>
      <Modal open={modal === "credentials"} onClose={() => setModal(null)} title="Password / PIN">
        {modal === "credentials" && <SetCredentials customer={d} onDone={() => setModal(null)} />}
      </Modal>
    </div>
  );
}

export default function CustomersPage() {
  const can = useCan();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useApi<Customer[]>(`/customers${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [tiers, setTiers] = useState(false);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Accounts for the PCs and the customer app: wallet, prepaid time and membership."
        actions={
          <div className="flex gap-2">
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
        <div className="border-b border-line p-4">
          <Input placeholder="Search name, username, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        </div>
        {list.loading && !list.data ? (
          <Spinner />
        ) : !list.data?.length ? (
          <Empty icon={<Users className="size-8" />} title={debounced ? "No matches" : "No customers yet"} />
        ) : (
          <Table head={["Customer", "Phone", "Wallet", "Prepaid time", "Last visit", ""]}>
            {list.data.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-panel-2" onClick={() => setOpen(c.id)}>
                <td className="px-4 py-3">
                  <p className="flex items-center gap-1.5 font-medium">{c.displayName}{c.membershipTier && <Crown className="size-3.5" style={{ color: c.membershipTier.color ?? undefined }} aria-label={c.membershipTier.name} />}</p>
                  <p className="text-xs text-ink-3">@{c.username}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-2">{c.phone ?? "—"}</td>
                <td className="tabular px-4 py-3">{Number(c.walletBalance) > 0 ? c.walletBalance : <span className="text-ink-3">—</span>}</td>
                <td className="tabular px-4 py-3">{c.timeBalanceMinutes > 0 ? <span className="text-ok">{hours(c.timeBalanceMinutes)}</span> : <span className="text-ink-3">—</span>}</td>
                <td className="px-4 py-3 text-xs text-ink-3">{c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : "never"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{c.status !== "ACTIVE" && <Badge tone="danger">{c.status.toLowerCase()}</Badge>}<RecordActions kind="customer" id={c.id} name={c.displayName} deletable={false} onEdit={() => setEditing(c)} onDone={() => void list.reload()} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewCustomer open={creating} onClose={() => setCreating(false)} onDone={(c) => { setCreating(false); void list.reload(); setOpen(c.id); }} />
      <TiersModal open={tiers} onClose={() => setTiers(false)} />
      <Modal open={!!open} onClose={() => setOpen(null)} title="Customer" wide>
        {open && <CustomerDetail id={open} onChanged={() => void list.reload()} onErased={() => { setOpen(null); void list.reload(); }} />}
      </Modal>
      <QuickEdit
        title={editing ? `Edit ${editing.displayName}` : ""} open={!!editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void list.reload(); }}
        fields={[{ key: "displayName", label: "Name", required: true }, { key: "phone", label: "Phone", hint: "International format, e.g. +971501234567" }, { key: "email", label: "Email" }]}
        initial={{ displayName: editing?.displayName ?? "", phone: editing?.phone ?? "", email: editing?.email ?? "" }}
        save={(v) => api(`/customers/${editing!.id}`, { method: "PATCH", body: { displayName: v["displayName"]!.trim(), phone: v["phone"]?.trim() || null, email: v["email"]?.trim() || null } })}
      />
    </>
  );
}
