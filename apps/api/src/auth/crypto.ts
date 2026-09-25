import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// ── Passwords (argon2id, OWASP-recommended parameters) ──────────────────────

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string) => hash(plain, ARGON);
export const verifySecret = async (hashed: string, plain: string) => {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
};

/** Constant work for unknown users so login timing doesn't reveal which emails exist. */
let dummyHash: Promise<string> | undefined;
export const burnVerify = async (plain: string) => {
  dummyHash ??= hashSecret("arenaos-timing-equaliser");
  await verifySecret(await dummyHash, plain);
  return false;
};

// ── Opaque tokens (refresh tokens) ──────────────────────────────────────────

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

// ── AES-256-GCM for small secrets at rest (MFA seeds) ───────────────────────
// Production: replace the static key with KMS envelope encryption.

export function seal(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function unseal(sealed: string, keyB64: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unsupported sealed secret");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

// ── TOTP (RFC 6238: SHA-1, 30 s, 6 digits — what authenticator apps expect) ─

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secretB32: string, time: number, step = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

/**
 * Accepts the current step ±1 to tolerate clock drift. Returns the matched
 * time-step so callers can refuse a step that was already used (replay).
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const w of [-1, 0, 1]) {
    const t = now + w * 30_000;
    if (timingSafeEqual(Buffer.from(totpAt(secretB32, t)), Buffer.from(code))) return Math.floor(t / 30_000);
  }
  return null;
}

export const otpauthUrl = (secretB32: string, account: string, issuer = "ArenaOS") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
