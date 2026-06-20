CREATE INDEX IF NOT EXISTS idx_runs_status_created ON runs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_occurrences_file_path ON occurrences (file_path);
