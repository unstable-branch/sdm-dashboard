-- Reconcile the replayed database with the application schema before adding
-- new canonical climate tables. Existing migration history remains unchanged.
-- Rollback is manual: retain the additive columns, drop the defaults and NOT
-- NULL constraints below if required, and cast default_climate_res to numeric.

ALTER TABLE "batches"
  ADD COLUMN IF NOT EXISTS "job_id" varchar(255);

ALTER TABLE "uploads"
  ADD COLUMN IF NOT EXISTS "cleaning_cc_log" jsonb;
ALTER TABLE "uploads"
  ADD COLUMN IF NOT EXISTS "cleaning_source_counts" jsonb;

UPDATE "uploaded_files"
SET "created_at" = now()
WHERE "created_at" IS NULL;
ALTER TABLE "uploaded_files"
  ALTER COLUMN "created_at" SET NOT NULL;

UPDATE "users"
SET "storage_used_bytes" = 0
WHERE "storage_used_bytes" IS NULL;
ALTER TABLE "users"
  ALTER COLUMN "storage_used_bytes" SET NOT NULL;

UPDATE "users"
SET "storage_quota_bytes" = 1073741824
WHERE "storage_quota_bytes" IS NULL
  AND "role" <> 'admin';
ALTER TABLE "users"
  ALTER COLUMN "storage_quota_bytes" SET DEFAULT 1073741824;

ALTER TABLE "runs"
  ALTER COLUMN "run_storage_bytes" SET DEFAULT 0;

ALTER TABLE "user_settings"
  ALTER COLUMN "default_climate_res" TYPE double precision
  USING "default_climate_res"::double precision;
