-- Add ALA API key column to user_settings for Atlas of Living Australia occurrence search
ALTER TABLE user_settings ADD COLUMN ala_api_key TEXT;
