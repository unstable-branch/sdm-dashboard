-- User profile fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;

-- User settings table
CREATE TABLE IF NOT EXISTS "user_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "default_model_id" varchar(50) DEFAULT 'glm',
  "default_biovars" text DEFAULT '1,4,6,12,15,18',
  "default_climate_source" varchar(20) DEFAULT 'worldclim',
  "default_climate_res" numeric DEFAULT 10,
  "default_cv_strategy" varchar(20) DEFAULT 'random',
  "default_cv_k" integer DEFAULT 5,
  "default_background_n" integer DEFAULT 10000,
  "default_pa_replications" integer DEFAULT 5,
  "theme" varchar(20) DEFAULT 'system',
  "table_page_size" integer DEFAULT 50,
  "compact_mode" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_settings_user_id" ON "user_settings"("user_id");

-- User ownership on species and occurrences
ALTER TABLE "species" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id");
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id");
CREATE INDEX IF NOT EXISTS "idx_species_user_id" ON "species"("user_id");
CREATE INDEX IF NOT EXISTS "idx_occurrences_user_id" ON "occurrences"("user_id");
