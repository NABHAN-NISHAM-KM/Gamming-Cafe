import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { decodeJwt, importSPKI, jwtVerify } from "jose";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import type { Db } from "@arena/db";
import { DEVICE_ASSERTION_AUDIENCE, REPAIR_ACTIONS } from "@arena/contracts";
import { CONFIG, type AppConfig } from "../config.js";
import { DB } from "../common/db.module.js";
import { CommandsService } from "./commands.service.js";
import { DeviceRuntimeService } from "./device-runtime.service.js";
import { DeviceHub, type Connection } from "./live.js";

export const DEVICE_WS_PATH = "/v1/device/ws";

const num = z.number().finite().nullish();
const pct = z.number().min(0).max(100).nullish();
const Metrics = z.object({
  cpuPct: pct, gpuPct: pct, ramPct: pct, diskPct: pct,
  cpuTempC: z.number().min(-20).max(150).nullish(), gpuTempC: z.number().min(-20).max(150).nullish(),
  pingMs: z.number().min(0).max(60_000).nullish(), packetLossPct: pct, fps: z.number().min(0).max(2000).nullish(),
  uptimeSec: z.number().int().min(0).nullish(), foregroundApp: z.string().max(200).nullish(), shellState: z.string().max(40).nullish(),
});
const Hardware = z.object({
  cpu: z.string().max(200).nullish(), cpuCores: z.number().int().nullish(), gpu: z.string().max(200).nullish(), gpuVramMb: num,
  ramMb: num, motherboard: z.string().max(200).nullish(), biosVersion: z.string().max(100).nullish(), osVersion: z.string().max(200).nullish(),
  disks: z.array(z.record(z.string(), z.unknown())).max(32).nullish(), nics: z.array(z.record(z.string(), z.unknown())).max(32).nullish(),
  monitors: z.array(z.record(z.string(), z.unknown())).max(16).nullish(),
});
const Incoming = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), agentVersion: z.string().max(32), shellVersion: z.string().max(32).nullish(), ipAddress: z.string().max(64).nullish(), hostname: z.string().max(64).nullish(), macAddress: z.string().max(32).nullish(), activeSessionId: z.uuid().nullish() }),
  z.object({ type: z.literal("shell_login"), requestId: z.string().min(8).max(64), username: z.string().min(1).max(100), secret: z.string().min(1).max(256) }),
  z.object({ type: z.literal("shell_logout"), requestId: z.string().min(8).max(64), sessionId: z.uuid() }),
  z.object({ type: z.literal("heartbeat"), metrics: Metrics }),
  z.object({ type: z.literal("hardware"), snapshot: Hardware }),
  z.object({
    type: z.literal("ack"),
    commandId: z.uuid(),
    status: z.enum(["RECEIVED", "EXECUTING", "SUCCESS", "FAILED"]),
    errorCode: z.string().max(64).optional(),
    errorMessage: z.string().max(500).optional(),
    result: z.record(z.string(), z.unknown()).optional(),
  }),
  // Phase 5 — station reports
  z.object({
    type: z.literal("inventory"),
    games: z.array(z.object({
      source: z.enum(["STEAM", "EPIC", "PATH"]), key: z.string().min(1).max(128), name: z.string().max(200),
      installPath: z.string().max(400).nullish(), buildId: z.string().max(64).nullish(), sizeBytes: z.number().int().min(0).max(2 ** 50).nullish(), updateRequired: z.boolean().optional(),
      updating: z.boolean().optional(), progressPct: z.number().min(0).max(100).nullish(),
    })).max(1000),
    apps: z.array(z.object({
      key: z.string().min(1).max(200), name: z.string().min(1).max(200), version: z.string().max(64).nullish(), publisher: z.string().max(200).nullish(),
      installPath: z.string().max(400).nullish(), executablePath: z.string().max(400).nullish(), sizeBytes: z.number().int().min(0).max(2 ** 50).nullish(),
    })).max(2000).optional(),
  }),
  z.object({
    type: z.literal("peripherals"),
    items: z.array(z.object({
      hardwareId: z.string().min(1).max(300), name: z.string().max(200), vendor: z.string().max(60).nullish(),
      type: z.enum(["CONTROLLER", "HEADSET", "STEERING_WHEEL", "JOYSTICK", "KEYBOARD", "MOUSE", "WEBCAM", "MICROPHONE", "OTHER"]),
    })).max(64),
  }),
  z.object({
    type: z.literal("network"),
    probe: z.object({
      targets: z.array(z.object({ name: z.string().max(60), host: z.string().max(255), pingMs: z.number().min(0).max(60_000).nullable(), lossPct: z.number().min(0).max(100) })).max(16),
      linkType: z.enum(["ETHERNET", "WIFI", "OTHER"]).nullish(), linkSpeedMbps: z.number().min(0).max(1_000_000).nullish(), dnsMs: z.number().min(0).max(60_000).nullish(),
    }),
  }),
  z.object({
    type: z.literal("boot"),
    report: z.object({ mode: z.enum(["LOCAL_DISK", "ISCSI", "UNKNOWN"]), provider: z.string().max(60).nullish(), bootServer: z.string().max(255).nullish(), imageName: z.string().max(200).nullish() }),
  }),
  z.object({ type: z.literal("game_event"), event: z.enum(["started", "exited"]), gameId: z.uuid(), sessionId: z.uuid().nullish() }),
  z.object({ type: z.literal("help_request"), requestId: z.string().min(8).max(64), topic: z.enum(["general", "game", "peripheral", "network", "payment"]), note: z.string().max(300).nullish() }),
  z.object({ type: z.literal("self_repair"), action: z.enum(REPAIR_ACTIONS), ok: z.boolean(), detail: z.string().max(300).nullish() }),
  // Phase 7 — in-seat ordering (the device is the one on the socket; the session is looked up server-side)
  z.object({ type: z.literal("menu_request"), requestId: z.string().min(8).max(64) }),
  z.object({
    type: z.literal("place_order"),
    requestId: z.string().min(8).max(64),
    lines: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(20), modifierIds: z.array(z.uuid()).max(20).optional(), notes: z.string().max(200).nullish() })).min(1).max(30),
    notes: z.string().max(300).nullish(),
    payWith: z.enum(["BILL", "WALLET"]),
  }),
  // Phase 9 — printing
  z.object({
    type: z.literal("print_job"),
    job: z.object({
      jobKey: z.string().regex(/^[\w:.-]{3,80}$/),
      printerName: z.string().min(1).max(120),
      document: z.string().max(200).nullish(),
      pages: z.number().int().min(1).max(2000),
      copies: z.number().int().min(1).max(100),
      color: z.boolean(),
    }),
  }),
  z.object({ type: z.literal("print_confirm"), jobKey: z.string().regex(/^[\w:.-]{3,80}$/), payWith: z.enum(["BILL", "WALLET"]) }),
  z.object({ type: z.literal("print_cancel"), jobKey: z.string().regex(/^[\w:.-]{3,80}$/) }),
  z.object({ type: z.literal("print_done"), jobKey: z.string().regex(/^[\w:.-]{3,80}$/), ok: z.boolean(), detail: z.string().max(300).nullish() }),
]);

