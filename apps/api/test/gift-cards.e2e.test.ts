// Gift cards: sold at the counter (held as a liability), redeemed once into a
// wallet, and the ledger agrees with the cards still outstanding.
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../src/main.js";
import { loadConfig } from "../src/config.js";
import { giftCodeHash } from "../src/customers/commerce.service.js";
import { seed, DEMO_PASSWORD } from "../scripts/seed.js";

const HAS_DB = !!process.env["APP_DATABASE_URL"] && !!process.env["DATABASE_URL"] && !!process.env["COMMAND_KEK_B64"];
const key = () => randomUUID();

describe("gift card codes", () => {
  it("are matched however they're typed", () => {
    expect(giftCodeHash("abcd-efgh-jkmn-pqrs")).toBe(giftCodeHash("ABCD EFGH JKMN PQRS"));
    expect(giftCodeHash("ABCDEFGHJKMNPQRS")).not.toBe(giftCodeHash("ABCDEFGHJKMNPQRT"));
  });
});

describe.skipIf(!HAS_DB)("Gift cards (e2e)", () => {
  let app: INestApplication;
  let base: string;
  const owner = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });
  let ownerT: string, cashierT: string, dxb1: string;

  const call = async (token: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/v1${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email: string) => (await call(null, "POST", "/auth/login", { email, password: DEMO_PASSWORD })).body.accessToken as string;
  const player = async () => {
    const username = `g${randomUUID().slice(0, 8)}`;
    const made = await call(cashierT, "POST", "/customers", { username, displayName: `Gus ${username}`, password: "longpassword1" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const token = (await call(null, "POST", "/app/demo/login", { username, password: "longpassword1" })).body.accessToken as string;
    return { id: made.body.id as string, token };
  };
  const sell = (amount: string, extra: object = {}) => call(cashierT, "POST", "/gift-cards", { branchId: dxb1, amount, payment: { method: "CASH" }, idempotencyKey: key(), ...extra });
  const cash = async (id: string) => Number((await call(cashierT, "GET", `/customers/${id}/wallet`)).body.cash);

  beforeAll(async () => {
    await seed(process.env["DATABASE_URL"]);
    app = await createApp(loadConfig({ NODE_ENV: "test" }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [ownerT, cashierT] = (await Promise.all(["owner@demo.test", "cashier@demo.test"].map(login))) as [string, string];
    dxb1 = ((await call(ownerT, "GET", "/branches")).body as any[]).find((b) => b.code === "DXB1").id;
  });
  afterAll(async () => {
    await app?.close();
    await owner.end();
  });

  it("sells a card: the code is shown once and only its hash is stored", async () => {
    const r = await sell("50");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    const row = (await owner.query(`SELECT "codeHash", "codeHint", status, amount::text FROM "GiftCard" WHERE id = $1`, [r.body.id])).rows[0];
    expect(row.codeHash).toBe(giftCodeHash(r.body.code));
    expect(row.codeHash).not.toContain(r.body.code.replace(/-/g, ""));
    expect(row).toMatchObject({ status: "ACTIVE", codeHint: r.body.code.slice(-4) });
    const bill = (await owner.query(`SELECT l."productType", l."taxAmount"::text AS tax FROM "OrderItem" l JOIN "Order" o ON o.id = l."orderId" WHERE o."billId" = (SELECT "billId" FROM "GiftCard" WHERE id = $1)`, [r.body.id])).rows[0];
    expect(bill).toMatchObject({ productType: "GIFT_CARD", tax: "0.0000" });
    const list = await call(cashierT, "GET", "/gift-cards?status=ACTIVE");
    expect(list.body.cards.some((c: any) => c.id === r.body.id)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(r.body.code);
  });

  it("a retry with the same key does not make a second card or show the code again", async () => {
    const k = key();
    const first = await sell("20", { idempotencyKey: k });
    const again = await sell("20", { idempotencyKey: k });
    expect(again.body).toEqual({ duplicate: true });
    const n = await owner.query(`SELECT count(*)::int AS n FROM "GiftCard" WHERE id = $1`, [first.body.id]);
    expect(n.rows[0].n).toBe(1);
  });

  it("redeems once: the wallet is credited, a second try and a wrong code are refused alike", async () => {
    const card = (await sell("30")).body;
    const p = await player();
    const before = await cash(p.id);
    const r = await call(p.token, "POST", "/app/wallet/gift-card", { code: card.code.toLowerCase() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ amount: "30.00" });
    expect(await cash(p.id)).toBe(before + 30);

    const other = await player();
    const reuse = await call(other.token, "POST", "/app/wallet/gift-card", { code: card.code });
    const wrong = await call(other.token, "POST", "/app/wallet/gift-card", { code: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toBe("gift_card_invalid");
    expect(wrong.body).toEqual(reuse.body);
    expect(await cash(other.id)).toBe(0);
  });

  it("two people racing for one card: exactly one wins", async () => {
    const card = (await sell("15")).body;
    const [a, b] = [await player(), await player()];
    const rs = await Promise.all([a, b].map((x) => call(x.token, "POST", "/app/wallet/gift-card", { code: card.code })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await cash(a.id)) + (await cash(b.id))).toBe(15);
  });

  it("repeated wrong guesses are throttled", async () => {
    const p = await player();
    const codes = Array.from({ length: 8 }, () => call(p.token, "POST", "/app/wallet/gift-card", { code: "WRONG-CODE-GUESS" }));
    const statuses = (await Promise.all(codes)).map((r) => r.status);
    expect(statuses).toContain(429);
  });

  it("the ledger agrees with the cards still outstanding", async () => {
    await call(ownerT, "POST", "/accounting/sync");
    const r = (await call(ownerT, "GET", "/accounting/reconciliation")).body;
    expect(r.unposted).toBe(0);
    for (const k of ["GIFT_CARD_LIABILITY", "WALLET_LIABILITY"]) {
      const c = r.checks.find((x: any) => x.key === k);
      expect(c, JSON.stringify(r.checks)).toMatchObject({ ok: true });
    }
  });

  it("cannot be redeemed twice at the database level either", async () => {
    const card = (await sell("5")).body;
    const row = (await owner.query(`SELECT id, "organizationId" FROM "GiftCard" WHERE id = $1`, [card.id])).rows[0];
    await expect(owner.query(`UPDATE "GiftCard" SET status = 'REDEEMED', "redeemedAt" = now() WHERE id = $1`, [row.id])).rejects.toThrow(/gift_card_state/);
  });
});
