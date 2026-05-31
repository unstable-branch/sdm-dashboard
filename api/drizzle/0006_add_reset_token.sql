ALTER TABLE "users" ADD COLUMN "reset_token" text;
ALTER TABLE "users" ADD COLUMN "reset_token_expiry" timestamp;
CREATE INDEX IF NOT EXISTS "idx_users_reset_token" ON "users" ("reset_token");
CREATE INDEX IF NOT EXISTS "idx_users_reset_token_expiry" ON "users" ("reset_token_expiry");
