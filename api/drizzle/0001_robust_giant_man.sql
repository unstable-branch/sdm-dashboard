CREATE TYPE "run_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "occurrences" ALTER COLUMN "species_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "status" SET DATA TYPE run_status USING status::run_status;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "cleaned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "species_name" varchar(255);--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "job_id" varchar(100);--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "output_files" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "progress_log" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "error" text;