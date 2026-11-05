-- Move passwordProtected + globallyDiscoverable to be PER-SERVICE only.
--
-- Previously these were device-level defaults with nullable per-service
-- overrides (NULL = inherit the device). Now each service owns its own value
-- (non-null, with sensible defaults) and the device no longer carries them.

-- Backfill each service's effective value from its override, falling back to
-- the device default, before we drop the device columns / tighten NOT NULL.
UPDATE "Service" s
SET
  "passwordProtected" = COALESCE(s."passwordProtected", d."passwordProtected", false),
  "globallyDiscoverable" = COALESCE(s."globallyDiscoverable", d."globallyDiscoverable", true)
FROM "Device" d
WHERE s."deviceId" = d."id";

-- Any rows still NULL (shouldn't happen, but be safe) get the defaults.
UPDATE "Service" SET "passwordProtected" = false WHERE "passwordProtected" IS NULL;
UPDATE "Service" SET "globallyDiscoverable" = true WHERE "globallyDiscoverable" IS NULL;

-- Tighten the Service columns to NOT NULL with defaults.
ALTER TABLE "Service" ALTER COLUMN "passwordProtected" SET DEFAULT false;
ALTER TABLE "Service" ALTER COLUMN "passwordProtected" SET NOT NULL;
ALTER TABLE "Service" ALTER COLUMN "globallyDiscoverable" SET DEFAULT true;
ALTER TABLE "Service" ALTER COLUMN "globallyDiscoverable" SET NOT NULL;

-- Drop the now-unused device-level columns.
ALTER TABLE "Device" DROP COLUMN "passwordProtected";
ALTER TABLE "Device" DROP COLUMN "globallyDiscoverable";
