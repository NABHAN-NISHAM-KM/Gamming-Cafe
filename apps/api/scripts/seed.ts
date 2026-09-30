// Seeds platform reference data + two demo tenants. Idempotent.
//   npm run seed -w @arena/api
// Runs as the migration/platform role (DATABASE_URL), which bypasses RLS.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPlatformClient, type PlatformClient, type TenantTx } from "@arena/db";
import { moveStock } from "../src/inventory/stock.js";
import { FEATURES, type FeatureKey } from "@arena/contracts";
import { PERMISSIONS, ROLE_TEMPLATES, templatePermissions } from "@arena/rbac";
import { randomBytes } from "node:crypto";
import { hashSecret } from "../src/auth/crypto.js";

const envFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const DEMO_PASSWORD = "ArenaDemo!2026";

const CURRENCIES = [
  ["AED", "UAE Dirham", "د.إ", 2], ["SAR", "Saudi Riyal", "﷼", 2], ["QAR", "Qatari Riyal", "ر.ق", 2],
  ["KWD", "Kuwaiti Dinar", "د.ك", 3], ["BHD", "Bahraini Dinar", ".د.ب", 3], ["OMR", "Omani Rial", "ر.ع.", 3],
  ["INR", "Indian Rupee", "₹", 2], ["GBP", "Pound Sterling", "£", 2], ["USD", "US Dollar", "$", 2], ["EUR", "Euro", "€", 2],
] as const;

const COUNTRIES = [
  ["AE", "United Arab Emirates", "AED", "Asia/Dubai", "en"], ["SA", "Saudi Arabia", "SAR", "Asia/Riyadh", "ar"],
  ["QA", "Qatar", "QAR", "Asia/Qatar", "ar"], ["KW", "Kuwait", "KWD", "Asia/Kuwait", "ar"],
  ["BH", "Bahrain", "BHD", "Asia/Bahrain", "ar"], ["OM", "Oman", "OMR", "Asia/Muscat", "ar"],
  ["IN", "India", "INR", "Asia/Kolkata", "en"], ["GB", "United Kingdom", "GBP", "Europe/London", "en"],
  ["US", "United States", "USD", "America/New_York", "en"],
] as const;

const ALL = Object.keys(FEATURES) as FeatureKey[];
const PLANS: Array<{ code: string; name: string; price: number; maxBranches: number | null; maxDevices: number | null; maxEmployees: number | null; features: FeatureKey[] }> = [
  {
    code: "STARTER", name: "Starter", price: 199, maxBranches: 1, maxDevices: 30, maxEmployees: 10,
    features: ["PC_GAMING", "CONSOLE", "INTERNET_CAFE", "BOOKINGS", "MEMBERSHIP", "WALLET", "INVENTORY", "LOYALTY", "PROMOTIONS", "CUSTOMER_APP", "REMOTE_SUPPORT", "OFFLINE_EDGE", "GAME_UPDATES"],
  },
  {
    code: "PRO", name: "Pro", price: 599, maxBranches: 5, maxDevices: 250, maxEmployees: 100,
    features: ALL.filter((f) => !["PUBLIC_API", "MULTI_BRAND", "DISKLESS", "ACCOUNTING"].includes(f)),
  },
  { code: "ENTERPRISE", name: "Enterprise", price: 1999, maxBranches: null, maxDevices: null, maxEmployees: null, features: ALL },
];

async function seedPlatform(db: PlatformClient) {
  for (const [code, name, symbol, minorUnit] of CURRENCIES) {
    await db.currency.upsert({ where: { code }, create: { code, name, symbol, minorUnit }, update: { name, symbol, minorUnit } });
  }
  for (const [code, name, defaultCurrency, defaultTimezone, defaultLocale] of COUNTRIES) {
    await db.country.upsert({ where: { code }, create: { code, name, defaultCurrency, defaultTimezone, defaultLocale }, update: { name, defaultCurrency, defaultTimezone, defaultLocale } });
  }
  for (const p of PLANS) {
    const plan = await db.subscriptionPlan.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, price: p.price, currency: "USD", maxBranches: p.maxBranches, maxDevices: p.maxDevices, maxEmployees: p.maxEmployees },
      update: { name: p.name, price: p.price, maxBranches: p.maxBranches, maxDevices: p.maxDevices, maxEmployees: p.maxEmployees },
    });
    for (const key of ALL) {
      const enabled = p.features.includes(key);
      await db.planFeature.upsert({ where: { planId_featureKey: { planId: plan.id, featureKey: key } }, create: { planId: plan.id, featureKey: key, enabled }, update: { enabled } });
    }
  }

  // Permission catalog: code is the source of truth.
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, module: p.module, description: p.description, isSensitive: !!p.sensitive },
      update: { module: p.module, description: p.description, isSensitive: !!p.sensitive },
    });
  }
  await db.permission.deleteMany({ where: { key: { notIn: PERMISSIONS.map((p) => p.key) } } });

  // Platform role templates (organizationId = NULL).
  for (const t of ROLE_TEMPLATES) {
    const existing = await db.role.findFirst({ where: { organizationId: null, key: t.key } });
    const role = existing
      ? await db.role.update({ where: { id: existing.id }, data: { name: t.name, description: t.description, isSystem: true } })
      : await db.role.create({ data: { key: t.key, name: t.name, description: t.description, isSystem: true } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: [...templatePermissions(t.key)].map((permissionKey) => ({ roleId: role.id, permissionKey })) });
  }
  await seedCatalog(db);
  console.log(`platform: ${CURRENCIES.length} currencies, ${COUNTRIES.length} countries, ${PLANS.length} plans, ${PERMISSIONS.length} permissions, ${ROLE_TEMPLATES.length} role templates, ${LAUNCHERS.length} launchers, ${GAMES.length} games, ${APPS.length} apps`);
}

// ── Platform game catalog (organizationId = NULL; every tenant can enable these) ──
// Metadata only — no cover art is shipped; the Shell draws its own tiles.
// Store ids are what the agent matches against Steam/Epic manifests on each PC.

const LAUNCHERS: Array<{ key: string; name: string; executablePath: string | null; processNames: string[] }> = [
  { key: "STEAM", name: "Steam", executablePath: "C:\\Program Files (x86)\\Steam\\steam.exe", processNames: ["steam.exe", "steamwebhelper.exe"] },
  { key: "EPIC", name: "Epic Games", executablePath: "C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe", processNames: ["EpicGamesLauncher.exe", "EpicWebHelper.exe"] },
  { key: "RIOT", name: "Riot Client", executablePath: "C:\\Riot Games\\Riot Client\\RiotClientServices.exe", processNames: ["RiotClientServices.exe", "RiotClientUx.exe"] },
  { key: "BATTLENET", name: "Battle.net", executablePath: "C:\\Program Files (x86)\\Battle.net\\Battle.net Launcher.exe", processNames: ["Battle.net.exe"] },
  { key: "EA", name: "EA app", executablePath: "C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EALauncher.exe", processNames: ["EADesktop.exe"] },
  { key: "UBISOFT", name: "Ubisoft Connect", executablePath: "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\UbisoftConnect.exe", processNames: ["UbisoftConnect.exe"] },
];

