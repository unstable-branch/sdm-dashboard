-- 0044: durable identity for browser refresh-token families. Legacy rows stay NULL-linked.
CREATE TABLE IF NOT EXISTS browser_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS browser_sessions_user_id_idx ON browser_sessions(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS browser_sessions_active_idx ON browser_sessions(user_id, expires_at) WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES browser_sessions(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS refresh_tokens_session_id_idx ON refresh_tokens(session_id);
