import { describe, expect, it } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { canonicalize, signCommand, verifyCommand, type CommandEnvelope } from "../src/device-protocol.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
const self = { organizationId: "org-a", branchId: "br-1", deviceId: "pc-17" };
const NOW = new Date("2026-09-23T12:00:00Z");

function envelope(over: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    v: 1,
    commandId: randomUUID(),
    ...self,
    type: "START_SESSION",
    payload: { sessionId: "s1", expiresAt: "2026-09-23T14:00:00Z" },
    requestedBy: { type: "EMPLOYEE", id: "emp-1" },
    issuedAt: "2026-09-23T12:00:00Z",
    expiresAt: "2026-09-23T12:01:00Z",
    nonce: "n1",
    ...over,
  };
}

const opts = (seen = new Set<string>()) => ({ self, publicKeys: { k1: publicKey }, now: NOW, seen: (id: string) => seen.has(id) });

describe("canonicalize", () => {
  it("sorts keys recursively and is stable", () => {
    expect(canonicalize({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});

describe("signed device commands (ES256, sign-the-bytes)", () => {
  it("accepts a valid command and returns the parsed envelope", () => {
    const res = verifyCommand(signCommand(envelope(), privateKey, "k1"), opts());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.envelope.deviceId).toBe("pc-17");
  });

  it("signature is 64 bytes (IEEE-P1363 r||s, as .NET ECDsa expects)", () => {
    expect(Buffer.from(signCommand(envelope(), privateKey, "k1").signature, "base64")).toHaveLength(64);
  });

  it("rejects tampering (e.g. a customer editing expiresAt to get free time)", () => {
    const cmd = signCommand(envelope(), privateKey, "k1");
    cmd.envelope = cmd.envelope.replace("2026-09-23T14:00:00Z", "2026-09-24T14:00:00Z");
    expect(verifyCommand(cmd, opts())).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("rejects commands signed by another key or with an unknown key id", () => {
    expect(verifyCommand(signCommand(envelope(), other.privateKey, "k1"), opts())).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyCommand(signCommand(envelope(), privateKey, "k9"), opts())).toEqual({ ok: false, reason: "UNKNOWN_KEY" });
  });

  it("rejects a valid command addressed to another PC or tenant", () => {
    expect(verifyCommand(signCommand(envelope({ deviceId: "pc-18" }), privateKey, "k1"), opts())).toEqual({ ok: false, reason: "WRONG_DEVICE" });
    expect(verifyCommand(signCommand(envelope({ organizationId: "org-b" }), privateKey, "k1"), opts())).toEqual({ ok: false, reason: "WRONG_TENANT" });
  });

  it("rejects expired and replayed commands", () => {
    expect(verifyCommand(signCommand(envelope({ expiresAt: "2026-09-23T11:00:00Z" }), privateKey, "k1"), opts())).toEqual({ ok: false, reason: "EXPIRED" });
    const cmd = signCommand(envelope(), privateKey, "k1");
    const id = JSON.parse(cmd.envelope).commandId;
    expect(verifyCommand(cmd, opts(new Set([id])))).toEqual({ ok: false, reason: "REPLAYED" });
  });
});
