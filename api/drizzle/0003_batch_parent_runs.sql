ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "batch_id" varchar(100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_batch" ON "runs"("batch_id");