type CatalogGame = { slug: string; title: string; developer: string; categories: string[]; launcher: string | null; storeId?: string; exe?: string; args?: string; process: string[]; ageRating: string; minAge: number; account: boolean };
const GAMES: CatalogGame[] = [
  { slug: "counter-strike-2", title: "Counter-Strike 2", developer: "Valve", categories: ["FPS", "COMPETITIVE", "MULTIPLAYER"], launcher: "STEAM", storeId: "730", process: ["cs2.exe"], ageRating: "PEGI 18", minAge: 18, account: true },
  { slug: "dota-2", title: "Dota 2", developer: "Valve", categories: ["MOBA", "COMPETITIVE", "MULTIPLAYER"], launcher: "STEAM", storeId: "570", process: ["dota2.exe"], ageRating: "PEGI 12", minAge: 12, account: true },
  { slug: "pubg-battlegrounds", title: "PUBG: Battlegrounds", developer: "Krafton", categories: ["BATTLE_ROYALE", "FPS", "MULTIPLAYER"], launcher: "STEAM", storeId: "578080", process: ["TslGame.exe"], ageRating: "PEGI 18", minAge: 18, account: true },
  { slug: "apex-legends", title: "Apex Legends", developer: "Respawn", categories: ["BATTLE_ROYALE", "FPS", "MULTIPLAYER"], launcher: "STEAM", storeId: "1172470", process: ["r5apex.exe", "r5apex_dx12.exe"], ageRating: "PEGI 16", minAge: 16, account: true },
  { slug: "marvel-rivals", title: "Marvel Rivals", developer: "NetEase Games", categories: ["FPS", "COMPETITIVE", "MULTIPLAYER"], launcher: "STEAM", storeId: "2767030", process: ["Marvel-Win64-Shipping.exe"], ageRating: "PEGI 12", minAge: 12, account: true },
  { slug: "rust", title: "Rust", developer: "Facepunch Studios", categories: ["MULTIPLAYER", "SIMULATION"], launcher: "STEAM", storeId: "252490", process: ["RustClient.exe"], ageRating: "PEGI 18", minAge: 18, account: true },
  { slug: "gta-v", title: "Grand Theft Auto V", developer: "Rockstar Games", categories: ["STORY", "MULTIPLAYER"], launcher: "STEAM", storeId: "271590", process: ["GTA5.exe", "PlayGTAV.exe"], ageRating: "PEGI 18", minAge: 18, account: true },
  { slug: "call-of-duty", title: "Call of Duty", developer: "Activision", categories: ["FPS", "BATTLE_ROYALE", "MULTIPLAYER"], launcher: "STEAM", storeId: "1938090", process: ["cod.exe"], ageRating: "PEGI 18", minAge: 18, account: true },
  { slug: "naraka-bladepoint", title: "Naraka: Bladepoint", developer: "24 Entertainment", categories: ["BATTLE_ROYALE", "FIGHTING"], launcher: "STEAM", storeId: "1203220", process: ["NarakaBladepoint.exe"], ageRating: "PEGI 16", minAge: 16, account: true },
  { slug: "ea-sports-fc-25", title: "EA SPORTS FC 25", developer: "EA Sports", categories: ["SPORTS", "MULTIPLAYER"], launcher: "STEAM", storeId: "2669320", process: ["FC25.exe"], ageRating: "PEGI 3", minAge: 3, account: true },
  { slug: "elden-ring", title: "Elden Ring", developer: "FromSoftware", categories: ["RPG", "STORY"], launcher: "STEAM", storeId: "1245620", process: ["eldenring.exe"], ageRating: "PEGI 16", minAge: 16, account: true },
  { slug: "fortnite", title: "Fortnite", developer: "Epic Games", categories: ["BATTLE_ROYALE", "MULTIPLAYER", "KIDS"], launcher: "EPIC", storeId: "Fortnite", process: ["FortniteClient-Win64-Shipping.exe"], ageRating: "PEGI 12", minAge: 12, account: true },
  { slug: "rocket-league", title: "Rocket League", developer: "Psyonix", categories: ["SPORTS", "RACING", "COMPETITIVE", "KIDS"], launcher: "EPIC", storeId: "Sugar", process: ["RocketLeague.exe"], ageRating: "PEGI 3", minAge: 3, account: true },
  { slug: "valorant", title: "VALORANT", developer: "Riot Games", categories: ["FPS", "COMPETITIVE", "MULTIPLAYER"], launcher: "RIOT", exe: "C:\\Riot Games\\Riot Client\\RiotClientServices.exe", args: "--launch-product=valorant --launch-patchline=live", process: ["VALORANT-Win64-Shipping.exe"], ageRating: "PEGI 16", minAge: 16, account: true },
  { slug: "league-of-legends", title: "League of Legends", developer: "Riot Games", categories: ["MOBA", "COMPETITIVE", "MULTIPLAYER"], launcher: "RIOT", exe: "C:\\Riot Games\\Riot Client\\RiotClientServices.exe", args: "--launch-product=league_of_legends --launch-patchline=live", process: ["League of Legends.exe", "LeagueClient.exe"], ageRating: "PEGI 12", minAge: 12, account: true },
  { slug: "overwatch-2", title: "Overwatch 2", developer: "Blizzard", categories: ["FPS", "COMPETITIVE", "MULTIPLAYER"], launcher: "STEAM", storeId: "2357570", process: ["Overwatch.exe"], ageRating: "PEGI 12", minAge: 12, account: true },
  { slug: "minecraft", title: "Minecraft", developer: "Mojang", categories: ["CASUAL", "KIDS", "MULTIPLAYER"], launcher: null, exe: "C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe", process: ["Minecraft.exe", "javaw.exe"], ageRating: "PEGI 7", minAge: 7, account: true },
  { slug: "roblox", title: "Roblox", developer: "Roblox Corporation", categories: ["CASUAL", "KIDS", "MULTIPLAYER"], launcher: null, exe: "C:\\Program Files (x86)\\Roblox\\Versions\\RobloxPlayerLauncher.exe", process: ["RobloxPlayerBeta.exe"], ageRating: "PEGI 7", minAge: 7, account: true },
];

