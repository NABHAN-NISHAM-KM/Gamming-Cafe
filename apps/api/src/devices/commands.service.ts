import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Db, TenantTx } from "@arena/db";
import type { CommandAck, CommandEnvelope, DeviceCommandType } from "@arena/contracts";
import type { PermissionKey } from "@arena/rbac";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";
import { DeviceHub, LiveBus } from "./live.js";
import { SigningKeysService } from "./signing-keys.service.js";

/** Which permission each remote command needs (checked against the station's branch). */
export const COMMAND_PERMISSION: Partial<Record<DeviceCommandType, PermissionKey>> = {
  LOCK: "station.lock",
  UNLOCK: "station.lock",
  RESTART: "station.restart",
  LOGOUT: "station.restart",
  SHUTDOWN: "station.shutdown",
  WAKE_ON_LAN: "station.shutdown",
  SEND_MESSAGE: "station.message",
  LAUNCH_APP: "station.launch_app",
  OPEN_GAME: "station.launch_app",
  CLOSE_GAME: "station.launch_app",
  REFRESH_CONFIG: "station.manage",
  UPDATE_CLIENT: "station.update_client",
  MAINTENANCE_MODE: "station.maintenance",
  RUN_REPAIR: "station.maintenance",
  SCREENSHOT: "station.remote_control",
  // START/END/EXTEND/MOVE_SESSION are issued only by the sessions module (phase 4).
};

/** How long a command stays deliverable (e.g. to a PC that is rebooting). */
const TTL_SECONDS: Partial<Record<DeviceCommandType, number>> = {
  SEND_MESSAGE: 120,
  LOCK: 120,
  UNLOCK: 60,
  RESTART: 300,
  SHUTDOWN: 300,
  WAKE_ON_LAN: 60,
  START_SESSION: 600,
  EXTEND_SESSION: 600,
  END_SESSION: 600,
};

export interface IssueInput {
  deviceId: string;
  type: DeviceCommandType;
  payload?: Record<string, unknown>;
  requestedBy: { type: "EMPLOYEE" | "SYSTEM"; id: string | null };
  batchId?: string | null;
}

