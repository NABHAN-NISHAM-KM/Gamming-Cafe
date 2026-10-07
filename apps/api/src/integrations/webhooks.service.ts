import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { Db, Prisma, TenantTx } from "@arena/db";
import { randomToken, seal, unseal } from "../auth/crypto.js";
import { DB } from "../common/db.module.js";
import { CONFIG, type AppConfig } from "../config.js";

/** Event families a venue may subscribe to. Staff, roles, billing and platform events never leave the venue. */
export const WEBHOOK_FAMILIES = ["booking", "customer", "giftcard", "loyalty", "membership", "order", "payment", "season", "session", "shift", "station", "stock", "ticket", "tournament", "waitlist", "wallet"] as const;
const FAMILY = new Set<string>(WEBHOOK_FAMILIES);

/** "giftcard.sell" is allowed to leave; "employee.create" is not. */
export const eventAllowed = (action: string) => FAMILY.has(action.split(".")[0] ?? "");

/** A subscription is "*" (everything allowed), "family.*" or an exact action. */
export const validPattern = (p: string) => p === "*" || (/^[a-z_]+\.(\*|[a-z_.]+)$/.test(p) && FAMILY.has(p.split(".")[0]!));
export const matches = (patterns: string[], action: string) =>
  eventAllowed(action) && patterns.some((p) => p === "*" || p === action || (p.endsWith(".*") && action.startsWith(p.slice(0, -1))));

/** Where a webhook may not point: this machine, the local network, link-local and cloud metadata addresses. */
export function blockedAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = v.startsWith("::ffff:") ? v.slice(7) : null;
  if (mapped && isIP(mapped) === 4) return blockedAddress(mapped);
  if (isIP(v) === 6) return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  const [a = 0, b = 0] = v.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** Backoff after the 1st, 2nd… failed attempt. After the last one the delivery gives up. */
export const RETRY_SECONDS = [60, 300, 1800, 7200, 43200];
const MAX_FAILURES = 20;
const BATCH = 50;

