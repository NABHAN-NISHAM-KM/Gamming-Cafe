import { Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Sse, type MessageEvent } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { z } from "zod";
import { DEVICE_COMMANDS, REPAIR_ACTIONS, type DeviceCommandType } from "@arena/contracts";
import { AuditService } from "../common/audit.service.js";
import { authorizeFor } from "../common/authz.js";
import { AnyStaff, LongLived, RequirePermission } from "../common/decorators.js";
import { orgId, principal, state, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { COMMAND_PERMISSION, CommandsService } from "./commands.service.js";
import { DEVICE_FIELDS, DeviceRuntimeService } from "./device-runtime.service.js";
import { hashEnrollmentCode, newEnrollmentCode } from "./enrollment.js";
import { DeviceHub, LiveBus, type FloorEvent } from "./live.js";

const NewToken = z
  .object({
    zoneId: z.uuid().nullish(),
    label: z.string().max(80).nullish(),
    maxUses: z.number().int().min(1).max(500).default(1),
    expiresInHours: z.number().int().min(1).max(72).default(24),
  })
  .strict();

const UpdateDevice = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9 _-]{1,24}$/),
    zoneId: z.uuid(),
    mapX: z.number().int().min(0).max(199),
    mapY: z.number().int().min(0).max(199),
    mapRotation: z.number().int().refine((v) => [0, 90, 180, 270].includes(v)),
    postSessionAction: z.enum(["LOCK", "LOGOUT_WINDOWS", "RESTART_SHELL", "RESTART_PC", "SHUTDOWN_PC", "RESTORE_REBOOT"]),
    controllerCount: z.number().int().min(0).max(8).nullable(),
    notes: z.string().max(500).nullable(),
  })
  .partial()
  .strict();

const Layout = z.object({ positions: z.array(z.object({ deviceId: z.uuid(), mapX: z.number().int().min(0).max(199), mapY: z.number().int().min(0).max(199) })).max(500) }).strict();

