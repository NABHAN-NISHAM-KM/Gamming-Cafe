// Seeds platform reference data + two demo tenants. Idempotent.
//   npm run seed -w @arena/api
// Runs as the migration/platform role (DATABASE_URL), which bypasses RLS.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPlatformClient, type PlatformClient } from "@arena/db";
import { FEATURES, type FeatureKey } from "@arena/contracts";
import { PERMISSIONS, ROLE_TEMPLATES, templatePermissions } from "@arena/rbac";
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

export async function seed(url = process.env["DATABASE_URL"]) {
  if (!url) throw new Error("DATABASE_URL (migration/platform role) is required");
  const db = createPlatformClient(url);
  try {
    await seedPlatform(db);
    await seedOrg(db, {
      slug: "demo",
      name: "Demo Arena",
      plan: "PRO",
      branches: [
        { code: "DXB1", name: "Dubai Marina", zones: [["Regular PCs", "PC_STANDARD"], ["VIP", "PC_VIP"], ["PS5 Lounge", "CONSOLE"], ["VR Zone", "VR"], ["Restaurant", "RESTAURANT"]] },
        { code: "AUH1", name: "Abu Dhabi Yas", zones: [["Regular PCs", "PC_STANDARD"], ["Bootcamp", "BOOTCAMP"]] },
      ],
      staff: [
        { email: "owner@demo.test", name: "Olivia Owner", code: "E001", role: "org_owner" },
        { email: "manager@demo.test", name: "Mo Manager", code: "E002", role: "branch_manager", branch: "DXB1" },
        { email: "cashier@demo.test", name: "Cara Cashier", code: "E003", role: "cashier", branch: "DXB1" },
        { email: "tech@demo.test", name: "Tariq Tech", code: "E004", role: "technician", branch: "DXB1" },
      ],
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

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts")) {
  await seed();
  console.log(`\nDemo logins (password: ${DEMO_PASSWORD}): owner@demo.test · manager@demo.test · cashier@demo.test · tech@demo.test · owner@rival.test`);
  console.log("Demo customers (Gaming Shell): ahmed / ahmed123 (PIN 1234, 2h prepaid) · sara / sara1234 (no time, age 13)");
}
