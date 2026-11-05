-- AlterTable
ALTER TABLE "Device" ADD COLUMN "apiKey" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Device_apiKey_key" ON "Device"("apiKey");

-- CreateIndex
CREATE INDEX "Device_apiKey_idx" ON "Device"("apiKey");
