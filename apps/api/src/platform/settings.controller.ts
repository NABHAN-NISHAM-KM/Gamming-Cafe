import { Body, ConflictException, Controller, Get, HttpCode, Inject, Post, Put, Req } from "@nestjs/common";
import { z } from "zod";
import type { PlatformClient } from "@arena/db";
import { MailService } from "../common/mail.service.js";
import { ENV_ONLY, SETTING_KEYS, SETTINGS, SettingsOverlay, sealSetting } from "../common/managed-settings.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PlatformAuthService } from "./auth.service.js";
import { PDB, PLATFORM_CONFIG, type PlatformConfig } from "./config.js";
import { clientMeta, PlatformRoles, type PlatformRequest } from "./guard.js";

/** key → new value; null or "" removes the saved value (the server's own value, if any, applies again). */
const Save = z.object({ values: z.record(z.string(), z.string().max(2000).nullable()) }).strict();
const TestMail = z.object({ to: z.email().max(200).optional() }).strict();

/**
 * Operator settings: mail, payment keys, public addresses. Super Admin only.
 * Secrets are sealed in the database and are never sent back; the page only
 * learns whether one is set.
 */
@Controller("platform/settings")
export class PlatformSettingsController {
  constructor(
    @Inject(PDB) private readonly db: PlatformClient,
    @Inject(PLATFORM_CONFIG) private readonly cfg: PlatformConfig,
    @Inject(PlatformAuthService) private readonly auth: PlatformAuthService,
    @Inject(SettingsOverlay) private readonly overlay: SettingsOverlay,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  @PlatformRoles("SUPER_ADMIN")
  @Get()
  async list() {
    const saved = new Map((await this.db.$queryRaw<Array<{ key: string; updatedAt: Date }>>`SELECT "key", "updatedAt" FROM "PlatformSetting"`).map((r) => [r.key, r.updatedAt]));
    const live = this.cfg as unknown as Record<string, unknown>;
    return {
      settings: SETTINGS.map((s) => {
        const value = live[s.key];
        const has = value !== undefined && value !== null && value !== "";
        return {
          key: s.key, group: s.group, label: s.label, help: s.help, type: s.type, choices: s.choices ?? null, placeholder: s.placeholder ?? null, secret: !!s.secret, live: s.live,
          source: saved.has(s.key) ? "saved" : has ? "server" : "unset",
          set: has,
          value: s.secret || !has ? null : String(value),
          updatedAt: saved.get(s.key) ?? null,
        };
      }),
      envOnly: ENV_ONLY,
    };
  }

  @PlatformRoles("SUPER_ADMIN")
  @Put()
  async save(@Body(new ZodPipe(Save)) body: z.infer<typeof Save>, @Req() req: PlatformRequest) {
    const p = req.platform!;
    const writes: Array<{ key: string; value: string | null; secret: boolean }> = [];
    const problems: Record<string, string> = {};
    for (const [key, raw] of Object.entries(body.values)) {
      const def = SETTING_KEYS.get(key);
      if (!def) throw new ConflictException({ error: "unknown_setting", key });
      const v = raw === null ? "" : raw.trim();
      if (!v) {
        writes.push({ key, value: null, secret: !!def.secret });
        continue;
      }
      const ok = def.check.safeParse(v);
      if (!ok.success) problems[key] = ok.error.issues[0]?.message ?? "Not valid";
      else writes.push({ key, value: ok.data, secret: !!def.secret });
    }
    if (Object.keys(problems).length) throw new ConflictException({ error: "settings_invalid", problems });

    for (const w of writes) {
      if (w.value === null) await this.db.$executeRaw`DELETE FROM "PlatformSetting" WHERE "key" = ${w.key}`;
      else {
        const stored = w.secret ? sealSetting(w.value, this.cfg.MFA_ENCRYPTION_KEY_B64) : w.value;
        await this.db.$executeRaw`INSERT INTO "PlatformSetting" ("key", "value", "isSecret", "updatedById", "updatedAt") VALUES (${w.key}, ${stored}, ${w.secret}, ${p.userId}::uuid, now())
          ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "isSecret" = EXCLUDED."isSecret", "updatedById" = EXCLUDED."updatedById", "updatedAt" = now()`;
      }
    }
    await this.overlay.refresh();
    // The audit trail records which settings changed, never what they were changed to.
    await this.auth.audit(p.userId, p.viaRole, clientMeta(req), { action: "platform.settings.change", entityType: "PlatformSetting", after: { changed: writes.filter((w) => w.value !== null).map((w) => w.key), removed: writes.filter((w) => w.value === null).map((w) => w.key) } });
    return this.list();
  }

  /** With an address: sends a short test message. Without: only connects and signs in, to check the password. */
  @PlatformRoles("SUPER_ADMIN")
  @Post("test-mail")
  @HttpCode(200)
  async testMail(@Body(new ZodPipe(TestMail)) body: z.infer<typeof TestMail>) {
    if (!body.to) return this.mail.verify();
    return this.mail.send({ to: body.to, subject: "ArenaOS test message", text: "This is a test from ArenaOS. If you can read it, your mail settings work." });
  }
}
