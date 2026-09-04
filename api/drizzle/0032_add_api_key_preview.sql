-- Add a non-secret preview column for API keys so the listing endpoint can
-- show identifier hints without leaking hash material. The full raw key is
-- only returned once at creation time and is never persisted in plain text.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_preview" varchar(16);
