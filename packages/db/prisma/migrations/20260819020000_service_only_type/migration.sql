-- serviceType is now PER-SERVICE only. A device no longer carries a default.
--
-- Previously the Device held a default serviceType and services inherited it
-- when their own value was NULL. Now each service owns its type outright; the
-- Device column is dropped.

-- Backfill each service's type from the device where the service didn't set
-- its own, so nothing flips from Paid to Free when the device column goes away.
UPDATE "Service" s
SET "serviceType" = d."serviceType"
FROM "Device" d
WHERE s."deviceId" = d."id"
  AND s."serviceType" IS NULL;

-- Any rows still NULL (shouldn't happen) fall back to FREE.
UPDATE "Service" SET "serviceType" = 'FREE' WHERE "serviceType" IS NULL;

-- Tighten the Service column to NOT NULL with a FREE default.
ALTER TABLE "Service" ALTER COLUMN "serviceType" SET DEFAULT 'FREE';
ALTER TABLE "Service" ALTER COLUMN "serviceType" SET NOT NULL;

-- Drop the now-unused device-level column.
ALTER TABLE "Device" DROP COLUMN "serviceType";
