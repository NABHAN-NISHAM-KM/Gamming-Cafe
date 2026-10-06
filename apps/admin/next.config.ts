import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/**
 * Dev only: Next.js blocks its dev tooling (hot reload, dev chunks) for any
 * origin other than localhost. Allow this machine's own LAN addresses so the
 * admin can be opened from a phone/tablet on the same network while
 * developing. Extra hosts: ADMIN_DEV_ORIGINS="10.0.0.5,myhost.local".
 */
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a!.address);

const extra = (process.env["ADMIN_DEV_ORIGINS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * ARENA_DEMO=1 builds the self-contained live demo: a static site (no Next
 * server, no API) where @arena/demo answers every request in the browser.
 * Route handlers (*.ts under app/api) are left out by pageExtensions.
 * DEMO_BASE_PATH is where it will be served, e.g. "/live/admin".
 */
const demo = process.env["ARENA_DEMO"] === "1";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@arena/theme", "@arena/demo"],
  allowedDevOrigins: [...lanAddresses, ...extra],
  env: { NEXT_PUBLIC_ARENA_DEMO: demo ? "1" : "0" },
  ...(demo
    ? {
        output: "export" as const,
        distDir: process.env["DEMO_DIST_DIR"] ?? ".next-demo",
        basePath: process.env["DEMO_BASE_PATH"] ?? "",
        trailingSlash: true,
        images: { unoptimized: true },
        pageExtensions: ["tsx"],
      }
    : {
        // Security headers here, not only in the proxy, so a missed proxy setting can't drop them.
        async headers() {
          const h = [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          ];
          if (process.env["NODE_ENV"] === "production") h.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
          return [{ source: "/:path*", headers: h }];
        },
      }),
};

export default config;
