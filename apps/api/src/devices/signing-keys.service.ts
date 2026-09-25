import { Inject, Injectable } from "@nestjs/common";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { TenantTx } from "@arena/db";
import { signCommand, type CommandEnvelope, type SignedCommand } from "@arena/contracts";
import { CONFIG, type AppConfig } from "../config.js";
import { seal, unseal } from "../auth/crypto.js";

/**
 * Per-branch ECDSA P-256 command-signing keys. Private keys are stored sealed
 * with COMMAND_KEK (a KMS/HSM key in production) and only unsealed in memory
 * to sign. Agents receive and pin the public keys at enrolment.
 */
@Injectable()
export class SigningKeysService {
  private readonly cache = new Map<string, { kid: string; privatePem: string }>();

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  /** Active key for the branch, created on first use. Race-safe: at most one ACTIVE row wins per call. */
  async active(tx: TenantTx, branchId: string): Promise<{ kid: string; privatePem: string; publicPem: string }> {
    let row = await tx.branchSigningKey.findFirst({ where: { branchId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    if (!row) {
      const { privateKey, publicKey } = generateKeyPairSync("ec", {
        namedCurve: "P-256",
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      row = await tx.branchSigningKey.create({
        data: {
          organizationId: (await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { organizationId: true } })).organizationId,
          branchId,
          kid: `bk_${randomBytes(9).toString("base64url")}`,
          publicKeyPem: publicKey,
          privateKeySealed: seal(privateKey, this.cfg.COMMAND_KEK_B64),
        },
      });
    }
    const cached = this.cache.get(row.kid);
    const privatePem = cached?.privatePem ?? unseal(row.privateKeySealed, this.cfg.COMMAND_KEK_B64);
    this.cache.set(row.kid, { kid: row.kid, privatePem });
    return { kid: row.kid, privatePem, publicPem: row.publicKeyPem };
  }

  /** Public keys an agent should trust for this branch (active + retiring during rotation). */
  async publicKeys(tx: TenantTx, branchId: string): Promise<Record<string, string>> {
    await this.active(tx, branchId);
    const rows = await tx.branchSigningKey.findMany({ where: { branchId, status: { in: ["ACTIVE", "RETIRING"] } }, select: { kid: true, publicKeyPem: true } });
    return Object.fromEntries(rows.map((r) => [r.kid, r.publicKeyPem]));
  }

  async sign(tx: TenantTx, envelope: CommandEnvelope): Promise<SignedCommand> {
    const key = await this.active(tx, envelope.branchId);
    return signCommand(envelope, key.privatePem, key.kid);
  }
}
