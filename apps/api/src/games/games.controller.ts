import { Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, RequirePermission, RequirePermissionAnyScope } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { CommandsService } from "../devices/commands.service.js";
import { DeviceHub } from "../devices/live.js";
import { UPDATING } from "./inventory.service.js";
import { StationConfigService } from "./station-config.service.js";

const CATEGORIES = ["FPS", "MOBA", "SPORTS", "RACING", "BATTLE_ROYALE", "STORY", "MULTIPLAYER", "COMPETITIVE", "KIDS", "VR", "STRATEGY", "RPG", "FIGHTING", "CASUAL", "SIMULATION"] as const;

/** Interpreters and system tools are never launchable from the Shell, whatever the catalog says (the agent enforces this too). */
const DENIED_EXE = /(^|\\)(cmd|powershell|pwsh|powershell_ise|wscript|cscript|mshta|rundll32|regsvr32|reg|regedit|certutil|bitsadmin|wmic|msiexec|schtasks|sc|net|taskmgr|mmc)\.exe$/i;
const exePath = z
  .string()
  .max(260)
  .regex(/^[A-Za-z]:\\[^<>:"|?*]+\.exe$/i, "must be an absolute path to an .exe")
  .refine((p) => !DENIED_EXE.test(p), "this program can't be launched from the Shell");
const processName = z.string().regex(/^[\w .()-]{1,64}\.exe$/i);

const GameBody = z
  .object({
    title: z.string().min(1).max(120),
    slug: z.string().regex(/^[a-z0-9-]{2,80}$/).optional(),
    developer: z.string().max(120).nullish(),
    categories: z.array(z.enum(CATEGORIES)).max(8).default([]),
    launcherKey: z.enum(["STEAM", "EPIC", "RIOT", "BATTLENET", "EA", "UBISOFT"]).nullish(),
    launcherGameId: z.string().regex(/^[\w.-]{1,128}$/).nullish(),
    executablePath: exePath.nullish(),
    arguments: z.string().max(500).nullish(),
    workingDirectory: z.string().max(260).nullish(),
    processNames: z.array(processName).max(10).default([]),
    ageRating: z.string().max(20).nullish(),
    minAge: z.number().int().min(0).max(21).nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();

const SettingsBody = z
  .object({
    isEnabled: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    minAgeOverride: z.number().int().min(0).max(21).nullish(),
    allowedZoneIds: z.array(z.uuid()).max(50).optional(),
    /** Save folders that follow the player between PCs, inside their Windows profile: "%APPDATA%\\Game\\Saves". */
    savePaths: z.array(z.string().max(200).regex(/^%(APPDATA|LOCALAPPDATA|USERPROFILE|DOCUMENTS|SAVEDGAMES)%(\\[^\\/:*?"<>|]+)+$/, "Start with %APPDATA%, %LOCALAPPDATA%, %USERPROFILE%, %DOCUMENTS% or %SAVEDGAMES%, then folder names").refine((p) => !p.split("\\").includes(".."), "No .. in save folders")).max(5).optional(),
  })
  .strict();

const AppBody = z
  .object({
    name: z.string().min(1).max(80),
    kind: z.enum(["BROWSER", "OFFICE", "COMMUNICATION", "MEDIA", "UTILITY", "PERIPHERAL_UTILITY", "PLATFORM_LAUNCHER"]),
    executablePath: exePath,
    arguments: z.string().max(500).nullish(),
    allowedZoneIds: z.array(z.uuid()).max(50).default([]),
    sortOrder: z.number().int().min(0).max(10_000).default(100),
    isActive: z.boolean().default(true),
  })
  .strict();

const PresetBody = z
  .object({
    name: z.string().min(1).max(60),
    settings: z.object({ mouseSpeed: z.number().int().min(1).max(20).optional(), enhancePointerPrecision: z.boolean().optional() }).strict(),
    isDefault: z.boolean().default(false),
  })
  .strict();

const UpdateJobBody = z
  .object({
    gameId: z.uuid(),
    scheduledFor: z.coerce.date().optional(),
    maxConcurrent: z.number().int().min(1).max(50).default(4),
    bandwidthLimitKbps: z.number().int().min(256).max(10_000_000).nullish(),
  })
  .strict();

const TargetsBody = z.object({ targets: z.array(z.object({ name: z.string().min(1).max(40), host: z.string().regex(/^(gateway|[A-Za-z0-9.:-]{1,253})$/) }).strict()).max(8) }).strict();

const DisklessBody = z
  .object({
    provider: z.enum(["CCBOOT", "ISCSI_PXE", "GGROCK", "NATIVE", "OTHER"]),
    name: z.string().min(1).max(80),
    endpoint: z.string().max(255).nullish(),
    config: z.record(z.string(), z.unknown()).default({}),
    isActive: z.boolean().default(true),
  })
  .strict();

const gameSelect = {
  id: true, organizationId: true, slug: true, title: true, developer: true, categories: true, launcherGameId: true, executablePath: true, arguments: true,
  processNames: true, ageRating: true, minAge: true, coverUrl: true, isActive: true, launcher: { select: { key: true, name: true } },
} as const;

async function assertZones(ids: string[] | undefined) {
  if (!ids?.length) return;
  const n = await tx().zone.count({ where: { id: { in: ids } } });
  if (n !== new Set(ids).size) throw new NotFoundException({ error: "zone_not_found" });
}

async function branchScope(branchId: string) {
  const b = await tx().branch.findUnique({ where: { id: branchId }, select: { id: true, brandId: true } });
  if (!b) throw new NotFoundException({ error: "branch_not_found" });
  return { organizationId: orgId(), brandId: b.brandId, branchId: b.id };
}

/**
 * Game library, launchers, Shell apps, pointer presets and update jobs.
 * Catalog rows with organizationId = NULL are the platform's (read-only to
 * tenants); an org enables them via OrgGameSetting or adds its own games.
 */
@Controller()
export class GamesController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StationConfigService) private readonly config: StationConfigService,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
  ) {}

  // ── Library ─────────────────────────────────────────────────────────────

  @RequirePermissionAnyScope("game.view")
  @Get("games")
  async list(@Query("branchId") branchId?: string) {
    const [games, settings] = await Promise.all([
      tx().game.findMany({ select: gameSelect, orderBy: { title: "asc" } }),
      tx().orgGameSetting.findMany(),
    ]);
    const byGame = new Map(settings.map((s) => [s.gameId, s]));
    const installs = branchId && /^[0-9a-f-]{36}$/i.test(branchId)
      ? await tx().gameInstallation.groupBy({ by: ["gameId", "status"], where: { device: { branchId, isEnabled: true } }, _count: { _all: true }, _avg: { progressPct: true } })
      : [];
    const stations = branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? await tx().device.count({ where: { branchId, isEnabled: true, platform: "WINDOWS" } }) : null;
    return {
      stations,
      games: games.map((g) => {
        const s = byGame.get(g.id);
        const counts = installs.filter((i) => i.gameId === g.id);
        const n = (st: readonly string[]) => counts.filter((c) => st.includes(c.status)).reduce((a, c) => a + c._count._all, 0);
        return {
          ...g,
          custom: g.organizationId !== null,
          setting: s ? { isEnabled: s.isEnabled, isFeatured: s.isFeatured, sortOrder: s.sortOrder, minAgeOverride: s.minAgeOverride, allowedZoneIds: s.allowedZoneIds, savePaths: s.savePaths } : null,
          installs: branchId
            ? { installed: n(["INSTALLED", ...UPDATING]), updateRequired: n(UPDATING), updating: n(["UPDATING"]), progressPct: counts.find((c) => c.status === "UPDATING")?._avg.progressPct ?? null }
            : undefined,
        };
      }),
    };
  }

  @AnyStaff()
  @Post("games")
  async create(@Body(new ZodPipe(GameBody)) body: z.infer<typeof GameBody>) {
    authorizeFor("game.manage", { organizationId: orgId() });
    const data = await this.gameData(body);
    const slug = body.slug ?? body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    if (await tx().game.findFirst({ where: { organizationId: orgId(), slug } })) throw new ConflictException({ error: "slug_taken" });
    const game = await tx().game.create({ data: { ...data, slug, organizationId: orgId() }, select: gameSelect });
    await tx().orgGameSetting.create({ data: { organizationId: orgId(), gameId: game.id, isEnabled: true, sortOrder: 100, allowedZoneIds: [] } });
    // PCs whose last scan already saw it are installed now, not at their next scan.
    if (game.launcher && game.launcherGameId && (game.launcher.key === "STEAM" || game.launcher.key === "EPIC")) {
      const seen = await tx().detectedTitle.findMany({ where: { kind: "GAME", source: game.launcher.key, key: { equals: game.launcherGameId, mode: "insensitive" } } });
      if (seen.length) {
        await tx().gameInstallation.createMany({
          data: seen.map((d) => ({ organizationId: orgId(), deviceId: d.deviceId, gameId: game.id, status: !d.updateRequired ? "INSTALLED" : d.updating ? "UPDATING" : "UPDATE_REQUIRED", progressPct: d.progressPct, detectedBy: d.source, buildId: d.version, installPath: d.installPath, sizeBytes: d.sizeBytes, lastCheckedAt: d.lastSeenAt })),
          skipDuplicates: true,
        });
      }
    }
    await this.audit.record({ action: "game.create", entityType: "Game", entityId: game.id, after: game });
    this.config.pushAll(orgId());
    return game;
  }

  @AnyStaff()
  @Patch("games/:gameId")
  async update(@Param("gameId") gameId: string, @Body(new ZodPipe(GameBody.partial())) body: Partial<z.infer<typeof GameBody>>) {
    authorizeFor("game.manage", { organizationId: orgId() });
    const before = await tx().game.findFirst({ where: { id: gameId, organizationId: orgId() }, select: gameSelect });
    if (!before) throw new NotFoundException({ error: "not_found", hint: "Catalog games can't be edited; change their settings instead." });
    const after = await tx().game.update({ where: { id: gameId }, data: await this.gameData(body, before), select: gameSelect });
    await this.audit.record({ action: "game.update", entityType: "Game", entityId: gameId, before, after });
    this.config.pushAll(orgId());
    return after;
  }

  private async gameData(body: Partial<z.infer<typeof GameBody>>, before?: { launcher: { key: string } | null; launcherGameId: string | null; executablePath: string | null }) {
    let launcherId: string | null | undefined;
    if (body.launcherKey !== undefined) {
      launcherId = body.launcherKey ? (await tx().launcher.findFirst({ where: { key: body.launcherKey }, orderBy: { organizationId: { sort: "asc", nulls: "last" } }, select: { id: true } }))?.id ?? null : null;
      if (body.launcherKey && !launcherId) throw new NotFoundException({ error: "launcher_not_found" });
    }
    const key = body.launcherKey !== undefined ? body.launcherKey : before?.launcher?.key;
    const storeId = body.launcherGameId !== undefined ? body.launcherGameId : before?.launcherGameId;
    const exe = body.executablePath !== undefined ? body.executablePath : before?.executablePath;
    const launchable = ((key === "STEAM" || key === "EPIC") && storeId) || exe;
    if (!launchable) throw new ConflictException({ error: "not_launchable", hint: "Give a Steam/Epic store id or an executable path." });
    if (key === "STEAM" && storeId && !/^\d{1,10}$/.test(storeId)) throw new ConflictException({ error: "invalid_steam_appid" });
    const { launcherKey: _k, slug: _s, ...rest } = body;
    return { ...rest, ...(launcherId !== undefined ? { launcherId } : {}) } as any;
  }

  @AnyStaff()
  @Put("games/:gameId/settings")
  async settings(@Param("gameId") gameId: string, @Body(new ZodPipe(SettingsBody)) body: z.infer<typeof SettingsBody>) {
    authorizeFor("game.manage", { organizationId: orgId() });
    if (!(await tx().game.findUnique({ where: { id: gameId }, select: { id: true } }))) throw new NotFoundException({ error: "not_found" });
    await assertZones(body.allowedZoneIds);
    const before = await tx().orgGameSetting.findFirst({ where: { gameId } });
    const after = before
      ? await tx().orgGameSetting.update({ where: { id: before.id }, data: body })
      : await tx().orgGameSetting.create({ data: { organizationId: orgId(), gameId, isEnabled: body.isEnabled ?? true, isFeatured: body.isFeatured ?? false, sortOrder: body.sortOrder ?? 100, minAgeOverride: body.minAgeOverride ?? null, allowedZoneIds: body.allowedZoneIds ?? [], savePaths: body.savePaths ?? [] } });
    await this.audit.record({ action: "game.settings", entityType: "Game", entityId: gameId, before, after });
    this.config.pushAll(orgId());
    return after;
  }

  @RequirePermissionAnyScope("game.view")
  @Get("games/:gameId/installations")
  async installations(@Param("gameId") gameId: string, @Query("branchId") branchId?: string) {
    const rows = await tx().gameInstallation.findMany({
      where: { gameId, ...(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? { device: { branchId } } : {}) },
      include: { device: { select: { id: true, name: true, branchId: true } } },
      orderBy: { device: { name: "asc" } },
    });
    return rows.map((r) => ({ device: r.device, status: r.status, buildId: r.buildId, detectedBy: r.detectedBy, sizeBytes: r.sizeBytes?.toString() ?? null, lastCheckedAt: r.lastCheckedAt, lastPlayedAt: r.lastPlayedAt }));
  }

  /** Everything PCs' scans found (games and installed apps), grouped across PCs, flagged when already in the catalog / Shell. */
  @RequirePermissionAnyScope("game.view")
  @Get("detected-titles")
  async detected(@Query("branchId") branchId?: string) {
    const [rows, games, apps] = await Promise.all([
      tx().detectedTitle.findMany({
        where: { device: { isEnabled: true, ...(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? { branchId } : {}) } },
        include: { device: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      tx().game.findMany({ where: { launcherGameId: { not: null } }, select: { id: true, launcherGameId: true, launcher: { select: { key: true } } } }),
      tx().shellApp.findMany({ select: { id: true, executablePath: true } }),
    ]);
    const gameByStore = new Map(games.map((g) => [`${g.launcher?.key}:${g.launcherGameId!.toLowerCase()}`, g.id]));
    const appByExe = new Map(apps.map((a) => [a.executablePath.toLowerCase(), a.id]));
    const groups = new Map<string, { kind: string; source: string; key: string; name: string; publisher: string | null; executablePath: string | null; versions: string[]; devices: string[]; updateRequired: number; updating: number; progressPct: number | null; sizeBytes: string | null; lastSeenAt: Date; catalogId: string | null }>();
    for (const r of rows) {
      const id = `${r.source}:${r.key.toLowerCase()}`;
      let g = groups.get(id);
      if (!g) {
        const catalogId = r.kind === "GAME" ? gameByStore.get(id) ?? null : r.executablePath ? appByExe.get(r.executablePath.toLowerCase()) ?? null : null;
        g = { kind: r.kind, source: r.source, key: r.key, name: r.name, publisher: r.publisher, executablePath: r.executablePath, versions: [], devices: [], updateRequired: 0, updating: 0, progressPct: null, sizeBytes: r.sizeBytes?.toString() ?? null, lastSeenAt: r.lastSeenAt, catalogId };
        groups.set(id, g);
      }
      g.devices.push(r.device.name);
      if (r.version && !g.versions.includes(r.version)) g.versions.push(r.version);
      if (r.updateRequired) g.updateRequired++;
      if (r.updating) {
        // Average across the PCs downloading it right now.
        g.progressPct = ((g.progressPct ?? 0) * g.updating + (r.progressPct ?? 0)) / (g.updating + 1);
        g.updating++;
      }
      if (r.lastSeenAt > g.lastSeenAt) g.lastSeenAt = r.lastSeenAt;
    }
    return [...groups.values()];
  }

  @RequirePermissionAnyScope("game.view")
  @Get("launchers")
  launchers() {
    return tx().launcher.findMany({ where: { isActive: true }, select: { id: true, key: true, name: true, organizationId: true }, orderBy: { name: "asc" } });
  }

  // ── Shell apps & pointer presets ────────────────────────────────────────

  @RequirePermissionAnyScope("game.view")
  @Get("shell-apps")
  apps() {
    return tx().shellApp.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  @AnyStaff()
  @Post("shell-apps")
  async createApp(@Body(new ZodPipe(AppBody)) body: z.infer<typeof AppBody>) {
    authorizeFor("game.manage", { organizationId: orgId() });
    await assertZones(body.allowedZoneIds);
    const app = await tx().shellApp.create({ data: { ...body, organizationId: orgId() } });
    await this.audit.record({ action: "shell_app.create", entityType: "ShellApp", entityId: app.id, after: app });
    this.config.pushAll(orgId());
    return app;
  }

  @AnyStaff()
  @Patch("shell-apps/:appId")
  async updateApp(@Param("appId") appId: string, @Body(new ZodPipe(AppBody.partial())) body: Partial<z.infer<typeof AppBody>>) {
    authorizeFor("game.manage", { organizationId: orgId() });
    const before = await tx().shellApp.findFirst({ where: { id: appId, organizationId: orgId() } });
    if (!before) throw new NotFoundException({ error: "not_found", hint: "Platform apps can't be edited here." });
    await assertZones(body.allowedZoneIds);
    const after = await tx().shellApp.update({ where: { id: appId }, data: body });
    await this.audit.record({ action: "shell_app.update", entityType: "ShellApp", entityId: appId, before, after });
    this.config.pushAll(orgId());
    return after;
  }

  @RequirePermissionAnyScope("game.view")
  @Get("peripheral-presets")
  presets() {
    return tx().peripheralProfile.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  }

  @AnyStaff()
  @Post("peripheral-presets")
  async createPreset(@Body(new ZodPipe(PresetBody)) body: z.infer<typeof PresetBody>) {
    authorizeFor("shell.configure", { organizationId: orgId() });
    if (body.isDefault) await tx().peripheralProfile.updateMany({ where: { category: "MOUSE", isDefault: true }, data: { isDefault: false } });
    const p = await tx().peripheralProfile.create({ data: { organizationId: orgId(), category: "MOUSE", name: body.name, settings: body.settings, isDefault: body.isDefault } });
    await this.audit.record({ action: "peripheral_preset.create", entityType: "PeripheralProfile", entityId: p.id, after: p });
    this.config.pushAll(orgId());
    return p;
  }

  // ── Updates & scans ─────────────────────────────────────────────────────

  @RequirePermission("game.update")
  @Post("branches/:branchId/game-scan")
  @HttpCode(200)
  async scan(@Param("branchId") branchId: string) {
    const devices = await tx().device.findMany({ where: { branchId, isEnabled: true, platform: "WINDOWS" }, select: { id: true } });
    const online = devices.filter((d) => this.hub.isOnline(d.id));
    for (const d of online) await this.commands.issue(tx(), { deviceId: d.id, type: "SCAN_GAMES", requestedBy: { type: "EMPLOYEE", id: principal().employeeId } });
    await this.audit.record({ action: "game.scan", entityType: "Branch", entityId: branchId, branchId, after: { stations: online.length } });
    return { requested: online.length, offline: devices.length - online.length };
  }

  @RequirePermission("game.view")
  @Get("branches/:branchId/game-updates")
  jobs(@Param("branchId") branchId: string) {
    return tx().gameUpdateJob.findMany({ where: { branchId }, include: { game: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  @RequirePermission("game.update")
  @Post("branches/:branchId/game-updates")
  async schedule(@Param("branchId") branchId: string, @Body(new ZodPipe(UpdateJobBody)) body: z.infer<typeof UpdateJobBody>) {
    const game = await tx().game.findUnique({ where: { id: body.gameId }, select: { id: true, title: true, launcherGameId: true, launcher: { select: { key: true } } } });
    if (!game) throw new NotFoundException({ error: "game_not_found" });
    if (!game.launcherGameId || !["STEAM", "EPIC"].includes(game.launcher?.key ?? "")) throw new ConflictException({ error: "not_launcher_managed", hint: "Only Steam and Epic games can be updated remotely; update the master image for others." });
    if (await tx().gameUpdateJob.findFirst({ where: { branchId, gameId: body.gameId, status: { in: ["SCHEDULED", "RUNNING"] } } })) throw new ConflictException({ error: "already_scheduled" });
    const job = await tx().gameUpdateJob.create({
      data: {
        organizationId: orgId(), branchId, gameId: body.gameId, scheduledFor: body.scheduledFor ?? new Date(), maxConcurrent: body.maxConcurrent,
        bandwidthLimitKbps: body.bandwidthLimitKbps ?? null, createdById: principal().employeeId,
      },
      include: { game: { select: { id: true, title: true } } },
    });
    await this.audit.record({ action: "game.update.schedule", entityType: "GameUpdateJob", entityId: job.id, branchId, after: job });
    return job;
  }

  @AnyStaff()
  @Post("game-updates/:jobId/cancel")
  @HttpCode(200)
  async cancel(@Param("jobId") jobId: string) {
    const job = await tx().gameUpdateJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ error: "not_found" });
    authorizeFor("game.update", await branchScope(job.branchId));
    if (job.status !== "SCHEDULED" && job.status !== "RUNNING") throw new ConflictException({ error: "not_cancellable", status: job.status });
    const after = await tx().gameUpdateJob.update({ where: { id: jobId }, data: { status: "CANCELLED", completedAt: new Date() } });
    await tx().deviceCommand.updateMany({ where: { batchId: jobId, status: "PENDING" }, data: { status: "CANCELLED", completedAt: new Date() } });
    await tx().gameInstallation.updateMany({ where: { gameId: job.gameId, status: "QUEUED", device: { branchId: job.branchId } }, data: { status: "UPDATE_REQUIRED" } });
    await this.audit.record({ action: "game.update.cancel", entityType: "GameUpdateJob", entityId: jobId, branchId: job.branchId, before: job, after });
    return after;
  }

  // ── Station tools view, connectivity targets, diskless ─────────────────

  @RequirePermission("station.view")
  @Get("devices/:deviceId/tools")
  async tools(@Param("deviceId") deviceId: string) {
    const d = await tx().device.findUnique({
      where: { id: deviceId },
      select: {
        id: true, metadata: true,
        gameInstallations: { where: { status: { not: "NOT_INSTALLED" } }, include: { game: { select: { id: true, title: true } } }, orderBy: { game: { title: "asc" } } },
        deviceAccessories: { orderBy: [{ connected: "desc" }, { type: "asc" }] },
        deviceBootInfos: { select: { bootStatus: true, bootServer: true, imageName: true, lastBootAt: true, integration: { select: { name: true, provider: true } } } },
      },
    });
    if (!d) throw new NotFoundException({ error: "not_found" });
    const live = this.hub.live(deviceId);
    return {
      currentGame: live?.currentGame ?? null,
      network: live?.network ?? (d.metadata as { network?: unknown })?.network ?? null,
      boot: d.deviceBootInfos[0] ?? null,
      games: d.gameInstallations.map((i) => ({ gameId: i.game.id, title: i.game.title, status: i.status, detectedBy: i.detectedBy, buildId: i.buildId, lastPlayedAt: i.lastPlayedAt })),
      peripherals: d.deviceAccessories.map((a) => ({ id: a.id, type: a.type, label: a.label, vendor: a.vendor, connected: a.connected, status: a.status, lastSeenAt: a.lastSeenAt, detected: a.hardwareId !== null })),
    };
  }

  @RequirePermission("settings.manage")
  @Put("branches/:branchId/connectivity-targets")
  async setTargets(@Param("branchId") branchId: string, @Body(new ZodPipe(TargetsBody)) body: z.infer<typeof TargetsBody>) {
    const b = await tx().branch.findUniqueOrThrow({ where: { id: branchId }, select: { settings: true } });
    const before = (b.settings as { connectivityTargets?: unknown })?.connectivityTargets ?? null;
    await tx().branch.update({ where: { id: branchId }, data: { settings: { ...((b.settings as object) ?? {}), connectivityTargets: body.targets } } });
    await this.audit.record({ action: "branch.connectivity_targets", entityType: "Branch", entityId: branchId, branchId, before, after: body.targets });
    this.config.pushAll(orgId(), branchId);
    return { targets: body.targets };
  }

  @RequirePermission("diskless.view")
  @Get("branches/:branchId/diskless")
  diskless(@Param("branchId") branchId: string) {
    return tx().disklessIntegration.findMany({ where: { branchId }, select: { id: true, provider: true, name: true, endpoint: true, config: true, isActive: true, lastSyncAt: true, _count: { select: { deviceBootInfos: true } } } });
  }

  @RequirePermission("diskless.manage")
  @Post("branches/:branchId/diskless")
  async addDiskless(@Param("branchId") branchId: string, @Body(new ZodPipe(DisklessBody)) body: z.infer<typeof DisklessBody>) {
    const row = await tx().disklessIntegration.create({ data: { ...body, config: body.config as object, organizationId: orgId(), branchId } });
    await this.audit.record({ action: "diskless.create", entityType: "DisklessIntegration", entityId: row.id, branchId, after: row });
    return row;
  }

  @AnyStaff()
  @Patch("diskless/:integrationId")
  async updateDiskless(@Param("integrationId") id: string, @Body(new ZodPipe(DisklessBody.partial())) body: Partial<z.infer<typeof DisklessBody>>) {
    const before = await tx().disklessIntegration.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: "not_found" });
    authorizeFor("diskless.manage", await branchScope(before.branchId));
    const after = await tx().disklessIntegration.update({ where: { id }, data: { ...body, config: body.config as object | undefined } });
    await this.audit.record({ action: "diskless.update", entityType: "DisklessIntegration", entityId: id, branchId: before.branchId, before, after });
    return after;
  }
}
