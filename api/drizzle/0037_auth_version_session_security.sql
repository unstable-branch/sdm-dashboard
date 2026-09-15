-- M2A forced browser-session cutover. Existing JWTs lack auth_version and are rejected.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_version" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Existing JWTs do not carry auth_version, and all pre-cutover refresh
-- sessions must be forced through a fresh login as well.
-- Keep the cutover idempotent if a later statement fails and the migration is retried.
UPDATE "users" SET "auth_version" = 1 WHERE "auth_version" = 0;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "refresh_tokens" GROUP BY "token_hash" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add refresh token hash uniqueness: duplicate hashes exist';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "refresh_tokens"
SET "revoked_at" = CURRENT_TIMESTAMP
WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_unique" ON "refresh_tokens" ("token_hash");
