-- Add the JSON `parameters` column to Service, storing the declared
-- input parameter schema as an array of { name, type, required } objects.
ALTER TABLE "Service" ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '[]';
