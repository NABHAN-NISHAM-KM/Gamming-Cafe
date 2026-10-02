// Live protocol between the backend (cloud or branch edge) and the Windows
// agent. Transport: WebSocket over TLS; the device proves possession of its
// enrolment key on every connection (see DeviceAssertion).
//
// Commands are signed with the branch's ECDSA P-256 key (ES256, IEEE-P1363
// r||s signatures — what .NET's ECDsa uses natively). The agent pins the
// branch PUBLIC key at enrolment, so a compromised PC can verify but never
// forge commands, and no privileged backend credential ships in the client.
//
// "Sign bytes, not objects": the envelope travels as a JSON *string* and the
// signature covers exactly its UTF-8 bytes. The agent verifies first and only
// then parses — no cross-language canonical-JSON pitfalls.
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

export const DEVICE_COMMANDS = [
  "LOCK",
  "UNLOCK",
  "START_SESSION",
  "END_SESSION",
  "EXTEND_SESSION",
  "MOVE_SESSION",
  "RESTART",
  "SHUTDOWN",
  "WAKE_ON_LAN",
  "LOGOUT",
  "OPEN_GAME",
  "CLOSE_GAME",
  "LAUNCH_APP",
  "SEND_MESSAGE",
  "MAINTENANCE_MODE",
  "REFRESH_CONFIG",
  "UPDATE_CLIENT",
  "RUN_REPAIR",
  "SCREENSHOT",
  "SCAN_GAMES",
  "UPDATE_GAME",
  "POWER",
  "PRINT_RELEASE",
  "PRINT_CANCEL",
] as const;
export type DeviceCommandType = (typeof DEVICE_COMMANDS)[number];

export type CommandAckStatus = "RECEIVED" | "EXECUTING" | "SUCCESS" | "FAILED";

export interface CommandEnvelope<P = Record<string, unknown>> {
  v: 1;
  commandId: string; // = DeviceCommand.id, also the replay-protection key
  organizationId: string;
  branchId: string;
  deviceId: string;
  type: DeviceCommandType;
  payload: P;
  requestedBy: { type: "EMPLOYEE" | "SYSTEM" | "CUSTOMER"; id: string | null };
  issuedAt: string; // ISO-8601 UTC, server clock
  expiresAt: string; // agent rejects after this
  nonce: string;
}

/** What goes over the wire. `envelope` is the exact signed JSON text. */
export interface SignedCommand {
  kid: string; // branch signing key id (rotation)
  envelope: string;
  signature: string; // base64, ES256 over UTF-8(envelope), IEEE-P1363 encoding
}

export interface CommandAck {
  commandId: string;
  status: CommandAckStatus;
  errorCode?: string;
  errorMessage?: string;
  result?: Record<string, unknown>;
}

/** Typed payloads for the commands whose shape matters. */
export interface SendMessagePayload {
  title: string;
  message: string;
  timeoutSeconds?: number;
}
export interface WakeOnLanPayload {
  targetDeviceId: string;
  macAddress: string;
}
export interface LaunchAppPayload {
  executablePath: string;
  arguments?: string;
  workingDirectory?: string;
}
export interface CloseAppPayload {
  processNames: string[];
}
export interface StartSessionPayload {
  sessionId: string;
  /** age: whole years from the profile's date of birth (null = unknown) — used for game age ratings. */
  customer: { id: string | null; displayName: string; membershipTier?: string; age?: number | null };
  startedAt: string;
  expiresAt: string | null;
  serverTime: string;
  warningMinutes: number[];
  postSessionAction: "LOCK" | "LOGOUT_WINDOWS" | "RESTART_SHELL" | "RESTART_PC" | "SHUTDOWN_PC" | "RESTORE_REBOOT";
  allowSelfExtend: boolean;
}

// ── Phase 5: games, station tools ──────────────────────────────────────────

/** Fixed, allow-listed repair actions. The agent maps each to hard-coded steps — never a command line from the server. */
export const REPAIR_ACTIONS = ["FLUSH_DNS", "RENEW_IP", "RESTART_AUDIO", "CLEAR_TEMP", "SYNC_TIME", "RESTART_SHELL", "CLOSE_GAMES"] as const;
export type RepairAction = (typeof REPAIR_ACTIONS)[number];
/** The subset a customer may run themselves from the Shell's Support screen. */
export const SELF_SERVICE_REPAIRS: readonly RepairAction[] = ["FLUSH_DNS", "RESTART_AUDIO", "RESTART_SHELL"];

