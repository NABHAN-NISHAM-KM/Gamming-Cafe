// Super Admin (platform) service: `npm run dev:platform -w @arena/api` → http://localhost:4100
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadPlatformConfig, type PlatformConfig } from "./config.js";
import { PlatformModule } from "./platform.module.js";

export async function createPlatformApp(config: PlatformConfig = loadPlatformConfig()) {
  const app = await NestFactory.create<NestExpressApplication>(PlatformModule.forRoot(config), {
    rawBody: true, // the billing webhook is verified against the exact bytes received
    logger: config.NODE_ENV === "test" ? (process.env["TEST_LOGS"] ? ["error"] : false) : undefined,
  });
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.useBodyParser("json", { limit: "64kb" });
  app.setGlobalPrefix("v1", { exclude: ["health"] });
  app.enableCors({ origin: config.PLATFORM_CORS_ORIGINS.split(",").map((s) => s.trim()), credentials: true });
  app.enableShutdownHooks();
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  const config = loadPlatformConfig();
  const app = await createPlatformApp(config);
  await app.listen(config.PLATFORM_PORT);
  new Logger("Bootstrap").log(`ArenaOS platform (Super Admin) service listening on http://localhost:${config.PLATFORM_PORT}`);
}
