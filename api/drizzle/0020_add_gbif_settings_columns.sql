-- Add GBIF credential columns to user_settings for authenticated GBIF downloads
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gbif_username TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gbif_password TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gbif_email TEXT;
