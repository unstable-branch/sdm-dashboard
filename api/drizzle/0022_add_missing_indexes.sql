-- Add missing indexes for common query patterns (performance optimization)
CREATE INDEX IF NOT EXISTS "idx_runs_created_at" ON "runs" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_job_id" ON "runs" ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_species_name" ON "species" ("name");
