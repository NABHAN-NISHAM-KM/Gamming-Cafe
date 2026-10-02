-- ─────────────────────────────────────────────────────────────────────────────
-- 0025_shell_player
-- What follows a player from PC to PC: their Shell settings, the games they
-- played recently, and (for games the venue sets up) their save folders.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "shellPrefs" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "OrgGameSetting" ADD COLUMN "savePaths" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CustomerRecentGame" (
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "plays" INTEGER NOT NULL DEFAULT 1,
    "lastPlayedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRecentGame_pkey" PRIMARY KEY ("customerId","gameId")
);

-- CreateTable
CREATE TABLE "GameSave" (
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSave_pkey" PRIMARY KEY ("customerId","gameId")
);

-- CreateIndex
CREATE INDEX "CustomerRecentGame_organizationId_customerId_lastPlayedAt_idx" ON "CustomerRecentGame"("organizationId", "customerId", "lastPlayedAt");

-- CreateIndex
CREATE INDEX "GameSave_organizationId_idx" ON "GameSave"("organizationId");

-- AddForeignKey
ALTER TABLE "CustomerRecentGame" ADD CONSTRAINT "CustomerRecentGame_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRecentGame" ADD CONSTRAINT "CustomerRecentGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSave" ADD CONSTRAINT "GameSave_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSave" ADD CONSTRAINT "GameSave_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Guards ──────────────────────────────────────────────────────────────────
ALTER TABLE "GameSave"
  ADD CONSTRAINT game_save_size CHECK ("sizeBytes" BETWEEN 1 AND 20971520 AND octet_length("data") = "sizeBytes");
ALTER TABLE "OrgGameSetting"
  ADD CONSTRAINT org_game_save_paths_limit CHECK (cardinality("savePaths") <= 5);

-- Games are a shared catalog: a tenant row may only point at a platform game or its own.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('CustomerRecentGame', 'gameId', 'Game'),
      ('GameSave',           'gameId', 'Game')
    ) AS t(tbl, col, target)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION app.enforce_catalog_ref(%L, %L)',
      'catalog_ref_' || r.col, r.col, r.tbl, r.col, r.target);
  END LOOP;
END
$$;

-- CustomerRecentGame
ALTER TABLE "CustomerRecentGame" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerRecentGame" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerRecentGame" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- GameSave
ALTER TABLE "GameSave" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GameSave" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GameSave" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());
