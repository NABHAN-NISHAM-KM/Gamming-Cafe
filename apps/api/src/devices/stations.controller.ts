import { Body, ConflictException, Controller, Delete, Get, HttpCode, HttpException, Inject, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@arena/db";
import { AuditService } from "../common/audit.service.js";
import { RequirePermission } from "../common/decorators.js";
import { orgId, principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DEVICE_FIELDS, DeviceRuntimeService } from "./device-runtime.service.js";
import { maxDevices } from "./enrollment.js";
import { LiveBus } from "./live.js";
import { PowerPlug, StationControlService } from "./station-control.service.js";

const KINDS = ["CONSOLE", "VR_HEADSET", "SIMULATOR", "SMART_TV"] as const;
const PLATFORMS = ["PS5", "PS4", "XBOX_SERIES", "XBOX_ONE", "SWITCH", "META_QUEST", "PICO", "VALVE_INDEX", "HTC_VIVE", "RACING_RIG", "FLIGHT_SIM", "MOTION_SIM", "OTHER"] as const;
const ACCESSORY_TYPES = ["CONTROLLER", "HEADSET", "VR_CONTROLLER", "STEERING_WHEEL", "PEDALS", "SHIFTER", "JOYSTICK", "KEYBOARD", "MOUSE", "WEBCAM", "MICROPHONE", "OTHER"] as const;
const ACCESSORY_STATUS = ["OK", "NEEDS_CHARGE", "NEEDS_CLEANING", "FAULTY", "MISSING", "RETIRED"] as const;

const StationFields = z.object({
  name: z.string().regex(/^[A-Za-z0-9 _-]{1,24}$/),
  zoneId: z.uuid(),
  platform: z.enum(PLATFORMS),
  controllerCount: z.number().int().min(0).max(16).nullable(),
  cleaningRequired: z.boolean(),
  minAge: z.number().int().min(3).max(21).nullable(),
  linkedDisplayId: z.uuid().nullable(),
  powerPlug: PowerPlug.nullable(),
  mapX: z.number().int().min(0).max(199),
  mapY: z.number().int().min(0).max(199),
  notes: z.string().max(500).nullable(),
});
const NewStation = StationFields.partial().extend({ name: StationFields.shape.name, zoneId: z.uuid(), kind: z.enum(KINDS), platform: z.enum(PLATFORMS).default("OTHER") }).strict();
const EditStation = StationFields.partial().strict();
const Accessory = z
  .object({ type: z.enum(ACCESSORY_TYPES), label: z.string().max(40).nullish(), vendor: z.string().max(40).nullish(), model: z.string().max(60).nullish(), serialNumber: z.string().max(60).nullish(), inventoryItemId: z.uuid().nullish(), status: z.enum(ACCESSORY_STATUS).optional() })
  .strict();
const Check = z.object({ items: z.array(z.object({ accessoryId: z.uuid(), status: z.enum(ACCESSORY_STATUS) }).strict()).min(1).max(40), note: z.string().max(200).nullish() }).strict();
const Power = z.object({ on: z.boolean() }).strict();
const Bridge = z.object({ enabled: z.boolean() }).strict();

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** 8 characters, no look-alikes (0/O, 1/I/L): easy to type on a TV remote, ~40 bits. */
const PAIR_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const newPairCode = () => Array.from(randomBytes(8), (b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join("");
export const hashPairCode = (code: string) => sha(`pair:${code.toUpperCase().replace(/[^0-9A-Z]/g, "")}`);
export const hashDisplayToken = (token: string) => sha(`display:${token}`);

const me = () => ({ type: "EMPLOYEE" as const, id: principal().employeeId });

/**
 * Stations without an ArenaOS agent — consoles, VR headsets, sim rigs — and
 * the TVs that show their countdown; their accessories, cleaning between
 * players, smart-plug power through the branch bridge, and display pairing.
 */
@Controller()
export class StationsController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
    @Inject(StationControlService) private readonly control: StationControlService,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  private async publish(deviceId: string) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: DEVICE_FIELDS });
    this.bus.publish(orgId(), d.branchId, { type: "device", device: this.runtime.view(d) });
    return d;
  }

  private async checkLinks(branchId: string, b: { zoneId?: string; linkedDisplayId?: string | null }) {
    if (b.zoneId && !(await tx().zone.findFirst({ where: { id: b.zoneId, branchId }, select: { id: true } }))) throw new NotFoundException({ error: "zone_not_found" });
    if (b.linkedDisplayId && !(await tx().device.findFirst({ where: { id: b.linkedDisplayId, branchId, kind: "SMART_TV" }, select: { id: true } }))) throw new NotFoundException({ error: "display_not_found" });
  }

  @RequirePermission("station.view")
  @Get("branches/:branchId/stations")
  async list(@Param("branchId") branchId: string) {
    const rows = await tx().device.findMany({
      where: { branchId, isEnabled: true, OR: [{ agentless: true }, { isBridge: true }] },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: {
        ...DEVICE_FIELDS, powerPlug: true, displayPairExpiresAt: true, displayTokenHash: true, zone: { select: { name: true, type: true } },
        deviceAccessories: { where: { status: { not: "RETIRED" } }, orderBy: [{ type: "asc" }, { label: "asc" }], select: { id: true, type: true, label: true, vendor: true, model: true, serialNumber: true, status: true } },
        displayFor: { select: { id: true, name: true } },
      },
    });
    const bridges = await tx().device.findMany({ where: { branchId, isEnabled: true, agentless: false, kind: { in: ["GAMING_PC", "INTERNET_PC", "KIOSK", "POS_TERMINAL"] } }, select: { id: true, name: true, isBridge: true }, orderBy: { name: "asc" } });
    return {
      stations: rows.map(({ displayTokenHash, ...d }) => ({ ...this.runtime.view(d), paired: !!displayTokenHash })),
      bridgeCandidates: bridges,
    };
  }

  @RequirePermission("station.manage")
  @Post("branches/:branchId/stations")
  async create(@Param("branchId") branchId: string, @Body(new ZodPipe(NewStation)) body: z.infer<typeof NewStation>) {
    await this.checkLinks(branchId, body);
    const limit = await maxDevices(tx());
    if (limit !== null && (await tx().device.count({ where: { isEnabled: true } })) >= limit) throw new HttpException({ error: "plan_limit_reached", limit: "MAX_DEVICES", max: limit }, 402);
    if (await tx().device.findFirst({ where: { branchId, name: body.name }, select: { id: true } })) throw new ConflictException({ error: "device_name_taken", name: body.name });
    const d = await tx().device.create({
      data: {
        organizationId: orgId(), branchId, zoneId: body.zoneId, name: body.name, kind: body.kind, platform: body.platform, agentless: true, status: "AVAILABLE", isOnline: true,
        controllerCount: body.controllerCount ?? (body.kind === "CONSOLE" ? 2 : null), cleaningRequired: body.cleaningRequired ?? body.kind === "VR_HEADSET",
        minAge: body.minAge ?? null, linkedDisplayId: body.linkedDisplayId ?? null, powerPlug: body.powerPlug ?? undefined, mapX: body.mapX ?? 0, mapY: body.mapY ?? 0, notes: body.notes ?? null,
      },
      select: { id: true },
    });
    await this.audit.record({ action: "station.create", entityType: "Device", entityId: d.id, branchId, after: body });
    return this.runtime.view(await this.publish(d.id));
  }

  @RequirePermission("station.manage")
  @Patch("devices/:deviceId/station")
  async edit(@Param("deviceId") deviceId: string, @Body(new ZodPipe(EditStation)) body: z.infer<typeof EditStation>) {
    const before = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { ...DEVICE_FIELDS, powerPlug: true } });
    await this.checkLinks(before.branchId, body);
    if (body.linkedDisplayId === deviceId) throw new ConflictException({ error: "display_is_itself" });
    if (body.name && body.name !== before.name && (await tx().device.findFirst({ where: { branchId: before.branchId, name: body.name }, select: { id: true } }))) throw new ConflictException({ error: "device_name_taken", name: body.name });
    const { powerPlug, ...rest } = body;
    await tx().device.update({ where: { id: deviceId }, data: { ...rest, ...(powerPlug !== undefined ? { powerPlug: powerPlug ?? Prisma.DbNull } : {}) } });
    await this.audit.record({ action: "station.update", entityType: "Device", entityId: deviceId, branchId: before.branchId, before, after: body });
    return this.runtime.view(await this.publish(deviceId));
  }

  /** The station agent that relays LAN actions (smart plugs, Wake-on-LAN) for the branch. One per branch. */
  @RequirePermission("station.manage")
  @Post("devices/:deviceId/bridge")
  @HttpCode(200)
  async bridge(@Param("deviceId") deviceId: string, @Body(new ZodPipe(Bridge)) body: z.infer<typeof Bridge>) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { id: true, branchId: true, agentless: true, name: true } });
    if (d.agentless) throw new ConflictException({ error: "bridge_needs_agent", hint: "Pick a PC that runs the ArenaOS agent." });
    if (body.enabled) await tx().device.updateMany({ where: { branchId: d.branchId, isBridge: true, id: { not: d.id } }, data: { isBridge: false } });
    await tx().device.update({ where: { id: deviceId }, data: { isBridge: body.enabled } });
    await this.audit.record({ action: body.enabled ? "station.bridge.set" : "station.bridge.unset", entityType: "Device", entityId: deviceId, branchId: d.branchId });
    return { bridge: body.enabled ? d.name : null };
  }

  @RequirePermission("station.shutdown")
  @Post("devices/:deviceId/power")
  @HttpCode(200)
  async power(@Param("deviceId") deviceId: string, @Body(new ZodPipe(Power)) body: z.infer<typeof Power>) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { branchId: true, name: true } });
    const r = await this.control.power(tx(), deviceId, body.on, me(), { strict: true });
    await this.audit.record({ action: `station.power.${body.on ? "on" : "off"}`, entityType: "Device", entityId: deviceId, branchId: d.branchId, after: r });
    return r;
  }

  /** VR headsets & shared gear: wiped down between players before the next session. */
  @RequirePermission("station.start_session")
  @Post("devices/:deviceId/cleaned")
  @HttpCode(200)
  async cleaned(@Param("deviceId") deviceId: string) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { status: true, branchId: true } });
    if (d.status !== "CLEANING") throw new ConflictException({ error: "not_cleaning", status: d.status });
    await tx().device.update({ where: { id: deviceId }, data: { status: "AVAILABLE" } });
    const wiped = await tx().deviceAccessory.updateMany({ where: { deviceId, status: "NEEDS_CLEANING" }, data: { status: "OK" } });
    await this.audit.record({ action: "station.cleaned", entityType: "Device", entityId: deviceId, branchId: d.branchId, after: { accessories: wiped.count } });
    return this.runtime.view(await this.publish(deviceId));
  }

  // ── accessories ──────────────────────────────────────────────────────────

  @RequirePermission("station.view")
  @Get("devices/:deviceId/accessories")
  accessories(@Param("deviceId") deviceId: string) {
    return tx().deviceAccessory.findMany({ where: { deviceId, status: { not: "RETIRED" } }, orderBy: [{ type: "asc" }, { label: "asc" }] });
  }

  @RequirePermission("station.manage")
  @Post("devices/:deviceId/accessories")
  async addAccessory(@Param("deviceId") deviceId: string, @Body(new ZodPipe(Accessory)) body: z.infer<typeof Accessory>) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { branchId: true } });
    if (body.inventoryItemId && !(await tx().inventoryItem.findUnique({ where: { id: body.inventoryItemId }, select: { id: true } }))) throw new NotFoundException({ error: "item_not_found" });
    const a = await tx().deviceAccessory.create({ data: { ...body, organizationId: orgId(), deviceId } });
    await this.audit.record({ action: "station.accessory.add", entityType: "Device", entityId: deviceId, branchId: d.branchId, after: body });
    return a;
  }

  @RequirePermission("station.manage")
  @Patch("devices/:deviceId/accessories/:accessoryId")
  async editAccessory(@Param("deviceId") deviceId: string, @Param("accessoryId") accessoryId: string, @Body(new ZodPipe(Accessory.partial())) body: Partial<z.infer<typeof Accessory>>) {
    const a = await tx().deviceAccessory.findFirst({ where: { id: accessoryId, deviceId } });
    if (!a) throw new NotFoundException({ error: "accessory_not_found" });
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { branchId: true } });
    const after = await tx().deviceAccessory.update({ where: { id: accessoryId }, data: body });
    await this.audit.record({ action: "station.accessory.update", entityType: "Device", entityId: deviceId, branchId: d.branchId, before: a, after: body });
    return after;
  }

  /**
   * After a session: were all the controllers handed back, and in what state?
   * Anything missing or broken raises an alert on the floor until it's sorted.
   */
  @RequirePermission("station.start_session")
  @Post("devices/:deviceId/accessory-check")
  @HttpCode(200)
  async check(@Param("deviceId") deviceId: string, @Body(new ZodPipe(Check)) body: z.infer<typeof Check>) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { id: true, name: true, branchId: true, organizationId: true } });
    const mine = await tx().deviceAccessory.findMany({ where: { deviceId, id: { in: body.items.map((i) => i.accessoryId) } }, select: { id: true, type: true, label: true, status: true } });
    if (mine.length !== new Set(body.items.map((i) => i.accessoryId)).size) throw new NotFoundException({ error: "accessory_not_found" });
    for (const i of body.items) await tx().deviceAccessory.update({ where: { id: i.accessoryId }, data: { status: i.status } });
    const problems = body.items
      .filter((i) => i.status === "MISSING" || i.status === "FAULTY")
      .map((i) => {
        const a = mine.find((m) => m.id === i.accessoryId)!;
        return { accessoryId: a.id, name: a.label ?? a.type.toLowerCase().replace("_", " "), status: i.status };
      });
    const c = { deviceId: d.id, organizationId: d.organizationId, branchId: d.branchId };
    if (problems.length) {
      await this.runtime.openAlert(tx(), c, "ACCESSORY_ISSUE", problems.some((p) => p.status === "MISSING") ? "CRITICAL" : "WARNING", `${d.name}: ${problems.map((p) => `${p.name} ${p.status.toLowerCase()}`).join(", ")}`, { problems, note: body.note ?? null });
    } else {
      const open = await tx().deviceAccessory.count({ where: { deviceId, status: { in: ["MISSING", "FAULTY"] } } });
      if (!open) await this.runtime.resolveAlert(tx(), "ACCESSORY_ISSUE", deviceId);
    }
    await this.audit.record({ action: "station.accessory_check", entityType: "Device", entityId: deviceId, branchId: d.branchId, after: body });
    return { problems };
  }

  // ── TV station displays ──────────────────────────────────────────────────

  /** A one-time code (valid 10 minutes) typed on the TV to pair it. Pairing again replaces the old pairing. */
  @RequirePermission("station.manage")
  @Post("devices/:deviceId/display-pairing")
  async pair(@Param("deviceId") deviceId: string) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { kind: true, branchId: true, name: true } });
    if (d.kind !== "SMART_TV") throw new ConflictException({ error: "not_a_display" });
    const code = newPairCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await tx().device.update({ where: { id: deviceId }, data: { displayPairCodeHash: hashPairCode(code), displayPairExpiresAt: expiresAt } });
    await this.audit.record({ action: "station.display.pairing", entityType: "Device", entityId: deviceId, branchId: d.branchId });
    return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt, url: "/display.html" };
  }

  @RequirePermission("station.manage")
  @Delete("devices/:deviceId/display-pairing")
  @HttpCode(204)
  async unpair(@Param("deviceId") deviceId: string) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { branchId: true } });
    await tx().device.update({ where: { id: deviceId }, data: { displayTokenHash: null, displayPairCodeHash: null, displayPairExpiresAt: null } });
    await this.audit.record({ action: "station.display.unpair", entityType: "Device", entityId: deviceId, branchId: d.branchId });
  }
}
