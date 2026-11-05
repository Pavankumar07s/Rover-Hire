-- Wallets are now PER-SERVICE only. Devices no longer carry a wallet.
--
-- Previously the Device held recipientWallet + walletChain and services
-- inherited them when their own values were NULL. Now each service owns its
-- wallet outright; the Device columns are dropped.

-- Backfill each service's wallet from the device where the service didn't set
-- its own, so no payout address is lost when the device columns go away.
UPDATE "Service" s
SET "recipientWallet" = d."recipientWallet"
FROM "Device" d
WHERE s."deviceId" = d."id"
  AND s."recipientWallet" IS NULL
  AND d."recipientWallet" IS NOT NULL;

-- Backfill the chain the same way, then make it NOT NULL (default BASE).
UPDATE "Service" s
SET "walletChain" = d."walletChain"
FROM "Device" d
WHERE s."deviceId" = d."id"
  AND s."walletChain" IS NULL;

UPDATE "Service" SET "walletChain" = 'BASE' WHERE "walletChain" IS NULL;

ALTER TABLE "Service" ALTER COLUMN "walletChain" SET DEFAULT 'BASE';
ALTER TABLE "Service" ALTER COLUMN "walletChain" SET NOT NULL;

-- Drop the now-unused device-level wallet columns.
ALTER TABLE "Device" DROP COLUMN "recipientWallet";
ALTER TABLE "Device" DROP COLUMN "walletChain";
