import { Body, Controller, ForbiddenException, HttpCode, HttpException, Inject, Injectable, Post, UnauthorizedException } from "@nestjs/common";
import { createHash, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db, TenantTx } from "@arena/db";
import { CONFIG, type AppConfig } from "../config.js";
import { DB } from "../common/db.module.js";
import { Public } from "../common/decorators.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DEVICE_WS_PATH } from "./device-gateway.js";
import { SigningKeysService } from "./signing-keys.service.js";

// Crockford-ish alphabet: no 0/O/1/I/L confusion when typed from a screen.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** 20 chars ≈ 98 bits: unguessable, still typeable ("ARENA-XXXXX-XXXXX-XXXXX-XXXXX"). */
export function newEnrollmentCode(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `ARENA-${chars.match(/.{5}/g)!.join("-")}`;
}
export const hashEnrollmentCode = (code: string) =>
  createHash("sha256").update(code.trim().toUpperCase().replace(/\s+/g, "")).digest("hex");

const Enroll = z
  .object({
    enrollmentCode: z.string().min(10).max(64),
    publicKeyPem: z.string().min(100).max(1000),
    hostname: z.string().max(64).nullish(),
    macAddress: z.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/).nullish(),
    requestedName: z.string().regex(/^[A-Za-z0-9 _-]{1,24}$/).nullish(),
    agentVersion: z.string().max(32),
  })
  .strict();

