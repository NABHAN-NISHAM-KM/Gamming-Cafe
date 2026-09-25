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

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: [...lanAddresses, ...extra],
};

export default config;