const APPS: Array<{ name: string; kind: string; executablePath: string; arguments?: string; sortOrder: number }> = [
  { name: "Google Chrome", kind: "BROWSER", executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", arguments: "--incognito", sortOrder: 0 },
  { name: "Microsoft Edge", kind: "BROWSER", executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", arguments: "--inprivate", sortOrder: 1 },
  ...LAUNCHERS.filter((l) => l.executablePath).map((l, i) => ({ name: l.name, kind: "PLATFORM_LAUNCHER", executablePath: l.executablePath!, sortOrder: 10 + i })),
  { name: "Notepad", kind: "UTILITY", executablePath: "C:\\Windows\\System32\\notepad.exe", sortOrder: 50 },
  { name: "Calculator", kind: "UTILITY", executablePath: "C:\\Windows\\System32\\calc.exe", sortOrder: 51 },
];

async function seedCatalog(db: PlatformClient) {
  const launcherIds: Record<string, string> = {};
  for (const l of LAUNCHERS) {
    const data = { name: l.name, executablePath: l.executablePath, processNames: l.processNames, requiresAccount: true, isActive: true };
    const row = await db.launcher.findFirst({ where: { organizationId: null, key: l.key } });
    launcherIds[l.key] = (row ? await db.launcher.update({ where: { id: row.id }, data }) : await db.launcher.create({ data: { key: l.key, ...data } })).id;
  }
  for (const g of GAMES) {
    const data = {
      title: g.title, developer: g.developer, categories: g.categories as any, launcherId: g.launcher ? launcherIds[g.launcher]! : null,
      launcherGameId: g.storeId ?? null, executablePath: g.exe ?? null, arguments: g.args ?? null, processNames: g.process,
      ageRating: g.ageRating, minAge: g.minAge, requiresAccount: g.account, isActive: true,
    };
    const row = await db.game.findFirst({ where: { organizationId: null, slug: g.slug } });
    if (row) await db.game.update({ where: { id: row.id }, data });
    else await db.game.create({ data: { slug: g.slug, ...data } });
  }
  for (const a of APPS) {
    const data = { kind: a.kind as any, executablePath: a.executablePath, arguments: a.arguments ?? null, sortOrder: a.sortOrder, isActive: true, allowedZoneIds: [] };
    const row = await db.shellApp.findFirst({ where: { organizationId: null, name: a.name } });
    if (row) await db.shellApp.update({ where: { id: row.id }, data });
    else await db.shellApp.create({ data: { name: a.name, ...data } });
  }
}

/** Demo menu, kitchen stations, tables and a cash drawer per branch. Idempotent. */
async function seedRestaurant(db: PlatformClient, organizationId: string, branchIds: Record<string, string>) {
  const stations: Record<string, Record<string, string>> = {};
  for (const [code, branchId] of Object.entries(branchIds)) {
    stations[code] = {};
    for (const name of ["Kitchen", "Bar"]) {
      const s = (await db.kitchenStation.findFirst({ where: { branchId, name } })) ?? (await db.kitchenStation.create({ data: { organizationId, branchId, name } }));
      stations[code]![name] = s.id;
    }
    if (!(await db.cashDrawer.findFirst({ where: { branchId } }))) await db.cashDrawer.create({ data: { organizationId, branchId, name: "Front desk" } });
  }
  const dxb = branchIds["DXB1"];
  if (dxb) {
    const zone = await db.zone.findFirst({ where: { branchId: dxb, type: "RESTAURANT" }, select: { id: true } });
    for (const [i, [name, seats]] of ([["T1", 2], ["T2", 2], ["T3", 4], ["T4", 4], ["T5", 6], ["T6", 8]] as const).entries()) {
      if (await db.restaurantTable.findFirst({ where: { branchId: dxb, name } })) continue;
      await db.restaurantTable.create({ data: { organizationId, branchId: dxb, zoneId: zone?.id ?? null, name, seats, mapX: (i % 3) * 2, mapY: Math.floor(i / 3) * 2, qrToken: `${organizationId.slice(0, 8)}-${name}-${Math.random().toString(36).slice(2, 10)}` } });
    }
  }
  if (await db.product.findFirst({ where: { organizationId, sku: "BRG-CLASSIC" } })) return;

  const group = async (name: string, minSelect: number, maxSelect: number, mods: Array<[string, number]>) =>
    db.modifierGroup.create({ data: { organizationId, name, minSelect, maxSelect, modifiers: { create: mods.map(([n, p], i) => ({ name: n, priceDelta: p, sortOrder: i })) } } });
  const extras = await group("Extras", 0, 3, [["Cheese", 3], ["Bacon", 5], ["Jalapeños", 2], ["Extra patty", 9]]);
  const size = await group("Size", 1, 1, [["Regular", 0], ["Large", 5]]);
  const milk = await group("Milk", 1, 1, [["Regular milk", 0], ["Oat milk", 3], ["No milk", 0]]);
  const sauce = await group("Dip", 0, 2, [["Ketchup", 0], ["Garlic mayo", 2], ["BBQ", 2]]);

  const kitchen = stations["DXB1"]?.["Kitchen"] ?? null;
  const bar = stations["DXB1"]?.["Bar"] ?? null;
  const menu: Array<{ cat: string; items: Array<[string, string, number, "RECIPE_ITEM" | "STOCK_ITEM", "FOOD" | "BEVERAGE", string | null, string[]]> }> = [
    { cat: "Burgers", items: [["BRG-CLASSIC", "Classic smash burger", 32, "RECIPE_ITEM", "FOOD", kitchen, [extras.id]], ["BRG-CHICKEN", "Crispy chicken burger", 29, "RECIPE_ITEM", "FOOD", kitchen, [extras.id]], ["BRG-VEG", "Halloumi burger", 27, "RECIPE_ITEM", "FOOD", kitchen, [extras.id]]] },
    { cat: "Snacks", items: [["SNK-FRIES", "Fries", 12, "RECIPE_ITEM", "FOOD", kitchen, [size.id, sauce.id]], ["SNK-WINGS", "Chicken wings (8)", 26, "RECIPE_ITEM", "FOOD", kitchen, [sauce.id]], ["SNK-NACHOS", "Loaded nachos", 24, "RECIPE_ITEM", "FOOD", kitchen, []]] },
    { cat: "Pizza", items: [["PZA-MARG", "Margherita", 35, "RECIPE_ITEM", "FOOD", kitchen, [size.id]], ["PZA-PEPP", "Pepperoni", 42, "RECIPE_ITEM", "FOOD", kitchen, [size.id]]] },
    { cat: "Drinks", items: [["DRK-COLA", "Cola (can)", 8, "STOCK_ITEM", "BEVERAGE", bar, []], ["DRK-ENERGY", "Energy drink", 14, "STOCK_ITEM", "BEVERAGE", bar, []], ["DRK-WATER", "Water", 5, "STOCK_ITEM", "BEVERAGE", bar, []], ["DRK-MILKSHAKE", "Oreo milkshake", 22, "RECIPE_ITEM", "BEVERAGE", bar, [size.id]]] },
    { cat: "Coffee", items: [["COF-LATTE", "Iced latte", 19, "RECIPE_ITEM", "BEVERAGE", bar, [milk.id, size.id]], ["COF-AMER", "Americano", 14, "RECIPE_ITEM", "BEVERAGE", bar, [size.id]]] },
  ];
  for (const [ci, c] of menu.entries()) {
    const cat = (await db.productCategory.findFirst({ where: { organizationId, name: c.cat } })) ?? (await db.productCategory.create({ data: { organizationId, name: c.cat, sortOrder: ci, showInShell: true } }));
    for (const [pi, [sku, name, price, type, tax, station, groups]] of c.items.entries()) {
      const p = await db.product.create({ data: { organizationId, categoryId: cat.id, sku, name, type, price, currency: "AED", taxAppliesTo: tax, kitchenStationId: station, prepTimeMinutes: type === "RECIPE_ITEM" ? 10 : null, sortOrder: pi } });
      for (const [gi, g] of groups.entries()) await db.productModifierGroup.create({ data: { organizationId, productId: p.id, modifierGroupId: g, sortOrder: gi } });
    }
  }
}

/**
 * Stores, suppliers, stock items, recipes and opening stock for DXB1 (AUH1
 * doesn't track stock, so its menu is never limited). Opening stock arrives
 * through real received purchase orders, so average costs are genuine; a few
 * items are left low and one milk batch close to expiry, to show the alerts.
 * Idempotent.
 */
async function seedInventory(db: PlatformClient, organizationId: string, branchIds: Record<string, string>) {
  const dxb = branchIds["DXB1"];
  if (!dxb || (await db.inventoryItem.findFirst({ where: { organizationId, sku: "INV-BUN" } }))) return;
  const t = db as unknown as TenantTx;
  const owner = await db.employee.findFirstOrThrow({ where: { organizationId, employeeCode: "E001" } });
  const invMgr = (await db.employee.findFirst({ where: { organizationId, employeeCode: "E007" } })) ?? owner;

  const wh = async (name: string, type: "CENTRAL" | "BRANCH_STORE" | "KITCHEN" | "BAR" | "TECH_STORE", branchId: string | null) =>
    (await db.warehouse.findFirst({ where: { organizationId, branchId, name } })) ?? (await db.warehouse.create({ data: { organizationId, branchId, name, type } }));
  const central = await wh("Central warehouse", "CENTRAL", null);
  await wh("Main store", "BRANCH_STORE", dxb);
  const kitchen = await wh("Kitchen store", "KITCHEN", dxb);
  const bar = await wh("Bar store", "BAR", dxb);
  const tech = await wh("Tech store", "TECH_STORE", dxb);

  const sup = async (name: string, contactName: string, email: string, phone: string, terms: number) =>
    (await db.supplier.findFirst({ where: { organizationId, name } })) ?? (await db.supplier.create({ data: { organizationId, name, contactName, email, phone, paymentTermsDays: terms, currency: "AED" } }));
  const fresh = await sup("Gulf Fresh Foods", "Rania", "orders@gulffresh.example", "+971 4 555 0101", 30);
  const bev = await sup("Emirates Beverages", "Sami", "sales@emiratesbev.example", "+971 4 555 0202", 15);
  const gear = await sup("PixelGear Trading", "Omar", "b2b@pixelgear.example", "+971 4 555 0303", 45);

  // sku, name, category, base unit, purchase unit, pack, min, reorder, cost per base unit, expiry, serial, supplier, store, opening qty
  type Row = [string, string, string, string, string, number, number, number | null, number, boolean, boolean, string, string, number];
  const K = kitchen.id, B = bar.id, T = tech.id;
  const rows: Row[] = [
    ["INV-BUN", "Burger bun", "INGREDIENT", "pcs", "bag", 12, 24, null, 0.8, true, false, fresh.id, K, 96],
    ["INV-PATTY", "Beef patty 120 g", "INGREDIENT", "pcs", "box", 20, 20, null, 4.5, true, false, fresh.id, K, 120],
    ["INV-CHKFIL", "Chicken fillet", "INGREDIENT", "pcs", "box", 20, 15, null, 3.8, true, false, fresh.id, K, 60],
    ["INV-HALLOUMI", "Halloumi", "INGREDIENT", "g", "block", 1000, 1000, null, 0.045, true, false, fresh.id, K, 4000],
    ["INV-CHEDDAR", "Cheddar slice", "INGREDIENT", "pcs", "pack", 50, 50, null, 0.35, false, false, fresh.id, K, 300],
    ["INV-BACON", "Beef bacon", "INGREDIENT", "g", "pack", 500, 500, null, 0.06, true, false, fresh.id, K, 2000],
    ["INV-JALAP", "Jalapeños", "INGREDIENT", "g", "jar", 500, 200, null, 0.03, false, false, fresh.id, K, 1500],
    ["INV-MAYO", "Garlic mayo", "INGREDIENT", "ml", "jar", 1000, 500, null, 0.015, false, false, fresh.id, K, 3000],
    ["INV-FRIES", "Frozen fries", "INGREDIENT", "g", "bag", 2500, 5000, null, 0.012, false, false, fresh.id, K, 25000],
    ["INV-WINGS", "Chicken wings", "INGREDIENT", "pcs", "box", 40, 40, null, 1.1, true, false, fresh.id, K, 240],
    ["INV-NACHO", "Tortilla chips", "INGREDIENT", "g", "bag", 1000, 1000, null, 0.02, false, false, fresh.id, K, 5000],
    ["INV-DOUGH", "Pizza dough ball", "INGREDIENT", "pcs", "box", 24, 12, null, 2, true, false, fresh.id, K, 48],
    ["INV-MOZZ", "Mozzarella", "INGREDIENT", "g", "block", 2000, 2000, null, 0.035, true, false, fresh.id, K, 8000],
    ["INV-PEPP", "Pepperoni", "INGREDIENT", "g", "pack", 1000, 500, null, 0.07, true, false, fresh.id, K, 3000],
    ["INV-TOMSAUCE", "Tomato sauce", "INGREDIENT", "ml", "tin", 3000, 1500, null, 0.008, false, false, fresh.id, K, 9000],
    ["INV-COLA", "Cola can 330 ml", "DRINK", "pcs", "case", 24, 48, 48, 2.2, false, false, bev.id, B, 144],
    ["INV-ENERGY", "Energy drink can", "DRINK", "pcs", "case", 24, 24, 48, 5.5, false, false, bev.id, B, 12],
    ["INV-WATER", "Water 500 ml", "DRINK", "pcs", "case", 24, 48, null, 0.9, false, false, bev.id, B, 96],
    ["INV-ICECREAM", "Vanilla ice cream", "INGREDIENT", "ml", "tub", 5000, 2000, null, 0.01, true, false, bev.id, B, 15000],
    ["INV-OREO", "Cookie crumbs", "INGREDIENT", "g", "pack", 500, 300, null, 0.04, false, false, bev.id, B, 2000],
    ["INV-MILK", "Fresh milk", "INGREDIENT", "ml", "carton", 1000, 4000, 8000, 0.006, true, false, bev.id, B, 3000],
    ["INV-OATMILK", "Oat milk", "INGREDIENT", "ml", "carton", 1000, 2000, null, 0.012, true, false, bev.id, B, 6000],
    ["INV-BEANS", "Coffee beans", "INGREDIENT", "g", "bag", 1000, 1000, null, 0.09, false, false, bev.id, B, 5000],
    ["INV-CUP", "Takeaway cup", "PACKAGING", "pcs", "sleeve", 50, 100, null, 0.3, false, false, bev.id, B, 400],
    ["INV-HEADSET", "Gaming headset (spare)", "HEADSET", "pcs", "box", 1, 4, 6, 180, false, true, gear.id, T, 3],
    ["INV-MOUSE", "Gaming mouse (spare)", "GAMING_ACCESSORY", "pcs", "box", 1, 4, null, 95, false, true, gear.id, T, 6],
  ];
  const item: Record<string, string> = {};
  for (const [sku, name, category, baseUnit, purchaseUnit, pack, min, reorder, , trackExpiry, trackSerial, supplierId] of rows) {
    const i = await db.inventoryItem.create({ data: { organizationId, sku, name, category: category as any, baseUnit, purchaseUnit, purchaseUnitQty: pack, minStock: min, reorderQty: reorder, trackExpiry, trackSerial, defaultSupplierId: supplierId } });
    item[sku] = i.id;
  }

  // Opening stock: one received PO per supplier and store.
  const soon = new Date(Date.now() + 3 * 86_400_000); // one milk batch about to expire
  const later = new Date(Date.now() + 21 * 86_400_000);
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(`${r[11]}|${r[12]}`, [...(groups.get(`${r[11]}|${r[12]}`) ?? []), r]);
  let n = 0;
  for (const [k, list] of groups) {
    const [supplierId, warehouseId] = k.split("|") as [string, string];
    const total = list.reduce((a, r) => a + r[13] * r[8], 0);
    const po = await db.purchaseOrder.create({
      data: {
        organizationId, branchId: dxb, warehouseId, supplierId, number: `PO-OPEN-${String(++n).padStart(3, "0")}`, status: "RECEIVED", currency: "AED",
        subtotal: total.toFixed(2), total: total.toFixed(2), orderedAt: new Date(), approvedAt: new Date(), createdById: invMgr.id, approvedById: owner.id, notes: "Opening stock",
        purchaseOrderLines: { create: list.map((r) => ({ itemId: item[r[0]]!, quantityOrdered: r[13], quantityReceived: r[13], unitCost: r[8], lineTotal: (r[13] * r[8]).toFixed(2) })) },
      },
      include: { purchaseOrderLines: true },
    });
    for (const r of list) {
      const line = po.purchaseOrderLines.find((l) => l.itemId === item[r[0]])!;
      const serial = r[10];
      const count = serial ? r[13] : 1;
      for (let s = 0; s < count; s++) {
        await moveStock(t, {
          itemId: item[r[0]]!, warehouseId, type: "PURCHASE_RECEIPT", delta: serial ? 1 : r[13], unitCost: r[8],
          lot: { lotCode: r[9] ? "OPEN-1" : null, serialNumber: serial ? `${r[0].slice(4)}-${1001 + s}` : null, expiresAt: r[9] ? (r[0] === "INV-MILK" ? soon : later) : null },
          referenceType: "PO_LINE", referenceId: line.id, employeeId: invMgr.id, reason: "Opening stock", idempotencyKey: `seed:${organizationId}:open:${r[0]}:${s}`,
        });
      }
    }
  }
  // Something in the central warehouse too (the source for restocking transfers).
  await moveStock(t, { itemId: item["INV-COLA"]!, warehouseId: central.id, type: "PURCHASE_RECEIPT", delta: 240, unitCost: 2.1, referenceType: "SEED", employeeId: invMgr.id, reason: "Opening stock", idempotencyKey: `seed:${organizationId}:open:central-cola` });

  // Recipes (per unit sold; the third number is planned waste %) and stock links.
  const recipes: Record<string, Array<[string, number, number?]>> = {
    "BRG-CLASSIC": [["INV-BUN", 1], ["INV-PATTY", 2], ["INV-CHEDDAR", 1]],
    "BRG-CHICKEN": [["INV-BUN", 1], ["INV-CHKFIL", 1], ["INV-MAYO", 20]],
    "BRG-VEG": [["INV-BUN", 1], ["INV-HALLOUMI", 120]],
    "SNK-FRIES": [["INV-FRIES", 200, 5]],
    "SNK-WINGS": [["INV-WINGS", 8]],
    "SNK-NACHOS": [["INV-NACHO", 150], ["INV-CHEDDAR", 2], ["INV-JALAP", 20]],
    "PZA-MARG": [["INV-DOUGH", 1], ["INV-MOZZ", 150], ["INV-TOMSAUCE", 80]],
    "PZA-PEPP": [["INV-DOUGH", 1], ["INV-MOZZ", 150], ["INV-TOMSAUCE", 80], ["INV-PEPP", 60]],
    "DRK-MILKSHAKE": [["INV-ICECREAM", 200], ["INV-MILK", 150], ["INV-OREO", 40], ["INV-CUP", 1]],
    "COF-LATTE": [["INV-BEANS", 18], ["INV-CUP", 1]],
    "COF-AMER": [["INV-BEANS", 18], ["INV-CUP", 1]],
  };
  for (const [sku, lines] of Object.entries(recipes)) {
    const p = await db.product.findFirst({ where: { organizationId, sku } });
    if (!p) continue;
    for (const [isku, quantity, waste] of lines) await db.recipeLine.create({ data: { organizationId, productId: p.id, inventoryItemId: item[isku]!, quantity, wastePct: waste ?? 0 } });
  }
  for (const [sku, isku] of [["DRK-COLA", "INV-COLA"], ["DRK-ENERGY", "INV-ENERGY"], ["DRK-WATER", "INV-WATER"]] as const) {
    await db.product.updateMany({ where: { organizationId, sku }, data: { inventoryItemId: item[isku]! } });
  }
  // What options take out of stock.
  const modStock: Array<[string, string, number]> = [["Cheese", "INV-CHEDDAR", 1], ["Bacon", "INV-BACON", 40], ["Jalapeños", "INV-JALAP", 20], ["Extra patty", "INV-PATTY", 1], ["Garlic mayo", "INV-MAYO", 30], ["Regular milk", "INV-MILK", 200], ["Oat milk", "INV-OATMILK", 200]];
  for (const [name, isku, qty] of modStock) await db.modifier.updateMany({ where: { organizationId, name }, data: { inventoryItemId: item[isku]!, inventoryQty: qty } });

  // Work in progress: an order on its way and one waiting for approval.
  const mk = async (number: string, status: "ORDERED" | "PENDING_APPROVAL", supplierId: string, warehouseId: string, lines: Array<[string, number, number]>) => {
    const sub = lines.reduce((a, [, q, c]) => a + q * c, 0);
    await db.purchaseOrder.create({
      data: {
        organizationId, branchId: dxb, warehouseId, supplierId, number, status, currency: "AED", subtotal: sub.toFixed(2), total: sub.toFixed(2), createdById: invMgr.id,
        expectedAt: new Date(Date.now() + 2 * 86_400_000), orderedAt: status === "ORDERED" ? new Date() : null, approvedAt: status === "ORDERED" ? new Date() : null,
        purchaseOrderLines: { create: lines.map(([isku, q, c]) => ({ itemId: item[isku]!, quantityOrdered: q, unitCost: c, lineTotal: (q * c).toFixed(2) })) },
      },
    });
  };
  await mk("PO-OPEN-101", "ORDERED", bev.id, bar.id, [["INV-ENERGY", 48, 5.4], ["INV-MILK", 12000, 0.006]]);
  await mk("PO-OPEN-102", "PENDING_APPROVAL", gear.id, tech.id, [["INV-HEADSET", 12, 175], ["INV-MOUSE", 6, 92]]);
  await db.supplierInvoice.create({
    data: { organizationId, supplierId: fresh.id, invoiceNumber: "GFF-88121", invoiceDate: new Date(Date.now() - 10 * 86_400_000), dueDate: new Date(Date.now() + 20 * 86_400_000), amount: 1500, taxAmount: 75, currency: "AED" },
  });
}

/**
 * Consoles, VR headsets and a racing sim at DXB1 — agentless stations with
 * TV displays, controllers and smart plugs (the plug addresses are examples;
 * a bridge PC is picked in the admin) — console pricing per player, and
 * per-page print prices. Idempotent.
 */
async function seedStationsAndPrinting(db: PlatformClient, organizationId: string, branchIds: Record<string, string>) {
  const dxb = branchIds["DXB1"];
  if (!dxb) return;
  const zone = async (name: string) => (await db.zone.findFirst({ where: { branchId: dxb, name }, select: { id: true } }))?.id;
  const [ps, vr, sims] = [await zone("PS5 Lounge"), await zone("VR Zone"), await zone("Racing Sims")];
  const station = async (d: { name: string; zoneId: string; kind: "CONSOLE" | "VR_HEADSET" | "SIMULATOR" | "SMART_TV"; platform: string; controllerCount?: number | null; cleaningRequired?: boolean; minAge?: number | null; linkedDisplayId?: string | null; powerPlug?: object | null; mapX: number; mapY: number; accessories?: Array<[string, string]> }) => {
    const found = await db.device.findFirst({ where: { branchId: dxb, name: d.name }, select: { id: true } });
    if (found) return found.id;
    const created = await db.device.create({
      data: {
        organizationId, branchId: dxb, zoneId: d.zoneId, name: d.name, kind: d.kind, platform: d.platform as any, agentless: true, status: "AVAILABLE", isOnline: true,
        controllerCount: d.controllerCount ?? null, cleaningRequired: d.cleaningRequired ?? false, minAge: d.minAge ?? null, linkedDisplayId: d.linkedDisplayId ?? null,
        powerPlug: (d.powerPlug ?? undefined) as any, mapX: d.mapX, mapY: d.mapY,
      },
    });
    for (const [type, label] of d.accessories ?? []) await db.deviceAccessory.create({ data: { organizationId, deviceId: created.id, type: type as any, label } });
    return created.id;
  };
  const pads = (n: number): Array<[string, string]> => Array.from({ length: n }, (_, i) => ["CONTROLLER", `Controller ${i + 1}`]);
  if (ps) {
    for (let i = 1; i <= 3; i++) {
      const tv = await station({ name: `TV-0${i}`, zoneId: ps, kind: "SMART_TV", platform: "OTHER", mapX: i * 3 - 3, mapY: 0 });
      await station({
        name: `PS5-0${i}`, zoneId: ps, kind: "CONSOLE", platform: "PS5", controllerCount: 4, linkedDisplayId: tv,
        powerPlug: { kind: "SHELLY", host: `192.168.1.${60 + i}`, channel: 0, offDelaySeconds: 60 }, mapX: i * 3 - 3, mapY: 1, accessories: [...pads(4), ["HEADSET", "Headset"]],
      });
    }
  }
  if (vr) {
    const tv = await station({ name: "TV-VR", zoneId: vr, kind: "SMART_TV", platform: "OTHER", mapX: 0, mapY: 0 });
    for (let i = 1; i <= 2; i++) {
      await station({
        name: `VR-0${i}`, zoneId: vr, kind: "VR_HEADSET", platform: "META_QUEST", controllerCount: 1, cleaningRequired: true, minAge: 13, linkedDisplayId: tv, mapX: i * 2, mapY: 1,
        accessories: [["VR_CONTROLLER", "Left controller"], ["VR_CONTROLLER", "Right controller"]],
      });
    }
  }
  if (sims) {
    await station({
      name: "SIM-01", zoneId: sims, kind: "SIMULATOR", platform: "RACING_RIG", controllerCount: 1, minAge: 10, mapX: 0, mapY: 0,
      powerPlug: { kind: "TASMOTA", host: "192.168.1.70", channel: 0, offDelaySeconds: 30 }, accessories: [["STEERING_WHEEL", "Wheel"], ["PEDALS", "Pedals"], ["SHIFTER", "Shifter"]],
    });
  }

  // Consoles: 2 players included, AED 5/h for each extra controller. A racing-sim rate.
  await db.pricingPlan.updateMany({ where: { organizationId, name: "PS5 / Xbox" }, data: { includedPlayers: 2, extraPlayerRate: 5 } });
  if (!(await db.pricingPlan.findFirst({ where: { organizationId, name: "Racing sim" } }))) {
    const plan = await db.pricingPlan.create({ data: { organizationId, name: "Racing sim", stationClass: "SIMULATOR", billingMode: "PER_HOUR", rate: 60, currency: "AED", minMinutes: 15, roundingMinutes: 5 } });
    await db.pricingPackage.create({ data: { organizationId, pricingPlanId: plan.id, name: "15-minute race", durationMinutes: 15, price: 18, sortOrder: 0 } });
  }

  // Printing: per-page products (hidden from the Shell menu; charged by the print service).
  if (!(await db.product.findFirst({ where: { organizationId, sku: "PRINT-BW" } }))) {
    const cat = (await db.productCategory.findFirst({ where: { organizationId, name: "Services" } })) ?? (await db.productCategory.create({ data: { organizationId, name: "Services", sortOrder: 90, showInShell: false } }));
    for (const [sku, name, price] of [["PRINT-BW", "Printing — black & white (per page)", 0.5], ["PRINT-COLOR", "Printing — colour (per page)", 2]] as const) {
      await db.product.create({ data: { organizationId, categoryId: cat.id, sku, name, type: "SERVICE", price, currency: "AED", taxAppliesTo: "SERVICE", availableInShell: false, availableOnline: false } });
    }
  }
}

/**
 * Loyalty rules and rewards, promotions (happy hour, weekend bonus, birthday,
 * first visit, a WELCOME10 code), five demo players, a FIFA 1v1 tournament
 * open for registration, and a draft campaign. Idempotent.
 */
async function seedEngagement(db: PlatformClient, organizationId: string, branchIds: Record<string, string>) {
  const dxb = branchIds["DXB1"];
  if (!dxb || (await db.loyaltyRule.findFirst({ where: { organizationId } }))) return;
  const owner = await db.employee.findFirstOrThrow({ where: { organizationId, employeeCode: "E001" } });

  // Loyalty: 1 point per AED on gaming and food, fixed points for events.
  const rules: Array<[string, string, number]> = [["GAMING", "CURRENCY", 1], ["RESTAURANT", "CURRENCY", 1], ["BOOKING", "EVENT", 20], ["TOURNAMENT", "EVENT", 50], ["REFERRAL", "EVENT", 200], ["BIRTHDAY", "EVENT", 100]];
  for (const [source, unit, pointsPerUnit] of rules) await db.loyaltyRule.create({ data: { organizationId, source: source as any, unit, pointsPerUnit } });
  const cola = await db.product.findFirst({ where: { organizationId, sku: "DRK-COLA" }, select: { id: true } });
  const rewards: Array<[string, string, number, string, object]> = [
    ["1 hour of gaming", "An hour on any PC, added to your time.", 150, "FREE_MINUTES", { minutes: 60 }],
    ["AED 10 wallet credit", "Bonus credit for anything in the venue.", 200, "WALLET_CREDIT", { amount: 10 }],
    ["20% off food & drinks", "One order, any time in the next 90 days.", 120, "DISCOUNT_PERCENT", { percent: 20, target: "ORDER" }],
    ...(cola ? ([["Free cola", "One can on us.", 60, "PRODUCT", { productId: cola.id }]] as Array<[string, string, number, string, object]>) : []),
  ];
  for (const [name, description, costPoints, rewardType, value] of rewards) await db.loyaltyReward.create({ data: { organizationId, name, description, costPoints, rewardType: rewardType as any, value: value as any } });

  // Promotions.
  const promos: Array<{ name: string; type: string; conditions: object; effects: object[]; isStackable?: boolean; perCustomerLimit?: number; requiresCode?: boolean; priority?: number }> = [
    { name: "Happy hour", type: "HAPPY_HOUR", conditions: { all: [{ dayOfWeekIn: ["mon", "tue", "wed", "thu"] }, { timeBetween: ["14:00", "18:00"] }, { stationClassIn: ["PC"] }] }, effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 20 }], priority: 10 },
    { name: "Weekend bonus", type: "WEEKEND", conditions: { all: [{ dayOfWeekIn: ["fri", "sat"] }, { minSpend: 30 }] }, effects: [{ type: "BONUS_MINUTES", minutes: 30 }], isStackable: true },
    { name: "Birthday treat", type: "BIRTHDAY", conditions: { all: [{ birthday: true }] }, effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 50, maxAmount: 50 }], perCustomerLimit: 1 },
    { name: "First visit", type: "FIRST_VISIT", conditions: { all: [{ firstVisit: true }] }, effects: [{ type: "PERCENT_OFF", target: "GAMING_TIME", value: 15 }], perCustomerLimit: 1 },
    { name: "Welcome 10% off food", type: "PROMO_CODE", conditions: {}, effects: [{ type: "PERCENT_OFF", target: "ORDER", value: 10 }], requiresCode: true, perCustomerLimit: 1 },
  ];
  for (const p of promos) {
    // Paused in the test database: automatic promotions would change prices in every other test suite.
    const row = await db.promotion.create({ data: { organizationId, name: p.name, type: p.type as any, status: process.env["NODE_ENV"] === "test" ? "PAUSED" : "ACTIVE", conditions: p.conditions as any, effects: p.effects as any, isStackable: p.isStackable ?? false, perCustomerLimit: p.perCustomerLimit ?? null, requiresCode: p.requiresCode ?? false, priority: p.priority ?? 0, createdById: owner.id } });
    if (p.requiresCode) await db.promoCode.create({ data: { organizationId, promotionId: row.id, code: "WELCOME10", maxUses: 500 } });
  }

  // Demo players (password: player1234) for the tournament.
  const players: string[] = [];
  for (const [username, displayName] of [["omar", "Omar"], ["layla", "Layla"], ["khalid", "Khalid"], ["noor", "Noor"], ["yusuf", "Yusuf"]] as const) {
    const c = (await db.customer.findFirst({ where: { organizationId, username } })) ??
      (await db.customer.create({ data: { organizationId, username, displayName, passwordHash: await hashSecret("player1234"), marketingConsent: true, referralCode: randomBytes(4).toString("hex").toUpperCase() } }));
    players.push(c.id);
  }
  const ahmed = await db.customer.findFirst({ where: { organizationId, username: "ahmed" } });
  if (ahmed) {
    await db.customer.update({ where: { id: ahmed.id }, data: { marketingConsent: true } });
    if (!(await db.loyaltyTransaction.findFirst({ where: { organizationId, idempotencyKey: "seed:ahmed:points" } }))) {
      await db.customer.update({ where: { id: ahmed.id }, data: { loyaltyPoints: { increment: 250 } } });
      const after = (await db.customer.findUniqueOrThrow({ where: { id: ahmed.id }, select: { loyaltyPoints: true } })).loyaltyPoints;
      await db.loyaltyTransaction.create({ data: { organizationId, customerId: ahmed.id, type: "ADJUST", source: "MANUAL", points: 250, balanceAfter: after, reason: "Welcome points", idempotencyKey: "seed:ahmed:points", expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
    }
  }

  // FIFA 1v1, single elimination, registration open; five players already in.
  const fifa = await db.game.findFirst({ where: { title: { contains: "FC 25" } }, select: { id: true } });
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  const cat = (await db.productCategory.findFirst({ where: { organizationId, name: "Services" } })) ?? (await db.productCategory.create({ data: { organizationId, name: "Services", sortOrder: 90, showInShell: false } }));
  const fee = await db.product.create({ data: { organizationId, categoryId: cat.id, sku: "TRN-FIFA01", name: "Tournament entry — FIFA Friday", type: "SERVICE", price: 20, currency: "AED", taxAppliesTo: "SERVICE", availableInShell: false, availableOnline: false } });
  const tr = await db.tournament.create({
    data: {
      organizationId, branchId: dxb, gameId: fifa?.id ?? null, customGameName: fifa ? null : "EA SPORTS FC 25", name: "FIFA Friday 1v1", slug: "fifa-friday-1v1", description: "Weekly 1v1 knockout on PS5. Best of one, final best of three.",
      format: "SINGLE_ELIMINATION", teamSize: 1, maxTeams: 8, minTeams: 4, entryFee: 20, entryFeeProductId: fee.id, prizePool: 200, prizeDistribution: [{ place: 1, amount: 120 }, { place: 2, amount: 60 }, { place: 3, amount: 20 }],
      currency: "AED", status: "REGISTRATION_OPEN", startsAt, registrationClosesAt: new Date(startsAt.getTime() - 3_600_000), createdById: owner.id, rules: "Standard settings, 6-minute halves. Arrive 15 minutes early to check in.",
    },
  });
  for (const [i, id] of players.entries()) {
    const c = await db.customer.findUniqueOrThrow({ where: { id }, select: { displayName: true } });
    await db.team.create({ data: { organizationId, tournamentId: tr.id, name: c.displayName, captainId: id, status: "CONFIRMED", tournamentPlayers: { create: [{ tournamentId: tr.id, customerId: id }] }, seed: i < 2 ? i + 1 : null } });
  }

  await db.campaign.create({ data: { organizationId, name: "FIFA Friday is back", channel: "IN_APP", subject: "FIFA Friday 1v1 — AED 200 prize pool", body: "Hi {{firstName}}! FIFA Friday is on this week at {{venue}}. Three places left — enter in the app. You have {{points}} points.", createdById: owner.id } });
}

/** Demo tiers (two sold, one earned) and some wallet credit for Ahmed. Idempotent. */
async function seedMembershipAndWallet(db: PlatformClient, organizationId: string) {
  const tiers: Array<Record<string, unknown> & { code: string }> = [
    { code: "SILVER", name: "Silver", rank: 10, color: "#9CA3AF", price: 99, durationDays: 30, gamingDiscountPct: 10, restaurantDiscountPct: 5, bonusMinutesMonthly: 60, bookingWindowDays: 10 },
    { code: "GOLD", name: "Gold", rank: 20, color: "#F5B301", price: 199, durationDays: 30, gamingDiscountPct: 20, restaurantDiscountPct: 10, bonusMinutesMonthly: 180, bookingWindowDays: 14, priorityBooking: true },
    { code: "LEGEND", name: "Legend", rank: 30, color: "#A78BFA", price: null, durationDays: null, gamingDiscountPct: 25, restaurantDiscountPct: 15, bookingWindowDays: 30, priorityBooking: true, autoQualifyRules: { minHours90d: 100 } },
  ];
  for (const t of tiers) {
    if (await db.membershipTier.findFirst({ where: { organizationId, code: t.code } })) continue;
    await db.membershipTier.create({ data: { organizationId, ...(t as any) } });
  }
  const ahmed = await db.customer.findFirst({ where: { organizationId, username: "ahmed" } });
  if (!ahmed) return;
  const wallet = (await db.wallet.findFirst({ where: { customerId: ahmed.id, currency: "AED" } })) ?? (await db.wallet.create({ data: { organizationId, customerId: ahmed.id, currency: "AED" } }));
  const credits: Array<[string, "CASH" | "BONUS", "TOPUP" | "BONUS_GRANT", number]> = [["seed:ahmed:cash", "CASH", "TOPUP", 150], ["seed:ahmed:bonus", "BONUS", "BONUS_GRANT", 20]];
  for (const [key, bucket, type, amount] of credits) {
    if (await db.walletTransaction.findFirst({ where: { organizationId, idempotencyKey: key } })) continue;
    const w = await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const col = bucket === "CASH" ? "cashBalance" : "bonusBalance";
    const after = Number(w[col]) + amount;
    await db.wallet.update({ where: { id: w.id }, data: { [col]: after, version: { increment: 1 } } });
    await db.walletTransaction.create({ data: { organizationId, walletId: w.id, type, bucket, amount, balanceAfter: after, currency: "AED", reason: "Demo credit", idempotencyKey: key, ...(bucket === "BONUS" ? { expiresAt: new Date(Date.now() + 90 * 86_400_000) } : {}) } });
  }
}

/** Demo tenant: enable most of the catalog, feature a few, and add pointer presets. */
async function seedGamesForOrg(db: PlatformClient, organizationId: string) {
  const featured = new Set(["counter-strike-2", "valorant", "fortnite", "ea-sports-fc-25"]);
  const games = await db.game.findMany({ where: { organizationId: null }, select: { id: true, slug: true } });
  for (const [i, g] of games.entries()) {
    if (await db.orgGameSetting.findFirst({ where: { organizationId, gameId: g.id } })) continue;
    await db.orgGameSetting.create({ data: { organizationId, gameId: g.id, isEnabled: true, isFeatured: featured.has(g.slug), sortOrder: featured.has(g.slug) ? 0 : 10 + i, allowedZoneIds: [] } });
  }
  const presets: Array<{ name: string; settings: Record<string, unknown>; isDefault?: boolean }> = [
    { name: "Windows default", settings: { mouseSpeed: 10, enhancePointerPrecision: true }, isDefault: true },
    { name: "FPS — low sensitivity, raw", settings: { mouseSpeed: 6, enhancePointerPrecision: false } },
    { name: "MOBA — fast", settings: { mouseSpeed: 14, enhancePointerPrecision: true } },
  ];
  for (const p of presets) {
    if (await db.peripheralProfile.findFirst({ where: { organizationId, name: p.name } })) continue;
    await db.peripheralProfile.create({ data: { organizationId, category: "MOUSE", name: p.name, settings: p.settings as object, isDefault: !!p.isDefault } });
  }
}

interface DemoOrg {
  slug: string;
  name: string;
  plan: string;
  branches: Array<{ code: string; name: string; zones: Array<[string, string]> }>;
  staff: Array<{ email: string; name: string; code: string; role: string; branch?: string }>;
  /** Paid add-ons on top of the plan (organization feature overrides). */
  addOns?: FeatureKey[];
}

async function seedOrg(db: PlatformClient, spec: DemoOrg) {
  const passwordHash = await hashSecret(DEMO_PASSWORD);
  const org =
    (await db.organization.findUnique({ where: { slug: spec.slug } })) ??
    (await db.organization.create({
      data: { slug: spec.slug, legalName: `${spec.name} LLC`, displayName: spec.name, status: "ACTIVE", countryCode: "AE", defaultCurrency: "AED", defaultTimezone: "Asia/Dubai", billingEmail: `billing@${spec.slug}.test` },
    }));
  const organizationId = org.id;

  const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { code: spec.plan } });
  for (const featureKey of spec.addOns ?? []) {
    await db.organizationFeature.upsert({ where: { organizationId_featureKey: { organizationId, featureKey } }, create: { organizationId, featureKey, enabled: true, reason: "Demo add-on" }, update: { enabled: true } });
  }
  if (!(await db.subscription.findFirst({ where: { organizationId } }))) {
    const now = new Date();
    await db.subscription.create({ data: { organizationId, planId: plan.id, status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } });
  }

  const brand = (await db.brand.findFirst({ where: { organizationId } })) ?? (await db.brand.create({ data: { organizationId, name: spec.name } }));
  const tax =
    (await db.taxProfile.findFirst({ where: { organizationId } })) ??
    (await db.taxProfile.create({ data: { organizationId, name: "UAE VAT 5%", countryCode: "AE", pricesIncludeTax: true, taxRates: { create: { name: "VAT", ratePercent: 5 } } } }));

  const branchIds: Record<string, string> = {};
  for (const b of spec.branches) {
    const branch =
      (await db.branch.findFirst({ where: { organizationId, code: b.code } })) ??
      (await db.branch.create({
        data: { organizationId, brandId: brand.id, code: b.code, name: b.name, status: "OPEN", countryCode: "AE", currency: "AED", timezone: "Asia/Dubai", taxProfileId: tax.id, openingHours: {} },
      }));
    branchIds[b.code] = branch.id;
    for (const [i, [name, type]] of b.zones.entries()) {
      if (!(await db.zone.findFirst({ where: { branchId: branch.id, name } }))) {
        await db.zone.create({ data: { organizationId, branchId: branch.id, name, type: type as any, sortOrder: i } });
      }
    }
  }

  for (const s of spec.staff) {
    const user =
      (await db.user.findUnique({ where: { email: s.email } })) ??
      (await db.user.create({ data: { email: s.email, displayName: s.name, passwordHash, emailVerified: true } }));
    let emp = await db.employee.findFirst({ where: { organizationId, userId: user.id } });
    if (!emp) {
      emp = await db.employee.create({
        data: { organizationId, userId: user.id, employeeCode: s.code, displayName: s.name, status: "ACTIVE", homeBranchId: s.branch ? branchIds[s.branch]! : null, hiredAt: new Date() },
      });
      const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key: s.role } });
      await db.employeeRoleAssignment.create({
        data: { organizationId, employeeId: emp.id, roleId: role.id, scope: s.branch ? "BRANCH" : "ORGANIZATION", branchId: s.branch ? branchIds[s.branch]! : null },
      });
    }
  }
  await seedPricingAndCustomers(db, organizationId, branchIds);
  await seedGamesForOrg(db, organizationId);
  await seedMembershipAndWallet(db, organizationId);
  await seedRestaurant(db, organizationId, branchIds);
  await seedInventory(db, organizationId, branchIds);
  await seedStationsAndPrinting(db, organizationId, branchIds);
  await seedEngagement(db, organizationId, branchIds);
  console.log(`org ${spec.slug}: ${spec.branches.length} branches, ${spec.staff.length} staff`);
}