export async function maxDevices(tx: TenantTx): Promise<number | null> {
  const sub = await tx.subscription.findFirst({
    where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
    orderBy: { currentPeriodEnd: "desc" },
    select: { maxDevices: true, plan: { select: { maxDevices: true } } },
  });
  const override = await tx.organizationFeature.findFirst({ where: { featureKey: "MAX_DEVICES" }, select: { limitValue: true } });
  return override?.limitValue ?? sub?.maxDevices ?? sub?.plan.maxDevices ?? null;
}

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SigningKeysService) private readonly keys: SigningKeysService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async enroll(input: z.infer<typeof Enroll>, ip: string | null) {
    // Only P-256 public keys; the private half stays on the PC (DPAPI-protected).
    let spkiDer: Buffer;
    try {
      const key = createPublicKey(input.publicKeyPem);
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
      spkiDer = key.export({ type: "spki", format: "der" });
    } catch {
      throw new HttpException({ error: "invalid_public_key", hint: "ECDSA P-256 SPKI PEM required" }, 400);
    }
    const thumbprint = createHash("sha256").update(spkiDer).digest("hex");

    const tokenHash = hashEnrollmentCode(input.enrollmentCode);
    const rows = await this.db.global.$queryRaw<Array<{ org: string | null }>>`SELECT app.enrollment_token_org(${tokenHash}) AS org`;
    const organizationId = rows[0]?.org;
    if (!organizationId) throw new UnauthorizedException({ error: "invalid_enrollment_code" });

    return this.db.withTenant({ organizationId, actorType: "DEVICE", actorId: null }, async (tx) => {
      const token = await tx.deviceEnrollmentToken.findUniqueOrThrow({ where: { tokenHash } });
      // Consume one use atomically — concurrent installs can't exceed maxUses.
      const claimed = await tx.deviceEnrollmentToken.updateMany({
        where: { id: token.id, uses: { lt: token.maxUses }, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { uses: { increment: 1 }, usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new UnauthorizedException({ error: "invalid_enrollment_code" });

      const zoneId =
        token.zoneId ??
        (await tx.zone.findFirst({ where: { branchId: token.branchId, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true } }))?.id;
      if (!zoneId) throw new HttpException({ error: "branch_has_no_zones" }, 409);

      const mac = input.macAddress?.toUpperCase().replace(/-/g, ":") ?? null;
      // Reinstalling Windows on a known PC re-enrols the same station (history kept).
      let device = mac ? await tx.device.findFirst({ where: { macAddress: mac } }) : null;
      if (device && device.branchId !== token.branchId) throw new ForbiddenException({ error: "device_belongs_to_another_branch" });

      if (!device) {
        const limit = await maxDevices(tx);
        if (limit !== null && (await tx.device.count({ where: { isEnabled: true } })) >= limit) {
          throw new HttpException({ error: "plan_limit_reached", limit: "MAX_DEVICES", max: limit }, 402);
        }
        const name = input.requestedName?.trim() || (await this.nextName(tx, token.branchId, zoneId));
        if (await tx.device.findFirst({ where: { branchId: token.branchId, name }, select: { id: true } })) {
          throw new HttpException({ error: "device_name_taken", name }, 409);
        }
        const count = await tx.device.count({ where: { zoneId } });
        device = await tx.device.create({
          data: {
            organizationId,
            branchId: token.branchId,
            zoneId,
            name,
            kind: "GAMING_PC",
            platform: "WINDOWS",
            status: "OFFLINE",
            macAddress: mac,
            hostname: input.hostname ?? null,
            agentVersion: input.agentVersion,
            mapX: count % 8,
            mapY: Math.floor(count / 8),
          },
        });
      } else {
        await tx.deviceCredential.updateMany({ where: { deviceId: device.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "re-enrolled" } });
        device = await tx.device.update({ where: { id: device.id }, data: { isEnabled: true, hostname: input.hostname ?? undefined, agentVersion: input.agentVersion } });
      }

      await tx.deviceCredential.create({
        data: {
          organizationId,
          deviceId: device.id,
          certSerial: randomUUID(),
          certThumbprint: thumbprint,
          publicKeyPem: input.publicKeyPem.trim(),
          expiresAt: new Date(Date.now() + 2 * 365 * 86_400_000),
        },
      });
      await tx.deviceEnrollmentToken.update({ where: { id: token.id }, data: { usedByDeviceId: device.id } });
      await tx.auditLog.create({
        data: {
          organizationId, branchId: device.branchId, actorType: "DEVICE", actorId: device.id, action: "device.enroll", entityType: "Device",
          entityId: device.id, after: { name: device.name, hostname: input.hostname, mac, enrollmentTokenId: token.id }, ip, hash: "",
        },
      });

      return {
        deviceId: device.id,
        organizationId,
        branchId: device.branchId,
        zoneId: device.zoneId,
        name: device.name,
        signingKeys: await this.keys.publicKeys(tx, device.branchId),
        heartbeatSeconds: this.cfg.DEVICE_HEARTBEAT_SECONDS,
        websocketPath: DEVICE_WS_PATH,
      };
    });
  }

  /** PC-01, PC-02… or VIP-01 for VIP zones, PS5-01 for consoles, etc. */
  private async nextName(tx: TenantTx, branchId: string, zoneId: string) {
    const zone = await tx.zone.findUniqueOrThrow({ where: { id: zoneId }, select: { type: true } });
    const prefix = { PC_VIP: "VIP", CONSOLE: "CON", VR: "VR", SIMULATOR: "SIM", BOOTCAMP: "BC", STREAMING: "STR", INTERNET: "NET" }[zone.type as string] ?? "PC";
    const names = await tx.device.findMany({ where: { branchId, name: { startsWith: `${prefix}-` } }, select: { name: true } });
    const used = new Set(names.map((n) => n.name));
    for (let i = 1; i < 1000; i++) {
      const candidate = `${prefix}-${String(i).padStart(2, "0")}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${prefix}-${randomBytes(2).toString("hex")}`;
  }
}

@Controller("device")
export class DeviceEnrollController {
  constructor(@Inject(EnrollmentService) private readonly enrollment: EnrollmentService) {}

  /** Called by the Windows agent installer: `ArenaAgent enroll --code ARENA-…`. */
  @Public()
  @Post("enroll")
  @HttpCode(201)
  enroll(@Body(new ZodPipe(Enroll)) body: z.infer<typeof Enroll>) {
    return this.enrollment.enroll(body, null);
  }
}
