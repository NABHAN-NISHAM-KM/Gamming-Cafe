// Adds the screens built after the main capture to the demo fixtures, without
// re-capturing everything: each response is captured from the REAL API (demo
// stack: node packages/demo/scripts/stack.mjs api|platform), its timestamps are
// moved back to the original capture time, and it's merged into fixtures/*.json.
//   cd apps/api && npx tsx ../../packages/demo/scripts/capture-new.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { totpAt } from "../../../apps/api/src/auth/crypto.js";

const API = process.env["DEMO_API"] ?? "http://localhost:4010/v1";
const PLATFORM = process.env["DEMO_PLATFORM"] ?? "http://localhost:4110/v1/platform";
const OUT = resolve(import.meta.dirname, "../src/fixtures");
const PASSWORD = "ArenaDemo!2026";

type Bag = Record<string, unknown>;
const load = (f: string): Bag => JSON.parse(readFileSync(resolve(OUT, `${f}.json`), "utf8"));
const meta = load("meta") as { capturedAt: string };
const fx = { staff: load("staff"), platform: load("platform"), customer: load("customer") };
const list = (v: unknown): any[] => (Array.isArray(v) ? v : v && typeof v === "object" ? ((Object.values(v).find(Array.isArray) as any[]) ?? []) : []);

// The demo shifts every ISO timestamp by (now − capturedAt) when it loads; undo today's offset so new data lines up.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const back = Date.now() - Date.parse(meta.capturedAt);
const shift = (v: unknown): unknown =>
  typeof v === "string" ? (ISO.test(v) ? new Date(Date.parse(v) - back).toISOString() : v) : Array.isArray(v) ? v.map(shift) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)])) : v;

const added: string[] = [];
const missing: string[] = [];
async function get(base: string, token: string, path: string, into: Bag) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return void missing.push(`${res.status} ${path}`);
  const text = await res.text();
  into[path] = shift(text ? JSON.parse(text) : null);
  added.push(path);
  return into[path] as any;
}
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(data)}`);
  return data;
};

// ── Staff ──────────────────────────────────────────────────────────────────
const T = (await post(`${API}/auth/login`, { email: "owner@demo.test", password: PASSWORD, organizationSlug: "demo" })).accessToken as string;
const s = (p: string) => get(API, T, p, fx.staff);
for (const p of ["/organization/usage", "/organization/links", "/organization/referrals", "/billing", "/announcements", "/seasons", "/payments/gateway"]) await s(p);
for (const c of list(fx.staff["/customers"])) await s(`/customers/${c.id}/insights`);
for (const b of list(fx.staff["/branches"])) {
  const bp = `/branches/${b.id}`;
  for (const p of ["/waitlist", "/forecast", "/anomalies?days=7", "/anomalies?days=30", "/station-health", "/table-qr"]) await s(`${bp}${p}`);
  // This week's rota (planned through the API the first time), served for whichever week the demo asks for.
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const range = `from=${encodeURIComponent(monday.toISOString())}&to=${encodeURIComponent(new Date(monday.getTime() + 7 * 86_400_000).toISOString())}`;
  const auth = { authorization: `Bearer ${T}`, "content-type": "application/json" };
  const now = (await (await fetch(`${API}${bp}/rota?${range}`, { headers: auth })).json()) as any;
  // A person can't be on two branches at once, so the sample rota goes on the main branch only.
  if (!list(now).length && b.code === "DXB1") {
    const team = list(fx.staff["/employees"]).filter((e: any) => e.status === "ACTIVE").slice(0, 4);
    for (let day = 0; day < 7; day++)
      for (const [i, e] of team.entries()) {
        const start = new Date(monday.getTime() + day * 86_400_000 + (i % 2 ? 16 : 10) * 3_600_000);
        if ((day + i) % 3 === 2) continue; // days off
        await fetch(`${API}${bp}/rota`, { method: "POST", headers: auth, body: JSON.stringify({ employeeId: e.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 8 * 3_600_000).toISOString() }) });
      }
  }
  const rota = await fetch(`${API}${bp}/rota?${range}`, { headers: auth });
  if (rota.ok) fx.staff[`${bp}/rota`] = shift(await rota.json());
}
for (const bill of Object.keys(fx.staff).filter((k) => /^\/bills\/[^/]+$/.test(k)).slice(0, 40)) await s(`${bill}/receipt`);

// ── Platform (demo database only: re-enrols the demo super admin's MFA) ─────
const pl = await post(`${PLATFORM}/auth/login`, { email: "super@arenaos.test", password: PASSWORD });
if (!pl.mfaSetupRequired) throw new Error("Demo super admin already enrolled — delete its MfaFactor in arena_demo first");
const P = (await post(`${PLATFORM}/auth/mfa/verify`, { mfaToken: pl.mfaToken, code: totpAt(pl.secret, Date.now()) })).accessToken as string;
const pg = (p: string) => get(PLATFORM, P, p, fx.platform);
for (const p of ["/releases", "/announcements", "/health", "/leads", "/site-stats?days=7", "/site-stats?days=30", "/site-stats?days=90", "/site-stats?days=365", "/overview", "/organizations"]) await pg(p);
for (const o of list(fx.platform["/organizations"])) await pg(`/organizations/${o.id}/invoices`);

// ── Customer app (Ahmed) ───────────────────────────────────────────────────
const C = (await post(`${API}/app/demo/login`, { username: "ahmed", password: "ahmed123" })).accessToken as string;
const cg = (p: string) => get(`${API}/app`, C, p, fx.customer);
for (const p of ["/waitlist", "/seasons", "/lfg", "/me/spending", "/me/bills", "/wallet/card"]) await cg(p);

for (const [f, bag] of Object.entries(fx)) writeFileSync(resolve(OUT, `${f}.json`), JSON.stringify(bag));
console.log(`added ${added.length} responses`);
if (missing.length) console.log(`not captured (${missing.length}):\n  ${missing.join("\n  ")}`);
