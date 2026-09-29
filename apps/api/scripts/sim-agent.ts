// A Node implementation of the Windows agent protocol. Used by the e2e tests
// and by `npm run sim` to populate the Live Floor with virtual stations.
// It verifies every command exactly like the real agent must.
import { generateKeyPairSync, randomBytes, randomUUID, createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import WebSocket from "ws";
import { DEVICE_ASSERTION_AUDIENCE, verifyCommand, type CommandAck, type DetectedApp, type DetectedGame, type DeviceMetrics, type HardwareSnapshot, type PrintQuote, type ServerToDevice, type StationConfig, type UpdateGamePayload } from "@arena/contracts";

export interface Identity {
  deviceId: string;
  organizationId: string;
  branchId: string;
  zoneId: string;
  name: string;
  privateKeyPem: string;
  signingKeys: Record<string, string>;
  heartbeatSeconds: number;
  websocketPath: string;
}

export interface SimOptions {
  /** Metric generator; defaults to a plausible idle/gaming mix. */
  metrics?: () => DeviceMetrics;
  hardware?: HardwareSnapshot;
  /** Decide the outcome of a verified command (default: success). */
  execute?: (type: string, payload: any) => Promise<CommandAck["result"] | { fail: string }> | CommandAck["result"] | { fail: string };
  heartbeatSeconds?: number;
  log?: (msg: string) => void;
  /** What this PC "has installed" (Steam/Epic manifests); reported on connect and on SCAN_GAMES. */
  games?: DetectedGame[];
}

export class SimAgent {
  identity?: Identity;
  ws?: WebSocket;
  readonly received: Array<{ type: string; payload: unknown; verified: boolean; reason?: string }> = [];
  private readonly seen = new Set<string>();
  /** Session the PC believes is running (like the real agent's persisted state). */
  activeSession: { id: string; expiresAt: string | null } | null = null;
  /** Called when the server drops the connection (not on our own disconnect()). */
  onClosed?: () => void;
  private closing = false;
  private readonly pendingShell = new Map<string, (r: any) => void>();
  private readonly pendingHelp = new Map<string, (r: any) => void>();
  private readonly pendingSeat = new Map<string, (r: any) => void>();
  /** In-seat order updates pushed by the server (what the Shell would show). */
  readonly orderUpdates: Array<{ orderId: string; number: string; status: string; message: string }> = [];
  /** Print quotes and print status updates pushed by the server (what the Shell would show). */
  readonly printQuotes: PrintQuote[] = [];
  readonly printStatuses: Array<{ jobKey: string; status: string; message: string }> = [];
  /** Last verified station config (game library etc.). */
  config: StationConfig | null = null;
  /** Installed games as this PC sees them; UPDATE_GAME flips updateRequired off after a short delay. */
  games: DetectedGame[];
  /** Installed programs to report; undefined = an older agent that doesn't send apps */
  apps?: DetectedApp[];
  private beat?: NodeJS.Timeout;
  private key?: KeyObject;

  constructor(
    private readonly apiUrl: string,
    private readonly opts: SimOptions = {},
  ) {
    this.games = opts.games ? opts.games.map((g) => ({ ...g })) : [];
  }

  static generateKey() {
    return generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  }

  async enroll(enrollmentCode: string, extra: { macAddress?: string; hostname?: string; requestedName?: string; publicKeyPem?: string } = {}) {
    const { privateKey, publicKey } = SimAgent.generateKey();
    const res = await fetch(`${this.apiUrl}/v1/device/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enrollmentCode,
        publicKeyPem: extra.publicKeyPem ?? publicKey,
        hostname: extra.hostname ?? `SIM-${randomBytes(3).toString("hex").toUpperCase()}`,
        macAddress: extra.macAddress ?? randomMac(),
        requestedName: extra.requestedName ?? null,
        agentVersion: "0.1.0-sim",
      }),
    });
    const body = await res.json();
    if (!res.ok) throw Object.assign(new Error(`enroll failed ${res.status}: ${JSON.stringify(body)}`), { status: res.status, body });
    this.identity = { ...body, privateKeyPem: privateKey };
    this.key = createPrivateKey(privateKey);
    return this.identity!;
  }

  /** Short-lived, single-use proof-of-possession assertion. */
  async assertion(): Promise<string> {
    const id = this.identity!;
    return new SignJWT({ org: id.organizationId })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer(id.deviceId)
      .setSubject(id.deviceId)
      .setAudience(DEVICE_ASSERTION_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("60s")
      .setJti(randomUUID())
      .sign(this.key!);
  }

  async connect(assertion?: string, opts: { reportSession?: boolean } = {}): Promise<void> {
    this.closing = false;
    const id = this.identity!;
    const url = this.apiUrl.replace(/^http/, "ws") + id.websocketPath;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${assertion ?? (await this.assertion())}` } });
    await new Promise<void>((resolve, reject) => {
      ws.once("unexpected-response", (_req, res) => reject(Object.assign(new Error(`ws rejected ${res.statusCode}`), { status: res.statusCode })));
      ws.once("error", reject);
      ws.once("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerToDevice;
        if (msg.type !== "welcome") return reject(new Error(`expected welcome, got ${msg.type}`));
        resolve();
      });
    });
    this.ws = ws;
    ws.on("close", () => {
      if (this.ws === ws) this.ws = undefined;
      clearInterval(this.beat);
      if (!this.closing) this.onClosed?.();
    });
    ws.on("message", (data) => void this.onMessage(JSON.parse(data.toString())));
    this.send({
      type: "hello", agentVersion: "0.1.0-sim", ipAddress: `192.168.1.${10 + Math.floor(Math.random() * 200)}`, hostname: `SIM-${id.name}`,
      activeSessionId: opts.reportSession === false ? null : (this.activeSession?.id ?? null),
    });
    this.send({ type: "hardware", snapshot: this.opts.hardware ?? DEFAULT_HARDWARE });
    if (this.opts.games) this.reportInventory();
    const every = (this.opts.heartbeatSeconds ?? id.heartbeatSeconds) * 1000;
    this.heartbeat();
    this.beat = setInterval(() => this.heartbeat(), every);
  }

  heartbeat(metrics?: DeviceMetrics) {
    this.send({ type: "heartbeat", metrics: metrics ?? this.opts.metrics?.() ?? randomMetrics() });
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  async disconnect() {
    this.closing = true;
    clearInterval(this.beat);
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = undefined;
    if (ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((r) => {
      ws.once("close", () => r());
      ws.close();
    });
  }

  reportInventory() {
    this.send({ type: "inventory", games: this.games, ...(this.apps ? { apps: this.apps } : {}) });
  }

  private seat(msg: Record<string, unknown>): Promise<any> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("seat request timed out")), 10_000);
      this.pendingSeat.set(requestId, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      this.send({ ...msg, requestId });
    });
  }

  /** The Shell's Food tab: menu, then an order to this seat. */
  menu(): Promise<any> {
    return this.seat({ type: "menu_request" });
  }

  order(lines: Array<{ productId: string; quantity: number; modifierIds?: string[] }>, payWith: "BILL" | "WALLET" = "BILL", notes?: string): Promise<any> {
    return this.seat({ type: "place_order", lines, payWith, notes });
  }

  /** The spooler caught a new job: the agent paused it and reports it. */
  print(job: { jobKey?: string; printerName?: string; document?: string | null; pages: number; copies?: number; color?: boolean }) {
    const jobKey = job.jobKey ?? `${Math.floor(Math.random() * 1e6)}:${Date.now()}`;
    this.send({ type: "print_job", job: { jobKey, printerName: job.printerName ?? "Front desk laser", document: job.document ?? "document.pdf", pages: job.pages, copies: job.copies ?? 1, color: job.color ?? false } });
    return jobKey;
  }

  confirmPrint(jobKey: string, payWith: "BILL" | "WALLET" = "BILL") {
    this.send({ type: "print_confirm", jobKey, payWith });
  }

  cancelPrint(jobKey: string) {
    this.send({ type: "print_cancel", jobKey });
  }

  printDone(jobKey: string, ok = true, detail?: string) {
    this.send({ type: "print_done", jobKey, ok, detail: detail ?? null });
  }

  /** Customer presses "Call staff" on the Shell. */
  help(topic: "general" | "game" | "peripheral" | "network" | "payment" = "general", note?: string): Promise<any> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("help request timed out")), 10_000);
      this.pendingHelp.set(requestId, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      this.send({ type: "help_request", requestId, topic, note });
    });
  }

  /** Customer login/logout from the (simulated) Gaming Shell. */
  shell(msg: { type: "shell_login"; username: string; secret: string } | { type: "shell_logout"; sessionId: string }, requestId: string = randomUUID()): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("shell request timed out")), 10_000);
      this.pendingShell.set(requestId, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      this.send({ ...msg, requestId });
    });
  }

  private async onMessage(msg: ServerToDevice) {
    if (msg.type === "shell_result") {
      this.pendingShell.get(msg.requestId)?.(msg);
      this.pendingShell.delete(msg.requestId);
      return;
    }
    if (msg.type === "menu" || msg.type === "order_result") {
      this.pendingSeat.get(msg.requestId)?.(msg);
      this.pendingSeat.delete(msg.requestId);
      return;
    }
    if (msg.type === "order_status") {
      this.orderUpdates.push({ orderId: msg.orderId, number: msg.number, status: msg.status, message: msg.message });
      return;
    }
    if (msg.type === "print_quote") {
      this.printQuotes.push(msg.quote);
      return;
    }
    if (msg.type === "print_status") {
      this.printStatuses.push({ jobKey: msg.jobKey, status: msg.status, message: msg.message });
      return;
    }
    if (msg.type === "help_result") {
      this.pendingHelp.get(msg.requestId)?.(msg);
      this.pendingHelp.delete(msg.requestId);
      return;
    }
    if (msg.type !== "command" && msg.type !== "config") return;
    const id = this.identity!;
    const check = verifyCommand(msg.command, {
      self: { organizationId: id.organizationId, branchId: id.branchId, deviceId: id.deviceId },
      publicKeys: id.signingKeys,
      seen: (c) => this.seen.has(c),
    });
    if (!check.ok) {
      this.received.push({ type: "?", payload: null, verified: false, reason: check.reason });
      this.opts.log?.(`rejected command: ${check.reason}`);
      return; // never ack or execute an unverified command
    }
    const e = check.envelope;
    this.seen.add(e.commandId);
    if (msg.type === "config") {
      // Station config is only accepted as a verified REFRESH_CONFIG envelope; never acknowledged.
      if (e.type === "REFRESH_CONFIG") this.config = e.payload as unknown as StationConfig;
      return;
    }
    this.received.push({ type: e.type, payload: e.payload, verified: true });
    const p = e.payload as { sessionId?: string; expiresAt?: string | null };
    if (e.type === "START_SESSION" && p.sessionId) this.activeSession = { id: p.sessionId, expiresAt: p.expiresAt ?? null };
    if (e.type === "EXTEND_SESSION" && this.activeSession && this.activeSession.id === p.sessionId) this.activeSession.expiresAt = p.expiresAt ?? null;
    if (e.type === "END_SESSION" && (!p.sessionId || this.activeSession?.id === p.sessionId)) this.activeSession = null;
    this.send({ type: "ack", commandId: e.commandId, status: "RECEIVED" });
    this.send({ type: "ack", commandId: e.commandId, status: "EXECUTING" });
    if (e.type === "SCAN_GAMES") setTimeout(() => this.reportInventory(), 50);
    if (e.type === "UPDATE_GAME") {
      // The launcher "downloads" for a moment, then the next scan shows the game up to date.
      const u = e.payload as unknown as UpdateGamePayload;
      const key = u.launch.kind === "STEAM" ? u.launch.appId : u.launch.kind === "EPIC" ? u.launch.appName : u.gameId;
      setTimeout(() => {
        this.games = this.games.map((g) => (g.key === key ? { ...g, updateRequired: false, buildId: String(Number(g.buildId ?? 0) + 1) } : g));
        this.reportInventory();
      }, 300);
    }
    const outcome = (await this.opts.execute?.(e.type, e.payload)) ?? { simulated: true };
    if (outcome && "fail" in outcome) this.send({ type: "ack", commandId: e.commandId, status: "FAILED", errorCode: "SIM_FAILURE", errorMessage: String(outcome.fail) });
    else this.send({ type: "ack", commandId: e.commandId, status: "SUCCESS", result: outcome ?? {} });
    this.opts.log?.(`${id.name}: ${e.type} ✓`);
  }
}