type Incoming = z.infer<typeof Incoming>;
export type StationMessage = Extract<Incoming, { type: "inventory" | "peripherals" | "network" | "boot" | "game_event" | "help_request" | "self_repair" | "menu_request" | "place_order" | "print_job" | "print_confirm" | "print_cancel" | "print_done" }>;

/**
 * WebSocket endpoint for Windows agents. Each connection authenticates with a
 * short-lived ES256 assertion signed by the device's enrolment key — proof of
 * possession; the private key never leaves the PC and no shared secret exists.
 */
@Injectable()
export class DeviceGateway implements OnModuleDestroy {
  private readonly log = new Logger("DeviceGateway");
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  /** Single-use assertion ids (jti) — in-memory; Redis once there are several API nodes. */
  private readonly seenJti = new Map<string, number>();
  /** Customer-facing requests from the Gaming Shell (login/logout), answered on the same socket. */
  private shellHandler?: (conn: Connection, msg: { type: "shell_login" | "shell_logout"; requestId: string } & Record<string, unknown>) => Promise<Record<string, unknown>>;

  handleShell(fn: NonNullable<DeviceGateway["shellHandler"]>) {
    this.shellHandler = fn;
  }

  /** Phase 5 station reports (inventory, peripherals, network, help…), handled by their modules. */
  private readonly stationHandlers = new Map<StationMessage["type"], (conn: Connection, msg: any) => Promise<unknown>>();

