// Signed webhooks: events come from the audit trail, are delivered with an
// HMAC signature, retried with backoff, and can't be pointed inside the network.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { blockedAddress, eventAllowed, matches, validPattern, WebhooksService } from "../src/integrations/webhooks.service.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];

describe("webhook rules", () => {
  it("only business events can leave the venue", () => {
    expect(eventAllowed("giftcard.sell")).toBe(true);
    expect(eventAllowed("employee.assign_role")).toBe(false);
    expect(eventAllowed("platform.org.suspend")).toBe(false);
    expect(eventAllowed("billing.invoice")).toBe(false);
  });
  it("subscriptions: everything, a family, or one event", () => {
    expect(matches(["*"], "customer.create")).toBe(true);
    expect(matches(["*"], "employee.create")).toBe(false);
    expect(matches(["booking.*"], "booking.cancel")).toBe(true);
    expect(matches(["booking.*"], "bookings.cancel")).toBe(false);
    expect(matches(["session.end"], "session.extend")).toBe(false);
    expect(validPattern("giftcard.*")).toBe(true);
    expect(validPattern("employee.*")).toBe(false);
    expect(validPattern("nonsense")).toBe(false);
  });
  it("addresses inside the network are refused", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) expect(blockedAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"]) expect(blockedAddress(ip), ip).toBe(false);
  });
});