/** Demo rate cards (the brief's own prices) and two customers. Idempotent. */
async function seedPricingAndCustomers(db: PlatformClient, organizationId: string, branchIds: Record<string, string>) {
  const vipZone = branchIds["DXB1"] ? await db.zone.findFirst({ where: { branchId: branchIds["DXB1"], type: "PC_VIP" }, select: { id: true } }) : null;
  const plans: Array<{ name: string; data: Record<string, unknown>; packages?: Array<[string, number, number, number]> }> = [
    { name: "Regular PC", data: { stationClass: "PC", billingMode: "PER_HOUR", rate: "15" }, packages: [["1 hour", 60, 15, 0], ["3 hours", 180, 40, 0], ["5 hours", 300, 60, 0]] },
    { name: "Happy hour", data: { stationClass: "PC", billingMode: "PER_HOUR", rate: "10", priority: 10, schedule: [{ days: ["mon", "tue", "wed", "thu"], from: "14:00", to: "18:00" }] } },
    { name: "Night pass", data: { stationClass: "PC", billingMode: "NIGHT_PASS", rate: "60", passStartTime: "00:00", passEndTime: "06:00" } },
    { name: "Pay as you go", data: { stationClass: "PC", billingMode: "PER_HOUR", rate: "18", paymentTiming: "POSTPAID", roundingMinutes: 15, graceMinutes: 3, priority: -10 } },
    { name: "PS5 / Xbox", data: { stationClass: "CONSOLE", billingMode: "PER_HOUR", rate: "20" }, packages: [["2 hours", 120, 40, 0]] },
    { name: "VR experience", data: { stationClass: "VR", billingMode: "PER_MINUTE", rate: "1.5", minMinutes: 15 } },
  ];
  if (vipZone) plans.push({ name: "VIP PC", data: { stationClass: "PC", billingMode: "PER_HOUR", rate: "25", zoneId: vipZone.id, branchId: branchIds["DXB1"] }, packages: [["1 hour", 60, 25, 0], ["3 hours", 180, 70, 0]] });

  for (const p of plans) {
    if (await db.pricingPlan.findFirst({ where: { organizationId, name: p.name } })) continue;
    const plan = await db.pricingPlan.create({ data: { organizationId, name: p.name, currency: "AED", ...(p.data as any) } });
    for (const [i, [name, minutes, price, bonus]] of (p.packages ?? []).entries()) {
      await db.pricingPackage.create({ data: { organizationId, pricingPlanId: plan.id, name, durationMinutes: minutes, price, bonusMinutes: bonus, sortOrder: i } });
    }
  }

  const customers: Array<{ username: string; displayName: string; password: string; pin?: string; minutes: number; dob: string }> = [
    { username: "ahmed", displayName: "Ahmed", password: "ahmed123", pin: "1234", minutes: 120, dob: "1998-04-12" },
    { username: "sara", displayName: "Sara", password: "sara1234", minutes: 0, dob: "2013-02-20" }, // 13: PEGI 16/18 games are hidden for her
  ];
  for (const c of customers) {
    let row = await db.customer.findFirst({ where: { organizationId, username: c.username } });
    if (!row) {
      row = await db.customer.create({
        data: { organizationId, username: c.username, displayName: c.displayName, passwordHash: await hashSecret(c.password), pinHash: c.pin ? await hashSecret(c.pin) : null },
      });
    }
    if (!row.dateOfBirth) await db.customer.update({ where: { id: row.id }, data: { dateOfBirth: new Date(c.dob) } });
    if (c.minutes > 0 && !(await db.walletTransaction.findFirst({ where: { organizationId, idempotencyKey: `seed:${c.username}:time` } }))) {
      const wallet = (await db.wallet.findFirst({ where: { customerId: row.id, currency: "AED" } })) ?? (await db.wallet.create({ data: { organizationId, customerId: row.id, currency: "AED" } }));
      const after = wallet.timeBalanceMin + c.minutes;
      await db.wallet.update({ where: { id: wallet.id }, data: { timeBalanceMin: after, version: { increment: 1 } } });
      await db.walletTransaction.create({ data: { organizationId, walletId: wallet.id, type: "TOPUP", bucket: "TIME", amount: c.minutes, balanceAfter: after, currency: "AED", reason: "Demo balance", idempotencyKey: `seed:${c.username}:time` } });
    }
  }
}

