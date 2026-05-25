ALTER TABLE "runs" ADD COLUMN "provenance" jsonb;
ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid REFERENCES runs(id);
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);
