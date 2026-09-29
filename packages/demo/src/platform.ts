// Super Admin (platform) backend for the demo.
import { clone, code, nowIso, num, uuid, type Engine } from "./engine";
import { created, fail, noContent, Router } from "./http";

export function platformBackend(e: Engine) {
  const r = new Router();
  const orgs = (): any[] => e.get("platform", "/organizations") ?? [];
  const detail = (id: string) => e.get("platform", `/organizations/${id}`) ?? fail(404, "not_found");
  const plans = (): any[] => e.get("platform", "/plans")?.plans ?? [];
  const meDoc = () => e.get("platform", "/auth/me");

  const audit = (action: string, entityType: string, entityId: string | null, organizationId: string | null, reason: string | null = null) => {
    const me = meDoc();
    const org = organizationId ? orgs().find((o) => o.id === organizationId) : null;
    const row = {
      id: uuid(), organizationId, organization: org?.displayName ?? null, actorType: "PLATFORM_ADMIN", actor: me?.user?.email ?? "super@arenaos.test", actorId: me?.user?.id ?? null,
      actorRole: "SUPER_ADMIN", action, entityType, entityId, reason, ip: "demo", createdAt: nowIso(),
    };
    for (const k of ["/audit?scope=platform", "/audit?scope=all"]) (e.get("platform", k) as any[] | undefined)?.unshift(clone(row));
    if (organizationId) e.get("platform", `/organizations/${organizationId}`)?.activity?.unshift(clone(row));
    e.get("platform", "/overview")?.activity?.unshift(clone(row));
  };

  r.get("/audit", (q) => {
    const orgId = q.query.get("organizationId");
    if (orgId) return detail(orgId).activity ?? [];
    return e.get("platform", `/audit?scope=${q.query.get("scope") === "all" ? "all" : "platform"}`) ?? [];
  });

  r.get("/overview", () => {
    const o = e.get("platform", "/overview");
    const list = orgs();
    const byStatus: Record<string, number> = {};
    for (const x of list) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    o.organizations = { total: list.length, byStatus };
    o.recent = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((x) => ({ id: x.id, slug: x.slug, displayName: x.displayName, status: x.status, countryCode: x.countryCode, createdAt: x.createdAt }));
    // Live station count from the venue demo, so the platform reflects the floor.
    const floors = e.keys("staff", /^\/branches\/[^/]+\/floor$/).map((k) => e.get("staff", k)?.devices ?? []).flat();
    if (floors.length) o.devices = { total: Math.max(o.devices.total, floors.length), online: floors.filter((d: any) => d.isOnline).length + Math.max(0, o.devices.total - floors.length) };
    const month = new Date().toISOString().slice(0, 7);
    const s = o.signups?.find((x: any) => x.month === month);
    if (s) s.count = list.filter((x) => x.createdAt.startsWith(month)).length;
    return o;
  });

  r.get("/organizations", (q) => {
    const term = (q.query.get("q") ?? "").trim().toLowerCase();
    const status = q.query.get("status");
    return orgs().filter((o) => (!status || o.status === status) && (!term || [o.displayName, o.slug, o.billingEmail].some((v) => String(v).toLowerCase().includes(term))));
  });

  r.post("/organizations", (q) => {
    const b = q.body ?? {};
    if (orgs().some((o) => o.slug === b.slug)) fail(409, "slug_taken");
    const plan = plans().find((p) => p.id === b.planId) ?? fail(400, "validation_failed", { issues: [{ path: "planId", message: "Unknown plan" }] });
    const trial = num(b.trialDays) > 0;
    const id = uuid();
    const now = nowIso();
    const end = new Date(Date.now() + (trial ? num(b.trialDays) : 30) * 86_400_000).toISOString();
    const row = {
      id, slug: b.slug, displayName: b.displayName, status: trial ? "TRIAL" : "ACTIVE", countryCode: b.countryCode ?? "AE", defaultCurrency: "AED", createdAt: now, billingEmail: b.ownerEmail,
      subscription: { status: trial ? "TRIALING" : "ACTIVE", currentPeriodEnd: end, plan: { name: plan.name, code: plan.code } },
      counts: { branches: 0, customers: 0, devices: 0, online: 0, staff: 1 },
    };
    orgs().unshift(row);
    const { subscribers: _s, features, ...planRest } = plan;
    e.set("platform", `/organizations/${id}`, {
      id, slug: b.slug, displayName: b.displayName, legalName: b.legalName ?? b.displayName, status: row.status, countryCode: row.countryCode, defaultCurrency: "AED", defaultTimezone: "Asia/Dubai",
      billingEmail: b.ownerEmail, suspendedAt: null, suspendReason: null, createdAt: now,
      subscription: { id: uuid(), status: row.subscription.status, currentPeriodStart: now, currentPeriodEnd: end, maxBranches: null, maxDevices: null, maxEmployees: null, plan: planRest },
      features: (e.get("platform", "/plans")?.catalog ?? []).map((f: any) => ({ key: f.key, label: f.label, plan: !!features?.[f.key], enabled: !!features?.[f.key], override: null })),
      branches: [], counts: { branches: 0, devices: 0, online: 0, staff: 1, customers: 0 },
      owners: [{ id: uuid(), name: b.ownerName, status: "ACTIVE", email: b.ownerEmail, lastLoginAt: null }], activity: [],
    });
    plan.subscribers = num(plan.subscribers) + 1;
    audit("platform.org.create", "Organization", id, id);
    return created({ organization: { id, slug: b.slug, displayName: b.displayName }, owner: { email: b.ownerEmail, existingAccount: false, tempPassword: `Arena-${code(10)}` } });
  });

  r.patch("/organizations/:id/status", (q) => {
    const id = q.params["id"]!;
    const status = q.body?.status;
    if ((status === "SUSPENDED" || status === "CANCELLED") && !q.body?.reason) fail(400, "reason_required");
    const suspended = status === "SUSPENDED";
    const patch = { status, suspendedAt: suspended ? nowIso() : null, suspendReason: suspended ? q.body.reason : null };
    Object.assign(detail(id), patch);
    const row = orgs().find((o) => o.id === id);
    if (row) row.status = status;
    audit("platform.org.status", "Organization", id, id, q.body?.reason ?? null);
    return patch;
  });

  r.patch("/organizations/:id/subscription", (q) => {
    const id = q.params["id"]!;
    const d = detail(id);
    const sub = d.subscription ?? fail(404, "not_found");
    const { extendDays, planId, ...rest } = q.body ?? {};
    Object.assign(sub, rest);
    if (planId) {
      const p = plans().find((x) => x.id === planId);
      if (p) {
        const { subscribers: _s, features, ...planRest } = p;
        sub.plan = planRest;
        d.features = d.features.map((f: any) => ({ ...f, plan: !!features[f.key], enabled: f.override ? f.override.enabled : !!features[f.key] }));
      }
    }
    if (extendDays) sub.currentPeriodEnd = new Date(Math.max(Date.parse(sub.currentPeriodEnd), Date.now()) + num(extendDays) * 86_400_000).toISOString();
    const row = orgs().find((o) => o.id === id);
    if (row?.subscription) Object.assign(row.subscription, { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, plan: { name: sub.plan.name, code: sub.plan.code } });
    audit("platform.subscription.update", "Subscription", sub.id, id);
    return sub;
  });

  r.put("/organizations/:id/features/:key", (q) => {
    const d = detail(q.params["id"]!);
    const f = d.features.find((x: any) => x.key === q.params["key"]) ?? fail(404, "not_found");
    f.override = { enabled: !!q.body?.enabled, reason: q.body?.reason ?? null, limitValue: null };
    f.enabled = f.override.enabled;
    audit("platform.feature.override", "OrganizationFeature", f.key, d.id, q.body?.reason ?? null);
    return f;
  });
  r.delete("/organizations/:id/features/:key", (q) => {
    const d = detail(q.params["id"]!);
    const f = d.features.find((x: any) => x.key === q.params["key"]);
    if (f) {
      f.override = null;
      f.enabled = f.plan;
      audit("platform.feature.reset", "OrganizationFeature", f.key, d.id);
    }
    return noContent();
  });

  r.patch("/plans/:id", (q) => {
    const p = plans().find((x) => x.id === q.params["id"]) ?? fail(404, "not_found");
    const body = { ...q.body };
    if (body.price !== undefined) body.price = Number(body.price).toFixed(4);
    Object.assign(p, body);
    audit("platform.plan.update", "SubscriptionPlan", p.id, null);
    return p;
  });
  r.put("/plans/:id/features/:key", (q) => {
    const p = plans().find((x) => x.id === q.params["id"]) ?? fail(404, "not_found");
    p.features[q.params["key"]!] = !!q.body?.enabled;
    audit("platform.plan.feature", "PlanFeature", `${p.code}:${q.params["key"]}`, null);
    return { planId: p.id, featureKey: q.params["key"], enabled: !!q.body?.enabled };
  });

  return r;
}
