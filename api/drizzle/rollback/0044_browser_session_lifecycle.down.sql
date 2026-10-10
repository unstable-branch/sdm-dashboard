-- 0044 rollback: remove only the additive browser-family storage objects.
BEGIN;
DROP INDEX IF EXISTS refresh_tokens_session_id_idx;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS session_id;
DROP TABLE IF EXISTS browser_sessions;
COMMIT;
