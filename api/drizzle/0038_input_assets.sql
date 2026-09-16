-- M2C1: canonical, server-owned input assets.
--
-- This migration is deliberately additive.  The legacy uploads tables remain
-- available to the compatibility/read paths until their producers are moved.
-- No legacy row is backfilled here: their path and ownership columns are not
-- authoritative (and cleaned_file_path is client-writable in old versions),
-- so a mapping is created only by the server-side registration adapter after
-- an exact, unambiguous verification.

DO $$
BEGIN
  CREATE TYPE input_asset_scope AS ENUM ('private', 'project', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE input_asset_kind AS ENUM (
    'raw_occurrence',
    'cleaned_occurrence',
    'custom_boundary',
    'target_group'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE input_asset_state AS ENUM ('ready', 'deleted', 'quarantined');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS input_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
  scope input_asset_scope NOT NULL,
  kind input_asset_kind NOT NULL,
  -- A canonical locator is a server-issued root/relative POSIX locator.  It
  -- is not an absolute path, URL, or value copied from an HTTP request.
  storage_locator TEXT NOT NULL,
  parent_asset_id UUID REFERENCES input_assets(id) ON DELETE RESTRICT,
  state input_asset_state NOT NULL DEFAULT 'ready',
  content_sha256 VARCHAR(64),
  content_size BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  quarantined_at TIMESTAMP,
  CONSTRAINT input_assets_scope_project_ck CHECK (
    (scope = 'private' AND project_id IS NULL)
    OR (scope = 'project' AND project_id IS NOT NULL)
    OR (scope = 'system' AND project_id IS NULL)
  ),
  CONSTRAINT input_assets_locator_nonempty_ck CHECK (length(btrim(storage_locator)) > 0),
  CONSTRAINT input_assets_hash_ck CHECK (
    content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  CONSTRAINT input_assets_size_ck CHECK (content_size IS NULL OR content_size >= 0),
  CONSTRAINT input_assets_deleted_time_ck CHECK (
    state <> 'deleted' OR deleted_at IS NOT NULL
  ),
  CONSTRAINT input_assets_quarantined_time_ck CHECK (
    state <> 'quarantined' OR quarantined_at IS NOT NULL
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS input_assets_storage_locator_unique
  ON input_assets(storage_locator);
CREATE INDEX IF NOT EXISTS input_assets_creator_idx
  ON input_assets(creator_user_id);
CREATE INDEX IF NOT EXISTS input_assets_project_idx
  ON input_assets(project_id);
CREATE INDEX IF NOT EXISTS input_assets_scope_state_idx
  ON input_assets(scope, state);
CREATE INDEX IF NOT EXISTS input_assets_kind_state_idx
  ON input_assets(kind, state);
CREATE INDEX IF NOT EXISTS input_assets_parent_idx
  ON input_assets(parent_asset_id);
--> statement-breakpoint

-- Ownership, scope, kind, lineage, locator, and content identity are not
-- mutable metadata. Lifecycle transitions use the state columns only.
CREATE OR REPLACE FUNCTION sdm_input_assets_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.creator_user_id IS DISTINCT FROM OLD.creator_user_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.storage_locator IS DISTINCT FROM OLD.storage_locator
     OR NEW.parent_asset_id IS DISTINCT FROM OLD.parent_asset_id
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.content_size IS DISTINCT FROM OLD.content_size THEN
    RAISE EXCEPTION 'input asset identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'input_assets_identity_immutable_trigger'
  ) THEN
    CREATE TRIGGER input_assets_identity_immutable_trigger
      BEFORE UPDATE ON input_assets
      FOR EACH ROW EXECUTE FUNCTION sdm_input_assets_identity_immutable();
  END IF;
END $$;
--> statement-breakpoint

-- Compatibility provenance is separate from the canonical registry.  A row
-- without a verified canonical mapping is never a usable asset.  In
-- particular, a basename or a first matching project must not be inserted by
-- a migration as an ownership decision.
CREATE TABLE IF NOT EXISTS input_asset_legacy_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_table VARCHAR(32) NOT NULL,
  legacy_row_id UUID NOT NULL,
  legacy_locator TEXT NOT NULL,
  legacy_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  legacy_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  input_asset_id UUID REFERENCES input_assets(id) ON DELETE RESTRICT,
  mapping_state VARCHAR(20) NOT NULL DEFAULT 'quarantined',
  quarantine_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT input_asset_legacy_table_ck CHECK (
    legacy_table IN ('uploads', 'uploaded_files')
  ),
  CONSTRAINT input_asset_legacy_locator_ck CHECK (length(btrim(legacy_locator)) > 0),
  CONSTRAINT input_asset_legacy_state_ck CHECK (
    mapping_state IN ('verified', 'quarantined')
  ),
  CONSTRAINT input_asset_legacy_verified_ck CHECK (
    mapping_state <> 'verified' OR input_asset_id IS NOT NULL
  ),
  CONSTRAINT input_asset_legacy_source_unique UNIQUE (legacy_table, legacy_row_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS input_asset_legacy_locator_idx
  ON input_asset_legacy_mappings(legacy_locator);
CREATE INDEX IF NOT EXISTS input_asset_legacy_asset_idx
  ON input_asset_legacy_mappings(input_asset_id);
CREATE INDEX IF NOT EXISTS input_asset_legacy_state_idx
  ON input_asset_legacy_mappings(mapping_state);
