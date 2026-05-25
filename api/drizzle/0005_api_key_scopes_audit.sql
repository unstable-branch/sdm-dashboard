ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" text[] NOT NULL DEFAULT ARRAY['read','write','run','batch','admin']::text[];
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "created_by_key_id" uuid REFERENCES "api_keys"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_key_hash" ON "api_keys"("key_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_project" ON "api_keys"("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" uuid REFERENCES "users"("id"),
  "actor_api_key_id" uuid REFERENCES "api_keys"("id"),
  "action" varchar(100) NOT NULL,
  "target_type" varchar(100),
  "target_id" text,
  "method" varchar(16),
  "route" text,
  "status_code" integer,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_audit_events_actor_user" ON "api_audit_events"("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_audit_events_actor_api_key" ON "api_audit_events"("actor_api_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_audit_events_action" ON "api_audit_events"("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_audit_events_created_at" ON "api_audit_events"("created_at");
