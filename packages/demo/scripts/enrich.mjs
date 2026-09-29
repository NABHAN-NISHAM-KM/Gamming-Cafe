// Fills the demo venue with realistic activity through the REAL API, so the
// captured demo data is produced by the actual business logic.
//   node packages/demo/scripts/enrich.mjs tokens   → prints enrolment codes for the simulator
//   node packages/demo/scripts/enrich.mjs activity → customers, top-ups, live sessions, orders, bookings
const API = process.env.DEMO_API ?? "http://localhost:4010/v1";
const PASSWORD = "ArenaDemo!2026";
const key = () => crypto.randomUUID();

async function call(token, method, path, body, reason) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(reason ? { "x-action-reason": reason } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return data;
}
const login = async (email) => (await call(null, "POST", "/auth/login", { email, password: PASSWORD, organizationSlug: "demo" })).accessToken;

const owner = await login("owner@demo.test");
const as = (m, p, b, r) => call(owner, m, p, b, r);
const branches = await as("GET", "/branches");
const dxb = branches.find((b) => b.code === "DXB1");
const zones = await as("GET", `/branches/${dxb.id}/zones`);
const zone = (type) => zones.find((z) => z.type === type);

const mode = process.argv[2];

if (mode === "tokens") {
  const regular = await as("POST", `/branches/${dxb.id}/enrollment-tokens`, { zoneId: zone("PC_STANDARD").id, maxUses: 12, label: "Demo regular PCs" });
  const vip = await as("POST", `/branches/${dxb.id}/enrollment-tokens`, { zoneId: zone("PC_VIP").id, maxUses: 6, label: "Demo VIP PCs" });
  console.log(JSON.stringify({ regular: regular.code, vip: vip.code }));
}

