import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { DeviceGateway } from "./devices/device-gateway.js";
import { loadConfig, type AppConfig } from "./config.js";
import { securityHeaders } from "./common/security-headers.js";

export async function createApp(config: AppConfig = loadConfig()) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    rawBody: true, // payment webhooks are verified against the exact bytes received
    logger: config.NODE_ENV === "test" ? (process.env["TEST_LOGS"] ? ["error"] : false) : undefined,
  });
  app.set("trust proxy", 1); // behind the reverse proxy (Caddy): req.ip = client address
  app.disable("x-powered-by");
  app.use(securityHeaders(config.NODE_ENV === "production"));
  // Room for an uploaded Shell wallpaper + logo (see WALLPAPER_DATA_MAX / LOGO_DATA_MAX).
  app.useBodyParser("json", { limit: "640kb" });
  app.setGlobalPrefix("v1", { exclude: ["/", "health"] });
  app.enableCors({ origin: config.CORS_ORIGINS.split(",").map((s) => s.trim()), credentials: true });
  app.enableShutdownHooks();
  // Windows agents connect over WebSocket on the same port.
  app.get(DeviceGateway).attach(app.getHttpServer());
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT);
  new Logger("Bootstrap").log(`ArenaOS API listening on http://localhost:${config.PORT}`);
}
