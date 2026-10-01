"use client";

import { useState } from "react";
import { Copy, Mail, MessageCircle, Star, Sunset } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { Card, Input, toast } from "@/components/ui";

interface DaySummary {
  date: string;
  branch: { name: string; code: string };
  currency: string;
  revenue: string;
  takings: string;
  bills: number;
  refunds: string;
  discounts: string;
  sessions: number;
  hoursPlayed: number;
  occupancyPct: number | null;
  cash: { counted: string; expected: string; variance: string; shifts: number; needingApproval: number };
  topProducts: Array<{ name: string; quantity: number; net: string }>;
  feedback: { count: number; average: number | null };
  openNotes: number;
}
interface Feedback {
  days: number;
  count: number;
  average: number | null;
  stars: number[];
  recent: Array<{ id: string; rating: number; comment: string | null; createdAt: string; station: string | null; customer: string }>;
}

const localToday = () => new Date().toLocaleDateString("en-CA");
const n = (v: string | number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The closing-time message an owner wants on their phone. Plain text so it reads well in WhatsApp, SMS or email. */
export function summaryText(d: DaySummary) {
  const c = d.currency;
  const v = Number(d.cash.variance);
  return [
    `${d.branch.name} — ${new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}`,
    `Revenue: ${c} ${n(d.revenue)} (taken in: ${c} ${n(d.takings)}, ${d.bills} receipts)`,
    `Gaming: ${d.sessions} sessions, ${d.hoursPlayed} h played${d.occupancyPct === null ? "" : `, ${d.occupancyPct}% busy`}`,
    d.cash.shifts
      ? `Cash: counted ${c} ${n(d.cash.counted)} of ${c} ${n(d.cash.expected)} expected${v ? ` — ${v > 0 ? "over" : "short"} by ${c} ${n(Math.abs(v))}` : " — exact"}${d.cash.needingApproval ? ` (${d.cash.needingApproval} shift(s) to approve)` : ""}`
      : "Cash: no shift closed yet",
    Number(d.refunds) ? `Refunds: ${c} ${n(d.refunds)}` : null,
    d.topProducts.length ? `Top sellers: ${d.topProducts.map((p) => `${p.name} ×${p.quantity}`).join(", ")}` : null,
    d.feedback.count ? `Players rated it ${d.feedback.average}/5 (${d.feedback.count} ratings)` : null,
    d.openNotes ? `${d.openNotes} handover note(s) still open` : null,
  ].filter(Boolean).join("\n");
}

/** End-of-day numbers for one branch, ready to send to the owner's phone. */
export function DaySummaryCard({ branchId }: { branchId: string }) {
  const [date, setDate] = useState(localToday);
  const d = useApi<DaySummary>(`/branches/${branchId}/day-summary?date=${date}`);
  if (d.error) return null;
  const text = d.data ? summaryText(d.data) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied — paste it anywhere.");
    } catch {
      toast("Couldn't copy — select the text instead.", "warn");
    }
  };
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Sunset className="size-4 text-accent" /> Day summary</h2>
        <Input type="date" value={date} max={localToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-auto" aria-label="Day" />
      </div>
      {!d.data ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-sans text-sm leading-relaxed">{text}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="press inline-flex items-center gap-1.5 rounded-lg border border-ok/50 bg-ok/10 px-3 py-1.5 text-sm text-ok hover:bg-ok/15" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" /> Send on WhatsApp
            </a>
            <a className="press inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:border-accent" href={`mailto:?subject=${encodeURIComponent(`${d.data.branch.code} day summary ${d.data.date}`)}&body=${encodeURIComponent(text)}`}>
              <Mail className="size-4" /> Email
            </a>
            <button className="press inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:border-accent" onClick={() => void copy()}>
              <Copy className="size-4" /> Copy
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

const Stars = ({ value }: { value: number }) => (
  <span className="inline-flex" aria-label={`${value} out of 5`}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={i <= Math.round(value) ? "size-3.5 fill-reserved text-reserved" : "size-3.5 text-line-strong"} aria-hidden />)}
  </span>
);

/** What players said about their sessions (rated from the Shell when they log out). */
export function FeedbackCard({ branchId }: { branchId: string }) {
  const f = useApi<Feedback>(`/branches/${branchId}/feedback?days=30`);
  if (f.error || !f.data) return null;
  const d = f.data;
  const low = d.recent.filter((r) => r.rating <= 2);
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Star className="size-4 text-reserved" /> Player ratings <span className="font-normal text-ink-3">· last 30 days</span></h2>
      {d.count === 0 ? (
        <p className="text-sm text-ink-3">No ratings yet. Players are asked when they log out of a PC.</p>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{d.average}</span>
            <Stars value={d.average ?? 0} />
            <span className="text-xs text-ink-3">{d.count} rating{d.count === 1 ? "" : "s"}</span>
          </p>
          <div className="mt-2 grid gap-1" aria-label="Ratings by stars">
            {[5, 4, 3, 2, 1].map((s) => (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className="w-3 tabular-nums text-ink-3">{s}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-reserved" style={{ width: `${(d.stars[s - 1]! / d.count) * 100}%` }} /></div>
                <span className="w-6 text-right tabular-nums text-ink-3">{d.stars[s - 1]}</span>
              </div>
            ))}
          </div>
          {(low.length > 0 || d.recent.some((r) => r.comment)) && (
            <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
              {[...low, ...d.recent.filter((r) => r.comment && r.rating > 2)].slice(0, 5).map((r) => (
                <li key={r.id} className="py-2">
                  <p className="flex items-center gap-2"><Stars value={r.rating} /> <span className="text-xs text-ink-3">{r.customer} · {r.station} · {new Date(r.createdAt).toLocaleDateString()}</span></p>
                  {r.comment && <p className="mt-0.5 text-ink-2">“{r.comment}”</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
