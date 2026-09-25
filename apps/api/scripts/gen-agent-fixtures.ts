// Generates cross-language test vectors for the .NET agent: commands signed by
// the real server code (@arena/contracts), including tampered/misaddressed ones.
//   npx tsx apps/api/scripts/gen-agent-fixtures.ts
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { signCommand, type CommandEnvelope } from "@arena/contracts";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const other = generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const self = { organizationId: "0190a1b2-0000-7000-8000-00000000000a", branchId: "0190a1b2-0000-7000-8000-0000000000b1", deviceId: "0190a1b2-0000-7000-8000-0000000000d1" };
const now = "2026-09-25T12:00:00.000Z";
const env = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  v: 1,
  commandId: "0190a1b2-0000-7000-8000-00000000c001",
  ...self,
  type: "SEND_MESSAGE",
  payload: { title: "Message from staff", message: "Your burger is on its way! 🍔 — ñ", timeoutSeconds: 30 },
  requestedBy: { type: "EMPLOYEE", id: "0190a1b2-0000-7000-8000-0000000000e1" },
  issuedAt: now,
  expiresAt: "2026-09-25T12:02:00.000Z",
  nonce: "n0nce",
  ...over,
});

const valid = signCommand(env(), privateKey, "bk_test");
const tampered = { ...valid, envelope: valid.envelope.replace("burger", "pizza") };

const cases = [
  { name: "valid", expect: "Ok", command: valid },
  { name: "tampered", expect: "BadSignature", command: tampered },
  { name: "other_key", expect: "BadSignature", command: signCommand(env(), other.privateKey, "bk_test") },
  { name: "unknown_kid", expect: "UnknownKey", command: signCommand(env(), privateKey, "bk_nope") },
  { name: "wrong_device", expect: "WrongDevice", command: signCommand(env({ deviceId: "0190a1b2-0000-7000-8000-0000000000d2" }), privateKey, "bk_test") },
  { name: "wrong_tenant", expect: "WrongTenant", command: signCommand(env({ organizationId: "0190a1b2-0000-7000-8000-00000000000b" }), privateKey, "bk_test") },
  { name: "expired", expect: "Expired", command: signCommand(env({ expiresAt: "2026-09-25T11:00:00.000Z", issuedAt: "2026-09-25T10:59:00.000Z" }), privateKey, "bk_test") },
];

const out = resolve(import.meta.dirname, "../../../clients/windows/tests/Arena.Agent.Tests/fixtures");
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "commands.json"), JSON.stringify({ generatedBy: "apps/api/scripts/gen-agent-fixtures.ts", now, self, publicKeys: { bk_test: publicKey }, cases }, null, 2));
console.log(`wrote ${cases.length} cases → ${out}`);
