import { Controller, Get, Inject, Module, type DynamicModule, type OnModuleDestroy } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { createPlatformClient, type PlatformClient } from "@arena/db";
import { ErrorsFilter } from "../common/errors.filter.js";
import { PDB, PLATFORM_CONFIG, type PlatformConfig } from "./config.js";
import { PlatformAdminController } from "./admin.controller.js";
import { PlatformAuthController } from "./auth.controller.js";
import { PlatformAuthService } from "./auth.service.js";
import { PlatformGuard, PlatformPublic } from "./guard.js";
import { PlatformTokens } from "./tokens.js";
import { PlatformPublicController } from "./public.controller.js";
import { PlatformOpsController } from "./ops.controller.js";
import { PlatformSettingsController } from "./settings.controller.js";
import { SettingsOverlay } from "../common/managed-settings.js";
import { MailService } from "../common/mail.service.js";

@Controller()
class HealthController {
  @PlatformPublic()
  @Get("health")
  health() {
    return { ok: true, service: "arena-platform" };
  }
}

class DbLifecycle implements OnModuleDestroy {
  constructor(@Inject(PDB) private readonly db: PlatformClient) {}
  onModuleDestroy() {
    return this.db.$disconnect();
  }
}

/** The Super Admin service. Separate process, separate DB login (BYPASSRLS), separate token audience. */
@Module({})
export class PlatformModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: PlatformModule,
      controllers: [HealthController, PlatformAuthController, PlatformAdminController, PlatformPublicController, PlatformOpsController, PlatformSettingsController],
      providers: [
        { provide: PLATFORM_CONFIG, useValue: config },
        { provide: PDB, useFactory: () => createPlatformClient(config.PLATFORM_DATABASE_URL) },
        DbLifecycle,
        { provide: SettingsOverlay, inject: [PLATFORM_CONFIG, PDB], useFactory: (cfg: PlatformConfig, db: PlatformClient) => new SettingsOverlay(cfg as never, () => db.$queryRaw`SELECT "key", "value", "isSecret" FROM "PlatformSetting"`, cfg.MFA_ENCRYPTION_KEY_B64) },
        { provide: MailService, inject: [PLATFORM_CONFIG], useFactory: (cfg: PlatformConfig) => new MailService(cfg) },
        PlatformTokens,
        PlatformAuthService,
        { provide: APP_GUARD, useClass: PlatformGuard },
        { provide: APP_FILTER, useClass: ErrorsFilter },
      ],
    };
  }
}
