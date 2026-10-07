-- 0031_gift_cards: prepaid codes sold at the counter, redeemed into a wallet.

CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED');

CREATE TABLE "GiftCard" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "branchId" UUID NOT NULL,
    "billId" UUID,
    "soldById" UUID,
    "redeemedById" UUID,
    "redeemedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GiftCard_organizationId_status_createdAt_idx" ON "GiftCard"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "GiftCard_organizationId_codeHash_key" ON "GiftCard"("organizationId", "codeHash");

ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "Branch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_redeemedById_organizationId_fkey" FOREIGN KEY ("redeemedById", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GiftCard"
  ADD CONSTRAINT gift_card_amount CHECK ("amount" > 0),
  -- A card is redeemed once, by someone; until then it has no redeemer.
  ADD CONSTRAINT gift_card_state CHECK (
    ("status" = 'ACTIVE' AND "redeemedAt" IS NULL AND "redeemedById" IS NULL) OR
    ("status" = 'REDEEMED' AND "redeemedAt" IS NOT NULL AND "redeemedById" IS NOT NULL));

ALTER TABLE "GiftCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiftCard" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GiftCard" USING ("organizationId" = app.current_org_id()) WITH CHECK ("organizationId" = app.current_org_id());
