-- Auth & Multi-tenancy migration
-- Adds users, projects, project_members, api_keys tables
-- Adds project_id to species, runs, occurrences

DO $$ BEGIN
 CREATE TYPE "user_role" AS ENUM ('admin', 'editor', 'viewer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "name" varchar(255),
  "role" "user_role" DEFAULT 'viewer' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "description" text,
  "owner_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" "user_role" DEFAULT 'viewer' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_project_members_project" ON "project_members"("project_id");
CREATE INDEX IF NOT EXISTS "idx_project_members_user" ON "project_members"("user_id");

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key_hash" text NOT NULL,
  "name" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_api_keys_user" ON "api_keys"("user_id");

ALTER TABLE "species" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id");
CREATE INDEX IF NOT EXISTS "idx_species_project" ON "species"("project_id");

ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id");
CREATE INDEX IF NOT EXISTS "idx_runs_project" ON "runs"("project_id");
CREATE INDEX IF NOT EXISTS "idx_runs_status" ON "runs"("status");

ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id");
CREATE INDEX IF NOT EXISTS "idx_occurrences_project" ON "occurrences"("project_id");
CREATE INDEX IF NOT EXISTS "idx_occurrences_species" ON "occurrences"("species_id");

-- Create default admin user for development
INSERT INTO "users" ("id", "email", "password_hash", "name", "role")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin@sdm.local',
  '$2b$10$X7sKqJz5qJz5qJz5qJz5qO8qJz5qJz5qJz5qJz5qJz5qJz5qJz5q',
  'Admin User',
  'admin'
) ON CONFLICT ("email") DO NOTHING;

-- Create default project
INSERT INTO "projects" ("id", "name", "description", "owner_id")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Project',
  'Default project for existing data',
  '00000000-0000-0000-0000-000000000001'
) ON CONFLICT DO NOTHING;

-- Link existing data to default project
UPDATE "species" SET "project_id" = '00000000-0000-0000-0000-000000000001' WHERE "project_id" IS NULL;
UPDATE "runs" SET "project_id" = '00000000-0000-0000-0000-000000000001' WHERE "project_id" IS NULL;
UPDATE "occurrences" SET "project_id" = '00000000-0000-0000-0000-000000000001' WHERE "project_id" IS NULL;
