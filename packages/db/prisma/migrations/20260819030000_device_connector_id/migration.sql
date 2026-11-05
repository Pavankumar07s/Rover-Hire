-- Add a PRIVATE connector id to every device.
--
-- The public `Device.id` is shared with agents (it appears in the callable URL
-- and public discovery). The physical device's MQTT transport must NOT be
-- reachable just by knowing that public id, so we introduce a separate PRIVATE
-- `connectorId`. All MQTT topics (d/<connectorId>/cmd|reply|status) are keyed
-- by this value. It is never returned over any public/agent-facing route.

-- 1) Add nullable first so we can backfill existing rows.
ALTER TABLE "Device" ADD COLUMN "connectorId" TEXT;

-- 2) Backfill a fresh uuid for every existing device. gen_random_uuid() is
--    available in Postgres 13+ (pgcrypto is built in). Fall back to uuid-ossp
--    is unnecessary on the versions we target.
UPDATE "Device" SET "connectorId" = gen_random_uuid()::text WHERE "connectorId" IS NULL;

-- 3) Tighten to NOT NULL and enforce uniqueness + index.
ALTER TABLE "Device" ALTER COLUMN "connectorId" SET NOT NULL;
CREATE UNIQUE INDEX "Device_connectorId_key" ON "Device"("connectorId");
CREATE INDEX "Device_connectorId_idx" ON "Device"("connectorId");