const REMOTE_TYPES = DEVICE_COMMANDS.filter((t) => COMMAND_PERMISSION[t]) as [DeviceCommandType, ...DeviceCommandType[]];
const Command = z
  .object({
    type: z.enum(REMOTE_TYPES),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const payloadSchemas: Partial<Record<DeviceCommandType, z.ZodType>> = {
  SEND_MESSAGE: z.object({ title: z.string().max(80).default("Message from staff"), message: z.string().min(1).max(500), timeoutSeconds: z.number().int().min(5).max(600).default(30) }).strict(),
  LAUNCH_APP: z.object({ executablePath: z.string().min(3).max(260), arguments: z.string().max(500).optional(), workingDirectory: z.string().max(260).optional() }).strict(),
  CLOSE_GAME: z.object({ processNames: z.array(z.string().regex(/^[\w .-]{1,64}$/)).min(1).max(20) }).strict(),
  RUN_REPAIR: z.object({ action: z.enum(REPAIR_ACTIONS) }).strict(),
};

/** Minimal live-session info shown on floor tiles (who, until when, how paid). */
async function liveSessionSummaries(branchId: string, deviceId?: string) {
  const rows = await tx().gamingSession.findMany({
    where: { branchId, ...(deviceId ? { deviceId } : {}), status: { in: ["PENDING", "ACTIVE", "PAUSED", "ENDING"] } },
    select: { id: true, deviceId: true, status: true, startedAt: true, expiresAt: true, paymentTiming: true, amountDue: true, currency: true, guestLabel: true, rateSnapshot: true, customer: { select: { id: true, displayName: true } } },
  });
  return new Map(
    rows.map((r) => [
      r.deviceId,
      {
        id: r.id, status: r.status, startedAt: r.startedAt, expiresAt: r.expiresAt, paymentTiming: r.paymentTiming, currency: r.currency,
        amountDue: r.amountDue.toFixed((r.rateSnapshot as { minorUnit?: number })?.minorUnit ?? 2),
        customer: r.customer, guestLabel: r.guestLabel, planName: (r.rateSnapshot as { quote?: { planName?: string } })?.quote?.planName ?? null,
      },
    ]),
  );
}

const publicCommand = (c: Record<string, any>) => {
  const { payload, signature, nonce, ...rest } = c;
  const { _signed, ...clean } = (payload ?? {}) as Record<string, unknown>;
  return { ...rest, payload: clean };
};

@Controller()
export class DevicesController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  // ── Enrolment codes ─────────────────────────────────────────────────────

  @RequirePermission("station.manage")
  @Post("branches/:branchId/enrollment-tokens")
  async createToken(@Param("branchId") branchId: string, @Body(new ZodPipe(NewToken)) body: z.infer<typeof NewToken>) {
    if (body.zoneId && !(await tx().zone.findFirst({ where: { id: body.zoneId, branchId }, select: { id: true } }))) throw new NotFoundException({ error: "zone_not_found" });
    const code = newEnrollmentCode();
    const t = await tx().deviceEnrollmentToken.create({
      data: {
        organizationId: orgId(),
        branchId,
        zoneId: body.zoneId ?? null,
        label: body.label ?? null,
        tokenHash: hashEnrollmentCode(code),
        maxUses: body.maxUses,
        expiresAt: new Date(Date.now() + body.expiresInHours * 3_600_000),
        createdById: principal().employeeId,
      },
      select: { id: true, zoneId: true, label: true, maxUses: true, uses: true, expiresAt: true, createdAt: true },
    });
    await this.audit.record({ action: "device.enrollment_token.create", entityType: "DeviceEnrollmentToken", entityId: t.id, branchId, after: t });
    // The code is shown exactly once; only its hash is stored.
    return { ...t, code };
  }

  @RequirePermission("station.manage")
  @Get("branches/:branchId/enrollment-tokens")
  listTokens(@Param("branchId") branchId: string) {
    return tx().deviceEnrollmentToken.findMany({
      where: { branchId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, zoneId: true, label: true, maxUses: true, uses: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  @AnyStaff()
  @Delete("enrollment-tokens/:tokenId")
  @HttpCode(204)
  async revokeToken(@Param("tokenId") tokenId: string) {
    const t = await tx().deviceEnrollmentToken.findUnique({ where: { id: tokenId }, include: { branch: { select: { brandId: true } } } });
    if (!t) throw new NotFoundException({ error: "not_found" });
    authorizeFor("station.manage", { organizationId: orgId(), brandId: t.branch.brandId, branchId: t.branchId });
    await tx().deviceEnrollmentToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: "device.enrollment_token.revoke", entityType: "DeviceEnrollmentToken", entityId: tokenId, branchId: t.branchId });
  }

  // ── Stations ────────────────────────────────────────────────────────────

  @RequirePermission("station.view")
  @Get("branches/:branchId/devices")
  async list(@Param("branchId") branchId: string) {
    const devices = await tx().device.findMany({ where: { branchId }, select: DEVICE_FIELDS, orderBy: [{ zoneId: "asc" }, { name: "asc" }] });
    return devices.map((d) => this.runtime.view(d));
  }

  @RequirePermission("station.view")
  @Get("devices/:deviceId")
  async get(@Param("deviceId") deviceId: string) {
    const d = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: { ...DEVICE_FIELDS, zone: { select: { id: true, name: true, type: true } } } });
    const hardware = await tx().deviceHardware.findFirst({ where: { deviceId, isCurrent: true } });
    const commands = await tx().deviceCommand.findMany({ where: { deviceId }, orderBy: { issuedAt: "desc" }, take: 15 });
    const alerts = await tx().alert.findMany({ where: { deviceId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { openedAt: "desc" } });
    const session = (await liveSessionSummaries(d.branchId, deviceId)).get(deviceId) ?? null;
    return { ...this.runtime.view(d), session, hardware, commands: commands.map(publicCommand), alerts };
  }

  @RequirePermission("station.manage")
  @Patch("devices/:deviceId")
  async update(@Param("deviceId") deviceId: string, @Body(new ZodPipe(UpdateDevice)) body: z.infer<typeof UpdateDevice>) {
    const before = await tx().device.findUniqueOrThrow({ where: { id: deviceId }, select: DEVICE_FIELDS });
    if (body.zoneId && !(await tx().zone.findFirst({ where: { id: body.zoneId, branchId: before.branchId }, select: { id: true } }))) {
      throw new NotFoundException({ error: "zone_not_found" });
    }
    const after = await tx().device.update({ where: { id: deviceId }, data: body, select: DEVICE_FIELDS });
    await this.audit.record({ action: "device.update", entityType: "Device", entityId: deviceId, branchId: after.branchId, before, after });
    this.bus.publish(orgId(), after.branchId, { type: "device", device: this.runtime.view(after) });
    return this.runtime.view(after);
  }

  /** Retire: disable, revoke credentials, disconnect. History is kept. */
  @RequirePermission("station.manage")
  @Delete("devices/:deviceId")
  @HttpCode(204)
  async retire(@Param("deviceId") deviceId: string) {
    const d = await tx().device.update({ where: { id: deviceId }, data: { isEnabled: false, isOnline: false, status: "OFFLINE", macAddress: null }, select: DEVICE_FIELDS });
    await tx().deviceCredential.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "retired" } });
    await this.audit.record({ action: "device.retire", entityType: "Device", entityId: deviceId, branchId: d.branchId });
    state().afterCommit.push(() => this.hub.get(deviceId)?.socket.close(4001, "retired"));
    this.bus.publish(orgId(), d.branchId, { type: "device", device: this.runtime.view({ ...d, removed: true }) });
  }

  @RequirePermission("station.manage")
  @Put("zones/:zoneId/layout")
  async layout(@Param("zoneId") zoneId: string, @Body(new ZodPipe(Layout)) body: z.infer<typeof Layout>) {
    const zone = await tx().zone.findUniqueOrThrow({ where: { id: zoneId }, select: { branchId: true } });
    for (const p of body.positions) {
      await tx().device.updateMany({ where: { id: p.deviceId, zoneId }, data: { mapX: p.mapX, mapY: p.mapY } });
    }
    await this.audit.record({ action: "zone.layout", entityType: "Zone", entityId: zoneId, branchId: zone.branchId, after: body });
    return { updated: body.positions.length };
  }

  // ── Remote commands ─────────────────────────────────────────────────────

  private validatePayload(type: DeviceCommandType, payload: Record<string, unknown>) {
    const schema = payloadSchemas[type];
    if (!schema) return {};
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ConflictException({ error: "invalid_payload", issues: parsed.error.issues.map((i) => i.message) });
    return parsed.data as Record<string, unknown>;
  }

  /** Permission depends on the command type, checked against the station's branch. */
  @AnyStaff()
  @Post("devices/:deviceId/commands")
  async command(@Param("deviceId") deviceId: string, @Body(new ZodPipe(Command)) body: z.infer<typeof Command>) {
    const d = await tx().device.findUnique({ where: { id: deviceId }, select: { id: true, branchId: true, macAddress: true, branch: { select: { brandId: true } } } });
    if (!d) throw new NotFoundException({ error: "not_found" });
    authorizeFor(COMMAND_PERMISSION[body.type]!, { organizationId: orgId(), brandId: d.branch.brandId, branchId: d.branchId });
    const payload = this.validatePayload(body.type, body.payload);

    // Wake-on-LAN can't come from the cloud: an online PC on the same LAN relays the magic packet.
    if (body.type === "WAKE_ON_LAN") {
      if (!d.macAddress) throw new ConflictException({ error: "no_mac_address" });
      const relay = this.hub.all().find((c) => c.branchId === d.branchId && c.deviceId !== d.id);
      if (!relay) throw new ConflictException({ error: "no_relay_online", hint: "Wake-on-LAN needs one other PC in the branch to be online" });
      const cmd = await this.commands.issue(tx(), { deviceId: relay.deviceId, type: "WAKE_ON_LAN", payload: { targetDeviceId: d.id, macAddress: d.macAddress }, requestedBy: { type: "EMPLOYEE", id: principal().employeeId } });
      await this.audit.record({ action: "device.command.WAKE_ON_LAN", entityType: "Device", entityId: d.id, branchId: d.branchId, after: { relay: relay.deviceId, commandId: cmd.id } });
      return { ...cmd, relayedBy: relay.deviceId };
    }

    const cmd = await this.commands.issue(tx(), { deviceId: d.id, type: body.type, payload, requestedBy: { type: "EMPLOYEE", id: principal().employeeId } });
    await this.audit.record({ action: `device.command.${body.type}`, entityType: "Device", entityId: d.id, branchId: d.branchId, after: { commandId: cmd.id, payload } });
    return cmd;
  }

  /** Mass action: e.g. "Restart zone", "Message everyone in VIP". */
  @RequirePermission("station.mass_action")
  @Post("zones/:zoneId/commands")
  async zoneCommand(@Param("zoneId") zoneId: string, @Body(new ZodPipe(Command)) body: z.infer<typeof Command>) {
    if (body.type === "WAKE_ON_LAN") throw new ConflictException({ error: "use_per_device_wake" });
    const zone = await tx().zone.findUniqueOrThrow({ where: { id: zoneId }, select: { branchId: true, branch: { select: { brandId: true } } } });
    authorizeFor(COMMAND_PERMISSION[body.type]!, { organizationId: orgId(), brandId: zone.branch.brandId, branchId: zone.branchId });
    const payload = this.validatePayload(body.type, body.payload);
    const devices = await tx().device.findMany({ where: { zoneId, isEnabled: true }, select: { id: true } });
    const batchId = randomUUID();
    const results = [];
    for (const dev of devices) results.push(await this.commands.issue(tx(), { deviceId: dev.id, type: body.type, payload, requestedBy: { type: "EMPLOYEE", id: principal().employeeId }, batchId }));
    await this.audit.record({ action: `zone.command.${body.type}`, entityType: "Zone", entityId: zoneId, branchId: zone.branchId, after: { batchId, count: devices.length, payload } });
    return { batchId, count: results.length, online: results.filter((r) => r.online).length };
  }

  @RequirePermission("station.view")
  @Get("devices/:deviceId/commands")
  async commandsFor(@Param("deviceId") deviceId: string) {
    const rows = await tx().deviceCommand.findMany({ where: { deviceId }, orderBy: { issuedAt: "desc" }, take: 50 });
    return rows.map(publicCommand);
  }

  // ── Live Floor ──────────────────────────────────────────────────────────

  @RequirePermission("station.view")
  @Get("branches/:branchId/floor")
  async floor(@Param("branchId") branchId: string) {
    const zones = await tx().zone.findMany({ where: { branchId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, color: true, floorMap: true } });
    const devices = await tx().device.findMany({ where: { branchId, isEnabled: true }, select: DEVICE_FIELDS });
    const alerts = await tx().alert.findMany({ where: { branchId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { openedAt: "desc" }, take: 100 });
    const sessions = await liveSessionSummaries(branchId);
    return { zones, devices: devices.map((d) => ({ ...this.runtime.view(d), session: sessions.get(d.id) ?? null })), alerts, serverTime: new Date().toISOString() };
  }

  /** Server-Sent Events: device status, live metrics, command acks, alerts. */
  @RequirePermission("station.view")
  @LongLived()
  @Sse("branches/:branchId/floor/events")
  events(@Param("branchId") branchId: string): Observable<MessageEvent> {
    const org = orgId();
    return new Observable<MessageEvent>((sub) => {
      const off = this.bus.subscribe(org, branchId, (e: FloorEvent) => sub.next({ type: e.type, data: e }));
      const ping = setInterval(() => sub.next({ type: "ping", data: { at: new Date().toISOString() } }), 20_000);
      sub.next({ type: "ready", data: { at: new Date().toISOString() } });
      return () => {
        off();
        clearInterval(ping);
      };
    });
  }

  @RequirePermission("station.view")
  @Post("alerts/:alertId/ack")
  @HttpCode(200)
  async ackAlert(@Param("alertId") alertId: string) {
    const a = await tx().alert.update({ where: { id: alertId }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: principal().employeeId } });
    if (a.branchId) this.bus.publish(orgId(), a.branchId, { type: "alert", alert: a });
    return a;
  }
}
