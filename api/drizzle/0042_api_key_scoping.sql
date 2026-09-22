-- Bounded API-key scoping (Phase 2 stage-2: scoped/underscoped key acceptance).
--
-- An API key may optionally be bound to a single project. A scoped key
-- resolves to its principal ONLY for resources inside that project; resources
-- outside the scope deny closed. NULL scope preserves the existing
-- principal-wide behavior for every key created before this migration
-- (additive, forward-compatible, replay-safe).
--
-- Authorization reads scope per request (no cached path), so key revocation
-- and scope changes are effective immediately.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scope_project_id" uuid REFERENCES "projects"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_api_keys_scope" ON "api_keys" ("scope_project_id");

COMMENT ON COLUMN "api_keys"."scope_project_id" IS 'Optional single-project scope; NULL means principal-wide';