export const SUPER_ADMIN_EMAIL = "super@arenaos.test";

/** Platform Super Admin: a User with a PlatformRoleAssignment and no org membership. Idempotent. */
async function seedSuperAdmin(db: PlatformClient, email = SUPER_ADMIN_EMAIL, password = DEMO_PASSWORD) {
  const user =
    (await db.user.findUnique({ where: { email } })) ??
    (await db.user.create({ data: { email, displayName: "Super Admin", passwordHash: await hashSecret(password), emailVerified: true } }));
  await db.platformRoleAssignment.upsert({
    where: { userId_role: { userId: user.id, role: "SUPER_ADMIN" } },
    update: {},
    create: { userId: user.id, role: "SUPER_ADMIN" },
  });
  console.log(`platform: super admin ${email}`);
}

/** Production: reference data + one Super Admin from env. No demo tenants or known passwords. */
async function seedProduction(url: string) {
  const email = process.env["SUPER_ADMIN_EMAIL"];
  const password = process.env["SUPER_ADMIN_PASSWORD"];
  if (!email || !password || password.length < 12) throw new Error("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (12+ chars) to seed production");
  const db = createPlatformClient(url);
  try {
    await seedPlatform(db);
    await seedSuperAdmin(db, email, password);
  } finally {
    await db.$disconnect();
  }
}

