CREATE TABLE IF NOT EXISTS occurrence_clean_jobs (
  job_id VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  raw_asset_id UUID NOT NULL REFERENCES input_assets(id) ON DELETE RESTRICT,
  cleaned_asset_id UUID REFERENCES input_assets(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS occurrence_clean_jobs_user_idx ON occurrence_clean_jobs(user_id);
CREATE INDEX IF NOT EXISTS occurrence_clean_jobs_raw_asset_idx ON occurrence_clean_jobs(raw_asset_id);
CREATE INDEX IF NOT EXISTS occurrence_clean_jobs_cleaned_asset_idx ON occurrence_clean_jobs(cleaned_asset_id);