export interface Sent { status: number | null; error: string | null }

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Webhooks");
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly sweepMs = Number(process.env["WEBHOOK_SWEEP_MS"] ?? 10_000);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** ponytail: tests point webhooks at 127.0.0.1; production never sets this. */
  private get allowPrivate() {
    return process.env["WEBHOOK_ALLOW_PRIVATE"] === "1";
  }

  checkUrl(raw: string) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ConflictException({ error: "webhook_url_invalid" });
    }
    if (u.protocol !== "https:" && !(this.allowPrivate && u.protocol === "http:")) throw new ConflictException({ error: "webhook_url_needs_https" });
    if (u.username || u.password) throw new ConflictException({ error: "webhook_url_invalid" });
    if (!this.allowPrivate && isIP(u.hostname.replace(/^\[|\]$/g, "")) && blockedAddress(u.hostname.replace(/^\[|\]$/g, ""))) throw new ConflictException({ error: "webhook_url_private" });
    return u;
  }

  // ── managing endpoints ────────────────────────────────────────────────────

  async create(t: TenantTx, organizationId: string, i: { url: string; events: string[]; description?: string | null }) {
    this.checkUrl(i.url);
    const secret = `whsec_${randomToken(24)}`;
    // Only what happens from now on: events already in the audit trail are not replayed.
    const [{ head }] = await t.$queryRaw<[{ head: bigint }]>`SELECT COALESCE(MAX("chainSeq"), 0) AS head FROM "AuditLog"`;
    const row = await t.webhookEndpoint.create({
      data: { organizationId, url: i.url, events: [...new Set(i.events)], description: i.description ?? null, secretRef: seal(secret, this.cfg.MFA_ENCRYPTION_KEY_B64), cursorSeq: head },
    });
    return { row, secret };
  }

  async rotate(t: TenantTx, id: string) {
    const secret = `whsec_${randomToken(24)}`;
    const done = await t.webhookEndpoint.updateMany({ where: { id }, data: { secretRef: seal(secret, this.cfg.MFA_ENCRYPTION_KEY_B64) } });
    if (!done.count) throw new NotFoundException({ error: "not_found" });
    return secret;
  }

  async list(t: TenantTx) {
    const rows = await t.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } });
    const recent = await t.webhookDelivery.findMany({ where: { endpointId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, endpointId: true, eventType: true, status: true, attempts: true, lastStatus: true, lastError: true, createdAt: true, deliveredAt: true, nextAttemptAt: true } });
    return rows.map(({ secretRef: _s, cursorSeq: _c, ...r }) => ({ ...r, deliveries: recent.filter((d) => d.endpointId === r.id).slice(0, 15) }));
  }

  /** Queues a synthetic event so the venue can see their endpoint answer. */
  async ping(t: TenantTx, organizationId: string, endpointId: string) {
    const e = await t.webhookEndpoint.findUnique({ where: { id: endpointId }, select: { id: true } });
    if (!e) throw new NotFoundException({ error: "not_found" });
    const id = randomUUID();
    await t.webhookDelivery.create({ data: { organizationId, endpointId, eventId: id, eventType: "webhook.test", payload: envelope(id, "webhook.test", organizationId, new Date(), { actor: null, entity: null, data: { message: "Hello from ArenaOS" } }) } });
  }

  async retry(t: TenantTx, deliveryId: string) {
    const done = await t.webhookDelivery.updateMany({ where: { id: deliveryId, status: "FAILED" }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    if (!done.count) throw new NotFoundException({ error: "not_found" });
    await t.webhookEndpoint.updateMany({ where: { deliveries: { some: { id: deliveryId } }, isActive: false, disabledReason: { not: null } }, data: { isActive: true, failureCount: 0, disabledReason: null } });
  }

  // ── the worker ────────────────────────────────────────────────────────────

  /** Looks at audit entries newer than each endpoint's cursor and queues the ones it subscribed to. One transaction, so each event is queued once. */
  async enqueue(t: TenantTx, organizationId: string) {
    const endpoints = await t.webhookEndpoint.findMany({ where: { isActive: true } });
    for (const e of endpoints) {
      const rows = await t.auditLog.findMany({ where: { chainSeq: { gt: e.cursorSeq } }, orderBy: { chainSeq: "asc" }, take: 200 });
      if (!rows.length) continue;
      const data = rows
        .filter((r) => matches(e.events, r.action))
        .map((r) => ({
          organizationId, endpointId: e.id, eventId: r.id, eventType: r.action,
          payload: envelope(r.id, r.action, organizationId, r.createdAt, { actor: { type: r.actorType, id: r.actorId }, entity: { type: r.entityType, id: r.entityId }, branchId: r.branchId, data: r.after }) as Prisma.InputJsonValue,
        }));
      if (data.length) await t.webhookDelivery.createMany({ data, skipDuplicates: true });
      await t.webhookEndpoint.update({ where: { id: e.id }, data: { cursorSeq: rows[rows.length - 1]!.chainSeq } });
    }
  }

  /** One pass for one organization: queue, send what's due (outside any transaction), record the answers. */
  async tick(organizationId: string, at?: Date) {
    const ctx = { organizationId, actorType: "SYSTEM" as const, actorId: null };
    const due = await this.db.withTenant(ctx, async (t) => {
      await this.enqueue(t, organizationId);
      // Read the clock after queueing, so what was just queued is due in this same pass.
      const rows = await t.webhookDelivery.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: at ?? new Date() }, endpoint: { isActive: true } }, orderBy: { nextAttemptAt: "asc" }, take: BATCH, include: { endpoint: { select: { url: true, secretRef: true } } } });
      return rows.map((d) => ({ id: d.id, eventId: d.eventId, eventType: d.eventType, payload: d.payload, attempts: d.attempts, endpointId: d.endpointId, url: d.endpoint.url, secret: unseal(d.endpoint.secretRef, this.cfg.MFA_ENCRYPTION_KEY_B64) }));
    });
    if (!due.length) return 0;
    const results = await Promise.all(due.map(async (d) => ({ d, r: await this.send(d.url, d.secret, d.eventId, d.eventType, JSON.stringify(d.payload)) })));
    await this.db.withTenant(ctx, async (t) => {
      for (const { d, r } of results) {
        const ok = r.status !== null && r.status >= 200 && r.status < 300;
        const attempts = d.attempts + 1;
        const giveUp = !ok && attempts > RETRY_SECONDS.length;
        await t.webhookDelivery.update({
          where: { id: d.id },
          data: { attempts, lastStatus: r.status, lastError: ok ? null : (r.error ?? `HTTP ${r.status}`).slice(0, 300), status: ok ? "DELIVERED" : giveUp ? "FAILED" : "PENDING", deliveredAt: ok ? new Date() : null, nextAttemptAt: ok || giveUp ? undefined : new Date(Date.now() + RETRY_SECONDS[attempts - 1]! * 1000) },
        });
        if (ok) {
          await t.webhookEndpoint.update({ where: { id: d.endpointId }, data: { failureCount: 0, lastDeliveryAt: new Date() } });
        } else {
          const e = await t.webhookEndpoint.update({ where: { id: d.endpointId }, data: { failureCount: { increment: 1 }, lastDeliveryAt: new Date() }, select: { failureCount: true } });
          if (e.failureCount >= MAX_FAILURES) await t.webhookEndpoint.update({ where: { id: d.endpointId }, data: { isActive: false, disabledReason: "Switched off after 20 failed deliveries in a row." } });
        }
      }
    });
    return due.length;
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.db.global.$queryRaw<Array<{ organization_id: string }>>`SELECT * FROM app.webhook_orgs()`;
      for (const { organization_id } of orgs) await this.tick(organization_id).catch((e) => this.log.error(`webhooks ${organization_id}: ${e instanceof Error ? e.message : e}`));
    } finally {
      this.running = false;
    }
  }

  /**
   * POSTs the event. The address is checked when the connection is made, not
   * before, so a name that later points inside the network is still refused.
   * Redirects are not followed.
   */
  send(rawUrl: string, secret: string, eventId: string, eventType: string, body: string): Promise<Sent> {
    return new Promise((resolve) => {
      let u: URL;
      try {
        u = this.checkUrl(rawUrl);
      } catch {
        return resolve({ status: null, error: "The address isn't allowed." });
      }
      const ts = Math.floor(Date.now() / 1000);
      // Node may ask for one address or all of them: check every one it was given.
      const guard = (host: string, opts: { all?: boolean }, cb: (...a: any[]) => void) =>
        dnsLookup(host, opts as never, (err: Error | null, address: any, family: number) => {
          if (err) return cb(err);
          const ips: string[] = Array.isArray(address) ? address.map((a: { address: string }) => a.address) : [address];
          if (!this.allowPrivate && ips.some(blockedAddress)) return cb(new Error("The address points inside a private network."));
          cb(null, address, family);
        });
      const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
        u,
        {
          method: "POST", timeout: 5000, lookup: guard as never,
          headers: {
            "content-type": "application/json", "user-agent": "ArenaOS-Webhooks/1", "content-length": Buffer.byteLength(body),
            "arena-event": eventType, "arena-delivery": eventId,
            "arena-signature": `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode ?? null, error: null }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("No answer within 5 seconds.")));
      req.on("error", (e) => resolve({ status: null, error: e.message }));
      req.end(body);
    });
  }
}

function envelope(id: string, type: string, organizationId: string, at: Date, rest: { actor: unknown; entity: unknown; branchId?: string | null; data: unknown }): Prisma.InputJsonValue {
  return { id, type, organizationId, createdAt: at.toISOString(), ...rest } as Prisma.InputJsonValue;
}