if (mode === "activity") {
  const people = [
    ["omar.k", "Omar Khalid", "+971501234501"], ["layla", "Layla Haddad", "+971501234502"], ["yusuf.gg", "Yusuf Rahman", "+971501234503"],
    ["mia.plays", "Mia Chen", "+971501234504"], ["rafael", "Rafael Souza", "+971501234505"], ["noor", "Noor Al-Mansoori", "+971501234506"],
    ["arjun99", "Arjun Mehta", "+971501234507"], ["hana", "Hana Kobayashi", "+971501234508"], ["zaid", "Zaid Farouk", "+971501234509"],
    ["sofia.v", "Sofia Varga", "+971501234510"], ["karim", "Karim Nasser", "+971501234511"], ["ella", "Ella Johnson", "+971501234512"],
    ["tariq.pro", "Tariq Aziz", "+971501234513"], ["lina", "Lina Petrova", "+971501234514"],
  ];
  const existing = await as("GET", "/customers");
  const customers = [];
  for (const [username, displayName, phone] of people) {
    let c = existing.find((x) => x.username === username);
    if (!c) c = await as("POST", "/customers", { username, displayName, phone, password: "player1234", marketingConsent: Math.random() > 0.3 });
    customers.push(c);
  }
  for (const [i, c] of customers.entries()) {
    const amount = [50, 100, 150, 200, 300][i % 5];
    await as("POST", `/customers/${c.id}/wallet/topup`, { branchId: dxb.id, amount, bonus: amount >= 150 ? 20 : null, payment: { method: "CARD" }, idempotencyKey: `demo-topup-${c.username}` }, "Demo wallet top-up").catch((e) => console.warn(e.message));
  }
  console.log(`customers: ${customers.length}`);

  // Live sessions on most PCs; a few left free so staff can start one in the demo.
  const floor = await as("GET", `/branches/${dxb.id}/floor`);
  const pcs = floor.devices.filter((d) => d.kind === "GAMING_PC" && d.isOnline && !d.session);
  const plans = await as("GET", "/pricing-plans");
  const regularPlan = plans.find((p) => p.name === "Regular PC");
  const vipPlan = plans.find((p) => p.name === "VIP PC");
  const minutes = [60, 120, 180, 45, 90, 240, 30, 150, 75, 200];
  let started = 0;
  for (const [i, d] of pcs.entries()) {
    if (i % 4 === 3) continue; // keep ~25% free
    const vip = d.zoneId === zone("PC_VIP").id;
    const c = customers[i % customers.length];
    const request = i % 5 === 4 ? { kind: "open" } : { kind: "minutes", minutes: minutes[i % minutes.length] };
    await as("POST", `/devices/${d.id}/sessions`, {
      customerId: i % 6 === 5 ? null : c.id,
      guestLabel: i % 6 === 5 ? `Guest ${i}` : null,
      planId: vip ? vipPlan?.id : regularPlan?.id,
      request,
      payment: { method: request.kind === "open" ? "PAY_LATER" : i % 3 === 0 ? "WALLET" : "CARD" },
      idempotencyKey: `demo-session-${d.id}`,
    }).then(() => started++).catch((e) => console.warn(e.message));
  }
  // Consoles & VR too.
  for (const [i, d] of floor.devices.filter((x) => ["CONSOLE", "VR_HEADSET", "SIMULATOR"].includes(x.kind) && !x.session).entries()) {
    if (i % 2) continue;
    await as("POST", `/devices/${d.id}/sessions`, { customerId: customers[(i + 3) % customers.length].id, request: { kind: "minutes", minutes: 60 }, payment: { method: "CARD" }, players: d.kind === "CONSOLE" ? 2 : 1, ageConfirmed: true, idempotencyKey: `demo-session-${d.id}` })
      .then(() => started++)
      .catch((e) => console.warn(e.message));
  }
  console.log(`sessions started: ${started}`);

  // Food: seat orders from players, a paid counter order, a dine-in bill left open.
  const menu = await as("GET", `/branches/${dxb.id}/menu`);
  const products = menu.categories.flatMap((c) => c.products).filter((p) => p.available && !p.modifierGroups.some((g) => g.minSelect > 0));
  const pick = (n) => products[n % products.length].id;
  const busy = (await as("GET", `/branches/${dxb.id}/floor`)).devices.filter((d) => d.session);
  let orders = 0;
  for (const [i, d] of busy.slice(0, 6).entries()) {
    await as("POST", `/branches/${dxb.id}/orders`, {
      type: "GAMING_SEAT", deviceId: d.id, customerId: d.session.customerId ?? null,
      lines: [{ productId: pick(i), quantity: 1 }, { productId: pick(i + 3), quantity: 1 + (i % 2) }],
      payments: [{ method: "CARD" }], idempotencyKey: `demo-seat-${d.id}`,
    }).then(() => orders++).catch((e) => console.warn(e.message));
  }
  for (let i = 0; i < 3; i++) {
    await as("POST", `/branches/${dxb.id}/orders`, { type: "COUNTER", lines: [{ productId: pick(i + 5), quantity: 2 }], payments: [{ method: "CARD" }], idempotencyKey: `demo-counter-${i}` })
      .then(() => orders++)
      .catch((e) => console.warn(e.message));
  }
  const tables = await as("GET", `/branches/${dxb.id}/tables`).catch(() => []);
  if (tables[0]) {
    await as("POST", `/branches/${dxb.id}/orders`, { type: "DINE_IN", tableId: tables[0].id, lines: [{ productId: pick(1), quantity: 2 }, { productId: pick(7), quantity: 2 }], idempotencyKey: "demo-dinein-1" })
      .then(() => orders++)
      .catch((e) => console.warn(e.message));
  }
  console.log(`orders: ${orders}`);

  // Move some kitchen tickets along so the kitchen screen shows every stage.
  const kitchen = await as("GET", `/branches/${dxb.id}/kitchen`).catch(() => ({ tickets: [] }));
  const tickets = Array.isArray(kitchen) ? kitchen : (kitchen.tickets ?? []);
  for (const [i, t] of tickets.entries()) {
    const to = ["ACCEPTED", "PREPARING", "READY"][i % 4];
    if (to) await as("POST", `/kitchen-tickets/${t.id}/bump`, { to }).catch(() => undefined);
    if (to === "PREPARING" || to === "READY") await as("POST", `/kitchen-tickets/${t.id}/bump`, { to: "PREPARING" }).catch(() => undefined);
    if (to === "READY") await as("POST", `/kitchen-tickets/${t.id}/bump`, { to: "READY" }).catch(() => undefined);
  }

  // Bookings later today and tomorrow.
  let booked = 0;
  const at = (hoursFromNow) => {
    const d = new Date(Date.now() + hoursFromNow * 3_600_000);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  };
  const slots = [[3, "PC_STANDARD", 2], [5, "PC_VIP", 1], [26, "PC_STANDARD", 5], [28, "CONSOLE", 1], [30, "PC_VIP", 3], [50, "VR", 1]];
  for (const [i, [h, type, players]] of slots.entries()) {
    const z = zone(type);
    if (!z) continue;
    await as("POST", `/branches/${dxb.id}/bookings`, { zoneId: z.id, players, startsAt: at(h), minutes: 120, customerId: customers[(i * 3) % customers.length].id, source: "STAFF", idempotencyKey: `demo-booking-${i}` })
      .then(() => booked++)
      .catch((e) => console.warn(e.message));
  }
  console.log(`bookings: ${booked}`);
}