export const DEFAULT_HARDWARE: HardwareSnapshot = {
  cpu: "AMD Ryzen 7 7800X3D 8-Core Processor",
  cpuCores: 8,
  gpu: "NVIDIA GeForce RTX 4070 SUPER",
  gpuVramMb: 12288,
  ramMb: 32768,
  motherboard: "ASUS TUF GAMING B650-PLUS",
  biosVersion: "2613",
  osVersion: "Windows 11 Pro 23H2 (22631)",
  disks: [{ model: "Samsung SSD 990 PRO 1TB", serial: "S6Z1NJ0W", sizeGb: 931, freeGb: 402 }],
  nics: [{ name: "Realtek Gaming 2.5GbE", mac: "04:7C:16:AA:BB:CC", speedMbps: 2500 }],
};

export function randomMac() {
  const b = randomBytes(6);
  b[0] = (b[0]! & 0xfe) | 0x02; // locally administered, unicast
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join(":").toUpperCase();
}

export function randomMetrics(): DeviceMetrics {
  const gaming = Math.random() < 0.6;
  const r = (a: number, b: number) => Math.round((a + Math.random() * (b - a)) * 10) / 10;
  return {
    cpuPct: gaming ? r(35, 80) : r(2, 12),
    gpuPct: gaming ? r(70, 99) : r(0, 6),
    ramPct: gaming ? r(45, 75) : r(20, 35),
    diskPct: r(40, 70),
    cpuTempC: gaming ? r(62, 82) : r(38, 48),
    gpuTempC: gaming ? r(60, 78) : r(32, 42),
    pingMs: r(1, 6),
    packetLossPct: 0,
    fps: gaming ? Math.round(r(140, 360)) : null,
    uptimeSec: Math.floor(r(600, 40_000)),
  };
}
