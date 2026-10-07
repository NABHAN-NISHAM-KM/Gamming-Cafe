-- 0032_webhooks: signed outbound webhooks fed by the audit trail.

CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

ALTER TABLE "WebhookEndpoint"
  ADD COLUMN "cursorSeq" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "disabledReason" TEXT;

CREATE UNIQUE INDEX "WebhookEndpoint_id_organizationId_key" ON "WebhookEndpoint"("id", "organizationId");

CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_organizationId_status_nextAttemptAt_idx" ON "WebhookDelivery"("organizationId", "status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");

ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_organizationId_fkey" FOREIGN KEY ("endpointId", "organizationId") REFERENCES "WebhookEndpoint"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT webhook_url_len CHECK (length("url") <= 500);
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT webhook_delivery_attempts CHECK ("attempts" >= 0);

ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookDelivery" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- The webhook worker visits only organizations with something to do: an active endpoint or a delivery still pending.
CREATE OR REPLACE FUNCTION app.webhook_orgs()
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    SELECT "organizationId" FROM "WebhookEndpoint" WHERE "isActive"
    UNION
    SELECT "organizationId" FROM "WebhookDelivery" WHERE "status" = 'PENDING'
    LIMIT 1000
  $fn$;

REVOKE ALL ON FUNCTION app.webhook_orgs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.webhook_orgs() TO arena_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_definer') THEN
    GRANT SELECT ON "WebhookEndpoint" TO arena_definer;
    GRANT SELECT ON "WebhookDelivery" TO arena_definer;
    ALTER FUNCTION app.webhook_orgs() OWNER TO arena_definer;
  END IF;
END $$;
