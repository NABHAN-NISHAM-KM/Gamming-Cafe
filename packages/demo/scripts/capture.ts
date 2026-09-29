// Captures the REAL API's responses for every screen of the demo venue, so the
// in-browser demo starts from genuine data in the exact shapes the apps use.
//   cd apps/api && npx tsx ../../packages/demo/scripts/capture.ts
// Needs the demo stack running: API on DEMO_API (4010), platform on DEMO_PLATFORM (4110).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { totpAt } from "../../../apps/api/src/auth/crypto.js";

const API = process.env["DEMO_API"] ?? "http://localhost:4010/v1";
const PLATFORM = process.env["DEMO_PLATFORM"] ?? "http://localhost:4110/v1/platform";
const OUT = resolve(import.meta.dirname, "../src/fixtures");
const PASSWORD = "ArenaDemo!2026";

type Bag = Record<string, unknown>;
/** A list endpoint's rows, whether it returns an array or an object holding one. */
const list = (v: unknown): any[] => (Array.isArray(v) ? v : v && typeof v === "object" ? ((Object.values(v).find(Array.isArray) as any[]) ?? []) : []);
const staff: Bag = {};
const platform: Bag = {};
const customer: Bag = {};
const missing: string[] = [];

async function get(base: string, token: string, path: string, into: Bag, label = path) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    missing.push(`${res.status} ${label}`);
    return undefined;
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  into[path] = body;
  return body as any;
}
const post = async (url: string, body: unknown, token?: string) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(data)}`);
  return data;
};

// ── Staff (owner of Demo Arena) ─────────────────────────────────────────────
const staffLogin = await post(`${API}/auth/login`, { email: "owner@demo.test", password: PASSWORD, organizationSlug: "demo" });
const T = staffLogin.accessToken as string;
const s = (p: string) => get(API, T, p, staff);

for (const p of [
  "/auth/me", "/permissions", "/organization", "/brands", "/branches", "/employees", "/roles", "/games", "/launchers", "/shell-apps",
  "/peripheral-presets", "/pricing-plans", "/membership-tiers", "/customers", "/inventory/items", "/inventory/overview", "/inventory/transfers",
  "/warehouses", "/suppliers", "/purchase-orders", "/purchase-orders?status=open", "/supplier-invoices", "/supplier-invoices?status=OPEN",
  "/products", "/product-categories", "/modifier-groups", "/menu/manage", "/loyalty/rules", "/loyalty/rewards", "/promotions", "/segments",
  "/campaigns", "/campaigns/audience", "/tournaments",
]) await s(p);

const branches = list(staff["/branches"]);
for (const b of branches) {
  const bp = `/branches/${b.id}`;
  for (const p of ["", "/zones", "/floor", "/stations", "/devices", "/sessions", "/bookings", "/bills", "/bills?open=1", "/orders", "/kitchen", "/menu", "/tables", "/shifts", "/shifts/me", "/cash-drawers", "/print-jobs", "/print-settings", "/enrollment-tokens", "/game-updates", "/diskless"]) await s(`${bp}${p}`);
  await s(`/menu/costing?branchId=${b.id}`);
  const zones = list(staff[`${bp}/zones`]);
  for (const z of zones) await s(`/zones/${z.id}`);
  const floor = staff[`${bp}/floor`] as any;
  for (const d of floor?.devices ?? []) {
    for (const p of ["", "/accessories", "/commands", "/session", "/tools"]) await s(`/devices/${d.id}${p}`);
    if (d.session?.id) await s(`/sessions/${d.session.id}`);
  }
  for (const bill of list(staff[`${bp}/bills`]).slice(0, 40)) await s(`/bills/${bill.id}`);
  for (const o of list(staff[`${bp}/orders`]).slice(0, 40)) await s(`/orders/${o.id}`);
  for (const bk of list(staff[`${bp}/bookings`]).slice(0, 40)) await s(`/bookings/${bk.id}`);
  for (const sh of list(staff[`${bp}/shifts`]).slice(0, 10)) await s(`/shifts/${sh.id}`);
}
for (const c of list(staff["/customers"])) for (const p of ["", "/memberships", "/wallet", "/loyalty"]) await s(`/customers/${c.id}${p}`);
for (const e of list(staff["/employees"])) await s(`/employees/${e.id}`);
for (const g of list(staff["/games"]).slice(0, 40)) await s(`/games/${g.id}/installations`);
for (const t of list(staff["/tournaments"])) await s(`/tournaments/${t.id}`);
for (const p of list(staff["/promotions"])) await s(`/promotions/${p.id}`);
for (const c of list(staff["/campaigns"])) await s(`/campaigns/${c.id}`);
for (const seg of list(staff["/segments"])) await s(`/segments/${seg.id}/members`);
for (const po of list(staff["/purchase-orders"])) await s(`/purchase-orders/${po.id}`);
for (const w of list(staff["/warehouses"])) for (const p of ["/stock", "/movements", "/reorder"]) await s(`/warehouses/${w.id}${p}`);
for (const it of list(staff["/inventory/items"]).slice(0, 60)) await s(`/inventory/items/${it.id}`);
for (const pr of list(staff["/products"]).slice(0, 80)) await s(`/products/${pr.id}/recipe`);

// ── Platform (Super Admin, demo database only) ─────────────────────────────
const pl = await post(`${PLATFORM}/auth/login`, { email: "super@arenaos.test", password: PASSWORD });
if (!pl.mfaSetupRequired) throw new Error("Demo super admin already enrolled — reseed arena_demo or delete its MfaFactor");
const pt = await post(`${PLATFORM}/auth/mfa/verify`, { mfaToken: pl.mfaToken, code: totpAt(pl.secret, Date.now()) });
const P = pt.accessToken as string;
const pg = (p: string) => get(PLATFORM, P, p, platform);
for (const p of ["/auth/me", "/overview", "/organizations", "/plans", "/audit?scope=platform", "/audit?scope=all", "/admins"]) await pg(p);
for (const o of list(platform["/organizations"])) await pg(`/organizations/${o.id}`);

// ── Customer app (Ahmed) ───────────────────────────────────────────────────
const cl = await post(`${API}/app/demo/login`, { username: "ahmed", password: "ahmed123" });
const C = cl.accessToken as string;
const cg = (p: string) => get(`${API}/app`, C, p, customer);
await cg("/demo/venue");
for (const p of ["/me", "/bookings", "/wallet", "/loyalty", "/inbox", "/tournaments", "/visits"]) await cg(p);
const venue = customer["/demo/venue"] as any;
for (const b of venue?.branches ?? []) await cg(`/shop?branchId=${b.id}`);
for (const t of list(customer["/tournaments"])) await cg(`/tournaments/${t.id}`);

mkdirSync(OUT, { recursive: true });
const meta = { capturedAt: new Date().toISOString(), staffLogin: { organization: staffLogin.organization }, customerToken: "demo" };
writeFileSync(resolve(OUT, "staff.json"), JSON.stringify(staff));
writeFileSync(resolve(OUT, "platform.json"), JSON.stringify(platform));
writeFileSync(resolve(OUT, "customer.json"), JSON.stringify(customer));
writeFileSync(resolve(OUT, "meta.json"), JSON.stringify(meta, null, 2));
const size = (b: Bag) => `${Object.keys(b).length} responses, ${Math.round(JSON.stringify(b).length / 1024)} KB`;
console.log(`staff: ${size(staff)}\nplatform: ${size(platform)}\ncustomer: ${size(customer)}`);
if (missing.length) console.log(`not captured (${missing.length}):\n  ${missing.join("\n  ")}`);
