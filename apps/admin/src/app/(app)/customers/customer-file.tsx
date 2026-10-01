"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { AlertTriangle, Ban, BadgeCheck, GitMerge, LifeBuoy, ShieldOff, StickyNote, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan, useMe } from "@/lib/client/me";
import { fmtCountdown } from "@/lib/client/sessions";
import type { Branch } from "@/lib/client/types";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Spinner, askConfirm, cx, toast } from "@/components/ui";
import { BranchField, useBranchPick } from "./account-panels";

const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{children}</h3>;
const when = (d: string | null) => (d ? new Date(d).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

// ── insights ────────────────────────────────────────────────────────────────

export interface Insights {
  summary: { totalSpend: string; gamingMinutes: number; visits: number; avgSpendPerVisit: string | null; lastVisitAt: string | null; memberSince: string };
  referralCode: string | null;
  referredBy: { id: string; displayName: string; username: string } | null;
  referrals: Array<{ id: string; displayName: string; username: string; createdAt: string }>;
  favorites: Array<{ id: string; title: string; coverUrl: string | null }>;
  achievements: Array<{ name: string; description: string | null; earnedAt: string }>;
  logins: Array<{ id: string; channel: string; ip: string | null; startedAt: string; endedAt: string | null; lastActiveAt: string; device: { name: string } | null }>;
  flags: Array<{ level: "danger" | "warn" | "info"; text: string }>;
  duplicates: Array<{ id: string; username: string; displayName: string }>;
}

/** Spend, play time, visits — and anything that deserves a second look. */
export function SummaryStrip({ i }: { i: Insights }) {
  const s = i.summary;
  const tiles = [
    ["Total spend", s.totalSpend],
    ["Played", fmtCountdown(s.gamingMinutes * 60_000, false)],
    ["Visits", String(s.visits)],
    ["Per visit", s.avgSpendPerVisit ?? "—"],
    ["Last visit", day(s.lastVisitAt)],
    ["Member since", day(s.memberSince)],
  ];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
            <p className="tabular truncate text-sm font-semibold">{v}</p>
            <p className="text-[11px] text-ink-3">{k}</p>
          </div>
        ))}
      </div>
      {i.flags.length > 0 && (
        <ul className="grid gap-1">
          {i.flags.map((f) => (
            <li key={f.text} className={cx("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", f.level === "danger" ? "border-danger/40 bg-danger/10 text-danger" : f.level === "warn" ? "border-reserved/40 bg-reserved/10 text-reserved" : "border-accent/40 bg-accent/10 text-accent")}>
              <AlertTriangle className="size-3.5 shrink-0" /> {f.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── restrictions ────────────────────────────────────────────────────────────

interface Restriction {
  id: string;
  type: string;
  scope: { zoneIds?: string[]; gameIds?: string[]; maxAge?: number; maxMinutesPerDay?: number };
  reason: string;
  startsAt: string;
  endsAt: string | null;
  liftedAt: string | null;
  createdBy: { displayName: string };
}
const KIND: Record<string, string> = {
  BAN: "Ban — can't sign in anywhere",
  ZONE_BLOCK: "Keep out of zones",
  GAME_BLOCK: "Block games",
  AGE_LIMIT: "Age limit for games",
  TIME_LIMIT: "Daily play limit",
  RESTAURANT_BLOCK: "No food & drink orders",
};
const active = (r: Restriction) => !r.liftedAt && (!r.endsAt || new Date(r.endsAt) > new Date());

function AddRestriction({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const b = useBranchPick();
  const zones = useApi<Array<{ id: string; name: string }>>(b.branchId ? `/branches/${b.branchId}/zones` : null);
  const games = useApi<{ games: Array<{ id: string; title: string }> }>("/games");
  const [f, setF] = useState({ type: "BAN", reason: "", days: "", ids: [] as string[], number: "" });
  const save = useAction(async () => {
    const scope =
      f.type === "ZONE_BLOCK" ? { zoneIds: f.ids } : f.type === "GAME_BLOCK" ? { gameIds: f.ids } : f.type === "AGE_LIMIT" ? { maxAge: Number(f.number) } : f.type === "TIME_LIMIT" ? { maxMinutesPerDay: Number(f.number) } : {};
    await api(`/customers/${customerId}/restrictions`, {
      method: "POST", action: KIND[f.type]!, reason: f.reason,
      body: { type: f.type, scope, reason: f.reason, endsAt: f.days ? new Date(Date.now() + Number(f.days) * 86_400_000).toISOString() : null },
    });
    onDone();
  });
  const pick = (opts: Array<{ id: string; name: string }>) => (
    <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-line p-2 text-sm">
      {opts.map((o) => (
        <label key={o.id} className="flex items-center gap-2">
          <input type="checkbox" checked={f.ids.includes(o.id)} onChange={(e) => setF({ ...f, ids: e.target.checked ? [...f.ids, o.id] : f.ids.filter((x) => x !== o.id) })} /> {o.name}
        </label>
      ))}
    </div>
  );
  const needsIds = f.type === "ZONE_BLOCK" || f.type === "GAME_BLOCK";
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="What">
        <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, ids: [], number: "" })}>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      {f.type === "ZONE_BLOCK" && (<><BranchField b={b} />{zones.data ? pick(zones.data) : <Spinner />}</>)}
      {f.type === "GAME_BLOCK" && (games.data ? pick(games.data.games.map((g) => ({ id: g.id, name: g.title }))) : <Spinner />)}
      {f.type === "AGE_LIMIT" && (
        <Field label="Treat them as this age" hint="Games rated above it are locked on the PC.">
          <Input required inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, "") })} placeholder="12" />
        </Field>
      )}
      {f.type === "TIME_LIMIT" && (
        <Field label="Minutes per day" hint="Prepaid sign-ins are shortened to what's left today; selling more is refused.">
          <Input required inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, "") })} placeholder="120" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="For how many days" hint="Empty = until lifted">
          <Input inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, "") })} placeholder="7" />
        </Field>
        <Field label="Reason" hint="Saved in the audit log">
          <Input required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Damaged a headset" />
        </Field>
      </div>
      {f.type === "BAN" && <p className="text-xs text-ink-3">A game they&apos;re playing right now carries on — end it from the Live Floor if needed.</p>}
      <ErrorNote>{save.error}</ErrorNote>
      <Button type="submit" variant="danger" pending={save.pending} disabled={(needsIds && !f.ids.length) || ((f.type === "AGE_LIMIT" || f.type === "TIME_LIMIT") && !f.number)}>
        <Ban className="size-4" /> Apply
      </Button>
    </form>
  );
}

