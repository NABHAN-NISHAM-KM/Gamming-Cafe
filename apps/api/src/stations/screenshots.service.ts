import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Db } from "@arena/db";
import { DB } from "../common/db.module.js";
import { DeviceGateway } from "../devices/device-gateway.js";
import type { Connection } from "../devices/live.js";

export const SCREENSHOT_MAX_BYTES = 2_000_000;
export const SCREENSHOT_THUMB_MAX_BYTES = 120_000;
export const SCREENSHOT_KEEP_DAYS = 30;
/** Per customer: at most this many a day, and this many kept (oldest go first). */
export const SCREENSHOT_DAILY_LIMIT = 60;
export const SCREENSHOT_KEEP_MAX = 100;
const UPLOAD_TTL_MS = 2 * 60_000;

/** A JPEG starts FF D8 FF and ends FF D9. Enough to refuse anything that isn't one. */
export function isJpeg(b: Buffer): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
}

interface Upload { size: number; width: number; height: number; thumb: Buffer; parts: Buffer[]; received: number; startedAt: number }

/**
 * Screenshots from the Gaming Shell (Print Screen / the taskbar camera). The
 * PC sends a JPEG in pieces over its socket (the socket carries at most 256 KB
 * per message); this puts it back together, checks it, and keeps it on the
 * signed-in customer's account for 30 days (customer app → Screenshots).
 * Guests have no account, so theirs are refused.
 */
@Injectable()
export class ScreenshotsService implements OnModuleInit {
  private readonly uploads = new Map<string, Upload>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DeviceGateway) private readonly gateway: DeviceGateway,
  ) {}

  onModuleInit() {
    this.gateway.handleStation("screenshot_begin", async (c, m) => this.begin(c, m.id, m.sizeBytes, m.width, m.height, m.thumb));
    this.gateway.handleStation("screenshot_chunk", async (c, m) => this.chunk(c, m.id, m.seq, m.data));
    this.gateway.handleStation("screenshot_end", (c, m) => this.end(c, m.id));
  }

  begin(c: Connection, id: string, size: number, width: number, height: number, thumbB64: string) {
    const now = Date.now();
    for (const [k, u] of this.uploads) if (now - u.startedAt > UPLOAD_TTL_MS) this.uploads.delete(k);
    // One upload at a time per PC is plenty; a second begin replaces the first.
    for (const k of this.uploads.keys()) if (k.startsWith(`${c.deviceId}:`)) this.uploads.delete(k);
    const thumb = Buffer.from(thumbB64, "base64");
    if (!isJpeg(thumb) || thumb.length > SCREENSHOT_THUMB_MAX_BYTES) return;
    this.uploads.set(`${c.deviceId}:${id}`, { size, width, height, thumb, parts: [], received: 0, startedAt: now });
  }

  chunk(c: Connection, id: string, seq: number, dataB64: string) {
    const key = `${c.deviceId}:${id}`;
    const u = this.uploads.get(key);
    if (!u) return;
    const part = Buffer.from(dataB64, "base64");
    if (seq !== u.parts.length || u.received + part.length > u.size) { this.uploads.delete(key); return; } // out of order or too big
    u.parts.push(part);
    u.received += part.length;
  }

  async end(c: Connection, id: string): Promise<Record<string, unknown>> {
    const key = `${c.deviceId}:${id}`;
    const u = this.uploads.get(key);
    this.uploads.delete(key);
    if (!u || u.received !== u.size) return { ok: false, error: "incomplete", message: "The screenshot didn't arrive in one piece. Try again." };
    const image = Buffer.concat(u.parts, u.size);
    if (!isJpeg(image)) return { ok: false, error: "not_jpeg", message: "That wasn't a picture." };

    return this.db.withTenant({ organizationId: c.organizationId, actorType: "DEVICE", actorId: c.deviceId }, async (t) => {
      const s = await t.gamingSession.findFirst({ where: { deviceId: c.deviceId, status: { in: ["ACTIVE", "PAUSED", "ENDING"] } }, select: { id: true, customerId: true } });
      if (!s?.customerId) return { ok: false, error: "guest", message: "Sign in with your account to keep screenshots." };
      const now = new Date();
      await t.screenshot.deleteMany({ where: { customerId: s.customerId, expiresAt: { lt: now } } });
      const today = await t.screenshot.count({ where: { customerId: s.customerId, takenAt: { gt: new Date(now.getTime() - 86_400_000) } } });
      if (today >= SCREENSHOT_DAILY_LIMIT) return { ok: false, error: "daily_limit", message: `That's ${SCREENSHOT_DAILY_LIMIT} screenshots today — the most for one day.` };
      await t.screenshot.create({
        data: {
          organizationId: c.organizationId, customerId: s.customerId, deviceId: c.deviceId, sessionId: s.id,
          image: new Uint8Array(image), thumb: new Uint8Array(u.thumb), width: u.width, height: u.height, sizeBytes: u.size,
          expiresAt: new Date(now.getTime() + SCREENSHOT_KEEP_DAYS * 86_400_000),
        },
      });
      const extra = await t.screenshot.findMany({ where: { customerId: s.customerId }, orderBy: { takenAt: "desc" }, skip: SCREENSHOT_KEEP_MAX, select: { id: true } });
      if (extra.length) await t.screenshot.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
      return { ok: true, message: "Screenshot saved — see it in the Arena app under Screenshots." };
    });
  }
}