  handleStation<T extends StationMessage["type"]>(type: T, fn: (conn: Connection, msg: Extract<StationMessage, { type: T }>) => Promise<unknown>) {
    this.stationHandlers.set(type, fn);
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceHub) private readonly hub: DeviceHub,
    @Inject(DeviceRuntimeService) private readonly runtime: DeviceRuntimeService,
    @Inject(CommandsService) private readonly commands: CommandsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  attach(server: Server) {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== DEVICE_WS_PATH) return; // not ours
      this.authenticate(req)
        .then((who) => this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, who)))
        .catch((e: Error) => {
          this.log.warn(`device auth rejected: ${e.message}`);
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
        });
    });
  }

  onModuleDestroy() {
    for (const c of this.hub.all()) c.socket.close(1001, "server shutting down");
    this.wss.close();
  }

  private async authenticate(req: IncomingMessage): Promise<{ deviceId: string; organizationId: string; branchId: string; name: string; venue: { name: string; branchName: string; logoUrl: string | null } }> {
    const header = req.headers.authorization ?? "";
    const assertion = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!assertion) throw new Error("missing assertion");

    const unverified = decodeJwt(assertion);
    const deviceId = unverified.sub;
    if (typeof deviceId !== "string" || !/^[0-9a-f-]{36}$/i.test(deviceId)) throw new Error("bad subject");

    const rows = await this.db.global.$queryRaw<Array<{ device_org: string | null }>>`SELECT app.device_org(${deviceId}::uuid) AS device_org`;
    const organizationId = rows[0]?.device_org;
    if (!organizationId) throw new Error("unknown or disabled device");

    return this.db.withTenant({ organizationId, actorType: "DEVICE", actorId: deviceId }, async (tx) => {
      const device = await tx.device.findUnique({
        where: { id: deviceId },
        select: { id: true, branchId: true, name: true, isEnabled: true, branch: { select: { name: true, brand: { select: { name: true, logoUrl: true } } } } },
      });
      const creds = await tx.deviceCredential.findMany({ where: { deviceId, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!device?.isEnabled || creds.length === 0) throw new Error("no active credential");

      let verified: { payload: { jti?: string } } | null = null;
      for (const c of creds) {
        try {
          verified = await jwtVerify(assertion, await importSPKI(c.publicKeyPem, "ES256"), {
            algorithms: ["ES256"],
            audience: DEVICE_ASSERTION_AUDIENCE,
            issuer: deviceId,
            subject: deviceId,
            maxTokenAge: "120s",
            clockTolerance: 30,
          });
          break;
        } catch {
          /* try next credential */
        }
      }
      if (!verified) throw new Error("bad signature");

      const jti = verified.payload.jti;
      if (typeof jti !== "string" || jti.length < 16) throw new Error("missing jti");
      const now = Date.now();
      for (const [k, exp] of this.seenJti) if (exp < now) this.seenJti.delete(k);
      if (this.seenJti.has(jti)) throw new Error("replayed assertion");
      this.seenJti.set(jti, now + 5 * 60_000);

      return { deviceId, organizationId, branchId: device.branchId, name: device.name, venue: { name: device.branch.brand.name, branchName: device.branch.name, logoUrl: device.branch.brand.logoUrl } };
    });
  }

  private onConnection(ws: WebSocket, who: { deviceId: string; organizationId: string; branchId: string; name: string; venue: { name: string; branchName: string; logoUrl: string | null } }) {
    const now = Date.now();
    const { venue, ...ids } = who;
    const conn: Connection = { socket: ws, ...ids, connectedAt: now, lastMessageAt: now, lastPersistAt: 0, metrics: null, metricsAt: null, alerts: null };
    this.hub.add(conn);
    this.log.log(`device ${who.name} (${who.deviceId}) connected`);
    ws.send(JSON.stringify({ type: "welcome", serverTime: new Date().toISOString(), heartbeatSeconds: this.cfg.DEVICE_HEARTBEAT_SECONDS, deviceName: who.name, venue }));

    // Simple flood guard: max 30 messages per 10 s window.
    let windowStart = now;
    let count = 0;
    let chain: Promise<unknown> = Promise.resolve(); // process messages in order

    ws.on("message", (data) => {
      conn.lastMessageAt = Date.now();
      if (conn.lastMessageAt - windowStart > 10_000) {
        windowStart = conn.lastMessageAt;
        count = 0;
      }
      // A burst of prints is ~6 messages per job (report, confirm, three acks, done): allow that, still cap abuse.
      if (++count > 60) return ws.close(1008, "rate limit");

      let msg: Incoming;
      try {
        msg = Incoming.parse(JSON.parse(data.toString()));
      } catch {
        return ws.send(JSON.stringify({ type: "error", error: "invalid_message" }));
      }
      chain = chain
        .then(() => {
          switch (msg.type) {
            case "hello":
              return this.runtime.onHello(conn, msg);
            case "heartbeat":
              return this.runtime.onHeartbeat(conn, msg.metrics);
            case "hardware":
              return this.runtime.onHardware(conn, msg.snapshot as any);
            case "ack":
              return this.commands.ack(conn.organizationId, conn.deviceId, msg);
            case "menu_request":
            case "place_order": {
              const handler = this.stationHandlers.get(msg.type);
              const replyType = msg.type === "menu_request" ? "menu" : "order_result";
              const reply = (r: Record<string, unknown>) => ws.send(JSON.stringify({ type: replyType, requestId: msg.requestId, ...r }));
              if (!handler) return reply({ ok: false, error: "unavailable" });
              return handler(conn, msg).then(
                (r) => reply(r as Record<string, unknown>),
                (e) => reply({ ok: false, error: e?.response?.error ?? "failed", message: e?.response?.message ?? e?.response?.hint }),
              );
            }
            case "help_request": {
              const handler = this.stationHandlers.get("help_request");
              const reply = (r: Record<string, unknown>) => ws.send(JSON.stringify({ type: "help_result", requestId: msg.requestId, ...r }));
              if (!handler) return reply({ ok: false, error: "unavailable" });
              return handler(conn, msg).then((r) => reply((r as Record<string, unknown>) ?? { ok: true }), () => reply({ ok: false, error: "failed" }));
            }
            case "inventory":
            case "peripherals":
            case "network":
            case "boot":
            case "game_event":
            case "self_repair":
            case "print_job":
            case "print_confirm":
            case "print_cancel":
            case "print_done":
              return this.stationHandlers.get(msg.type)?.(conn, msg);
            case "shell_login":
            case "shell_logout": {
              const handler = this.shellHandler;
              if (!handler) return ws.send(JSON.stringify({ type: "shell_result", requestId: msg.requestId, ok: false, error: "unavailable" }));
              return handler(conn, msg).then(
                (r) => ws.send(JSON.stringify({ type: "shell_result", requestId: msg.requestId, ...r })),
                (e) => ws.send(JSON.stringify({ type: "shell_result", requestId: msg.requestId, ok: false, error: e?.response?.error ?? "failed", message: e?.response?.message })),
              );
            }
          }
        })
        .catch((e) => this.log.error(`device ${conn.deviceId} ${msg.type}: ${e instanceof Error ? e.message : e}`));
    });

    ws.on("close", () => {
      const removed = this.hub.remove(conn.deviceId, ws);
      if (removed) {
        this.log.log(`device ${who.name} disconnected`);
        void this.runtime.onDisconnect(removed);
      }
    });
    ws.on("error", () => ws.terminate());
  }
}
