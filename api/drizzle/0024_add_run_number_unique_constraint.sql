-- Add unique constraint to prevent duplicate run numbers within a project
-- This fixes a race condition where concurrent run requests could create duplicate run numbers
CREATE UNIQUE INDEX IF NOT EXISTS "idx_runs_project_run_number" ON "runs" ("project_id", "run_number");