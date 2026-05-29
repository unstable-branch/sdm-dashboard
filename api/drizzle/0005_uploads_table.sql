-- Upload persistence: track uploaded files across sessions
CREATE TABLE IF NOT EXISTS "uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id"),
  "filename" varchar(255) NOT NULL,
  "file_path" text NOT NULL,
  "file_size" integer DEFAULT 0,
  "format" varchar(20) DEFAULT 'csv',
  "n_rows" integer,
  "species" varchar(255),
  "columns_detected" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_uploads_user_id" ON "uploads" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_uploads_created" ON "uploads" ("created_at");
