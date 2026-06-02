-- Track cleaned state for uploads so "Use" doesn't re-recommend cleaning
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "is_cleaned" boolean DEFAULT false;
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "cleaned_file_path" text;
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "cleaned_valid_records" integer;
ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "cleaned_original_rows" integer;