export async function seed(url = process.env["DATABASE_URL"]) {
  if (!url) throw new Error("DATABASE_URL (migration/platform role) is required");
  const db = createPlatformClient(url);
  try {
    await seedPlatform(db);
    await seedSuperAdmin(db);
    await seedOrg(db, {
      slug: "demo",
      name: "Demo Arena",
      plan: "PRO",
      branches: [
        { code: "DXB1", name: "Dubai Marina", zones: [["Regular PCs", "PC_STANDARD"], ["VIP", "PC_VIP"], ["PS5 Lounge", "CONSOLE"], ["VR Zone", "VR"], ["Restaurant", "RESTAURANT"], ["Racing Sims", "SIMULATOR"]] },
        { code: "AUH1", name: "Abu Dhabi Yas", zones: [["Regular PCs", "PC_STANDARD"], ["Bootcamp", "BOOTCAMP"]] },
      ],
      staff: [
        { email: "owner@demo.test", name: "Olivia Owner", code: "E001", role: "org_owner" },
        { email: "manager@demo.test", name: "Mo Manager", code: "E002", role: "branch_manager", branch: "DXB1" },
        { email: "cashier@demo.test", name: "Cara Cashier", code: "E003", role: "cashier", branch: "DXB1" },
        { email: "tech@demo.test", name: "Tariq Tech", code: "E004", role: "technician", branch: "DXB1" },
        { email: "waiter@demo.test", name: "Wafa Waiter", code: "E005", role: "waiter", branch: "DXB1" },
        { email: "kitchen@demo.test", name: "Karim Kitchen", code: "E006", role: "kitchen_staff", branch: "DXB1" },
        { email: "inventory@demo.test", name: "Ines Inventory", code: "E007", role: "inventory_manager" },
        { email: "accountant@demo.test", name: "Adam Accountant", code: "E008", role: "accountant" },
      ],
      addOns: ["ACCOUNTING"],
    });
    await seedOrg(db, {
      slug: "rival",
      name: "Rival Gaming",
      plan: "STARTER",
      branches: [{ code: "SHJ1", name: "Sharjah City", zones: [["Main floor", "PC_STANDARD"]] }],
      staff: [{ email: "owner@rival.test", name: "Rashid Rival", code: "R001", role: "org_owner" }],
    });
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts") && process.env["NODE_ENV"] === "production") {
  await seedProduction(process.env["DATABASE_URL"]!);
} else if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts")) {
  await seed();
  console.log(`\nDemo logins (password: ${DEMO_PASSWORD}): owner@demo.test · manager@demo.test · cashier@demo.test · tech@demo.test · waiter@demo.test · kitchen@demo.test · inventory@demo.test · accountant@demo.test · owner@rival.test`);
  console.log(`Super Admin (platform role, password: ${DEMO_PASSWORD}): ${SUPER_ADMIN_EMAIL}`);
  console.log("Demo customers (Gaming Shell & app): ahmed / ahmed123 (PIN 1234, 2h prepaid, AED 150 + 20 bonus in wallet) · sara / sara1234 (no time, age 13)");
}