export interface RunRepairPayload {
  action: RepairAction;
}

/** How a game is started. The agent builds launcher URIs itself from the id — the server never sends a raw URI. */
export type LaunchSpec =
  | { kind: "PATH"; executablePath: string; arguments?: string | null; workingDirectory?: string | null }
  | { kind: "STEAM"; appId: string }
  | { kind: "EPIC"; appName: string };

export interface UpdateGamePayload {
  jobId: string;
  gameId: string;
  title: string;
  launch: LaunchSpec;
}

export interface LibraryGame {
  id: string;
  title: string;
  categories: string[];
  coverUrl: string | null;
  minAge: number | null;
  featured: boolean;
  sortOrder: number;
  launcherKey: string | null;
  launch: LaunchSpec | null;
  processNames: string[];
  /** from this PC's last scan */
  installed: boolean;
  updateRequired: boolean;
  /** save folders that follow the player (placeholders like %APPDATA%); empty = off */
  savePaths?: string[];
}

export interface LibraryApp {
  id: string;
  name: string;
  kind: string;
  executablePath: string;
  arguments: string | null;
}

export interface ConnectivityTarget {
  name: string;
  /** IPv4/IPv6/hostname, or the literal "gateway" (this PC's default gateway) */
  host: string;
}

export interface PeripheralPreset {
  id: string;
  name: string;
  /** Windows pointer speed 1–20 (10 = default) and "Enhance pointer precision" */
  settings: { mouseSpeed?: number; enhancePointerPrecision?: boolean };
}

/**
 * Station configuration, delivered as a SIGNED REFRESH_CONFIG command envelope
 * (payload = StationConfig) so a PC only ever launches executables the branch
 * signed off. It is not persisted as a DeviceCommand and not acknowledged.
 */
export interface StationConfig {
  revision: string;
  games: LibraryGame[];
  apps: LibraryApp[];
  connectivityTargets: ConnectivityTarget[];
  peripheralPresets: PeripheralPreset[];
}

export const DEFAULT_CONNECTIVITY_TARGETS: ConnectivityTarget[] = [
  { name: "Router", host: "gateway" },
  { name: "Cloudflare", host: "1.1.1.1" },
  { name: "Google DNS", host: "8.8.8.8" },
];

export interface DetectedGame {
  source: "STEAM" | "EPIC" | "PATH";
  /** Steam appid, Epic AppName, or for PATH the catalog game id the agent checked */
  key: string;
  name: string;
  installPath?: string | null;
  buildId?: string | null;
  sizeBytes?: number | null;
  updateRequired?: boolean;
  /** The launcher is downloading/applying the update right now */
  updating?: boolean;
  /** 0–100 while updating, from the launcher's byte counters */
  progressPct?: number | null;
}

/** A program from the Windows "installed apps" list (registry Uninstall keys). */
export interface DetectedApp {
  /** Uninstall subkey name — stable per install */
  key: string;
  name: string;
  version?: string | null;
  publisher?: string | null;
  installPath?: string | null;
  /** Best-guess main .exe (from DisplayIcon), if any */
  executablePath?: string | null;
  sizeBytes?: number | null;
}

export interface DetectedPeripheral {
  hardwareId: string;
  type: "CONTROLLER" | "HEADSET" | "STEERING_WHEEL" | "JOYSTICK" | "KEYBOARD" | "MOUSE" | "WEBCAM" | "MICROPHONE" | "OTHER";
  name: string;
  vendor?: string | null;
}

export interface NetworkProbe {
  targets: Array<{ name: string; host: string; pingMs: number | null; lossPct: number }>;
  linkType?: "ETHERNET" | "WIFI" | "OTHER" | null;
  linkSpeedMbps?: number | null;
  dnsMs?: number | null;
}

export interface BootReport {
  mode: "LOCAL_DISK" | "ISCSI" | "UNKNOWN";
  provider?: string | null;
  bootServer?: string | null;
  imageName?: string | null;
}

/** What the Shell (and the agent, for game saves) may ask about the player at the PC. */
export const PLAYER_ACTIONS = [
  "overview", "rewards", "redeem", "inbox", "inbox_read", "leaderboard", "favorite", "prefs_set", "verify", "summary",
  "claim_code", "request_game", "players", "invite", "save_get", "save_put_begin", "save_put_chunk", "save_put_end",
] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

export interface SeatOrderLine {
  productId: string;
  quantity: number;
  modifierIds?: string[];
  notes?: string | null;
}