@Injectable()
export class CommandsService {
  private readonly log = new Logger("Commands");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(LiveBus) private readonly bus: LiveBus,
    @Inject(SigningKeysService) private readonly keys: SigningKeysService,
  ) {}

  /**
   * Persist → sign → deliver if connected (else it waits in PENDING until the
   * agent reconnects or the command expires). Must run inside a tenant tx.
   */
  async issue(tx: TenantTx, input: IssueInput) {
    const device = await tx.device.findUniqueOrThrow({ where: { id: input.deviceId }, select: { id: true, organizationId: true, branchId: true, isEnabled: true } });
    if (!device.isEnabled) throw new ConflictException({ error: "device_disabled" });

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + (TTL_SECONDS[input.type] ?? 300) * 1000);
    const nonce = randomBytes(12).toString("base64url");
    const created = await tx.deviceCommand.create({
      data: {
        organizationId: device.organizationId,
        branchId: device.branchId,
        deviceId: device.id,
        type: input.type,
        payload: (input.payload ?? {}) as object,
        requestedById: input.requestedBy.type === "EMPLOYEE" ? input.requestedBy.id : null,
        batchId: input.batchId ?? null,
        nonce,
        signature: "", // filled below — the envelope needs the row id
        issuedAt,
        expiresAt,
      },
    });

    const envelope: CommandEnvelope = {
      v: 1,
      commandId: created.id,
      organizationId: device.organizationId,
      branchId: device.branchId,
      deviceId: device.id,
      type: input.type,
      payload: input.payload ?? {},
      requestedBy: input.requestedBy,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      nonce,
    };
    const signed = await this.keys.sign(tx, envelope);
    const cmd = await tx.deviceCommand.update({
      where: { id: created.id },
      data: { signature: signed.signature, payload: { ...(input.payload ?? {}), _signed: signed } as object },
    });

    // Deliver only after the command row has committed, so a PC can never act
    // on a command that doesn't exist in the database.
    const ids = { org: device.organizationId, branch: device.branchId, device: device.id };
    const deliver = async () => {
      const sent = this.hub.send(ids.device, { type: "command", command: signed });
      if (!sent) return this.publish(ids.org, ids.branch, { id: cmd.id, deviceId: ids.device, type: input.type, status: "PENDING" });
      await this.db.withTenant({ organizationId: ids.org, actorType: "SYSTEM", actorId: null }, (t) =>
        t.deviceCommand.updateMany({ where: { id: cmd.id, status: "PENDING" }, data: { status: "SENT", sentAt: new Date(), attempts: 1 } }),
      );
      this.publish(ids.org, ids.branch, { id: cmd.id, deviceId: ids.device, type: input.type, status: "SENT" });
    };
    const req = requestStore.getStore();
    if (req) req.afterCommit.push(deliver);
    else await deliver();
    return { id: cmd.id, deviceId: device.id, type: input.type, status: "PENDING" as const, online: this.hub.isOnline(device.id), expiresAt: expiresAt.toISOString() };
  }

  /** Re-send commands queued while the agent was offline. */
  async deliverPending(organizationId: string, deviceId: string) {
    await this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, async (tx) => {
      const now = new Date();
      await tx.deviceCommand.updateMany({ where: { deviceId, status: { in: ["PENDING", "SENT"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED", completedAt: now } });
      const pending = await tx.deviceCommand.findMany({ where: { deviceId, status: { in: ["PENDING", "SENT"] }, expiresAt: { gt: now } }, orderBy: { issuedAt: "asc" }, take: 50 });
      for (const c of pending) {
        const signed = (c.payload as any)?._signed;
        if (signed && this.hub.send(deviceId, { type: "command", command: signed })) {
          await tx.deviceCommand.update({ where: { id: c.id }, data: { status: "SENT", sentAt: now, attempts: { increment: 1 } } });
        }
      }
    });
  }

  /** Agent acknowledgement. Transitions only move forward; stale/duplicate acks are ignored. */
  async ack(organizationId: string, deviceId: string, ack: CommandAck) {
    const ORDER = { PENDING: 0, SENT: 1, RECEIVED: 2, EXECUTING: 3, SUCCEEDED: 4, FAILED: 4, EXPIRED: 4, CANCELLED: 4 } as const;
    const next = ack.status === "SUCCESS" ? "SUCCEEDED" : ack.status;
    await this.db.withTenant({ organizationId, actorType: "DEVICE", actorId: deviceId }, async (tx) => {
      const cmd = await tx.deviceCommand.findFirst({ where: { id: ack.commandId, deviceId } });
      if (!cmd || ORDER[next] <= ORDER[cmd.status]) return;
      const now = new Date();
      const stamp = next === "RECEIVED" ? { receivedAt: now } : next === "EXECUTING" ? { executingAt: now } : { completedAt: now };
      const updated = await tx.deviceCommand.update({
        where: { id: cmd.id },
        data: {
          status: next,
          ...stamp,
          result: (ack.result ?? undefined) as object | undefined,
          errorCode: ack.errorCode ?? null,
          errorMessage: ack.errorMessage?.slice(0, 500) ?? null,
        },
      });
      this.publish(organizationId, cmd.branchId, {
        id: cmd.id,
        deviceId,
        type: cmd.type,
        status: updated.status,
        errorMessage: updated.errorMessage,
        completedAt: updated.completedAt?.toISOString() ?? null,
      });
    });
  }

  private publish(org: string, branch: string, command: { id: string; deviceId: string; type: string; status: string; errorMessage?: string | null; completedAt?: string | null }) {
    this.bus.publish(org, branch, { type: "command", command });
  }
}
