"use client";

import { useState } from "react";
import { Card, Empty, ErrorNote, PageHeader, Select, Skeleton, Table } from "@/components/ui";
import { usePlatform } from "@/lib/client/platform";

interface SiteStats {
  days: number;
  views: number;
  byDay: Array<{ day: string; views: number }>;
  pages: Array<{ path: string; views: number }>;
  referrers: Array<{ referrer: string; views: number }>;
  funnel: { signupViews: number; trialStarted: number; trialDone: number; contactSent: number; demoBooked: number; partnerSent: number; quoteMade: number; venueBooked: number; helpAsked: number };
}

/** The website's own visit counts: no cookies, no IPs — just pages, referring sites and sign-up steps per day. */
export default function SitePage() {
  const [days, setDays] = useState("30");
  const { data, error } = usePlatform<SiteStats>(`/site-stats?days=${days}`);
  const max = Math.max(1, ...(data?.byDay.map((d) => d.views) ?? []));
  const f = data?.funnel;
  const steps: Array<[string, number | undefined]> = [
    ["Sign-up page views", f?.signupViews],
    ["Started filling in the trial form", f?.trialStarted],
    ["Trials created", f?.trialDone],
  ];
  const other: Array<[string, number | undefined]> = [
    ["Walkthrough requests", f?.contactSent],
    ["Calls booked", f?.demoBooked],
    ["Partner applications", f?.partnerSent],
    ["Venue plans / quotes", f?.quoteMade],
    ["Stations booked on venue pages", f?.venueBooked],
    ["Questions to the help assistant", f?.helpAsked],
  ];
  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Website"
        subtitle="Visits to the marketing site, counted without cookies or IP addresses. Visitors whose browser asks not to be tracked aren't counted."
        actions={
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option>
          </Select>
        }
      />
      <ErrorNote>{error?.message}</ErrorNote>
      {!data ? <Card><Skeleton rows={6} /></Card> : (
        <div className="grid gap-4">
          <Card>
            <div className="flex items-baseline justify-between"><h2 className="font-semibold">Page views</h2><span className="tabular text-2xl font-semibold">{data.views.toLocaleString()}</span></div>
            {data.byDay.length ? (
              <div className="mt-4 flex h-32 items-end gap-px" role="img" aria-label={`Page views per day over ${data.days} days`}>
                {data.byDay.map((d) => <div key={d.day} title={`${d.day}: ${d.views}`} className="min-w-[2px] flex-1 rounded-t bg-accent/70" style={{ height: `${Math.max(2, (d.views / max) * 100)}%` }} />)}
              </div>
            ) : <Empty title="No visits counted yet." />}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold">Trial funnel</h2>
              {steps.map(([label, n], i) => (
                <div key={label} className="flex justify-between border-b border-line py-2 text-sm last:border-0">
                  <span>{label}</span>
                  <span className="tabular">{n ?? 0}{i > 0 && steps[i - 1][1] ? <span className="ml-2 text-ink-3">{Math.round(((n ?? 0) / steps[i - 1][1]!) * 100)}%</span> : null}</span>
                </div>
              ))}
              <h2 className="mb-3 mt-6 font-semibold">Other actions</h2>
              {other.map(([label, n]) => <div key={label} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{label}</span><span className="tabular">{n ?? 0}</span></div>)}
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">Where visitors come from</h2>
              {data.referrers.length ? (
                <Table head={["Site", "Views"]}>{data.referrers.map((r) => <tr key={r.referrer}><td className="px-4 py-2">{r.referrer}</td><td className="tabular px-4 py-2">{r.views}</td></tr>)}</Table>
              ) : <Empty title="No referring sites yet.">Direct visits and links between our own pages aren't listed.</Empty>}
            </Card>
          </div>
          <Card>
            <h2 className="mb-3 font-semibold">Top pages</h2>
            {data.pages.length ? (
              <Table head={["Page", "Views"]}>{data.pages.map((p) => <tr key={p.path}><td className="px-4 py-2 font-mono text-xs">{p.path}</td><td className="tabular px-4 py-2">{p.views}</td></tr>)}</Table>
            ) : <Empty title="No pages yet." />}
          </Card>
        </div>
      )}
    </>
  );
}
