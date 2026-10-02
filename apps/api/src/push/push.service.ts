import { Inject, Injectable, Logger } from "@nestjs/common";
import webpush from "web-push";
import type { Db, TenantTx } from "@arena/db";
import { DB } from "../common/db.module.js";
import { requestStore } from "../common/request-state.js";
import { CONFIG, type AppConfig } from "../config.js";

export interface PushMessage {
  customerId: string;
  /** What happened, e.g. "session.ending" — kept on the Notification row. */
  event: string;
  title: string;
  body: string;
  /** Opens this screen of the customer app when tapped (e.g. "home", "inbox"). */
  screen?: string;
  /** Same key → sent once, however often it's asked for. */
  dedupeKey: string;
  branchId?: string | null;
}

/**
 * Web push to the customer app ("10 minutes left", "your food is ready"…).
 * Each message is a Notification row (channel PUSH, unique dedupe key), so a
 * retried sweep never buzzes a phone twice; the send itself happens after the
 * surrounding transaction commits. Without VAPID keys push is simply off.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger("Push");
  readonly enabled: boolean;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {
    this.enabled = !!cfg.VAPID_PUBLIC_KEY && !!cfg.VAPID_PRIVATE_KEY;
    if (this.enabled) webpush.setVapidDetails(cfg.VAPID_SUBJECT, cfg.VAPID_PUBLIC_KEY!, cfg.VAPID_PRIVATE_KEY!);
  }

  get publicKey() {
    return this.enabled ? this.cfg.VAPID_PUBLIC_KEY! : null;
  }

  async notify(t: TenantTx, m: PushMessage) {
    if (!this.enabled) return;
    const subs = await t.pushSubscription.findMany({ where: { customerId: m.customerId, platform: "WEB_PUSH" }, select: { id: true, token: true, organizationId: true } });
    if (!subs.length) return;
    const made = await t.notification.createMany({
      data: [{ organizationId: subs[0]!.organizationId, branchId: m.branchId ?? null, recipientType: "CUSTOMER", customerId: m.customerId, channel: "PUSH", event: m.event, title: m.title, body: m.body, data: { screen: m.screen ?? "home" }, status: "SENT", sentAt: new Date(), dedupeKey: m.dedupeKey }],
      skipDuplicates: true,
    });
    if (!made.count) return; // already sent
    const payload = JSON.stringify({ title: m.title, body: m.body, screen: m.screen ?? "home", tag: m.event });
    const send = () => void this.deliver(subs[0]!.organizationId, subs, payload);
    // ponytail: outside a request the send isn't tied to the commit; a rolled-back sweep could still buzz once.
    const req = requestStore.getStore();
    if (req) req.afterCommit.push(send);
    else setImmediate(send);
  }

  private async deliver(organizationId: string, subs: Array<{ id: string; token: string }>, payload: string) {
    const gone: string[] = [];
    await Promise.all(
      subs.map((s) =>
        webpush.sendNotification(JSON.parse(s.token), payload, { TTL: 600 }).catch((e: { statusCode?: number; message?: string }) => {
          if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.id); // unsubscribed or expired
          else this.log.warn(`push failed (${e.statusCode ?? "?"}): ${e.message ?? e}`);
        }),
      ),
    );
    if (gone.length) await this.db.withTenant({ organizationId, actorType: "SYSTEM", actorId: null }, (t) => t.pushSubscription.deleteMany({ where: { id: { in: gone } } })).catch(() => undefined);
  }
}
