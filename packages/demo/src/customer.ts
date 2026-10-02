// Customer app backend for the demo. The signed-in customer is a real customer
// of the demo venue, so bookings, purchases and sessions show up for staff too.
import { clone, code, money, nowIso, num, uuid, type Engine } from "./engine";
import { created, fail, Router } from "./http";
import type { StaffBackend } from "./staff";

export const DEMO_CUSTOMERS: Record<string, string> = { ahmed: "ahmed123", sara: "sara1234" };

export function customerBackend(e: Engine, staff: StaffBackend) {
  const r = new Router();
  const me = () => e.get("customer", "/me") ?? fail(401, "invalid_token");
  const staffCustomer = () => staff.customers().find((c) => c.id === me().id);
  const venue = () => e.get("customer", "/demo/venue");

  // ── sign-in ─────────────────────────────────────────────────────────────
  const signIn = (username: string) => {
    const c = staff.customers().find((x) => x.username === username.toLowerCase());
    if (!c) fail(401, "invalid_credentials");
    const w = staff.walletDoc(c.id);
    const current = e.get("customer", "/me");
    if (current?.id !== c.id) {
      // Switch the customer app to this customer (built from the venue's records).
      e.set("customer", "/me", {
        id: c.id, username: c.username, displayName: c.displayName, email: c.email, phone: c.phone, dateOfBirth: c.username === "sara" ? "2013-02-20T00:00:00.000Z" : null, referralCode: c.username.toUpperCase().slice(0, 6),
        createdAt: c.createdAt, membershipTier: c.membershipTier ? { ...c.membershipTier, gamingDiscountPct: "10", bookingWindowDays: 14, priorityBooking: false } : null, membership: null,
        wallet: { currency: w.currency, cash: w.cash, bonus: w.bonus, total: w.total, timeMinutes: w.timeMinutes, frozen: w.frozen },
        playingNow: (() => {
          const d = staff.allDevices().find((x) => x.session?.customer?.id === c.id);
          return d ? { sessionId: d.session.id, station: d.name, expiresAt: d.session.expiresAt } : null;
        })(),
      });
      e.set("customer", "/wallet", clone(w));
      e.set("customer", "/bookings", []);
      e.set("customer", "/inbox", [welcome(c.displayName)]);
      e.set("customer", "/screenshots", []); // taken on a real gaming PC only
    }
    return { accessToken: `demo.${c.id}`, customer: { id: c.id, displayName: c.displayName } };
  };
  const welcome = (name: string) => ({ id: uuid(), title: "Welcome to Demo Arena 🎮", body: `Hi ${name.split(" ")[0]}! This is the ArenaOS demo — book a PC, buy time or redeem rewards. Everything you do here is live in the venue's admin demo too.`, createdAt: nowIso(), readAt: null, kind: "INFO" });

  r.post("/:slug/login", (q) => {
    const u = String(q.body?.username ?? "").toLowerCase();
    const known = DEMO_CUSTOMERS[u];
    const exists = staff.customers().some((c) => c.username === u);
    if (!exists || (known && q.body?.password !== known) || (!known && !q.body?.password)) fail(401, "invalid_credentials");
    return signIn(u);
  });
  r.post("/:slug/register", (q) => {
    const b = q.body ?? {};
    if (staff.customers().some((c) => c.username === String(b.username).toLowerCase())) fail(409, "username_taken");
    const c = { id: uuid(), username: String(b.username).toLowerCase(), displayName: b.displayName || b.username, firstName: null, lastName: null, phone: b.phone ?? null, email: null, status: "ACTIVE", createdAt: nowIso(), lastVisitAt: null, marketingConsent: !!b.marketingConsent, membershipTier: null, timeBalanceMinutes: 0, walletBalance: "0.00" };
    staff.customers().unshift(c);
    e.set("staff", `/customers/${c.id}`, { ...clone(c), sessions: [], timeLedger: [] });
    staff.walletDoc(c.id);
    return created(signIn(c.username));
  });
  r.post("/logout", () => ({ ok: true }));
  r.get("/:slug/venue", () => venue());

  // ── me & wallet (always fresh from the venue's records) ────────────────
  r.get("/me", () => {
    const m = me();
    const w = staff.walletDoc(m.id);
    m.wallet = { ...m.wallet, cash: w.cash, bonus: w.bonus, total: w.total, timeMinutes: w.timeMinutes, frozen: w.frozen };
    const d = staff.allDevices().find((x) => x.session?.customer?.id === m.id);
    m.playingNow = d ? { sessionId: d.session.id, station: d.name, expiresAt: d.session.expiresAt } : null;
    const c = staffCustomer();
    if (c?.membershipTier) m.membershipTier = { ...c.membershipTier, gamingDiscountPct: m.membershipTier?.gamingDiscountPct ?? "10", bookingWindowDays: 14, priorityBooking: false };
    return m;
  });
  r.get("/wallet", () => {
    const w = staff.walletDoc(me().id);
    return { ...clone(w) };
  });

  // ── booking ─────────────────────────────────────────────────────────────
  const bookingsFor = (customerId: string) =>
    staff.branches().flatMap((b) => ((e.get("staff", `/branches/${b.id}/bookings`) as any[]) ?? []).filter((x) => x.customerId === customerId));
  const toCustomerBooking = (b: any) => ({
    id: b.id, reference: b.reference, status: b.status, startsAt: b.startsAt, endsAt: b.endsAt, minutes: Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60_000), players: b.players,
    estimatedTotal: b.estimatedTotal, depositAmount: b.depositAmount, currency: b.currency, zone: b.zone ?? null, branchId: b.branchId, devices: b.devices ?? [],
  });
  r.get("/bookings", () => bookingsFor(me().id).map(toCustomerBooking).sort((a, b) => b.startsAt.localeCompare(a.startsAt)));
  r.get("/stations", (q) => {
    const branchId = q.query.get("branchId")!;
    const zoneId = q.query.get("zoneId");
    const from = Date.parse(q.query.get("from") ?? nowIso());
    const to = Date.parse(q.query.get("to") ?? nowIso());
    const floor = staff.floorDoc(branchId);
    const bookings = ((e.get("staff", `/branches/${branchId}/bookings`) as any[]) ?? []).filter((b) => ["CONFIRMED", "CHECKED_IN", "PENDING"].includes(b.status));
    return floor.devices
      .filter((d: any) => d.kind !== "SMART_TV" && (!zoneId || d.zoneId === zoneId))
      .map((d: any) => {
        const busy: Array<{ from: string; to: string }> = [];
        if (d.session) busy.push({ from: d.session.startedAt, to: d.session.expiresAt ?? new Date(Date.now() + 3 * 3_600_000).toISOString() });
        for (const b of bookings) if ((b.devices ?? []).some((x: any) => x.id === d.id) && Date.parse(b.endsAt) > from && Date.parse(b.startsAt) < to) busy.push({ from: b.startsAt, to: b.endsAt });
        return { id: d.id, name: d.name, maintenance: d.status === "MAINTENANCE", busy };
      });
  });
  r.get("/estimate", (q) => {
    const branchId = q.query.get("branchId")!;
    const zoneId = q.query.get("zoneId");
    const minutes = num(q.query.get("minutes")) || 60;
    const d = staff.floorDoc(branchId).devices.find((x: any) => x.zoneId === zoneId && x.kind !== "SMART_TV") ?? { kind: "GAMING_PC", zoneId, branchId };
    const plan = staff.plansFor(d).find((p: any) => p.paymentTiming === "PREPAID") ?? staff.plansFor(d)[0];
    return { currency: venue()?.currency ?? "AED", perStation: money(((num(plan?.rate) || 15) * minutes) / 60) };
  });
  r.post("/bookings", (q) => {
    const b = q.body ?? {};
    const branchId = b.branchId;
    const startsAt = new Date(b.startsAt);
    if (startsAt.getTime() < Date.now() - 60_000) fail(400, "starts_in_past");
    const zones = (e.get("staff", `/branches/${branchId}/zones`) ?? []) as any[];
    const zone = zones.find((z) => z.id === b.zoneId);
    const devices = staff.floorDoc(branchId).devices.filter((d: any) => (b.deviceIds ?? []).includes(d.id));
    const c = staffCustomer() ?? fail(401, "invalid_token");
    const est = num(q.body?.estimate) || devices.length * 15 * (num(b.minutes) / 60);
    const bk = {
      id: uuid(), branchId, zoneId: zone?.id ?? null, customerId: c.id, reference: `BK-${code(6)}`, resourceType: "PC", startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + num(b.minutes) * 60_000).toISOString(), players: Math.max(1, devices.length), status: "CONFIRMED", source: "APP",
      contactName: c.displayName, contactPhone: c.phone, estimatedTotal: money(est), depositAmount: b.payment?.method === "DEMO_CARD" ? money(est) : "0.00", currency: venue()?.currency ?? "AED",
      promoCode: null, notes: null, holdExpiresAt: null, checkedInAt: null, cancelledAt: null, cancelReason: null, createdAt: nowIso(),
      customer: { id: c.id, displayName: c.displayName, username: c.username, phone: c.phone }, zone: zone ? { id: zone.id, name: zone.name, type: zone.type } : null,
      devices: devices.map((d: any) => ({ id: d.id, name: d.name })), minutes: num(b.minutes),
    };
    const list = (e.get("staff", `/branches/${branchId}/bookings`) as any[]) ?? [];
    list.push(bk);
    list.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
    e.set("staff", `/branches/${branchId}/bookings`, list);
    e.set("staff", `/bookings/${bk.id}`, bk);
    e.emit({ type: "booking", branchId });
    return created(toCustomerBooking(bk));
  });
  r.post("/bookings/:id/cancel", (q) => {
    const bk = e.findById(q.params["id"]!) ?? fail(404, "not_found");
    if (bk.customerId !== me().id) fail(404, "not_found");
    e.patchById(bk.id, { status: "CANCELLED", cancelledAt: nowIso(), cancelReason: "Cancelled in the app" });
    e.emit({ type: "booking", branchId: bk.branchId });
    return { ok: true };
  });

  // ── shop ────────────────────────────────────────────────────────────────
  r.get("/shop", (q) => e.get("customer", `/shop?branchId=${q.query.get("branchId")}`) ?? e.get("customer", Object.keys(e.docs("customer")).find((k) => k.startsWith("/shop"))!) ?? { plans: [], tiers: [] });
  r.post("/time", (q) => {
    const id = me().id;
    const shop = e.get("customer", `/shop?branchId=${q.body?.branchId}`);
    const plan = shop?.plans.find((p: any) => p.id === q.body?.planId) ?? fail(404, "not_found");
    const pkg = plan.pricingPackages.find((k: any) => k.id === q.body?.packageId) ?? fail(404, "not_found");
    staff.spendWallet(id, num(pkg.price), `Bought ${pkg.name} (${plan.name})`);
    staff.ledger(id, "TOPUP", "TIME", pkg.durationMinutes + (pkg.bonusMinutes ?? 0), `${pkg.name} · ${plan.name}`);
    return { ok: true };
  });
  r.post("/memberships", (q) => {
    const id = me().id;
    const shop = Object.entries(e.docs("customer")).find(([k]) => k.startsWith("/shop"))?.[1] as any;
    const tier = shop?.tiers?.find((t: any) => t.id === q.body?.tierId) ?? fail(404, "not_found");
    staff.spendWallet(id, num(tier.price), `${tier.name} membership`);
    const t = { id: tier.id, name: tier.name, code: tier.code, color: tier.color };
    e.patchById(id, { membershipTier: t });
    me().membershipTier = { ...t, gamingDiscountPct: tier.gamingDiscountPct, bookingWindowDays: tier.bookingWindowDays, priorityBooking: tier.priorityBooking };
    me().membership = { id: uuid(), expiresAt: new Date(Date.now() + num(tier.durationDays) * 86_400_000).toISOString(), tier: { name: tier.name } };
    return { ok: true };
  });

  // ── rewards, tournaments, inbox ────────────────────────────────────────
  r.post("/loyalty/redeem", (q) => {
    const l = e.get("customer", "/loyalty");
    const reward = l?.rewards?.find((x: any) => x.id === q.body?.rewardId) ?? fail(404, "reward_not_found");
    const cost = num(reward.pointsCost ?? reward.points);
    if (num(l.points) < cost) fail(409, "not_enough_points");
    l.points = num(l.points) - cost;
    l.history.unshift({ id: uuid(), at: nowIso(), type: "REDEEM", source: "REWARD", points: -cost, balanceAfter: l.points, reason: reward.name, expiresAt: null });
    if (reward.type === "TIME" || reward.minutes) staff.ledger(me().id, "BONUS_GRANT", "TIME", num(reward.minutes ?? reward.value ?? 60), reward.name);
    if (reward.type === "WALLET_CREDIT") staff.ledger(me().id, "BONUS_GRANT", "BONUS", num(reward.value ?? 10), reward.name);
    return { code: reward.type === "ITEM" || !reward.type ? code(8) : undefined, minutes: reward.minutes ?? undefined, walletCredit: reward.type === "WALLET_CREDIT" ? money(num(reward.value)) : undefined };
  });
  r.post("/tournaments/:id/register", (q) => {
    const d = e.get("customer", `/tournaments/${q.params["id"]}`) ?? fail(404, "tournament_not_found");
    if (d.myTeam) fail(409, "already_registered", { player: me().displayName });
    const team = { id: uuid(), name: q.body?.teamName ?? me().displayName, players: [me().displayName, ...(q.body?.teammates ?? [])], seed: null, status: "REGISTERED" };
    d.myTeam = team;
    d.entered = num(d.entered) + 1;
    (d.teams ??= []).push(team);
    const row = (e.get("customer", "/tournaments") as any[]).find((t) => t.id === d.id);
    if (row) Object.assign(row, { myTeam: team, entered: d.entered });
    if (num(d.entryFee) > 0) staff.spendWallet(me().id, num(d.entryFee), `${d.name} entry`);
    return created(team);
  });
  r.post("/inbox/:id/read", (q) => {
    e.patchById(q.params["id"]!, { readAt: nowIso() }, ["customer"]);
    return { ok: true };
  });

  // ── self-service (profile, food, add time, live, games, friends, help…) ─
  const first = (n: string) => n.split(" ")[0] ?? n;
  const branchIds = () => staff.branches().map((b: any) => b.id);
  const mySeat = () => staff.allDevices().find((x: any) => x.session?.customer?.id === me().id) ?? null;
  r.patch("/me", (q) => {
    const m = me();
    Object.assign(m, Object.fromEntries(Object.entries(q.body ?? {}).filter(([k]) => ["displayName", "phone", "email", "dateOfBirth", "locale", "marketingConsent", "showOnLeaderboard"].includes(k))));
    return m;
  });
  r.post("/me/password", () => ({ ok: true }));
  r.post("/me/pin", (q) => {
    me().hasPin = !!q.body?.pin;
    return { ok: true };
  });
  r.post("/me/delete", () => fail(409, "wallet_not_empty"));
  r.post("/:slug/reset", () => fail(401, "invalid_code"));
  r.get("/me/stats", () => ({ minutes: 1260, spend: "385.00", visits: 9, sessions: 12, memberSince: me().createdAt, favouriteStation: "PC-07", months: [{ month: nowIso().slice(0, 7), minutes: 420, visits: 3 }] }));
  r.get("/live", () =>
    staff.branches().map((b: any) => {
      const devices = staff.floorDoc(b.id).devices.filter((d: any) => d.kind !== "SMART_TV");
      const zones = ((e.get("staff", `/branches/${b.id}/zones`) ?? []) as any[]).map((z) => {
        const mine = devices.filter((d: any) => d.zoneId === z.id);
        return { id: z.id, name: z.name, type: z.type, total: mine.length, free: mine.filter((d: any) => d.status === "AVAILABLE").length };
      });
      return { id: b.id, name: b.name, zones: zones.filter((z) => z.total > 0) };
    }),
  );
  r.get("/menu", () => {
    const d = mySeat();
    return d ? { station: d.name, menu: e.get("staff", `/branches/${d.branchId ?? branchIds()[0]}/menu`) } : { station: null, menu: null };
  });
  r.get("/orders", () => e.get("customer", "/orders") ?? []);
  r.post("/orders", (q) => {
    const d = mySeat() ?? fail(409, "not_playing");
    const menu = e.get("staff", `/branches/${d.branchId ?? branchIds()[0]}/menu`);
    const products = menu.categories.flatMap((c: any) => c.products);
    const lines = (q.body?.lines ?? []).map((l: any) => ({ p: products.find((p: any) => p.id === l.productId), quantity: num(l.quantity) }));
    const total = lines.reduce((s: number, l: any) => s + num(l.p?.price) * l.quantity, 0);
    if (q.body?.payWith === "WALLET") staff.spendWallet(me().id, total, "Food & drinks");
    const o = { id: uuid(), number: `A${code(4)}`, status: "PLACED", total: money(total), currency: menu.currency, createdAt: nowIso(), orderItems: lines.map((l: any) => ({ nameSnapshot: l.p?.name ?? "?", quantity: l.quantity })) };
    e.set("customer", "/orders", [o, ...(e.get("customer", "/orders") ?? [])]);
    return created(o);
  });
  const shopPlan = () => (Object.entries(e.docs("customer")).find(([k]) => k.startsWith("/shop"))?.[1] as any)?.plans?.find((p: any) => p.pricingPackages?.length);
  r.get("/session/offers", () => {
    const d = mySeat();
    if (!d?.session?.expiresAt) return { ok: false, message: "This session can't be extended here." };
    const w = staff.walletDoc(me().id);
    const plan = shopPlan();
    return {
      ok: true, currency: w.currency, wallet: w.frozen ? null : w.total, savedMinutes: w.timeMinutes, savedSteps: [30, 60, 120].filter((m) => m <= w.timeMinutes),
      packages: (plan?.pricingPackages ?? []).map((k: any) => ({ id: k.id, name: k.name, minutes: k.durationMinutes + (k.bonusMinutes ?? 0), bonusMinutes: k.bonusMinutes ?? 0, price: k.price })),
    };
  });
  r.post("/session/extend", (q) => {
    const d = mySeat() ?? fail(409, "no_session");
    let minutes = num(q.body?.savedMinutes);
    if (minutes) staff.ledger(me().id, "SPEND", "TIME", -minutes, `Added to ${d.name}`);
    else {
      const k = shopPlan()?.pricingPackages.find((x: any) => x.id === q.body?.packageId) ?? fail(404, "not_found");
      staff.spendWallet(me().id, num(k.price), `${k.name} on ${d.name}`);
      minutes = k.durationMinutes + (k.bonusMinutes ?? 0);
    }
    d.session.expiresAt = new Date(Date.parse(d.session.expiresAt) + minutes * 60_000).toISOString();
    e.emit({ type: "device", branchId: d.branchId, device: d });
    return created({ ok: true, expiresAt: d.session.expiresAt });
  });
  const favs = () => (e.get("customer", "/favorites") as string[] | undefined) ?? [];
  r.get("/games", () =>
    ((e.get("staff", "/games")?.games ?? []) as any[])
      .filter((g) => g.setting?.isEnabled !== false)
      .map((g) => ({ id: g.id, title: g.title, coverUrl: g.coverUrl, categories: g.categories, minAge: g.minAge, featured: !!g.setting?.isFeatured, stations: g.installedCount ?? 6, favorite: favs().includes(g.id) }))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title)),
  );
  r.post("/games/:id/favorite", (q) => {
    e.set("customer", "/favorites", [...new Set([...favs(), q.params["id"]!])]);
    return { ok: true };
  });
  r.delete("/games/:id/favorite", (q) => {
    e.set("customer", "/favorites", favs().filter((x) => x !== q.params["id"]));
    return { ok: true };
  });
  r.get("/referrals", () => ({ code: me().referralCode, friends: [{ name: "Omar", joinedAt: nowIso(), played: true }], points: 200 }));
  r.get("/tickets", () => e.get("customer", "/tickets") ?? []);
  r.post("/tickets", (q) => {
    const tk = { id: uuid(), category: q.body?.category, subject: q.body?.subject, message: q.body?.message ?? null, status: "OPEN", createdAt: nowIso(), resolvedAt: null };
    e.set("customer", "/tickets", [tk, ...(e.get("customer", "/tickets") ?? [])]);
    return created(tk);
  });
  r.get("/pc-login/:code", () => fail(404, "pc_code_expired"));
  r.post("/pc-login", () => fail(404, "pc_code_expired"));
  r.post("/gift", (q) => {
    const to = staff.customers().find((c: any) => c.username === String(q.body?.to ?? "").toLowerCase()) ?? fail(404, "player_not_found", { usernames: [q.body?.to] });
    if (to.id === me().id) fail(409, "gift_to_self");
    const amount = num(q.body?.amount);
    if (q.body?.bucket === "TIME") {
      staff.ledger(me().id, "TRANSFER_OUT", "TIME", -amount, `Gift to ${first(to.displayName)}`);
      staff.ledger(to.id, "TRANSFER_IN", "TIME", amount, `Gift from ${first(me().displayName)}`);
      return created({ sent: `${amount} min of play time`, to: first(to.displayName) });
    }
    staff.spendWallet(me().id, amount, `Gift to ${first(to.displayName)}`);
    staff.ledger(to.id, "TRANSFER_IN", "CASH", amount, `Gift from ${first(me().displayName)}`);
    return created({ sent: `${venue()?.currency ?? "AED"} ${money(amount)}`, to: first(to.displayName) });
  });
  r.post("/wallet/topup", (q) => {
    staff.ledger(me().id, "TOPUP", "CASH", num(q.body?.amount), "Top-up (demo card)");
    return created({ ok: true });
  });
  r.get("/leaderboard", () => ({
    top: [{ place: 1, name: "Omar", minutes: 1840, me: false }, { place: 2, name: "Lina", minutes: 1420, me: false }, ...(me().showOnLeaderboard ? [{ place: 3, name: first(me().displayName), minutes: 420, me: true }] : [])],
    me: { minutes: 420, place: 3, of: 41, shown: !!me().showOnLeaderboard },
  }));
  r.get("/challenges", () => [
    { id: "c1", name: "First visit", description: null, rewardPoints: 25, type: "VISITS", target: 1, progress: 1, earnedAt: nowIso() },
    { id: "c2", name: "Night owl: 10 hours", description: null, rewardPoints: 100, type: "PLAY_MINUTES", target: 600, progress: 420, earnedAt: null },
  ]);
  r.post("/bookings/:id/invite", (q) => {
    const bk = e.findById(q.params["id"]!) ?? fail(404, "booking_not_found");
    const n = (q.body?.usernames ?? []).length;
    return created({ invited: q.body?.usernames ?? [], share: money(num(bk.estimatedTotal) / (n + 1)), currency: bk.currency });
  });
  r.get("/bookings/:id/shares", () => []);
  r.post("/inbox/:id/pay-share", () => ({ paid: true }));
  r.get("/push/key", () => ({ publicKey: null })); // the demo has no push server

  return r;
}
