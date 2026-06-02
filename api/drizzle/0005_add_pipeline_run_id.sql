ALTER TABLE "runs" ADD COLUMN "pipeline_run_id" uuid;
ALTER TABLE "occurrences" ADD COLUMN "pipeline_run_id" uuid;
CREATE INDEX IF NOT EXISTS "idx_runs_pipeline" ON "runs" ("pipeline_run_id");
CREATE INDEX IF NOT EXISTS "idx_occurrences_pipeline" ON "occurrences" ("pipeline_run_id");
