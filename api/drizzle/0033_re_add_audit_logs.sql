-- Re-add audit_logs table for persistent audit trail.
-- The original 0004_admin_dashboard.sql created this table; it was dropped
-- in 0013_cleanup_dead_columns.sql. Now re-adding with improvements:
--   - request_id UUID for correlating logs with a single HTTP request
--   - method, path, status_code for request-level context
--   - retention_days column for future TTL policies
--   - all original columns preserved

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(100) NOT NULL,
  "entity" varchar(100),
  "entity_id" uuid,
  "ip_address" varchar(45),
  "user_agent" text,
  "request_id" uuid,
  "method" varchar(10),
  "path" varchar(500),
  "status_code" smallint,
  "retention_days" integer DEFAULT 90,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_audit_logs_user" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created" ON "audit_logs"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity" ON "audit_logs"("entity", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_request" ON "audit_logs"("request_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_status" ON "audit_logs"("status_code");
