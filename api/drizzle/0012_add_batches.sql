CREATE TABLE IF NOT EXISTS "batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" varchar(255),
  "total_jobs" integer NOT NULL DEFAULT 0,
  "completed_jobs" integer NOT NULL DEFAULT 0,
  "failed_jobs" integer NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'running',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_batches_project" ON "batches" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_batches_user" ON "batches" ("user_id");
