ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "bullmq_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "run_number" integer;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "progress_log" jsonb DEFAULT '[]'::jsonb;
