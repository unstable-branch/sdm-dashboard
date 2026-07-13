-- Persist structured runtime diagnostics reported by Plumber workers.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "error_code" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "error_hint" text;
