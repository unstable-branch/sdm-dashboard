-- Admin Dashboard: Audit Logs, System Settings, Maintenance Log

-- Audit trail for all significant actions
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(50) NOT NULL,
  "entity" varchar(100),
  "entity_id" uuid,
  "ip_address" varchar(45),
  "user_agent" text,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_audit_logs_user" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created" ON "audit_logs"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity" ON "audit_logs"("entity", "entity_id");

-- System-wide configuration settings
CREATE TABLE IF NOT EXISTS "system_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" varchar(100) NOT NULL UNIQUE,
  "value" jsonb NOT NULL,
  "description" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_system_settings_key" ON "system_settings"("key");

-- System maintenance event log
CREATE TABLE IF NOT EXISTS "maintenance_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" varchar(50) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'running',
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_maintenance_log_type" ON "maintenance_log"("type");
CREATE INDEX IF NOT EXISTS "idx_maintenance_log_created" ON "maintenance_log"("created_at" DESC);

-- Seed default system settings
INSERT INTO "system_settings" ("key", "value", "description") VALUES
  ('site_name', '"SDM Dashboard Workbench"', 'Display name for the platform'),
  ('maintenance_mode', 'false', 'Enable maintenance mode to block non-admin access'),
  ('jwt_expiry_seconds', '86400', 'JWT token lifetime in seconds'),
  ('max_login_attempts', '10', 'Max failed login attempts before temporary lockout'),
  ('api_key_default_expiry_days', '90', 'Default API key expiration in days'),
  ('default_climate_source', '"worldclim"', 'Default climate data source'),
  ('default_climate_resolution', '10', 'Default climate raster resolution in arc-minutes'),
  ('default_model', '"glm"', 'Default SDM model algorithm'),
  ('default_biovars', '"1,4,6,12,15,18"', 'Default BIO variables for model runs'),
  ('default_cv_strategy', '"random"', 'Default cross-validation strategy'),
  ('default_cv_k', '5', 'Default number of CV folds'),
  ('default_background_points', '10000', 'Default number of background points'),
  ('default_theme', '"dark"', 'Default UI theme'),
  ('default_page_size', '50', 'Default table page size'),
  ('rate_limit_public', '{"windowMs": 60000, "max": 60}', 'Rate limit for public endpoints'),
  ('rate_limit_auth', '{"windowMs": 60000, "max": 120}', 'Rate limit for authenticated endpoints')
ON CONFLICT ("key") DO NOTHING;
