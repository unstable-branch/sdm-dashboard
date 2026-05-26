CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  n_rows INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_user ON uploaded_files(user_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_project ON uploaded_files(project_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT NOT NULL DEFAULT 0;

UPDATE users SET storage_quota_bytes = 524288000 WHERE storage_quota_bytes IS NULL AND role != 'admin';
UPDATE users SET storage_quota_bytes = NULL WHERE role = 'admin' AND storage_quota_bytes IS NULL;
