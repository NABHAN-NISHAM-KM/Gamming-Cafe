import { Prisma, type TenantTx } from "@arena/db";

/**
 * Ledger vs operational balances. Each control account in the general ledger
 * must equal the balance the operational side keeps on its own:
 *  - Customer wallets  = Σ wallet money balances (cash, bonus, promo, refund)
 *  - Inventory         = Σ stock ledger value (quantity × unit cost)
 *  - Accounts payable  = Σ unpaid supplier invoices
 *  - Cash in drawers   = Σ cash expected in the drawers of open shifts
 * A difference means a document wasn't posted (or was posted wrongly) — or,
 * for drawers, that cash was taken without an open shift.
 */
export interface ReconCheck {
  key: string;
  label: string;
  ledger: string;
  operational: string;
  difference: string;
  ok: boolean;
}

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);

/** Σ(debit − credit) of an account by system key (whole organization). */
async function balanceOf(t: TenantTx, systemKey: string) {
  const [r] = await t.$queryRaw<[{ bal: Prisma.Decimal | null }]>`
    SELECT SUM(l."debit" - l."credit") AS bal FROM "JournalLine" l JOIN "LedgerAccount" a ON a."id" = l."accountId" WHERE a."systemKey" = ${systemKey}`;
  return D(r.bal);
}

export async function reconcile(t: TenantTx): Promise<{ checkedAt: string; checks: ReconCheck[]; unposted: number }> {
  const unit = (await t.currency.findUnique({ where: { code: (await t.organization.findFirstOrThrow({ select: { defaultCurrency: true } })).defaultCurrency }, select: { minorUnit: true } }))?.minorUnit ?? 2;
  const tolerance = D(1).div(10 ** unit).div(2);

  const [wallets] = await t.$queryRaw<[{ v: Prisma.Decimal | null }]>`SELECT SUM("cashBalance" + "bonusBalance" + "promoBalance" + "refundBalance") AS v FROM "Wallet"`;
  // Each movement is booked rounded to the currency's minor unit (costs carry 4 decimals).
  const [stock] = await t.$queryRaw<[{ v: Prisma.Decimal | null }]>`SELECT SUM(ROUND("quantity" * "unitCost", ${unit}::int)) AS v FROM "StockMovement"`;
  const [payables] = await t.$queryRaw<[{ v: Prisma.Decimal | null }]>`SELECT SUM("amount" + "taxAmount" - "paidAmount") AS v FROM "SupplierInvoice" WHERE "status" <> 'VOID'`;
  const [drawers] = await t.$queryRaw<[{ v: Prisma.Decimal | null }]>`
    SELECT SUM(m."amount") AS v FROM "CashMovement" m JOIN "Shift" s ON s."id" = m."shiftId" WHERE s."status" IN ('OPEN', 'CLOSING')`;

  const check = (key: string, label: string, ledger: Prisma.Decimal, operational: Prisma.Decimal): ReconCheck => {
    const diff = ledger.sub(operational);
    return { key, label, ledger: ledger.toFixed(unit), operational: operational.toFixed(unit), difference: diff.toFixed(unit), ok: diff.abs().lte(tolerance) };
  };
  const checks = [
    // Liabilities are credit balances: flip the sign to compare with the positive operational total.
    check("WALLET_LIABILITY", "Customer wallets", (await balanceOf(t, "WALLET_LIABILITY")).neg(), D(wallets.v)),
    check("INVENTORY", "Inventory value", await balanceOf(t, "INVENTORY"), D(stock.v)),
    check("AP", "Supplier invoices unpaid", (await balanceOf(t, "AP")).neg(), D(payables.v)),
    check("CASH_DRAWER", "Cash in open drawers", await balanceOf(t, "CASH_DRAWER"), D(drawers.v)),
  ];

  // Documents that changed but aren't booked yet (normally only the last few seconds' worth).
  const [pending] = await t.$queryRaw<[{ n: bigint }]>`
    SELECT
      (SELECT COUNT(*) FROM "Bill" b LEFT JOIN "PostingCursor" c ON c."documentType" = 'BILL' AND c."documentId" = b."id"
        WHERE b."status" IN ('SETTLED', 'VOID') AND (c."id" IS NULL OR c."fingerprint" <> b."version"::text))
    + (SELECT COUNT(*) FROM "Payment" p LEFT JOIN "PostingCursor" c ON c."documentType" = 'PAYMENT' AND c."documentId" = p."id"
        WHERE c."id" IS NULL OR c."fingerprint" <> p."status"::text) AS n`;
  return { checkedAt: new Date().toISOString(), checks, unposted: Number(pending.n) };
}
