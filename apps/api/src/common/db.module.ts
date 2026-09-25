import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { createDb, type Db } from "@arena/db";
import { CONFIG, type AppConfig } from "../config.js";

export const DB = Symbol("DB");

class DbLifecycle implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly db: Db) {}
  onModuleDestroy() {
    return this.db.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => createDb({ connectionString: cfg.APP_DATABASE_URL }),
    },
    DbLifecycle,
  ],
  exports: [DB],
})
export class DbModule {}