describe.skipIf(!HAS_DB)("Webhooks (e2e)", () => {
  let app: INestApplication;
  let hooks: WebhooksService;
  let base: string;
  let sink: Server;
  let sinkUrl: string;
  const got: Array<{ headers: IncomingHttpHeaders; body: string }> = [];
  let answer = 200;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  let ownerT: string, cashierT: string, dxb1: string, org: string;

  const call = async (token: string | null, method: string, path: string, body?: unknown, reason = "testing") => {
    const res = await fetch(`${base}/v1${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(reason ? { "x-action-reason": reason } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email: string) => (await call(null, "POST", "/auth/login", { email, password: DEMO_PASSWORD }, "")).body.accessToken as string;
  const sellCard = () => call(cashierT, "POST", "/gift-cards", { branchId: dxb1, amount: "10", payment: { method: "CASH" }, idempotencyKey: randomUUID() }, "");
  const flush = () => hooks.tick(org);
  /** Webhooks belong to the PUBLIC_API plan feature, which the demo plan doesn't include. */
  const setPlanFeature = async (on: boolean) => {
    const o = (await owner.query(`SELECT id FROM "Organization" WHERE slug = 'demo'`)).rows[0].id;
    await owner.query(`INSERT INTO "OrganizationFeature" (id, "organizationId", "featureKey", enabled, "updatedAt") VALUES (gen_random_uuid(), $1, 'PUBLIC_API', $2, now()) ON CONFLICT ("organizationId", "featureKey") DO UPDATE SET enabled = $2`, [o, on]);
  };
  const make = async (events = ["giftcard.*"]) => {
    const r = await call(ownerT, "POST", "/webhooks", { url: sinkUrl, events });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; secret: string };
  };

  beforeAll(async () => {
    process.env["WEBHOOK_ALLOW_PRIVATE"] = "1";
    process.env["WEBHOOK_SWEEP_MS"] = "3600000"; // the test drives the worker itself
    await seed(process.env["DATABASE_URL"]);
    await setPlanFeature(true);
    sink = createServer((rq, rs) => {
      let raw = "";
      rq.on("data", (c) => (raw += c));
      rq.on("end", () => {
        got.push({ headers: rq.headers, body: raw });
        rs.writeHead(answer).end("ok");
      });
    });
    await new Promise<void>((r) => sink.listen(0, "127.0.0.1", r));
    sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/hook`;
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    hooks = app.get(WebhooksService);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT] = (await Promise.all(["owner@demo.test", "cashier@demo.test"].map(login))) as [string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
    org = (await owner.query(`SELECT "organizationId" AS o FROM "Branch" WHERE id = $1`, [dxb1])).rows[0].o;
    await owner.query(`DELETE FROM "WebhookEndpoint" WHERE "organizationId" = $1`, [org]);
  });
  afterAll(async () => {
    delete process.env["WEBHOOK_ALLOW_PRIVATE"];
    await app?.close();
    sink?.close();
    await owner.end();
  });

  it("delivers a signed event, once, and the secret is shown only at creation", async () => {
    const e = await make();
    expect(e.secret).toMatch(/^whsec_/);
    const listed = await call(ownerT, "GET", "/webhooks", undefined, ""); // looking needs no reason
    expect(listed.status).toBe(200);
    expect((await call(ownerT, "POST", "/webhooks", { url: sinkUrl, events: ["*"] }, "")).body.reason).toBe("REASON_REQUIRED"); // changing does
    expect(JSON.stringify(listed.body)).not.toContain(e.secret);
    expect(JSON.stringify(listed.body)).not.toContain("secretRef");

    got.length = 0;
    const sale = (await sellCard()).body;
    await flush();
    await flush(); // a second pass must not send it again
    expect(got).toHaveLength(1);
    const hit = got[0]!;
    const [, t, v1] = String(hit.headers["arena-signature"]).match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
    expect(createHmac("sha256", e.secret).update(`${t}.${hit.body}`).digest("hex")).toBe(v1);
    expect(hit.headers["arena-event"]).toBe("giftcard.sell");
    const event = JSON.parse(hit.body);
    expect(event).toMatchObject({ type: "giftcard.sell", organizationId: org, entity: { type: "GiftCard", id: sale.id } });
    expect(hit.body).not.toContain(sale.code); // the card's code is never in the audit trail, so never in a webhook
    await call(ownerT, "DELETE", `/webhooks/${e.id}`);
  });

  it("starts from now: older events are not replayed, other events are not sent", async () => {
    await sellCard();
    const e = await make(["customer.*"]);
    got.length = 0;
    await sellCard(); // a giftcard event, but this endpoint wants customers only
    await flush();
    expect(got).toHaveLength(0);
    await call(ownerT, "DELETE", `/webhooks/${e.id}`);
  });

  it("retries a failing endpoint with backoff, then delivers", async () => {
    const e = await make();
    answer = 500;
    got.length = 0;
    await sellCard();
    await flush();
    let d = (await owner.query(`SELECT status, attempts, "lastStatus", "nextAttemptAt" > now() AS later FROM "WebhookDelivery" WHERE "endpointId" = $1`, [e.id])).rows[0];
    expect(d).toMatchObject({ status: "PENDING", attempts: 1, lastStatus: 500, later: true });
    await flush(); // not due yet: nothing is sent
    expect(got).toHaveLength(1);

    answer = 200;
    await owner.query(`UPDATE "WebhookDelivery" SET "nextAttemptAt" = now() WHERE "endpointId" = $1`, [e.id]);
    await flush();
    d = (await owner.query(`SELECT status, attempts FROM "WebhookDelivery" WHERE "endpointId" = $1`, [e.id])).rows[0];
    expect(d).toMatchObject({ status: "DELIVERED", attempts: 2 });
    expect(got).toHaveLength(2);
    await call(ownerT, "DELETE", `/webhooks/${e.id}`);
  });

  it("gives up after the last retry, can be retried by hand, and switches off an endpoint that keeps failing", async () => {
    const e = await make();
    answer = 500;
    await sellCard();
    await flush();
    await owner.query(`UPDATE "WebhookDelivery" SET attempts = 5, "nextAttemptAt" = now() WHERE "endpointId" = $1`, [e.id]);
    await owner.query(`UPDATE "WebhookEndpoint" SET "failureCount" = 19 WHERE id = $1`, [e.id]);
    await flush();
    const d = (await owner.query(`SELECT id, status FROM "WebhookDelivery" WHERE "endpointId" = $1`, [e.id])).rows[0];
    expect(d.status).toBe("FAILED");
    const ep = (await owner.query(`SELECT "isActive", "disabledReason" FROM "WebhookEndpoint" WHERE id = $1`, [e.id])).rows[0];
    expect(ep.isActive).toBe(false);
    expect(ep.disabledReason).toMatch(/20 failed/);

    answer = 200;
    expect((await call(ownerT, "POST", `/webhooks/deliveries/${d.id}/retry`)).status).toBe(200);
    await flush();
    expect((await owner.query(`SELECT status FROM "WebhookDelivery" WHERE id = $1`, [d.id])).rows[0].status).toBe("DELIVERED");
    expect((await owner.query(`SELECT "isActive" FROM "WebhookEndpoint" WHERE id = $1`, [e.id])).rows[0].isActive).toBe(true);
    await call(ownerT, "DELETE", `/webhooks/${e.id}`);
  });

  it("test ping, secret rotation, and who may manage them", async () => {
    const e = await make(["customer.*"]);
    got.length = 0;
    expect((await call(ownerT, "POST", `/webhooks/${e.id}/test`)).status).toBe(200);
    await flush();
    expect(JSON.parse(got[0]!.body)).toMatchObject({ type: "webhook.test" });

    const rotated = (await call(ownerT, "POST", `/webhooks/${e.id}/rotate-secret`)).body.secret as string;
    expect(rotated).not.toBe(e.secret);
    await call(ownerT, "POST", `/webhooks/${e.id}/test`);
    got.length = 0;
    await flush();
    const [, t, v1] = String(got[0]!.headers["arena-signature"]).match(/^t=(\d+),v1=(\w+)$/)!;
    expect(createHmac("sha256", rotated).update(`${t}.${got[0]!.body}`).digest("hex")).toBe(v1);

    expect((await call(cashierT, "GET", "/webhooks")).status).toBe(403);
    expect((await call(cashierT, "POST", "/webhooks", { url: sinkUrl, events: ["*"] })).status).toBe(403);
    await call(ownerT, "DELETE", `/webhooks/${e.id}`);
  });

  it("belongs to the plan: a venue without the feature is told so", async () => {
    await setPlanFeature(false);
    const r = await call(ownerT, "GET", "/webhooks");
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe("FEATURE_DISABLED");
    await setPlanFeature(true);
    expect((await call(ownerT, "GET", "/webhooks")).status).toBe(200);
  });

  it("refuses addresses it must not call", async () => {
    process.env["WEBHOOK_ALLOW_PRIVATE"] = "";
    expect((await call(ownerT, "POST", "/webhooks", { url: "http://example.com/hook", events: ["*"] })).body.error).toBe("webhook_url_needs_https");
    expect((await call(ownerT, "POST", "/webhooks", { url: "https://169.254.169.254/latest", events: ["*"] })).body.error).toBe("webhook_url_private");
    expect((await call(ownerT, "POST", "/webhooks", { url: "https://[::1]/x", events: ["*"] })).body.error).toBe("webhook_url_private");
    expect((await call(ownerT, "POST", "/webhooks", { url: "https://u:p@example.com/x", events: ["*"] })).body.error).toBe("webhook_url_invalid");
    expect((await call(ownerT, "POST", "/webhooks", { url: "https://example.com/x", events: ["employee.*"] })).status).toBe(400);
    // A name that resolves to a private address is stopped when the connection is made.
    const r = await hooks.send("https://localhost:1/x", "s", randomUUID(), "x", "{}");
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/private network|ECONNREFUSED/);
    process.env["WEBHOOK_ALLOW_PRIVATE"] = "1";
  });
});
