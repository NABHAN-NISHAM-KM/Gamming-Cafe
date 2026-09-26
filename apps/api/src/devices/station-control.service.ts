import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { TenantTx } from "@arena/db";
import { CommandsService } from "./commands.service.js";
import { DeviceRuntimeService } from "./device-runtime.service.js";

/** A LAN address the bridge may call: private IPv4 or a .local/.lan name — never the internet. */
export function isLanHost(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^[a-z0-9-]{1,63}\.(local|lan)$/i.test(host);
}

export const PowerPlug = z
  .object({
    kind: z.enum(["SHELLY", "SHELLY_GEN1", "TASMOTA"]),
    host: z.string().max(80).refine(isLanHost, "must be a private LAN address (e.g. 192.168.1.50) or a .local name"),
    channel: z.number().int().min(0).max(7).default(0),
    /** After time's up, how long the TV/console stays on (the station display shows "time's up"). */
    offDelaySeconds: z.number().int().min(0).max(600).default(60),
  })
  .strict();
export type PowerPlug = z.infer<typeof PowerPlug>;

type Actor = { type: "EMPLOYEE"; id: string } | { type: string; id: string | null };

/**
 * Agentless stations (consoles, VR headsets, sim rigs): nothing on the station
 * itself enforces time, so the branch's **bridge** — one ordinary station
 * agent on the same LAN — switches the station's smart plug on at start and
 * off (after a short "time's up" grace) at the end, via signed POWER commands.
 * Without a plug or a bridge the TV station display and staff enforce it.
 */
@Injectable()
export class StationControlService {
  constructor(
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
  ) {}

  plugOf(raw: unknown): PowerPlug | null {
    const p = PowerPlug.safeParse(raw);
    return p.success ? p.data : null;
  }

  async bridgeFor(t: TenantTx, branchId: string) {
    return t.device.findFirst({ where: { branchId, isBridge: true, isEnabled: true, agentless: false }, select: { id: true, name: true } });
  }

  /** Switch an agentless station's plug through the branch bridge. */
  async power(t: TenantTx, deviceId: string, on: boolean, actor: Actor, opts: { delaySeconds?: number; strict?: boolean } = {}) {
    const d = await t.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true, branchId: true, organizationId: true, powerPlug: true, agentless: true } });
    if (!d) throw new NotFoundException({ error: "not_found" });
    const plug = this.plugOf(d.powerPlug);
    if (!plug) {
      if (opts.strict) throw new ConflictException({ error: "no_power_plug", hint: "Set up this station's smart plug first." });
      return null;
    }
    const bridge = await this.bridgeFor(t, d.branchId);
    if (!bridge) {
      if (opts.strict) throw new ConflictException({ error: "no_bridge", hint: "Choose a station at this branch to act as the bridge." });
      await this.runtime.openAlert(t, { deviceId: d.id, organizationId: d.organizationId, branchId: d.branchId }, "NO_BRIDGE", "WARNING", `${d.name}: no bridge to switch its power`, { on });
      return null;
    }
    const cmd = await this.commands.issue(t, {
      deviceId: bridge.id,
      type: "POWER",
      payload: { targetDeviceId: d.id, targetName: d.name, on, delaySeconds: opts.delaySeconds ?? 0, plug: { kind: plug.kind, host: plug.host, channel: plug.channel } },
      requestedBy: actor.type === "EMPLOYEE" && actor.id ? { type: "EMPLOYEE", id: actor.id } : { type: "SYSTEM", id: null },
    });
    return { bridge: bridge.name, commandId: cmd.id };
  }

  async sessionStarted(t: TenantTx, deviceId: string, actor: Actor) {
    await this.power(t, deviceId, true, actor);
  }

  async sessionEnded(t: TenantTx, deviceId: string, actor: Actor) {
    const d = await t.device.findUniqueOrThrow({ where: { id: deviceId }, select: { powerPlug: true } });
    await this.power(t, deviceId, false, actor, { delaySeconds: this.plugOf(d.powerPlug)?.offDelaySeconds ?? 60 });
  }
}
