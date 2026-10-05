import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Just the slice of Stripe we use, over plain HTTPS (no SDK): a hosted Checkout
 * page for a one-off payment, and verifying the webhook that says it was paid.
 * STRIPE_API_BASE lets tests point this at a local stand-in.
 */
const base = () => (process.env["STRIPE_API_BASE"] ?? "https://api.stripe.com").replace(/\/+$/, "");

export interface CheckoutInput {
  /** In the currency's minor units (fils, cents). */
  amountMinor: number;
  currency: string;
  name: string;
  successUrl: string;
  cancelUrl: string;
  /** Our own references, echoed back on the webhook. */
  metadata: Record<string, string>;
  customerEmail?: string | null;
}

export async function createCheckout(secretKey: string, i: CheckoutInput): Promise<{ id: string; url: string }> {
  const form = new URLSearchParams({
    mode: "payment",
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": i.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(i.amountMinor),
    "line_items[0][price_data][product_data][name]": i.name,
    ...Object.fromEntries(Object.entries(i.metadata).map(([k, v]) => [`metadata[${k}]`, v])),
    ...(i.customerEmail ? { customer_email: i.customerEmail } : {}),
  });
  const r = await fetch(`${base()}/v1/checkout/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await r.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
  if (!r.ok || !body.id || !body.url) throw new Error(`stripe checkout failed: ${body.error?.message ?? r.status}`);
  return { id: body.id, url: body.url };
}

/**
 * Checks a Stripe-Signature header ("t=…,v1=…") against the raw body. Rejects
 * anything older than five minutes so a captured webhook can't be replayed.
 */
export function verifyWebhook(secret: string, rawBody: string, header: string | undefined, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const ts = Number(parts["t"]);
  const sig = parts["v1"];
  if (!ts || !sig || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** For tests and local stand-ins: a valid Stripe-Signature header. */
export function signWebhook(secret: string, rawBody: string, now = Date.now()) {
  const ts = Math.floor(now / 1000);
  return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`;
}

/**
 * Secrets are never stored in the database: a gateway row names where to find
 * them. "env:STRIPE_SECRET_PIXEL" reads that environment variable on the server.
 */
export function resolveSecret(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = /^env:([A-Z0-9_]{1,100})$/.exec(ref);
  return m ? (process.env[m[1]!] ?? null) : null;
}

export interface CompletedCheckout {
  id: string;
  paid: boolean;
  amountMinor: number;
  currency: string;
  metadata: Record<string, string>;
}

/** The parts of a "checkout.session.completed" event we act on, or null for any other event. */
export function completedCheckout(event: unknown): CompletedCheckout | null {
  const e = event as { type?: string; data?: { object?: { id?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: Record<string, string> } } };
  if (e?.type !== "checkout.session.completed" || !e.data?.object?.id) return null;
  const o = e.data.object;
  return { id: o.id!, paid: o.payment_status === "paid", amountMinor: Number(o.amount_total ?? 0), currency: String(o.currency ?? "").toUpperCase(), metadata: o.metadata ?? {} };
}