/** The in-seat menu: what this PC's customer can order right now (display data — the server re-prices every order). */
export interface SeatMenu {
  currency: string;
  canPayWithWallet: boolean;
  categories: Array<{
    id: string;
    name: string;
    products: Array<{
      id: string;
      name: string;
      description: string | null;
      price: string;
      available: boolean;
      modifierGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; modifiers: Array<{ id: string; name: string; priceDelta: string }> }>;
    }>;
  }>;
}

// ── WebSocket messages ──────────────────────────────────────────────────────

export interface DeviceMetrics {
  cpuPct?: number | null;
  gpuPct?: number | null;
  ramPct?: number | null;
  diskPct?: number | null;
  cpuTempC?: number | null;
  gpuTempC?: number | null;
  pingMs?: number | null;
  packetLossPct?: number | null;
  fps?: number | null;
  uptimeSec?: number | null;
  foregroundApp?: string | null;
  shellState?: string | null;
}

export interface HardwareSnapshot {
  cpu?: string | null;
  cpuCores?: number | null;
  gpu?: string | null;
  gpuVramMb?: number | null;
  ramMb?: number | null;
  motherboard?: string | null;
  biosVersion?: string | null;
  osVersion?: string | null;
  disks?: Array<{ model?: string; serial?: string; sizeGb?: number; freeGb?: number; smartStatus?: string }>;
  nics?: Array<{ name?: string; mac?: string; speedMbps?: number; ip?: string }>;
  monitors?: Array<Record<string, unknown>>;
}

export type DeviceToServer =
  | { type: "hello"; agentVersion: string; shellVersion?: string | null; ipAddress?: string | null; hostname?: string | null; macAddress?: string | null; activeSessionId?: string | null }
  | { type: "shell_login"; requestId: string; username: string; secret: string }
  | { type: "shell_logout"; requestId: string; sessionId: string }
  | { type: "heartbeat"; metrics: DeviceMetrics }
  | { type: "hardware"; snapshot: HardwareSnapshot }
  | ({ type: "ack" } & CommandAck)
  // Phase 5
  | { type: "inventory"; games: DetectedGame[]; apps?: DetectedApp[] }
  | { type: "peripherals"; items: DetectedPeripheral[] }
  | { type: "network"; probe: NetworkProbe }
  | { type: "boot"; report: BootReport }
  | { type: "game_event"; event: "started" | "exited"; gameId: string; sessionId?: string | null }
  | { type: "help_request"; requestId: string; topic: "general" | "game" | "peripheral" | "network" | "payment"; note?: string | null }
  | { type: "self_repair"; action: RepairAction; ok: boolean; detail?: string | null }
  // Phase 7 — in-seat food & drink ordering from the Shell
  | { type: "menu_request"; requestId: string }
  | { type: "place_order"; requestId: string; lines: SeatOrderLine[]; notes?: string | null; payWith: "BILL" | "WALLET" }
  | { type: "qr_login"; requestId: string }
  // The player at this PC (Shell) or their saves (agent): one request, one player_result.
  | { type: "player_request"; requestId: string; action: PlayerAction; args?: Record<string, unknown> }
  // Phase 9 — internet-café printing: the agent pauses every new job and asks
  | { type: "print_job"; job: PrintJobReport }
  | { type: "print_confirm"; jobKey: string; payWith: "BILL" | "WALLET" }
  | { type: "print_cancel"; jobKey: string }
  | { type: "print_done"; jobKey: string; ok: boolean; detail?: string | null };

/** A paused spooler job as the station sees it. jobKey = spooler id + submit time (unique per station). */
export interface PrintJobReport {
  jobKey: string;
  printerName: string;
  document: string | null;
  pages: number;
  copies: number;
  color: boolean;
}

/** What the customer is asked to approve on the Shell. */
export interface PrintQuote {
  jobKey: string;
  jobId: string;
  document: string | null;
  pages: number;
  copies: number;
  color: boolean;
  unitPrice: string;
  total: string;
  currency: string;
  canPayWithWallet: boolean;
  needsStaff: boolean;
  expiresAt: string;
  /** Why the customer is being asked again (e.g. the wallet couldn't cover it). */
  notice?: string | null;
}

