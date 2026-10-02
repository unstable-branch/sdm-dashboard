-- Representative pre-0044 schema, intentionally synthetic and disposable.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'viewer',
  auth_version integer NOT NULL DEFAULT 0
);
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);
INSERT INTO users (id, email, password_hash, role, auth_version)
VALUES ('10000000-0000-4000-8000-000000000099', 'legacy@example.invalid', 'synthetic', 'editor', 0);
INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
VALUES ('10000000-0000-4000-8000-000000000099', repeat('a', 64), now() + interval '1 day');
