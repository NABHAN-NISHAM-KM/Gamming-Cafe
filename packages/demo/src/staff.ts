// Staff (admin console) backend for the demo: the core operational flows.
// Anything not handled here falls through to the generic document layer.
import { clone, code, money, nowIso, num, rand, uuid, type Engine } from "./engine";
import { created, fail, noContent, Router } from "./http";

const STATION_CLASS: Record<string, string> = { GAMING_PC: "PC", CONSOLE: "CONSOLE", VR_HEADSET: "VR", SIMULATOR: "SIMULATOR" };
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const ymd = () => new Date().toISOString().slice(2, 10).replace(/-/g, "");

export function staffBackend(e: Engine) {
  const r = new Router();

  // ── lookups ─────────────────────────────────────────────────────────────
  const branches = (): any[] => e.get("staff", "/branches") ?? [];
  const branch = (id: string) => branches().find((b) => b.id === id) ?? fail(404, "not_found");
  const floorDoc = (branchId: string) => e.get("staff", `/branches/${branchId}/floor`) as { zones: any[]; devices: any[]; alerts: any[]; serverTime: string };
  const allDevices = () => branches().flatMap((b) => (floorDoc(b.id)?.devices ?? []).map((d: any) => d));
  const device = (id: string) => allDevices().find((d) => d.id === id) ?? fail(404, "not_found");
  const customers = (): any[] => e.get("staff", "/customers") ?? [];
  const customer = (id: string | null | undefined) => (id ? customers().find((c) => c.id === id) ?? fail(404, "customer_not_found") : null);
  const plans = (): any[] => e.get("staff", "/pricing-plans") ?? [];
  const me = () => e.get("staff", "/auth/me");
  const staffName = () => me()?.employee?.displayName ?? "Staff";
  const currency = () => e.get("staff", "/organization")?.defaultCurrency ?? "AED";

  // Show the busiest branch first (the demo's "home" venue).
  const bl = e.get("staff", "/branches") as any[] | undefined;
  if (bl && bl.length > 1) bl.sort((a, b) => (floorDoc(b.id)?.devices?.length ?? 0) - (floorDoc(a.id)?.devices?.length ?? 0));

  const pushDevice = (d: any) => e.emit({ type: "device", branchId: d.branchId, device: clone(d) });
  const syncDeviceDocs = (d: any) => {
    e.patchById(d.id, { status: d.status, displayStatus: d.displayStatus, isOnline: d.isOnline, session: d.session ?? null });
    const ds = e.get("staff", `/devices/${d.id}/session`);
    if (ds) ds.session = d.session ? e.get("staff", `/sessions/${d.session.id}`) ?? d.session : null;
    else e.set("staff", `/devices/${d.id}/session`, { session: d.session ? e.get("staff", `/sessions/${d.session.id}`) ?? d.session : null });
  };

  // ── wallet ──────────────────────────────────────────────────────────────
  const walletDoc = (customerId: string) => {
    let w = e.get("staff", `/customers/${customerId}/wallet`);
    if (!w) {
      w = { currency: currency(), cash: "0.00", bonus: "0.00", total: "0.00", timeMinutes: 0, frozen: false, ledger: [] };
      e.set("staff", `/customers/${customerId}/wallet`, w);
    }
    return w;
  };
  const syncWallet = (customerId: string) => {
    const w = walletDoc(customerId);
    w.total = money(num(w.cash) + num(w.bonus));
    e.patchById(customerId, { walletBalance: w.total, timeBalanceMinutes: w.timeMinutes });
    // The customer app shows the same wallet.
    const cme = e.get("customer", "/me");
    if (cme?.id === customerId) {
      cme.wallet = { ...cme.wallet, cash: w.cash, bonus: w.bonus, total: w.total, timeMinutes: w.timeMinutes, frozen: w.frozen };
      const cw = e.get("customer", "/wallet");
      if (cw) Object.assign(cw, { cash: w.cash, bonus: w.bonus, total: w.total, timeMinutes: w.timeMinutes, frozen: w.frozen, ledger: w.ledger });
    }
  };
  const ledger = (customerId: string, type: string, bucket: "CASH" | "BONUS" | "TIME", amount: number, reason: string) => {
    const w = walletDoc(customerId);
    const field = bucket === "CASH" ? "cash" : bucket === "BONUS" ? "bonus" : "timeMinutes";
    const after = bucket === "TIME" ? w.timeMinutes + amount : num(w[field]) + amount;
    if (bucket === "TIME") w.timeMinutes = after;
    else w[field] = money(after);
    w.ledger.unshift({ id: uuid(), at: nowIso(), type, bucket, reason, referenceType: "BILL", amount: bucket === "TIME" ? amount : money(amount), balanceAfter: bucket === "TIME" ? after : money(after), expiresAt: null });
    syncWallet(customerId);
  };
  /** Takes `amount` from bonus first, then cash (the real server's order). */
  const spendWallet = (customerId: string, amount: number, reason: string) => {
    const w = walletDoc(customerId);
    if (w.frozen) fail(409, "wallet_frozen");
    if (num(w.cash) + num(w.bonus) + 1e-9 < amount) fail(402, "insufficient_funds", { balance: money(num(w.cash) + num(w.bonus)), needed: money(amount) });
    const fromBonus = Math.min(num(w.bonus), amount);
    if (fromBonus > 0) ledger(customerId, "SPEND", "BONUS", -fromBonus, reason);
    if (amount - fromBonus > 0) ledger(customerId, "SPEND", "CASH", -(amount - fromBonus), reason);
  };

  // ── bills ───────────────────────────────────────────────────────────────
  const billsDoc = (branchId: string) => (e.get("staff", `/branches/${branchId}/bills`) as any[]) ?? (e.set("staff", `/branches/${branchId}/bills`, []), e.get("staff", `/branches/${branchId}/bills`));
  const newBill = (branchId: string, cust: any, extra: Partial<any> = {}) => {
    const b = branch(branchId);
    const bill: any = {
      id: uuid(), number: `${b.code}-${ymd()}-${code(6)}`, status: "OPEN", currency: currency(),
      customer: cust ? { id: cust.id, displayName: cust.displayName } : null, table: null, openedAt: nowIso(), closedAt: null,
      subtotal: "0.00", discountTotal: "0.00", taxTotal: "0.00", total: "0.00", paidTotal: "0.00", due: "0.00", sessions: [], orders: [], payments: [], ...extra,
    };
    billsDoc(branchId).unshift(bill);
    e.set("staff", `/bills/${bill.id}`, bill);
    return bill;
  };
  const recalcBill = (bill: any) => {
    const total = bill.orders.reduce((a: number, o: any) => a + (o.status === "CANCELLED" ? 0 : num(o.total)), 0);
    const paid = bill.payments.reduce((a: number, p: any) => a + num(p.amount) - num(p.refundedAmount), 0);
    bill.subtotal = money(total);
    bill.total = money(total);
    bill.paidTotal = money(paid);
    bill.due = money(Math.max(0, total - paid));
    if (bill.status !== "VOID") bill.status = paid <= 0 ? "OPEN" : paid + 1e-9 >= total ? "SETTLED" : "PARTIALLY_PAID";
    if (bill.status === "SETTLED" && bill.sessions.some((s: any) => s.status === "ACTIVE")) bill.status = "OPEN"; // sessions keep the bill open
    e.patchById(bill.id, { subtotal: bill.subtotal, total: bill.total, paidTotal: bill.paidTotal, due: bill.due, status: bill.status });
  };
  const takePayments = (bill: any, tenders: any[], due: number, cust: any) => {
    let left = due;
    for (const t of tenders) {
      const amount = t.amount != null ? num(t.amount) : left;
      if (amount <= 0) continue;
      if (t.method === "WALLET") {
        if (!cust) fail(400, "wallet_needs_customer");
        spendWallet(cust.id, amount, `Bill ${bill.number}`);
      }
      const tendered = t.method === "CASH" && t.tendered != null ? num(t.tendered) : null;
      bill.payments.push({ id: uuid(), method: t.method, amount: money(amount), refundedAmount: "0.00", cashTendered: tendered != null ? money(tendered) : null, changeGiven: tendered != null ? money(Math.max(0, tendered - amount)) : null, createdAt: nowIso() });
      left -= amount;
    }
    const last = bill.payments.at(-1);
    return last?.changeGiven ?? null;
  };

  // ── pricing ─────────────────────────────────────────────────────────────
  const plansFor = (d: any) => {
    const cls = STATION_CLASS[d.kind] ?? "PC";
    const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
    const hhmm = new Date().toTimeString().slice(0, 5);
    return plans().filter(
      (p) =>
        p.isActive !== false &&
        p.stationClass === cls &&
        (!p.zoneId || p.zoneId === d.zoneId) &&
        (!p.branchId || p.branchId === d.branchId) &&
        p.billingMode !== "NIGHT_PASS" &&
        (!p.schedule?.length || p.schedule.some((s: any) => s.days?.includes(day) && s.from <= hhmm && hhmm < s.to)),
    );
  };
  const planView = (p: any) => ({
    id: p.id, name: p.name, billingMode: p.billingMode, paymentTiming: p.paymentTiming, rateMinor: Math.round(num(p.rate) * 100), minMinutes: p.minMinutes ?? 0,
    passEndTime: p.passEndTime ?? null, includedPlayers: p.includedPlayers ?? 1, extraPlayerRateMinor: p.extraPlayerRate ? Math.round(num(p.extraPlayerRate) * 100) : null,
    packages: (p.pricingPackages ?? []).filter((k: any) => k.isActive !== false).map((k: any) => ({ id: k.id, name: k.name, durationMinutes: k.durationMinutes, priceMinor: Math.round(num(k.price) * 100), bonusMinutes: k.bonusMinutes ?? 0, isActive: true })),
  });
  const quote = (d: any, body: any) => {
    const avail = plansFor(d);
    const cust = body.customerId ? customer(body.customerId) : null;
    const tierPct = cust?.membershipTier ? num((e.get("staff", "/membership-tiers") ?? []).find((t: any) => t.id === cust.membershipTier.id)?.gamingDiscountPct) : 0;
    const req = body.request ?? { kind: "minutes", minutes: 60 };
    const plan = avail.find((p) => p.id === body.planId) ?? avail.find((p) => req.kind === "open" ? p.paymentTiming === "POSTPAID" : p.paymentTiming === "PREPAID") ?? avail[0];
    const players = Math.max(1, num(body.players) || 1);
    let q: any = null;
    let error: string | null = null;
    if (!plan) error = "no_plan";
    else if (req.kind === "open") {
      if (plan.paymentTiming !== "POSTPAID") error = "prepaid_only";
      else q = { planId: plan.id, planName: plan.name, packageId: null, billingMode: plan.billingMode, paymentTiming: "POSTPAID", currency: currency(), minutes: null, expiresAt: null, grossMinor: 0, membershipDiscountMinor: 0, manualDiscountMinor: 0, totalMinor: 0, lines: [`Open session · ${plan.rate} ${currency()}/hour, pay at the end`] };
    } else {
      const pkg = req.kind === "package" ? (plan.pricingPackages ?? []).find((k: any) => k.id === req.packageId) : null;
      const minutes = pkg ? pkg.durationMinutes + (pkg.bonusMinutes ?? 0) : num(req.minutes) || 60;
      const rateH = num(plan.rate) * (plan.billingMode === "PER_MINUTE" ? 60 : 1);
      const extra = players > (plan.includedPlayers ?? 1) && plan.extraPlayerRate ? (players - (plan.includedPlayers ?? 1)) * num(plan.extraPlayerRate) * (minutes / 60) : 0;
      const gross = Math.round((pkg ? num(pkg.price) : (rateH * minutes) / 60 + extra) * 100);
      const member = Math.round((gross * tierPct) / 100);
      const manual = body.discount ? (body.discount.kind === "PERCENT" ? Math.round(((gross - member) * num(body.discount.value)) / 100) : Math.round(num(body.discount.value) * 100)) : 0;
      q = {
        planId: plan.id, planName: plan.name, packageId: pkg?.id ?? null, billingMode: plan.billingMode, paymentTiming: plan.paymentTiming, currency: currency(), minutes,
        expiresAt: minutesFromNow(minutes), grossMinor: gross, membershipDiscountMinor: member, manualDiscountMinor: manual, totalMinor: Math.max(0, gross - member - manual),
        lines: [pkg ? `${pkg.name} package` : `${minutes} min @ ${num(plan.rate).toFixed(2)} ${currency()}/${plan.billingMode === "PER_MINUTE" ? "min" : "hour"}`, ...(member ? [`Member discount ${tierPct}%`] : []), ...(manual ? ["Discount"] : [])],
      };
    }
    const w = cust ? walletDoc(cust.id) : null;
    return {
      currency: currency(), minorUnit: 2, stationClass: STATION_CLASS[d.kind] ?? "PC",
      station: { agentless: !!d.agentless, minAge: d.minAge ?? null, controllerCount: d.controllerCount ?? null, kind: d.kind },
      customer: cust ? { id: cust.id, displayName: cust.displayName, status: cust.status, membershipTierId: cust.membershipTier?.id ?? null, tierName: cust.membershipTier?.name ?? null, discountPct: tierPct, age: null, timeBalanceMinutes: w?.timeMinutes ?? 0 } : null,
      plans: avail.map(planView), quote: q, error,
    };
  };

  // ── sessions ────────────────────────────────────────────────────────────
  const startSession = (d: any, body: any) => {
    if (d.session) fail(409, "device_busy");
    if (!d.isOnline && !d.agentless) fail(409, "device_offline");
    const cust = customer(body.customerId);
    const method = body.payment?.method ?? "CARD";
    const fromTime = method === "TIME_BALANCE";
    let minutes: number | null;
    let total = 0;
    let planName: string | null;
    let timing = "PREPAID";
    if (fromTime) {
      if (!cust) fail(400, "customer_required");
      const w = walletDoc(cust!.id);
      if (w.timeMinutes <= 0) fail(402, "no_time_balance");
      minutes = w.timeMinutes;
      ledger(cust!.id, "SPEND", "TIME", -(minutes ?? 0), `Session on ${d.name}`);
      planName = "Prepaid time";
    } else {
      const q = quote(d, body);
      if (q.error || !q.quote) fail(400, q.error ?? "no_plan");
      minutes = q.quote!.minutes;
      total = q.quote!.totalMinor / 100;
      planName = q.quote!.planName;
      timing = q.quote!.paymentTiming;
    }
    const bill = newBill(d.branchId, cust);
    const sid = uuid();
    const session = {
      id: sid, status: "ACTIVE", startedAt: nowIso(), expiresAt: minutes ? minutesFromNow(minutes) : null, paymentTiming: timing, currency: currency(),
      amountDue: timing === "POSTPAID" ? "0.00" : money(total), customer: cust ? { id: cust.id, displayName: cust.displayName } : null, guestLabel: body.guestLabel ?? (cust ? null : "Guest"), planName,
    };
    const orderId = uuid();
    bill.sessions.push({ id: sid, status: "ACTIVE", device: { name: d.name } });
    bill.orders.push({ id: orderId, number: `G-${ymd()}-${code(6)}`, type: "GAMING_SEAT", status: "COMPLETED", deliverTo: d.name, total: money(total), orderItems: [{ id: uuid(), nameSnapshot: `Gaming — ${planName}${minutes ? ` (${minutes} min)` : ""} · ${d.name}`, quantity: minutes ?? 1, lineTotal: money(total), modifiers: [], status: "SERVED" }] });
    if (total > 0 && timing === "PREPAID" && !fromTime) takePayments(bill, [{ method: method === "PAY_LATER" ? "CARD" : method, amount: money(total) }], total, cust);
    recalcBill(bill);
    e.set("staff", `/sessions/${sid}`, {
      ...session, deviceId: d.id, deviceName: d.name, branchId: d.branchId, zoneId: d.zoneId, customer: cust ? { id: cust.id, displayName: cust.displayName, username: cust.username } : null,
      fundedBy: method, billingMode: "PER_HOUR", allocatedMinutes: minutes, endedAt: null, endReason: null, discountAmount: "0.00",
      bill: { id: bill.id, number: bill.number, total: bill.total, paidTotal: bill.paidTotal, status: bill.status }, serverTime: nowIso(),
    });
    d.session = session;
    d.status = "OCCUPIED";
    d.displayStatus = "OCCUPIED";
    const games = (e.get("staff", "/games") ?? []) as any[];
    if (d.kind === "GAMING_PC" && games.length) d.currentGame = { id: rand(games).id, title: rand(games).title ?? rand(games).name, startedAt: nowIso() };
    syncDeviceDocs(d);
    if (cust) {
      const cd = e.get("staff", `/customers/${cust.id}`);
      cd?.sessions?.unshift({ id: sid, status: "ACTIVE", startedAt: session.startedAt, endedAt: null, expiresAt: session.expiresAt, amountDue: session.amountDue, currency: currency(), device: { name: d.name }, endReason: null });
      e.patchById(cust.id, { lastVisitAt: nowIso() });
      const cme = e.get("customer", "/me");
      if (cme?.id === cust.id) cme.playingNow = { sessionId: sid, station: d.name, expiresAt: session.expiresAt };
    }
    pushDevice(d);
    return e.get("staff", `/sessions/${sid}`);
  };

  const sessionDevice = (sessionId: string) => allDevices().find((d) => d.session?.id === sessionId) ?? fail(404, "not_found");

  const endSession = (sessionId: string, reason = "Ended by staff") => {
    const d = sessionDevice(sessionId);
    const view = e.get("staff", `/sessions/${sessionId}`);
    const custId = d.session.customer?.id;
    // Postpaid (open) sessions charge for the time used.
    if (d.session.paymentTiming === "POSTPAID" && view) {
      const plan = plans().find((p) => p.name === view.planName);
      const used = Math.max(1, Math.round((Date.now() - Date.parse(d.session.startedAt)) / 60_000));
      const amt = plan ? (num(plan.rate) * used) / 60 : 0;
      view.amountDue = money(amt);
      const bill = e.get("staff", `/bills/${view.bill?.id}`);
      if (bill) {
        bill.orders[0].total = money(amt);
        bill.orders[0].orderItems[0].lineTotal = money(amt);
        bill.orders[0].orderItems[0].quantity = used;
        recalcBill(bill);
      }
    }
    e.patchById(sessionId, { status: "ENDED", endedAt: nowIso(), endReason: reason });
    d.session = null;
    d.currentGame = null;
    d.status = d.cleaningRequired ? "CLEANING" : "AVAILABLE";
    d.displayStatus = d.status;
    syncDeviceDocs(d);
    const bill = view?.bill ? e.get("staff", `/bills/${view.bill.id}`) : null;
    if (bill) {
      bill.sessions.forEach((s: any) => s.id === sessionId && (s.status = "ENDED"));
      recalcBill(bill);
    }
    const cme = e.get("customer", "/me");
    if (custId && cme?.id === custId) cme.playingNow = null;
    pushDevice(d);
    return view;
  };

  r.post("/devices/:id/sessions/quote", (q) => quote(device(q.params["id"]!), q.body ?? {}));
  r.post("/devices/:id/sessions", (q) => created(startSession(device(q.params["id"]!), q.body ?? {})));
  r.post("/sessions/:id/extend", (q) => {
    const d = sessionDevice(q.params["id"]!);
    const minutes = num(q.body?.minutes) || 30;
    const plan = plans().find((p) => p.name === d.session.planName);
    const amount = plan ? (num(plan.rate) * minutes) / 60 : 0;
    if (q.body?.payment?.method === "WALLET" && d.session.customer) spendWallet(d.session.customer.id, amount, `Extend on ${d.name}`);
    const base = Math.max(Date.now(), Date.parse(d.session.expiresAt ?? nowIso()));
    d.session.expiresAt = new Date(base + minutes * 60_000).toISOString();
    d.session.amountDue = money(num(d.session.amountDue) + amount);
    d.status = "OCCUPIED";
    d.displayStatus = "OCCUPIED";
    e.patchById(d.session.id, { expiresAt: d.session.expiresAt, amountDue: d.session.amountDue });
    syncDeviceDocs(d);
    pushDevice(d);
    return e.get("staff", `/sessions/${d.session.id}`);
  });
  r.post("/sessions/:id/end", (q) => endSession(q.params["id"]!, q.body?.reason ?? "Ended by staff"));
  r.post("/sessions/:id/move", (q) => {
    const from = sessionDevice(q.params["id"]!);
    const to = device(q.body?.toDeviceId);
    if (to.session) fail(409, "device_busy");
    to.session = from.session;
    to.currentGame = from.currentGame;
    to.status = to.displayStatus = "OCCUPIED";
    from.session = null;
    from.currentGame = null;
    from.status = from.displayStatus = "AVAILABLE";
    e.patchById(to.session.id, { deviceId: to.id, deviceName: to.name });
    syncDeviceDocs(from);
    syncDeviceDocs(to);
    pushDevice(from);
    pushDevice(to);
    return e.get("staff", `/sessions/${to.session.id}`);
  });
  r.post("/devices/:id/cleaned", (q) => {
    const d = device(q.params["id"]!);
    d.status = d.displayStatus = "AVAILABLE";
    syncDeviceDocs(d);
    pushDevice(d);
    return { ok: true };
  });

  // ── station commands ────────────────────────────────────────────────────
  const runCommand = (d: any, type: string, payload: unknown) => {
    const cmd: any = { id: uuid(), deviceId: d.id, type, status: "SENT", payload, issuedAt: nowIso(), completedAt: null, errorMessage: null, issuedBy: staffName() };
    const list = (e.get("staff", `/devices/${d.id}/commands`) as any[]) ?? (e.set("staff", `/devices/${d.id}/commands`, []), e.get("staff", `/devices/${d.id}/commands`));
    list.unshift(cmd);
    e.emit({ type: "command", branchId: d.branchId, command: clone(cmd) });
    const online = d.isOnline;
    setTimeout(() => {
      cmd.status = online ? "SUCCEEDED" : "EXPIRED";
      cmd.completedAt = nowIso();
      e.patchById(cmd.id, { status: cmd.status, completedAt: cmd.completedAt });
      e.commit();
      e.emit({ type: "command", branchId: d.branchId, command: clone(cmd) });
      if (!online) return;
      if (type === "SHUTDOWN" || type === "RESTART") {
        d.isOnline = false;
        d.status = d.displayStatus = "OFFLINE";
        syncDeviceDocs(d);
        pushDevice(d);
        e.commit();
        if (type === "RESTART")
          setTimeout(() => {
            d.isOnline = true;
            d.status = d.displayStatus = d.session ? "OCCUPIED" : "AVAILABLE";
            syncDeviceDocs(d);
            pushDevice(d);
            e.commit();
          }, 9000);
      }
      if (type === "WAKE") {
        d.isOnline = true;
        d.status = d.displayStatus = d.session ? "OCCUPIED" : "AVAILABLE";
        syncDeviceDocs(d);
        pushDevice(d);
        e.commit();
      }
    }, 900 + Math.random() * 700);
    return cmd;
  };
  r.post("/devices/:id/commands", (q) => {
    const d = device(q.params["id"]!);
    const cmd = runCommand(d, q.body?.type ?? "LOCK", q.body?.payload ?? null);
    return { ...cmd, online: d.isOnline };
  });
  r.post("/zones/:id/commands", (q) => {
    const ds = allDevices().filter((d) => d.zoneId === q.params["id"] && !d.agentless);
    const type = q.body?.type ?? "MESSAGE";
    ds.forEach((d) => runCommand(d, type, q.body?.payload ?? null));
    return { count: ds.length, online: ds.filter((d) => d.isOnline).length };
  });
  r.post("/branches/:id/game-scan", (q) => {
    const ds = allDevices().filter((d) => d.branchId === q.params["id"] && d.kind === "GAMING_PC");
    ds.forEach((d) => runCommand(d, "SCAN_GAMES", null));
    return { requested: ds.length, offline: ds.filter((d) => !d.isOnline).length };
  });
  r.post("/alerts/:id/ack", (q) => {
    e.patchById(q.params["id"]!, { status: "ACKNOWLEDGED" });
    return { ok: true };
  });
  r.post("/enrollment-tokens", () => fail(400, "validation_failed"));
  r.post("/branches/:id/enrollment-tokens", (q) => {
    const t = { id: uuid(), code: `ARENA-${code(5)}-${code(5)}-${code(5)}-${code(5)}`, zoneId: q.body?.zoneId ?? null, label: q.body?.label ?? null, maxUses: q.body?.maxUses ?? 1, uses: 0, expiresAt: minutesFromNow(60 * 24), createdAt: nowIso() };
    const list = (e.get("staff", `/branches/${q.params["id"]}/enrollment-tokens`) as any[]) ?? [];
    list.unshift(t);
    e.set("staff", `/branches/${q.params["id"]}/enrollment-tokens`, list);
    return created(t);
  });

  // ── customers & wallet ──────────────────────────────────────────────────
  r.get("/customers", (q) => {
    const term = (q.query.get("q") ?? "").trim().toLowerCase();
    const all = customers();
    return term ? all.filter((c) => [c.displayName, c.username, c.phone, c.email].some((v) => String(v ?? "").toLowerCase().includes(term))) : all;
  });
  r.post("/customers", (q) => {
    const b = q.body ?? {};
    if (customers().some((c) => c.username === b.username)) fail(409, "username_taken");
    const c = {
      id: uuid(), username: b.username, displayName: b.displayName, firstName: b.firstName ?? null, lastName: b.lastName ?? null, phone: b.phone ?? null, email: b.email ?? null,
      status: "ACTIVE", createdAt: nowIso(), lastVisitAt: null, marketingConsent: !!b.marketingConsent, membershipTier: null, timeBalanceMinutes: 0, walletBalance: "0.00",
    };
    customers().unshift(c);
    e.set("staff", `/customers/${c.id}`, { ...clone(c), sessions: [], timeLedger: [] });
    e.set("staff", `/customers/${c.id}/memberships`, []);
    e.set("staff", `/customers/${c.id}/loyalty`, { balance: 0, lifetime: 0, ledger: [] });
    walletDoc(c.id);
    return created(c);
  });
  r.post("/customers/:id/wallet/topup", (q) => {
    const id = q.params["id"]!;
    customer(id);
    if (walletDoc(id).frozen) fail(409, "wallet_frozen");
    ledger(id, "TOPUP", "CASH", num(q.body?.amount), "Top-up");
    if (num(q.body?.bonus) > 0) ledger(id, "BONUS_GRANT", "BONUS", num(q.body?.bonus), "Top-up bonus");
    return walletDoc(id);
  });
  r.post("/customers/:id/wallet/adjust", (q) => {
    const id = q.params["id"]!;
    ledger(id, "ADJUSTMENT", q.body?.bucket ?? "CASH", num(q.body?.amount), q.body?.reason ?? "Adjustment");
    return walletDoc(id);
  });
  r.post("/customers/:id/wallet/freeze", (q) => {
    const w = walletDoc(q.params["id"]!);
    w.frozen = !!q.body?.frozen;
    syncWallet(q.params["id"]!);
    return w;
  });
  r.post("/customers/:id/time", (q) => {
    const id = q.params["id"]!;
    const cust = customer(id);
    const plan = plans().find((p) => p.id === q.body?.planId) ?? fail(400, "no_plan");
    const pkg = (plan.pricingPackages ?? []).find((k: any) => k.id === q.body?.packageId);
    const minutes = pkg ? pkg.durationMinutes + (pkg.bonusMinutes ?? 0) : num(q.body?.minutes);
    const price = pkg ? num(pkg.price) : (num(plan.rate) * minutes) / 60;
    if (q.body?.payment?.method === "WALLET") spendWallet(id, price, "Prepaid time");
    const bill = newBill(q.body?.branchId ?? branches()[0].id, cust);
    bill.orders.push({ id: uuid(), number: `T-${ymd()}-${code(4)}`, type: "COUNTER", status: "COMPLETED", deliverTo: null, total: money(price), orderItems: [{ id: uuid(), nameSnapshot: `Prepaid time — ${pkg?.name ?? `${minutes} min`}`, quantity: 1, lineTotal: money(price), modifiers: [], status: "SERVED" }] });
    if (q.body?.payment?.method !== "WALLET") takePayments(bill, [{ method: q.body?.payment?.method ?? "CARD", amount: money(price) }], price, cust);
    else bill.payments.push({ id: uuid(), method: "WALLET", amount: money(price), refundedAmount: "0.00", cashTendered: null, changeGiven: null, createdAt: nowIso() });
    recalcBill(bill);
    ledger(id, "TOPUP", "TIME", minutes, `Bought ${pkg?.name ?? `${minutes} min`}`);
    return { minutes, bill: { id: bill.id, number: bill.number } };
  });
  r.post("/customers/:id/credentials", () => ({ ok: true }));
  r.post("/customers/:id/memberships", (q) => {
    const id = q.params["id"]!;
    const tier = (e.get("staff", "/membership-tiers") ?? []).find((t: any) => t.id === q.body?.tierId) ?? fail(400, "tier_not_found");
    if (q.body?.payment?.method === "WALLET") spendWallet(id, num(tier.price), `${tier.name} membership`);
    const m = { id: uuid(), status: "ACTIVE", startsAt: nowIso(), expiresAt: tier.durationDays ? minutesFromNow(tier.durationDays * 1440) : null, tier: { id: tier.id, name: tier.name, code: tier.code, color: tier.color }, pricePaid: tier.price, autoRenew: false, cancelledAt: null };
    const list = (e.get("staff", `/customers/${id}/memberships`) as any[]) ?? [];
    list.unshift(m);
    e.set("staff", `/customers/${id}/memberships`, list);
    e.patchById(id, { membershipTier: { id: tier.id, name: tier.name, code: tier.code, color: tier.color } });
    return created(m);
  });
  r.post("/customers/:id/memberships/:mid/cancel", (q) => {
    e.patchById(q.params["mid"]!, { status: "CANCELLED", cancelledAt: nowIso() });
    e.patchById(q.params["id"]!, { membershipTier: null });
    return { ok: true };
  });
  r.post("/customers/:id/loyalty/adjust", (q) => {
    const l = e.get("staff", `/customers/${q.params["id"]}/loyalty`) ?? { balance: 0, ledger: [] };
    const pts = num(q.body?.points);
    l.balance = num(l.balance) + pts;
    (l.ledger ??= []).unshift({ id: uuid(), at: nowIso(), type: "ADJUST", points: pts, balanceAfter: l.balance, reason: q.body?.reason ?? "Adjustment" });
    e.set("staff", `/customers/${q.params["id"]}/loyalty`, l);
    return l;
  });
  r.post("/customers/:id/loyalty/redeem", (q) => {
    const l = e.get("staff", `/customers/${q.params["id"]}/loyalty`) ?? { balance: 0, ledger: [] };
    const reward = (e.get("staff", "/loyalty/rewards") ?? []).find((x: any) => x.id === q.body?.rewardId) ?? fail(404, "reward_not_found");
    if (num(l.balance) < num(reward.pointsCost)) fail(409, "not_enough_points", { balance: l.balance, needed: reward.pointsCost });
    l.balance = num(l.balance) - num(reward.pointsCost);
    (l.ledger ??= []).unshift({ id: uuid(), at: nowIso(), type: "REDEEM", points: -num(reward.pointsCost), balanceAfter: l.balance, reason: reward.name });
    return { code: code(8), balance: l.balance, minutes: reward.minutes ?? undefined };
  });

  // ── bookings ────────────────────────────────────────────────────────────
  const bookingsDoc = (branchId: string) => (e.get("staff", `/branches/${branchId}/bookings`) as any[]) ?? (e.set("staff", `/branches/${branchId}/bookings`, []), e.get("staff", `/branches/${branchId}/bookings`));
  r.post("/branches/:id/bookings", (q) => {
    const b = q.body ?? {};
    const branchId = q.params["id"]!;
    const zone = (e.get("staff", `/branches/${branchId}/zones`) ?? []).find((z: any) => z.id === b.zoneId);
    const cust = b.customerId ? customer(b.customerId) : null;
    const startsAt = new Date(b.startsAt);
    if (startsAt.getTime() < Date.now() - 60_000) fail(400, "starts_in_past");
    const minutes = num(b.minutes) || 60;
    const free = floorDoc(branchId).devices.filter((d: any) => (!zone || d.zoneId === zone.id) && d.kind !== "SMART_TV");
    const picked = free.slice(0, Math.max(1, num(b.players) || 1));
    const rate = plansFor(picked[0] ?? { kind: "GAMING_PC", zoneId: zone?.id, branchId })[0];
    const bk = {
      id: uuid(), branchId, zoneId: zone?.id ?? null, customerId: cust?.id ?? null, reference: `BK-${code(6)}`, resourceType: zone?.type?.startsWith("PC") ? "PC" : zone?.type ?? "PC",
      startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(), players: num(b.players) || 1, status: "CONFIRMED", source: b.source ?? "STAFF",
      contactName: b.contactName ?? cust?.displayName ?? null, contactPhone: b.contactPhone ?? cust?.phone ?? null, estimatedTotal: money(((num(rate?.rate) || 15) * minutes * (num(b.players) || 1)) / 60),
      depositAmount: "0.00", currency: currency(), promoCode: null, notes: b.notes ?? null, holdExpiresAt: null, checkedInAt: null, cancelledAt: null, cancelReason: null, createdAt: nowIso(),
      customer: cust ? { id: cust.id, displayName: cust.displayName, username: cust.username, phone: cust.phone } : null, zone: zone ? { id: zone.id, name: zone.name, type: zone.type } : null,
      devices: picked.map((d: any) => ({ id: d.id, name: d.name })), minutes,
    };
    bookingsDoc(branchId).push(bk);
    bookingsDoc(branchId).sort((x: any, y: any) => x.startsAt.localeCompare(y.startsAt));
    e.set("staff", `/bookings/${bk.id}`, bk);
    e.emit({ type: "booking", branchId });
    return created(bk);
  });
  const bookingAction = (id: string, patch: Record<string, unknown>) => {
    const bk = e.findById(id) ?? fail(404, "not_found");
    e.patchById(id, patch);
    e.patchById(id, patch, ["customer"]);
    e.emit({ type: "booking", branchId: bk.branchId });
    return e.findById(id);
  };
  r.post("/bookings/:id/cancel", (q) => bookingAction(q.params["id"]!, { status: "CANCELLED", cancelledAt: nowIso(), cancelReason: q.body?.reason ?? null }));
  r.post("/bookings/:id/no-show", (q) => bookingAction(q.params["id"]!, { status: "NO_SHOW" }));
  r.post("/bookings/:id/check-in", (q) => {
    const bk = e.findById(q.params["id"]!) ?? fail(404, "not_found");
    for (const dv of bk.devices ?? []) {
      const d = allDevices().find((x) => x.id === dv.id);
      if (d && !d.session) startSession(d, { customerId: bk.customerId, request: { kind: "minutes", minutes: bk.minutes ?? Math.round((Date.parse(bk.endsAt) - Date.parse(bk.startsAt)) / 60_000) }, payment: q.body?.payment ?? { method: "CARD" } });
    }
    return bookingAction(bk.id, { status: "CHECKED_IN", checkedInAt: nowIso() });
  });

  // ── POS, bills, kitchen ─────────────────────────────────────────────────
  const menu = (branchId: string) => e.get("staff", `/branches/${branchId}/menu`) ?? { currency: currency(), categories: [] };
  const product = (branchId: string, id: string) => menu(branchId).categories.flatMap((c: any) => c.products).find((p: any) => p.id === id) ?? fail(404, "product_not_found");
  const kitchenDoc = (branchId: string) => e.get("staff", `/branches/${branchId}/kitchen`) ?? (e.set("staff", `/branches/${branchId}/kitchen`, { stations: [], serverTime: nowIso(), tickets: [] }), e.get("staff", `/branches/${branchId}/kitchen`));
  const ordersDoc = (branchId: string) => (e.get("staff", `/branches/${branchId}/orders`) as any[]) ?? (e.set("staff", `/branches/${branchId}/orders`, []), e.get("staff", `/branches/${branchId}/orders`));

  r.post("/branches/:id/orders", (q) => {
    const branchId = q.params["id"]!;
    const b = q.body ?? {};
    if (!b.lines?.length) fail(400, "empty_order");
    const cust = b.customerId ? customer(b.customerId) : null;
    const dev = b.deviceId ? device(b.deviceId) : null;
    const table = b.tableId ? (e.get("staff", `/branches/${branchId}/tables`) ?? []).find((t: any) => t.id === b.tableId) : null;
    const items = b.lines.map((l: any) => {
      const p = product(branchId, l.productId);
      if (!p.available) fail(409, "sold_out", { product: p.name });
      const mods = p.modifierGroups.flatMap((g: any) => g.modifiers).filter((m: any) => (l.modifierIds ?? []).includes(m.id));
      const unit = num(p.price) + mods.reduce((a: number, m: any) => a + num(m.priceDelta), 0);
      return { id: uuid(), productId: p.id, nameSnapshot: p.name, quantity: l.quantity, unitPrice: money(unit), lineTotal: money(unit * l.quantity), modifiers: mods.map((m: any) => ({ name: m.name })), notes: l.notes ?? null, status: p.station ? "PENDING" : "SERVED", station: p.station };
    });
    const subtotal = items.reduce((a: number, i: any) => a + num(i.lineTotal), 0);
    const discount = b.discount ? (b.discount.kind === "PERCENT" ? (subtotal * num(b.discount.value)) / 100 : num(b.discount.value)) : 0;
    const total = Math.max(0, subtotal - discount);
    let bill = b.billId ? e.get("staff", `/bills/${b.billId}`) : table?.bill ? e.get("staff", `/bills/${table.bill.id}`) : null;
    if (!bill) bill = newBill(branchId, cust, table ? { table: { id: table.id, name: table.name } } : {});
    const deliverTo = dev ? `${dev.name}` : table ? table.name : null;
    const kitchenItems = items.filter((i: any) => i.station);
    const order = {
      id: uuid(), branchId, number: `A${String(e.nextSeq()).padStart(3, "0")}`, channel: "POS", type: b.type, status: kitchenItems.length ? "NEW" : "COMPLETED", paymentState: "UNPAID",
      billId: bill.id, customerId: cust?.id ?? null, deviceId: dev?.id ?? null, tableId: table?.id ?? null, deliverTo, subtotal: money(subtotal), discountTotal: money(discount), taxTotal: "0.00",
      total: money(total), notes: b.notes ?? null, createdAt: nowIso(), customer: cust ? { id: cust.id, displayName: cust.displayName } : null,
      orderItems: items.map(({ station: _s, ...i }: any) => i),
    };
    bill.orders.push({ id: order.id, number: order.number, type: order.type, status: order.status, deliverTo, total: order.total, orderItems: order.orderItems });
    ordersDoc(branchId).unshift(order);
    e.set("staff", `/orders/${order.id}`, order);
    let change: string | null = null;
    if (b.payments?.length) change = takePayments(bill, b.payments, total, cust);
    recalcBill(bill);
    order.paymentState = num(bill.due) <= 0 ? "PAID" : "UNPAID";
    if (table) {
      table.status = "OCCUPIED";
      table.bill = { id: bill.id, total: bill.total, due: bill.due, openedAt: bill.openedAt };
    }
    // Kitchen tickets, one per prep station.
    if (kitchenItems.length) {
      const kd = kitchenDoc(branchId);
      const byStation = new Map<string, any[]>();
      for (const i of kitchenItems) byStation.set(i.station, [...(byStation.get(i.station) ?? []), i]);
      for (const [name, its] of byStation) {
        const st = kd.stations.find((s: any) => s.name === name) ?? { id: uuid(), name };
        kd.tickets.push({
          id: uuid(), status: "NEW", station: { id: st.id, name: st.name }, deliverTo, notes: b.notes ?? null, createdAt: nowIso(), startedAt: null, readyAt: null,
          order: { id: order.id, number: order.number, type: order.type, channel: "POS", notes: b.notes ?? null, customer: cust?.displayName ?? null },
          items: its.map((i: any) => ({ id: i.id, nameSnapshot: i.nameSnapshot, quantity: i.quantity, modifiers: i.modifiers, notes: i.notes, status: "PENDING" })),
        });
      }
      e.emit({ type: "kitchen", branchId });
    }
    return created({ ...order, bill: { id: bill.id, number: bill.number }, change });
  });
  r.get("/branches/:id/bills", (q) => {
    const all = billsDoc(q.params["id"]!);
    return q.query.get("open") ? all.filter((b: any) => b.status === "OPEN" || b.status === "PARTIALLY_PAID") : all;
  });
  r.post("/bills/:id/pay", (q) => {
    const bill = e.get("staff", `/bills/${q.params["id"]}`) ?? fail(404, "not_found");
    if (bill.status === "SETTLED") fail(409, "bill_settled");
    const change = takePayments(bill, q.body?.payments ?? [], num(bill.due), bill.customer ? customer(bill.customer.id) : null);
    recalcBill(bill);
    for (const o of bill.orders) e.patchById(o.id, { paymentState: num(bill.due) <= 0 ? "PAID" : "PARTIAL" });
    if (num(bill.due) <= 0 && bill.table) {
      e.patchById(bill.table.id, { status: "CLEANING", bill: null });
    }
    return { ...bill, change };
  });
  r.post("/payments/:id/refund", (q) => {
    const bill = Object.values(e.docs("staff")).find((v: any) => v && v.payments?.some?.((p: any) => p.id === q.params["id"]));
    if (!bill) fail(404, "not_found");
    const p = (bill as any).payments.find((x: any) => x.id === q.params["id"]);
    p.refundedAmount = money(num(p.refundedAmount) + num(q.body?.amount));
    if (q.body?.destination === "WALLET" && (bill as any).customer) ledger((bill as any).customer.id, "REFUND", "CASH", num(q.body?.amount), q.body?.reason ?? "Refund");
    recalcBill(bill);
    return bill;
  });
  r.post("/order-items/:id/void", (q) => {
    e.patchById(q.params["id"]!, { status: "VOID" });
    for (const bill of Object.values(e.docs("staff")).filter((v: any) => v && Array.isArray(v?.orders) && v.number)) {
      for (const o of (bill as any).orders) {
        const it = o.orderItems.find((i: any) => i.id === q.params["id"]);
        if (it) {
          o.total = money(num(o.total) - num(it.lineTotal));
          it.lineTotal = "0.00";
          recalcBill(bill);
        }
      }
    }
    return { ok: true };
  });
  r.post("/orders/:id/cancel", (q) => {
    e.patchById(q.params["id"]!, { status: "CANCELLED" });
    return e.findById(q.params["id"]!);
  });
  r.get("/branches/:id/kitchen", (q) => {
    const kd = clone(kitchenDoc(q.params["id"]!));
    kd.serverTime = nowIso();
    kd.tickets = kd.tickets.filter((t: any) => t.status !== "SERVED");
    const st = q.query.get("station") ?? q.query.get("stationId");
    if (st) kd.tickets = kd.tickets.filter((t: any) => t.station.id === st || t.station.name === st);
    return kd;
  });
  r.post("/kitchen-tickets/:id/bump", (q) => {
    const to = q.body?.to ?? "READY";
    const t = branches().flatMap((b) => kitchenDoc(b.id).tickets as any[]).find((x) => x.id === q.params["id"]) ?? fail(404, "not_found");
    const patch: any = { status: to };
    if (to === "PREPARING") patch.startedAt = nowIso();
    if (to === "READY") patch.readyAt = nowIso();
    e.patchById(t.id, patch);
    t.items?.forEach((i: any) => (i.status = to === "SERVED" ? "SERVED" : to === "READY" ? "READY" : "PREPARING"));
    const status = to === "SERVED" ? "COMPLETED" : to;
    e.patchById(t.order.id, { status });
    const branchId = branches().find((b) => kitchenDoc(b.id).tickets.some((x: any) => x.id === t.id))?.id;
    if (branchId) e.emit({ type: "kitchen", branchId });
    return e.findById(t.id);
  });
  r.post("/tables/:id/status", (q) => {
    e.patchById(q.params["id"]!, { status: q.body?.status });
    return e.findById(q.params["id"]!);
  });
  r.post("/branches/:id/tables", (q) => {
    const t = { id: uuid(), name: q.body?.name, seats: q.body?.seats ?? 2, status: "AVAILABLE", zoneId: null, mapX: 0, mapY: 0, bill: null };
    const list = (e.get("staff", `/branches/${q.params["id"]}/tables`) as any[]) ?? [];
    list.push(t);
    e.set("staff", `/branches/${q.params["id"]}/tables`, list);
    return created(t);
  });

  // ── cash shifts ─────────────────────────────────────────────────────────
  r.post("/branches/:id/shifts", (q) => {
    const branchId = q.params["id"]!;
    const drawers = (e.get("staff", `/branches/${branchId}/cash-drawers`) ?? []) as any[];
    const drawer = drawers.find((d) => d.id === q.body?.cashDrawerId) ?? drawers[0] ?? { id: uuid(), name: "Front desk" };
    const s = {
      id: uuid(), status: "OPEN", branchId, drawer: drawer.name, employee: staffName(), currency: currency(), openedAt: nowIso(), closedAt: null, approvedBy: null,
      openingCash: money(num(q.body?.openingCash)), expectedCash: money(num(q.body?.openingCash)), countedCash: null, variance: null, sales: {}, salesTotal: "0.00", refunds: "0.00", movements: [], orders: 0,
    };
    e.set("staff", `/shifts/${s.id}`, s);
    e.set("staff", `/branches/${branchId}/shifts/me`, s);
    const list = (e.get("staff", `/branches/${branchId}/shifts`) as any[]) ?? [];
    list.unshift(s);
    e.set("staff", `/branches/${branchId}/shifts`, list);
    drawer.shifts = [{ id: s.id, employee: staffName() }];
    return created(s);
  });
  r.post("/shifts/:id/movements", (q) => {
    const s = e.get("staff", `/shifts/${q.params["id"]}`) ?? fail(404, "not_found");
    const amt = num(q.body?.amount) * (q.body?.type === "PAY_OUT" || q.body?.type === "DROP" ? -1 : 1);
    s.movements.push({ type: q.body?.type, amount: money(Math.abs(amt)), reason: q.body?.reason ?? null, createdAt: nowIso() });
    s.expectedCash = money(num(s.expectedCash) + amt);
    e.patchById(s.id, { expectedCash: s.expectedCash, movements: s.movements });
    return s;
  });
  r.post("/shifts/:id/close", (q) => {
    const s = e.get("staff", `/shifts/${q.params["id"]}`) ?? fail(404, "not_found");
    const counted = num(q.body?.countedCash);
    const variance = counted - num(s.expectedCash);
    const patch = { status: Math.abs(variance) > 5 ? "PENDING_APPROVAL" : "CLOSED", closedAt: nowIso(), countedCash: money(counted), variance: money(variance) };
    e.patchById(s.id, patch);
    for (const b of branches()) if (e.get("staff", `/branches/${b.id}/shifts/me`)?.id === s.id) e.set("staff", `/branches/${b.id}/shifts/me`, null);
    return e.get("staff", `/shifts/${s.id}`);
  });
  r.post("/shifts/:id/approve", (q) => {
    e.patchById(q.params["id"]!, { status: "CLOSED", approvedBy: staffName() });
    return e.get("staff", `/shifts/${q.params["id"]}`);
  });

  // ── floor (derived live state) ──────────────────────────────────────────
  r.get("/branches/:id/floor", (q) => {
    const f = floorDoc(q.params["id"]!) ?? fail(404, "not_found");
    for (const d of f.devices) {
      if (d.session?.expiresAt) {
        const left = Date.parse(d.session.expiresAt) - Date.now();
        d.displayStatus = left <= 5 * 60_000 ? "SESSION_ENDING" : "OCCUPIED";
      } else if (d.session) d.displayStatus = "OCCUPIED";
    }
    f.serverTime = nowIso();
    return f;
  });

  // ── MFA (demo: any 6-digit code) ────────────────────────────────────────
  r.post("/auth/mfa/totp/setup", () => ({ factorId: uuid(), secret: "DEMODEMODEMODEMODEMODEMODEMODEMO", otpauthUrl: "otpauth://totp/ArenaOS:demo?secret=DEMODEMODEMODEMODEMODEMODEMODEMO&issuer=ArenaOS" }));
  r.post("/auth/mfa/totp/confirm", () => {
    const m = me();
    if (m) m.user.mfaEnabled = true;
    return { enabled: true };
  });

  return { router: r, endSession, startSession, allDevices, customers, walletDoc, spendWallet, ledger, floorDoc, branches, quote, plansFor };
}

export type StaffBackend = ReturnType<typeof staffBackend>;
export { noContent };
