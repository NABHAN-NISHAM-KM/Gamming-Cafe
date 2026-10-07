-- 0033_platform_settings: operator-managed settings (mail, payment keys, public addresses).

CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "PlatformSetting" ADD CONSTRAINT platform_setting_size CHECK (length("value") <= 2000);

-- Only the platform service writes; the tenant API only reads.
REVOKE ALL ON "PlatformSetting" FROM arena_app;
GRANT SELECT ON "PlatformSetting" TO arena_app;
