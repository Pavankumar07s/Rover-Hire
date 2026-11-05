-- CreateEnum: which chain a payout wallet lives on.
CREATE TYPE "WalletChain" AS ENUM ('BASE', 'SOLANA');

-- CreateEnum: whether calling a service costs money (x402) or is free.
CREATE TYPE "ServiceType" AS ENUM ('FREE', 'PAID');

-- AlterTable: device-level wallet chain + service defaults.
ALTER TABLE "Device" ADD COLUMN "walletChain" "WalletChain" NOT NULL DEFAULT 'BASE';
ALTER TABLE "Device" ADD COLUMN "serviceType" "ServiceType" NOT NULL DEFAULT 'FREE';
ALTER TABLE "Device" ADD COLUMN "passwordProtected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN "globallyDiscoverable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: per-service overrides (NULL means "inherit the device default").
ALTER TABLE "Service" ADD COLUMN "recipientWallet" TEXT;
ALTER TABLE "Service" ADD COLUMN "walletChain" "WalletChain";
ALTER TABLE "Service" ADD COLUMN "serviceType" "ServiceType";
ALTER TABLE "Service" ADD COLUMN "passwordProtected" BOOLEAN;
ALTER TABLE "Service" ADD COLUMN "globallyDiscoverable" BOOLEAN;
ALTER TABLE "Service" ADD COLUMN "accessUsername" TEXT;
ALTER TABLE "Service" ADD COLUMN "accessPasswordHash" TEXT;
