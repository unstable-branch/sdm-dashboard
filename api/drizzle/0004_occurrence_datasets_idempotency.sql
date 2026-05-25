DO $$ BEGIN
 CREATE TYPE "occurrence_dataset_kind" AS ENUM ('upload', 'gbif', 'dwca', 'cleaned', 'registered');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "occurrence_dataset_status" AS ENUM ('pending', 'ready', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "occurrence_datasets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "species_id" uuid REFERENCES "species"("id"),
  "parent_dataset_id" uuid REFERENCES "occurrence_datasets"("id"),
  "kind" "occurrence_dataset_kind" NOT NULL,
  "status" "occurrence_dataset_status" NOT NULL DEFAULT 'pending',
  "file_id" text NOT NULL,
  "file_name" text,
  "record_count" integer,
  "valid_count" integer,
  "summary" jsonb,
  "metadata" jsonb,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_occurrence_datasets_project" ON "occurrence_datasets"("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_occurrence_datasets_species" ON "occurrence_datasets"("species_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_occurrence_datasets_parent" ON "occurrence_datasets"("parent_dataset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_occurrence_datasets_status" ON "occurrence_datasets"("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid REFERENCES "projects"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "method" varchar(16) NOT NULL,
  "route" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "state" varchar(32) NOT NULL,
  "status_code" integer,
  "response_body" jsonb,
  "resource_type" text,
  "resource_id" text,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "idempotency_keys_state_check" CHECK ("state" IN ('processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_project" ON "idempotency_keys"("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_user" ON "idempotency_keys"("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_expires_at" ON "idempotency_keys"("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_idempotency_keys_scope_key_unique"
ON "idempotency_keys" (
  coalesce("project_id", '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce("user_id", '00000000-0000-0000-0000-000000000000'::uuid),
  "method",
  "route",
  "idempotency_key"
);
