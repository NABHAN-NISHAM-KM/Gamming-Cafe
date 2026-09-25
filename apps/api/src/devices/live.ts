import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import type { DeviceMetrics, ServerToDevice } from "@arena/contracts";

// ── Live Floor events ───────────────────────────────────────────────────────
// In-process pub/sub keyed by org+branch. Single API instance for now; with
// several instances (or cloud + edge) this becomes Redis pub/sub (phase 13)
// behind the same interface.

export type FloorEvent =
  | { type: "device"; device: Record<string, unknown> }
  | { type: "metrics"; deviceId: string; metrics: DeviceMetrics; at: string }
  | { type: "command"; command: { id: string; deviceId: string; type: string; status: string; errorMessage?: string | null; completedAt?: string | null } }
  | { type: "alert"; alert: Record<string, unknown> };

@Injectable()
export class LiveBus {
  private readonly ee = new EventEmitter().setMaxListeners(0);
  private key = (org: string, branch: string) => `${org}:${branch}`;

  publish(org: string, branch: string, e: FloorEvent) {
    this.ee.emit(this.key(org, branch), e);
  }

  subscribe(org: string, branch: string, fn: (e: FloorEvent) => void): () => void {
    const k = this.key(org, branch);
    this.ee.on(k, fn);
    return () => this.ee.off(k, fn);
  }
}

// ── Connected agents ────────────────────────────────────────────────────────

export interface Connection {
  socket: WebSocket;
  deviceId: string;
  organizationId: string;
  branchId: string;
  connectedAt: number;
  lastMessageAt: number;
  lastPersistAt: number;
  metrics: DeviceMetrics | null;
  metricsAt: number | null;
  /** Alert types currently raised for this connection (null = not yet synced with the DB). */
  alerts: Map<string, "WARNING" | "CRITICAL"> | null;
}

@Injectable()
export class DeviceHub {
  private readonly conns = new Map<string, Connection>();
  /** When a device went offline (for the "client offline" alert grace period). */
  readonly offlineSince = new Map<string, { at: number; organizationId: string; branchId: string }>();

  add(c: Connection) {
    this.conns.get(c.deviceId)?.socket.close(4000, "replaced by a newer connection");
    this.conns.set(c.deviceId, c);
    this.offlineSince.delete(c.deviceId);
  }

  remove(deviceId: string, socket: WebSocket): Connection | undefined {
    const c = this.conns.get(deviceId);
    if (c && c.socket === socket) {
      this.conns.delete(deviceId);
      this.offlineSince.set(deviceId, { at: Date.now(), organizationId: c.organizationId, branchId: c.branchId });
      return c;
    }
    return undefined;
  }

  get(deviceId: string) {
    return this.conns.get(deviceId);
  }

  isOnline(deviceId: string) {
    return this.conns.has(deviceId);
  }

  all() {
    return [...this.conns.values()];
  }

  send(deviceId: string, msg: ServerToDevice): boolean {
    const c = this.conns.get(deviceId);
    if (!c || c.socket.readyState !== c.socket.OPEN) return false;
    c.socket.send(JSON.stringify(msg));
    return true;
  }

  /** Live metrics for a device, if connected and fresh. */
  live(deviceId: string) {
    const c = this.conns.get(deviceId);
    return c ? { metrics: c.metrics, metricsAt: c.metricsAt ? new Date(c.metricsAt).toISOString() : null } : null;
  }
}