export function RestrictionsPanel({ customerId, onChanged }: { customerId: string; onChanged: () => void }) {
  const can = useCan();
  const list = useApi<Restriction[]>(`/customers/${customerId}/restrictions`);
  const [adding, setAdding] = useState(false);
  const lift = useAction(async (r: Restriction) => {
    await api(`/customers/${customerId}/restrictions/${r.id}/lift`, { method: "POST", action: `Lift ${KIND[r.type]?.toLowerCase()}` });
    await list.reload();
    onChanged();
  });
  if (!list.data) return <Spinner />;
  const describe = (r: Restriction) =>
    r.type === "AGE_LIMIT" ? `as age ${r.scope.maxAge}` : r.type === "TIME_LIMIT" ? `${r.scope.maxMinutesPerDay} min/day` : r.type === "ZONE_BLOCK" ? `${r.scope.zoneIds?.length} zone(s)` : r.type === "GAME_BLOCK" ? `${r.scope.gameIds?.length} game(s)` : "";
  return (
    <div className="grid gap-3">
      <div className="flex items-center">
        <p className="text-sm text-ink-2">Bans and limits apply at every branch. Timed ones lift themselves.</p>
        {can("customer.restrict") && <Button size="sm" variant="danger" className="ml-auto" onClick={() => setAdding(true)}><Ban className="size-3.5" /> Restrict</Button>}
      </div>
      <ErrorNote>{lift.error}</ErrorNote>
      {list.data.length === 0 ? (
        <p className="text-sm text-ink-3">No restrictions, ever.</p>
      ) : (
        <ul className="grid gap-2">
          {list.data.map((r) => (
            <li key={r.id} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm", active(r) ? "border-danger/40 bg-danger/5" : "border-line opacity-70")}>
              <Badge tone={active(r) ? "danger" : "neutral"}>{active(r) ? "active" : r.liftedAt ? "lifted" : "ended"}</Badge>
              <span className="font-medium">{KIND[r.type] ?? r.type}</span>
              <span className="text-ink-2">{describe(r)}</span>
              <span className="text-ink-3">“{r.reason}” · {r.createdBy.displayName} · {day(r.startsAt)}{r.endsAt ? ` → ${day(r.endsAt)}` : ""}</span>
              {active(r) && can("customer.restrict") && (
                <Button size="sm" variant="ghost" className="ml-auto" pending={lift.pending} onClick={() => void lift.run(r)}><ShieldOff className="size-3.5" /> Lift</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Restrict customer">
        {adding && <AddRestriction customerId={customerId} onDone={() => { setAdding(false); void list.reload(); onChanged(); }} />}
      </Modal>
    </div>
  );
}

// ── notes ───────────────────────────────────────────────────────────────────

interface Note { id: string; body: string; createdAt: string; author: { id: string; displayName: string } }

export function NotesPanel({ customerId }: { customerId: string }) {
  const can = useCan();
  const me = useMe();
  const notes = useApi<Note[]>(`/customers/${customerId}/notes`);
  const [body, setBody] = useState("");
  const add = useAction(async () => {
    await api(`/customers/${customerId}/notes`, { method: "POST", body: { body } });
    setBody("");
    await notes.reload();
  });
  const remove = useAction(async (n: Note) => {
    if (!(await askConfirm("Delete this note?"))) return;
    await api(`/customers/${customerId}/notes/${n.id}`, { method: "DELETE" });
    await notes.reload();
  });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-2">Only staff see these — never the customer.</p>
      {can("customer.edit") && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
          <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder="Prefers PC 12 · owes 20 from Friday…" className="flex-1" />
          <Button type="submit" variant="primary" pending={add.pending} disabled={!body.trim()}><StickyNote className="size-4" /> Add</Button>
        </form>
      )}
      <ErrorNote>{add.error ?? remove.error}</ErrorNote>
      {!notes.data ? <Spinner /> : notes.data.length === 0 ? <p className="text-sm text-ink-3">No notes yet.</p> : (
        <ul className="grid gap-2">
          {notes.data.map((n) => (
            <li key={n.id} className="flex gap-3 rounded-lg border border-line bg-panel-2 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
                <p className="mt-1 text-xs text-ink-3">{n.author.displayName} · {when(n.createdAt)}</p>
              </div>
              {n.author.id === me.employee.id && <button className="text-ink-3 hover:text-danger" aria-label="Delete note" onClick={() => void remove.run(n)}><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── activity ────────────────────────────────────────────────────────────────

interface Activity { items: Array<{ kind: string; id: string; at: string; title: string; detail: string; forAt?: string; amount: string | null }>; next: string | null }
const KIND_TONE: Record<string, "accent" | "ok" | "warn" | "neutral" | "maint"> = { session: "accent", order: "warn", wallet: "ok", points: "maint" };

export function ActivityPanel({ customerId }: { customerId: string }) {
  const [pages, setPages] = useState<Activity[]>([]);
  const first = useApi<Activity>(`/customers/${customerId}/activity`);
  const more = useAction(async () => {
    const last = pages.at(-1) ?? first.data!;
    const p = await api<Activity>(`/customers/${customerId}/activity?before=${encodeURIComponent(last.next!)}`);
    setPages([...pages, p]);
  });
  if (!first.data) return <Spinner />;
  const all = [first.data, ...pages];
  const items = all.flatMap((p) => p.items);
  if (!items.length) return <p className="text-sm text-ink-3">Nothing yet.</p>;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1 text-sm">
        {items.map((i) => (
          <li key={`${i.kind}:${i.id}`} className="flex items-center gap-3 border-b border-line/60 py-1.5">
            <span className="w-28 shrink-0 text-xs text-ink-3">{when(i.at)}</span>
            <Badge tone={KIND_TONE[i.kind] ?? "neutral"}>{i.kind}</Badge>
            <span className="min-w-0 flex-1 truncate">{i.title}{i.forAt && <span className="text-ink-3"> · for {when(i.forAt)}</span>}{i.detail && <span className="text-ink-3"> · {i.detail}</span>}</span>
            {i.amount && <span className="tabular shrink-0">{i.amount}</span>}
          </li>
        ))}
      </ul>
      <ErrorNote>{more.error}</ErrorNote>
      {all.at(-1)!.next && <Button size="sm" variant="ghost" pending={more.pending} onClick={() => void more.run()}>Show older</Button>}
    </div>
  );
}

// ── profile ─────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  homeBranchId: string | null;
  locale: string;
  marketingConsent: boolean;
  tags: string[];
  referralCode: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
}

export function ProfileForm({ c, onDone }: { c: Profile; onDone: () => void }) {
  const can = useCan();
  const branches = useApi<Branch[]>("/branches");
  const pii = can("customer.view_pii");
  const [f, setF] = useState({
    displayName: c.displayName, firstName: c.firstName ?? "", lastName: c.lastName ?? "", phone: c.phone ?? "", email: c.email ?? "",
    dateOfBirth: c.dateOfBirth ?? "", homeBranchId: c.homeBranchId ?? "", locale: c.locale, marketingConsent: c.marketingConsent, tags: c.tags.join(", "),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useAction(async () => {
    await api(`/customers/${c.id}`, {
      method: "PATCH", done: "Saved.",
      body: {
        displayName: f.displayName.trim(), firstName: f.firstName.trim() || null, lastName: f.lastName.trim() || null, homeBranchId: f.homeBranchId || null, locale: f.locale, marketingConsent: f.marketingConsent,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        // Masked values come back as "•••123": only send contact details staff can actually see.
        ...(pii ? { phone: f.phone.trim() || null, email: f.email.trim() || null, dateOfBirth: f.dateOfBirth || null } : {}),
      },
    });
    onDone();
  });
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Shown as"><Input required value={f.displayName} onChange={set("displayName")} maxLength={60} /></Field>
      <Field label="Tags" hint="Comma separated — VIP, regular, watch…"><Input value={f.tags} onChange={set("tags")} /></Field>
      <Field label="First name"><Input value={f.firstName} onChange={set("firstName")} maxLength={60} /></Field>
      <Field label="Last name"><Input value={f.lastName} onChange={set("lastName")} maxLength={60} /></Field>
      {pii && (
        <>
          <Field label="Phone" hint="International format, e.g. +971501234567"><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Date of birth" hint="Used for game age ratings"><Input type="date" value={f.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={set("dateOfBirth")} /></Field>
        </>
      )}
      <Field label="Home branch">
        <Select value={f.homeBranchId} onChange={set("homeBranchId")}>
          <option value="">None</option>
          {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </Select>
      </Field>
      <Field label="Language">
        <Select value={f.locale} onChange={set("locale")}>
          {[["en", "English"], ["ar", "Arabic"], ["fr", "French"], ["hi", "Hindi"], ["ur", "Urdu"], ["ru", "Russian"], ["tr", "Turkish"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          {!["en", "ar", "fr", "hi", "ur", "ru", "tr"].includes(f.locale) && <option value={f.locale}>{f.locale}</option>}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.marketingConsent} onChange={(e) => setF({ ...f, marketingConsent: e.target.checked })} /> Agreed to receive offers and news
      </label>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>Save</Button></div>
    </form>
  );
}

export function Verification({ c, onChanged }: { c: Profile; onChanged: () => void }) {
  const can = useCan();
  const verify = useAction(async (channel: "email" | "phone", verified: boolean) => {
    await api(`/customers/${c.id}/verify`, { method: "POST", body: { channel, verified }, done: verified ? `${channel === "email" ? "Email" : "Phone"} marked verified.` : false });
    onChanged();
  });
  const row = (channel: "email" | "phone", value: string | null, at: string | null) => (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-14 text-ink-3">{channel}</span>
      <span className="font-mono text-xs">{value ?? "—"}</span>
      {at ? <Badge tone="ok"><BadgeCheck className="size-3" /> verified {day(at)}</Badge> : value ? <Badge>not verified</Badge> : null}
      {value && can("customer.edit") && (
        <Button size="sm" variant="ghost" className="ml-auto" pending={verify.pending} onClick={() => void verify.run(channel, !at)}>{at ? "Unverify" : "Mark verified"}</Button>
      )}
    </li>
  );
  return (
    <div>
      <H3>Contact</H3>
      <ul className="grid gap-1.5">{row("phone", c.phone, c.phoneVerifiedAt)}{row("email", c.email, c.emailVerifiedAt)}</ul>
      <p className="mt-1 text-xs text-ink-3">Mark verified after checking it with the customer (e.g. you called the number). Sending codes by SMS or email needs a messaging provider.</p>
      <ErrorNote>{verify.error}</ErrorNote>
    </div>
  );
}

export function PeoplePanel({ i, open }: { i: Insights; open: (id: string) => void }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <H3>Referrals</H3>
        <p className="text-sm">Code <span className="font-mono">{i.referralCode ?? "—"}</span></p>
        {i.referredBy && <p className="text-sm text-ink-2">Invited by <button className="text-accent hover:underline" onClick={() => open(i.referredBy!.id)}>{i.referredBy.displayName}</button></p>}
        {i.referrals.length > 0 ? (
          <ul className="mt-2 grid gap-1 text-sm">
            {i.referrals.map((r) => <li key={r.id}><button className="text-accent hover:underline" onClick={() => open(r.id)}>{r.displayName}</button> <span className="text-xs text-ink-3">@{r.username} · {day(r.createdAt)}</span></li>)}
          </ul>
        ) : <p className="text-sm text-ink-3">Hasn&apos;t invited anyone yet.</p>}
      </div>
      <div>
        <H3>Favourite games</H3>
        {i.favorites.length ? <div className="flex flex-wrap gap-1.5">{i.favorites.map((g) => <Badge key={g.id}>{g.title}</Badge>)}</div> : <p className="text-sm text-ink-3">None picked.</p>}
        <div className="mt-4"><H3>Achievements</H3></div>
        {i.achievements.length ? (
          <ul className="grid gap-1 text-sm">{i.achievements.map((a) => <li key={a.name}>🏆 {a.name} <span className="text-xs text-ink-3">{day(a.earnedAt)}</span></li>)}</ul>
        ) : <p className="text-sm text-ink-3">None earned yet.</p>}
      </div>
    </div>
  );
}

export function LoginsPanel({ i }: { i: Insights }) {
  if (!i.logins.length) return <p className="text-sm text-ink-3">Never signed in.</p>;
  return (
    <ul className="grid gap-1 text-sm">
      {i.logins.map((l) => (
        <li key={l.id} className="flex flex-wrap gap-3 border-b border-line/60 py-1.5">
          <Badge tone={l.endedAt ? "neutral" : "accent"}>{l.channel.toLowerCase()}</Badge>
          <span>{l.device?.name ?? l.ip ?? "—"}</span>
          <span className="text-ink-3">{when(l.startedAt)}{l.endedAt ? ` → ${when(l.endedAt)}` : " · still signed in"}</span>
        </li>
      ))}
    </ul>
  );
}

// ── support tickets ─────────────────────────────────────────────────────────

interface TicketRow { id: string; subject: string; message: string | null; category: string; status: string; createdAt: string; resolvedAt: string | null; branch: { code: string }; device: { name: string } | null; assignee: { displayName: string } | null }

export function TicketsPanel({ customerId }: { customerId: string }) {
  const can = useCan();
  const b = useBranchPick();
  const list = useApi<TicketRow[]>(`/customers/${customerId}/tickets`);
  const [f, setF] = useState<{ open: boolean; category: string; subject: string; message: string }>({ open: false, category: "OTHER", subject: "", message: "" });
  const add = useAction(async () => {
    await api(`/customers/${customerId}/tickets`, { method: "POST", body: { branchId: b.branchId, category: f.category, subject: f.subject, message: f.message || null }, done: "Ticket opened." });
    setF({ open: false, category: "OTHER", subject: "", message: "" });
    await list.reload();
  });
  const resolve = useAction(async (id: string) => {
    await api(`/customers/${customerId}/tickets/${id}/resolve`, { method: "POST", done: "Resolved." });
    await list.reload();
  });
  return (
    <div className="grid gap-3">
      {can("support.handle") && !f.open && <Button size="sm" className="justify-self-start" onClick={() => setF({ ...f, open: true })}><LifeBuoy className="size-3.5" /> Open a ticket</Button>}
      {f.open && (
        <form className="grid gap-3 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <BranchField b={b} />
            <Field label="About">
              <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {["HARDWARE", "GAME", "PAYMENT", "FOOD", "OTHER"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Subject"><Input required minLength={3} maxLength={120} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Charged twice for a 3-hour pack" /></Field>
          <Field label="Details (optional)"><Input value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={2000} /></Field>
          <ErrorNote>{add.error}</ErrorNote>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setF({ ...f, open: false })}>Cancel</Button><Button type="submit" variant="primary" pending={add.pending}>Open ticket</Button></div>
        </form>
      )}
      <ErrorNote>{resolve.error}</ErrorNote>
      {!list.data ? <Spinner /> : list.data.length === 0 ? <p className="text-sm text-ink-3">No tickets.</p> : (
        <ul className="grid gap-2">
          {list.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line p-3 text-sm">
              <Badge tone={t.status === "RESOLVED" || t.status === "CLOSED" ? "ok" : "warn"}>{t.status.toLowerCase().replace("_", " ")}</Badge>
              <span className="font-medium">{t.subject}</span>
              <span className="text-ink-3">{t.category.toLowerCase()} · {t.branch.code}{t.device ? ` · ${t.device.name}` : ""} · {when(t.createdAt)}</span>
              {t.message && <p className="w-full text-ink-2">{t.message}</p>}
              {can("support.handle") && t.status !== "RESOLVED" && t.status !== "CLOSED" && <Button size="sm" variant="ghost" className="ml-auto" pending={resolve.pending} onClick={() => void resolve.run(t.id)}>Resolve</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── merge ───────────────────────────────────────────────────────────────────

export function MergeForm({ c, suggestions, onDone }: { c: Profile; suggestions: Insights["duplicates"]; onDone: () => void }) {
  const b = useBranchPick();
  const [q, setQ] = useState("");
  const found = useApi<Array<{ id: string; username: string; displayName: string; walletBalance: string; timeBalanceMinutes: number }>>(q.trim().length >= 2 ? `/customers?q=${encodeURIComponent(q.trim())}` : null);
  const [from, setFrom] = useState<{ id: string; username: string; displayName: string } | null>(null);
  const merge = useAction(async () => {
    if (!(await askConfirm(`Move everything from @${from!.username} into @${c.username} and erase @${from!.username}? Wallet, prepaid time, points, sessions, orders, bookings and notes all move across. This can't be undone.`))) return;
    await api(`/customers/${c.id}/merge`, { method: "POST", action: `Merge @${from!.username} into @${c.username}`, body: { fromId: from!.id, branchId: b.branchId } });
    toast(`@${from!.username} merged into @${c.username}.`);
    onDone();
  });
  const options = [...suggestions, ...(found.data ?? [])].filter((x, i, a) => x.id !== c.id && a.findIndex((y) => y.id === x.id) === i);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-2">Pick the <strong className="text-ink">duplicate</strong> account. It is folded into <strong className="text-ink">@{c.username}</strong>, which keeps its login.</p>
      <Input placeholder="Search the duplicate by name, username or phone…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="grid max-h-56 gap-1 overflow-y-auto">
        {options.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => setFrom(o)} className={cx("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm", from?.id === o.id ? "border-accent bg-accent/10" : "border-line hover:bg-panel-2")}>
              <span className="font-medium">{o.displayName}</span><span className="text-ink-3">@{o.username}</span>
              {suggestions.some((s) => s.id === o.id) && <Badge tone="accent">looks similar</Badge>}
            </button>
          </li>
        ))}
      </ul>
      <BranchField b={b} />
      <ErrorNote>{merge.error}</ErrorNote>
      <Button variant="danger" disabled={!from} pending={merge.pending} onClick={() => void merge.run()}><GitMerge className="size-4" /> Merge {from ? `@${from.username}` : ""} into @{c.username}</Button>
    </div>
  );
}

// ── ID card ─────────────────────────────────────────────────────────────────

/**
 * A wallet-size card to print: name, username and a QR of the username, which
 * a scanner at the counter types into the customer search.
 */
export async function printCard(c: Profile, venue: string) {
  const qr = await QRCode.toDataURL(c.username, { margin: 1, width: 240, color: { dark: "#0b0e14", light: "#ffffff" } });
  const w = window.open("", "_blank", "width=480,height=360");
  if (!w) return toast("Allow pop-ups to print the card.", "warn");
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  w.document.write(`<!doctype html><title>${esc(c.displayName)}</title>
<style>@page{size:85.6mm 54mm;margin:0}body{margin:0;font-family:system-ui,sans-serif}
.card{width:85.6mm;height:54mm;box-sizing:border-box;padding:5mm;display:flex;gap:4mm;align-items:center;border:1px solid #ccc;border-radius:3mm}
img{width:30mm;height:30mm}h1{font-size:14pt;margin:0 0 1mm}p{margin:0;font-size:9pt;color:#444}.v{font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#888;margin-bottom:2mm}</style>
<div class="card"><img src="${qr}" alt=""><div><p class="v">${esc(venue)}</p><h1>${esc(c.displayName)}</h1><p>@${esc(c.username)}</p>${c.referralCode ? `<p>Invite code ${esc(c.referralCode)}</p>` : ""}</div></div>
<script>window.onload=()=>{window.print()}</script>`);
  w.document.close();
}

