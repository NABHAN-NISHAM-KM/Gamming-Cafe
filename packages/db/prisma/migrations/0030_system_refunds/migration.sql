-- Refunds the system makes on its own (unused prepaid time when a session ends
-- early, including when it expires or the player logs out) have no employee.
ALTER TABLE "Refund" ALTER COLUMN "requestedById" DROP NOT NULL;