export type ServerToDevice =
  | { type: "welcome"; serverTime: string; heartbeatSeconds: number; deviceName: string; venue?: { name: string; branchName: string; logoUrl: string | null } }
  | { type: "command"; command: SignedCommand }
  | { type: "config"; command: SignedCommand } // envelope.type = REFRESH_CONFIG, payload = StationConfig
  | { type: "shell_result"; requestId: string; ok: boolean; error?: string; message?: string; displayName?: string; timeBalanceMinutes?: number }
  | { type: "help_result"; requestId: string; ok: boolean; error?: string }
  | { type: "menu"; requestId: string; menu: SeatMenu | null; error?: string }
  | { type: "order_result"; requestId: string; ok: boolean; orderId?: string; number?: string; total?: string; currency?: string; error?: string; message?: string }
  // "Sign in with your phone": a one-time code for this PC, shown as a QR of `url`.
  | { type: "qr_login_code"; requestId: string; ok: boolean; code?: string; url?: string; expiresAt?: string; error?: string }
  | { type: "player_result"; requestId: string; ok: boolean; data?: unknown; error?: string; message?: string }
  | { type: "order_status"; orderId: string; number: string; status: "PREPARING" | "READY" | "SERVED"; message: string }
  | { type: "print_quote"; quote: PrintQuote }
  | { type: "print_status"; jobKey: string; status: "WAITING_STAFF" | "PRINTING" | "COMPLETED" | "CANCELLED" | "FAILED"; message: string }
  | { type: "error"; error: string };

/**
 * Device → server authentication: a short-lived JWT (ES256) signed with the
 * device's enrolment private key. Claims: iss = sub = deviceId, org, aud =
 * "arena:device", iat, exp (≤ 2 min), jti (single use).
 */
export const DEVICE_ASSERTION_AUDIENCE = "arena:device";

// ── Signing ─────────────────────────────────────────────────────────────────

const toKey = (k: string | KeyObject, kind: "private" | "public") =>
  typeof k === "string" ? (kind === "private" ? createPrivateKey(k) : createPublicKey(k)) : k;

export function signCommand(envelope: CommandEnvelope, privateKey: string | KeyObject, kid: string): SignedCommand {
  const text = JSON.stringify(envelope);
  const signature = sign("sha256", Buffer.from(text, "utf8"), { key: toKey(privateKey, "private"), dsaEncoding: "ieee-p1363" }).toString("base64");
  return { kid, envelope: text, signature };
}

export type VerifyFailure =
  | "BAD_SIGNATURE"
  | "MALFORMED"
  | "WRONG_DEVICE"
  | "WRONG_TENANT"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "REPLAYED"
  | "UNKNOWN_KEY"
  | "UNSUPPORTED_VERSION";

export interface VerifyOptions {
  /** Identity bound to this agent at enrolment — never taken from the message. */
  self: { organizationId: string; branchId: string; deviceId: string };
  publicKeys: Record<string, string | KeyObject>; // kid → PEM (pinned at enrolment)
  now?: Date;
  maxClockSkewMs?: number;
  /** Returns true if commandId was already seen (agent keeps a persisted, bounded set). */
  seen: (commandId: string) => boolean;
}

/** Reference verification logic; the .NET agent mirrors it exactly. */
export function verifyCommand(cmd: SignedCommand, opts: VerifyOptions): { ok: true; envelope: CommandEnvelope } | { ok: false; reason: VerifyFailure } {
  const pem = opts.publicKeys[cmd.kid];
  if (!pem) return { ok: false, reason: "UNKNOWN_KEY" };
  let valid = false;
  try {
    valid = verify("sha256", Buffer.from(cmd.envelope, "utf8"), { key: toKey(pem, "public"), dsaEncoding: "ieee-p1363" }, Buffer.from(cmd.signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "BAD_SIGNATURE" };

  let e: CommandEnvelope;
  try {
    e = JSON.parse(cmd.envelope);
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  const now = (opts.now ?? new Date()).getTime();
  const skew = opts.maxClockSkewMs ?? 30_000;
  if (e.v !== 1) return { ok: false, reason: "UNSUPPORTED_VERSION" };
  if (e.organizationId !== opts.self.organizationId || e.branchId !== opts.self.branchId) return { ok: false, reason: "WRONG_TENANT" };
  if (e.deviceId !== opts.self.deviceId) return { ok: false, reason: "WRONG_DEVICE" };
  if (Date.parse(e.issuedAt) - skew > now) return { ok: false, reason: "NOT_YET_VALID" };
  if (Date.parse(e.expiresAt) + skew < now) return { ok: false, reason: "EXPIRED" };
  if (opts.seen(e.commandId)) return { ok: false, reason: "REPLAYED" };
  return { ok: true, envelope: e };
}

/** Kept for other signed documents; commands no longer depend on it. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}
