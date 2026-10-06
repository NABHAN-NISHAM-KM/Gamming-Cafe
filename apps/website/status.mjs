// Uptime for the status page: every minute the website server checks each
// service, keeps per-day up/total minutes and a list of outages, and saves them
// to status-data.json (beside this file) every few minutes.
import { readFile, writeFile } from "node:fs/promises";

const KEEP_DAYS = 90;
const SAVE_EVERY = 5; // checks

export function services() {
  const api = process.env.API_URL ?? "http://localhost:4000";
  const platform = process.env.PLATFORM_URL ?? "http://localhost:4100";
  const admin = process.env.ADMIN_URL ?? "http://localhost:3000";
  return [
    { key: "api", name: "Venue API (stations, app, POS)", url: `${api.replace(/\/+$/, "")}/health` },
    { key: "console", name: "Admin console", url: `${admin.replace(/\/+$/, "")}/login` },
    { key: "platform", name: "Sign-up, billing & Super Admin", url: `${platform.replace(/\/+$/, "")}/health` },
  ];
}

const empty = () => ({ days: {}, incidents: [], last: {} });

/** Tells a person: ALERT_WEBHOOK_URL gets `{ text }` (Slack, Teams, Discord-compatible relays…). */
function alert(text) {
  const url = process.env.ALERT_WEBHOOK_URL;
  console.log(`[status] ${text}`);
  if (url) fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) }).catch((e) => console.error(`[status] alert failed: ${e.message}`));
}

export function createMonitor(file) {
  let state = empty();
  let checks = 0;
  const ready = readFile(file, "utf8").then((t) => void (state = { ...empty(), ...JSON.parse(t) })).catch(() => undefined);

  async function check() {
    await ready;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const today = (state.days[day] ??= {});
    await Promise.all(
      services().map(async (s) => {
        const started = Date.now();
        const ok = await fetch(s.url, { signal: AbortSignal.timeout(10_000), redirect: "manual" })
          .then((r) => r.status < 500)
          .catch(() => false);
        const [up, total] = today[s.key] ?? [0, 0];
        today[s.key] = [up + (ok ? 1 : 0), total + 1];
        state.last[s.key] = { ok, at: now.toISOString(), ms: Date.now() - started };
        const open = state.incidents.find((i) => i.service === s.key && !i.end);
        if (!ok && !open) state.incidents.unshift({ service: s.key, start: now.toISOString(), end: null });
        // Alert on the second failed check in a row, so one slow answer doesn't page anyone.
        if (!ok && open && !open.alerted) {
          open.alerted = true;
          alert(`🔴 ${s.name} is DOWN since ${open.start} (${s.url})`);
        }
        if (ok && open) {
          open.end = now.toISOString();
          if (open.alerted) alert(`✅ ${s.name} is back up after ${Math.max(1, Math.round((Date.parse(open.end) - Date.parse(open.start)) / 60_000))} min`);
        }
      }),
    );
    for (const d of Object.keys(state.days)) if (Date.parse(d) < Date.now() - KEEP_DAYS * 86_400_000) delete state.days[d];
    state.incidents = state.incidents.filter((i) => !i.end || Date.parse(i.end) > Date.now() - KEEP_DAYS * 86_400_000).slice(0, 200);
    if (++checks % SAVE_EVERY === 0) await writeFile(file, JSON.stringify(state)).catch(() => undefined);
  }

  /** What the status page shows: each service now, uptime over 24 h / 7 d / 90 d, daily bars, recent outages. */
  function view() {
    const days = Object.keys(state.days).sort();
    const pct = (key, n) => {
      const recent = days.slice(-n).map((d) => state.days[d][key]).filter(Boolean);
      const up = recent.reduce((a, [u]) => a + u, 0);
      const total = recent.reduce((a, [, t]) => a + t, 0);
      return total ? Math.round((up / total) * 10000) / 100 : null;
    };
    return {
      updatedAt: new Date().toISOString(),
      services: services().map((s) => ({
        key: s.key, name: s.name, now: state.last[s.key] ?? null,
        uptime: { day: pct(s.key, 1), week: pct(s.key, 7), quarter: pct(s.key, KEEP_DAYS) },
        days: days.slice(-KEEP_DAYS).map((d) => ({ day: d, pct: state.days[d][s.key] ? Math.round((state.days[d][s.key][0] / state.days[d][s.key][1]) * 1000) / 10 : null })),
      })),
      incidents: state.incidents.slice(0, 20).map((i) => ({ ...i, name: services().find((s) => s.key === i.service)?.name ?? i.service, minutes: Math.max(1, Math.round(((i.end ? Date.parse(i.end) : Date.now()) - Date.parse(i.start)) / 60_000)) })),
    };
  }

  return { check, view };
}
