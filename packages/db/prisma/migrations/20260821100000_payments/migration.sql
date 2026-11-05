-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "transaction" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "payer" TEXT,
    "idempotencyKey" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transaction_key" ON "Payment"("transaction");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_deviceId_idempotencyKey_key" ON "Payment"("deviceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_deviceId_idx" ON "Payment"("deviceId");

-- CreateIndex
CREATE INDEX "Payment_serviceId_idx" ON "Payment"("serviceId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
