-- Per-user storage quota tracking
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "storage_quota_bytes" bigint DEFAULT 1073741824;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "storage_used_bytes" bigint DEFAULT 0;
