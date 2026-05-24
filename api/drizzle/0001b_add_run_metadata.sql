CREATE TYPE IF NOT EXISTS "run_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "species_name" varchar(255);
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "job_id" varchar(100);
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "output_files" jsonb;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "progress_log" jsonb;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "error" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "status" "run_status" DEFAULT 'queued' NOT NULL;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "file_path" text;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "cleaned" boolean DEFAULT false;