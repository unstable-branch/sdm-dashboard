-- Add missing index on runs.bullmq_id for plumber-sync lookup-by-bullmqId path.
-- Without this index, lookup is a full-table scan as the runs table grows.
CREATE INDEX IF NOT EXISTS idx_runs_bullmq_id ON runs (bullmq_id);
