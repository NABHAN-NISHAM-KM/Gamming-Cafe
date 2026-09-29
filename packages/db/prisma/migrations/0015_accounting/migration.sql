-- ─────────────────────────────────────────────────────────────────────────────
-- 0015_accounting (Phase 11)
-- The general ledger is fed automatically from the business documents (bills,
-- payments, refunds, wallet, stock, cash drawer, shifts, supplier invoices,
-- expenses). PostingCursor remembers what has been booked per document so a
-- change to a document books only the difference. Journal entries become
-- append-only like their lines: corrections are reversing entries.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "documentId" UUID;

-- CreateTable
CREATE TABLE "PostingCursor" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "posted" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PostingCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostingCursor_organizationId_documentType_documentId_key" ON "PostingCursor"("organizationId", "documentType", "documentId");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_documentId_idx" ON "JournalEntry"("organizationId", "documentId");

-- PostingCursor
ALTER TABLE "PostingCursor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PostingCursor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PostingCursor" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());

-- Journal entries are append-only (their lines already are, see 0003).
CREATE TRIGGER append_only_row BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON "JournalEntry" FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON "JournalEntry" FROM arena_app, arena_platform;

-- One side per line, positive amounts, and an account can't be the parent of itself.
ALTER TABLE "LedgerAccount"
  ADD CONSTRAINT ledger_account_not_own_parent CHECK ("parentId" IS NULL OR "parentId" <> "id"),
  ADD CONSTRAINT ledger_account_code_shape CHECK ("code" ~ '^[0-9]{3,6}$');
ALTER TABLE "Expense"
  ADD CONSTRAINT expense_amounts CHECK ("amount" > 0 AND "taxAmount" >= 0);
