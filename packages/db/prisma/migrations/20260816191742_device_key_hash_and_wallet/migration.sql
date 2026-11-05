-- Existing devices carry now-unusable plaintext keys; clear test data so the
-- new NOT NULL columns can be added cleanly. Services cascade-delete.
DELETE FROM "Device";

-- DropIndex
DROP INDEX IF EXISTS "Device_apiKey_idx";
DROP INDEX IF EXISTS "Device_apiKey_key";

-- AlterTable: replace the plaintext key with a hash + masked preview, add wallet
ALTER TABLE "Device" DROP COLUMN "apiKey";
ALTER TABLE "Device" ADD COLUMN "apiKeyHash" TEXT NOT NULL;
ALTER TABLE "Device" ADD COLUMN "apiKeyPreview" TEXT NOT NULL;
ALTER TABLE "Device" ADD COLUMN "recipientWallet" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Device_apiKeyHash_key" ON "Device"("apiKeyHash");
CREATE INDEX "Device_apiKeyHash_idx" ON "Device"("apiKeyHash");
