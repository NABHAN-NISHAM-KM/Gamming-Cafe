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
  customer: { id: string | null; displayName: string; membershipTier?: string };
  startedAt: string;
  expiresAt: string | null;
  serverTime: string;
  warningMinutes: number[];
  postSessionAction: "LOCK" | "LOGOUT_WINDOWS" | "RESTART_SHELL" | "RESTART_PC" | "SHUTDOWN_PC" | "RESTORE_REBOOT";
  allowSelfExtend: boolean;
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
  | ({ type: "ack" } & CommandAck);

export type ServerToDevice =
  | { type: "welcome"; serverTime: string; heartbeatSeconds: number; deviceName: string; venue?: { name: string; branchName: string; logoUrl: string | null } }
  | { type: "command"; command: SignedCommand }
  | { type: "shell_result"; requestId: string; ok: boolean; error?: string; message?: string; displayName?: string; timeBalanceMinutes?: number }
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
