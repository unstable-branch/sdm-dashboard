-- Schema/migration drift repair: uploads.cleaning_cc_log and
-- uploads.cleaning_source_counts were added to api/src/db/schema.ts
-- (cleaning results review popup) without a corresponding migration, so
-- clean bootstrap databases failed `GET /api/v1/data/occurrences/uploads`
-- with `column "cleaning_cc_log" does not exist`.
-- Additive only; mirrors 0028_add_upload_cleaned.sql style.

ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "cleaning_cc_log" jsonb;
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "cleaning_source_counts" jsonb;