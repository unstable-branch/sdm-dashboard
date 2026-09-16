-- M4: policy-neutral durable execution and attempt foundation.
-- Additive only. Existing 0037, 0038 and 0039 migrations remain authoritative.
-- New rows retain opaque IDs and hashes only; no path, token, secret or role grant is stored.

CREATE TABLE IF NOT EXISTS executions (
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_principal_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
  execution_kind VARCHAR(32) NOT NULL,
  authorization_policy_version VARCHAR(64) NOT NULL,
  authorization_basis VARCHAR(64) NOT NULL,
  specification_set_sha256 VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT executions_kind_ck CHECK (length(btrim(execution_kind)) > 0),
  CONSTRAINT executions_policy_version_ck CHECK (length(btrim(authorization_policy_version)) > 0),
  CONSTRAINT executions_authorization_basis_ck CHECK (length(btrim(authorization_basis)) > 0),
  CONSTRAINT executions_specification_set_hash_ck CHECK (
    specification_set_sha256 ~ '^[0-9a-fA-F]{64}$'
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS executions_creator_idx ON executions(creator_principal_id);
CREATE INDEX IF NOT EXISTS executions_project_idx ON executions(project_id);
CREATE INDEX IF NOT EXISTS executions_created_idx ON executions(created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS run_specifications (
  run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE RESTRICT,
  canonical_bytes BYTEA NOT NULL,
  specification_sha256 VARCHAR(64) NOT NULL,
  schema_version VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT run_specifications_bytes_ck CHECK (octet_length(canonical_bytes) > 0),
  CONSTRAINT run_specifications_hash_ck CHECK (specification_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT run_specifications_schema_version_ck CHECK (length(btrim(schema_version)) > 0)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS execution_members (
  execution_id UUID NOT NULL REFERENCES executions(execution_id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  member_ordinal INTEGER NOT NULL,
  specification_sha256 VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (execution_id, run_id),
  CONSTRAINT execution_members_ordinal_ck CHECK (member_ordinal > 0),
  CONSTRAINT execution_members_specification_hash_ck CHECK (specification_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT execution_members_execution_run_unique UNIQUE (run_id),
  CONSTRAINT execution_members_execution_ordinal_unique UNIQUE (execution_id, member_ordinal),
  CONSTRAINT execution_members_run_specification_fk FOREIGN KEY (run_id)
    REFERENCES run_specifications(run_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS execution_members_run_idx ON execution_members(run_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS execution_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(execution_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  retry_of_attempt_id UUID REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  attempt_request_sha256 VARCHAR(64) NOT NULL,
  specification_set_sha256 VARCHAR(64) NOT NULL,
  actor_principal_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT execution_attempts_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT execution_attempts_request_hash_ck CHECK (attempt_request_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT execution_attempts_specification_hash_ck CHECK (specification_set_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT execution_attempts_execution_ordinal_unique UNIQUE (execution_id, ordinal),
  CONSTRAINT execution_attempts_id_execution_unique UNIQUE (attempt_id, execution_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS execution_attempts_execution_idx ON execution_attempts(execution_id);
CREATE INDEX IF NOT EXISTS execution_attempts_retry_idx ON execution_attempts(retry_of_attempt_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS execution_attempt_members (
  attempt_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  run_id UUID NOT NULL,
  PRIMARY KEY (attempt_id, run_id),
  CONSTRAINT execution_attempt_members_attempt_unique UNIQUE (attempt_id, execution_id, run_id),
  CONSTRAINT execution_attempt_members_attempt_fk FOREIGN KEY (attempt_id, execution_id)
    REFERENCES execution_attempts(attempt_id, execution_id) ON DELETE RESTRICT,
  CONSTRAINT execution_attempt_members_execution_member_fk FOREIGN KEY (execution_id, run_id)
    REFERENCES execution_members(execution_id, run_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS execution_attempt_members_execution_idx
  ON execution_attempt_members(execution_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attempt_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  sequence BIGINT NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  event_sha256 VARCHAR(64) NOT NULL,
  evidence_sha256 VARCHAR(64),
  payload_bytes BYTEA NOT NULL DEFAULT ''::bytea,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT attempt_events_sequence_ck CHECK (sequence > 0),
  CONSTRAINT attempt_events_type_ck CHECK (event_type IN (
    'reserved', 'dispatch_requested', 'accepted', 'running',
    'cancel_requested', 'cancelled', 'finalizing', 'succeeded',
    'failed', 'outcome_unknown', 'blocked'
  )),
  CONSTRAINT attempt_events_hash_ck CHECK (event_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT attempt_events_evidence_hash_ck CHECK (
    evidence_sha256 IS NULL OR evidence_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  CONSTRAINT attempt_events_attempt_sequence_unique UNIQUE (attempt_id, sequence)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attempt_events_attempt_idx ON attempt_events(attempt_id, sequence);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attempt_state (
  attempt_id UUID PRIMARY KEY REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL,
  current_state VARCHAR(24) NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 0,
  dispatch_fence UUID NOT NULL DEFAULT gen_random_uuid(),
  last_event_sequence BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT attempt_state_attempt_execution_fk FOREIGN KEY (attempt_id, execution_id)
    REFERENCES execution_attempts(attempt_id, execution_id) ON DELETE RESTRICT,
  CONSTRAINT attempt_state_version_ck CHECK (state_version >= 0),
  CONSTRAINT attempt_state_last_event_ck CHECK (last_event_sequence >= 0),
  CONSTRAINT attempt_state_state_ck CHECK (current_state IN (
    'reserved', 'dispatching', 'accepted', 'running', 'cancel_requested',
    'finalizing', 'outcome_unknown', 'blocked', 'succeeded', 'failed', 'cancelled'
  )),
  CONSTRAINT attempt_state_fence_ck CHECK (dispatch_fence <> '00000000-0000-0000-0000-000000000000')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attempt_state_execution_idx ON attempt_state(execution_id);
CREATE UNIQUE INDEX IF NOT EXISTS attempt_state_one_active_execution_idx
  ON attempt_state(execution_id)
  WHERE current_state IN (
    'reserved', 'dispatching', 'accepted', 'running', 'cancel_requested',
    'finalizing', 'outcome_unknown', 'blocked'
  );
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attempt_jobs (
  attempt_id UUID PRIMARY KEY REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  backend_instance_namespace VARCHAR(128) NOT NULL,
  backend_job_id VARCHAR(255) NOT NULL,
  reserved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT attempt_jobs_namespace_ck CHECK (length(btrim(backend_instance_namespace)) > 0),
  CONSTRAINT attempt_jobs_id_ck CHECK (length(btrim(backend_job_id)) > 0),
  CONSTRAINT attempt_jobs_backend_binding_unique
    UNIQUE (backend_instance_namespace, backend_job_id)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attempt_run_results (
  attempt_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  run_id UUID NOT NULL,
  outcome VARCHAR(24) NOT NULL,
  metrics_artifact_sha256 VARCHAR(64),
  manifest_sha256 VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (attempt_id, run_id),
  CONSTRAINT attempt_run_results_member_fk FOREIGN KEY (attempt_id, execution_id, run_id)
    REFERENCES execution_attempt_members(attempt_id, execution_id, run_id) ON DELETE RESTRICT,
  CONSTRAINT attempt_run_results_outcome_ck CHECK (outcome IN ('succeeded', 'failed', 'cancelled', 'not_reached')),
  CONSTRAINT attempt_run_results_metrics_hash_ck CHECK (
    metrics_artifact_sha256 IS NULL OR metrics_artifact_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  CONSTRAINT attempt_run_results_manifest_hash_ck CHECK (
    manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-fA-F]{64}$'
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attempt_run_results_execution_idx ON attempt_run_results(execution_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attempt_provenance (
  attempt_id UUID PRIMARY KEY REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  specification_set_sha256 VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT attempt_provenance_specification_hash_ck
    CHECK (specification_set_sha256 ~ '^[0-9a-fA-F]{64}$')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attempt_start_attestations (
  attempt_id UUID PRIMARY KEY REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  start_attestation_sha256 VARCHAR(64) NOT NULL,
  canonical_bytes BYTEA NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT attempt_start_attestations_hash_ck
    CHECK (start_attestation_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT attempt_start_attestations_bytes_ck CHECK (octet_length(canonical_bytes) > 0)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attempt_final_manifests (
  attempt_id UUID PRIMARY KEY REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  final_manifest_sha256 VARCHAR(64) NOT NULL,
  canonical_bytes BYTEA NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT attempt_final_manifests_hash_ck
    CHECK (final_manifest_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT attempt_final_manifests_bytes_ck CHECK (octet_length(canonical_bytes) > 0)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS operation_keys (
  operation_key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope_kind VARCHAR(16) NOT NULL,
  scope_namespace VARCHAR(128) NOT NULL,
  scope_project_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
  semantic_operation VARCHAR(64) NOT NULL,
  target_id UUID NOT NULL,
  client_key VARCHAR(128) NOT NULL,
  request_sha256 VARCHAR(64) NOT NULL,
  execution_id UUID NOT NULL REFERENCES executions(execution_id) ON DELETE RESTRICT,
  attempt_id UUID NOT NULL REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT operation_keys_scope_kind_ck CHECK (scope_kind IN ('private', 'project')),
  CONSTRAINT operation_keys_scope_namespace_ck CHECK (length(btrim(scope_namespace)) > 0),
  CONSTRAINT operation_keys_scope_project_ck CHECK (
    (scope_kind = 'private' AND scope_project_id IS NULL)
    OR (scope_kind = 'project' AND scope_project_id IS NOT NULL)
  ),
  CONSTRAINT operation_keys_operation_ck CHECK (length(btrim(semantic_operation)) > 0),
  CONSTRAINT operation_keys_target_ck CHECK (target_id <> '00000000-0000-0000-0000-000000000000'),
  CONSTRAINT operation_keys_client_key_ck CHECK (length(btrim(client_key)) BETWEEN 1 AND 128),
  CONSTRAINT operation_keys_request_hash_ck CHECK (request_sha256 ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT operation_keys_execution_attempt_fk FOREIGN KEY (attempt_id)
    REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  CONSTRAINT operation_keys_scope_tuple_unique UNIQUE (
    principal_id, scope_kind, scope_namespace, scope_project_id,
    semantic_operation, target_id, client_key
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS operation_keys_execution_idx ON operation_keys(execution_id);
CREATE INDEX IF NOT EXISTS operation_keys_attempt_idx ON operation_keys(attempt_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS dispatch_outbox (
  outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  event_type VARCHAR(32) NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  payload_bytes BYTEA NOT NULL DEFAULT ''::bytea,
  delivery_state VARCHAR(16) NOT NULL DEFAULT 'pending',
  available_at TIMESTAMP NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMP,
  CONSTRAINT dispatch_outbox_event_type_ck CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT dispatch_outbox_version_ck CHECK (event_version > 0),
  CONSTRAINT dispatch_outbox_delivery_state_ck CHECK (delivery_state IN ('pending', 'claimed', 'delivered', 'failed')),
  CONSTRAINT dispatch_outbox_attempt_event_unique UNIQUE (attempt_id, event_type, event_version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dispatch_outbox_pending_idx
  ON dispatch_outbox(delivery_state, available_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS notification_outbox (
  outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  event_type VARCHAR(32) NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  payload_bytes BYTEA NOT NULL DEFAULT ''::bytea,
  delivery_state VARCHAR(16) NOT NULL DEFAULT 'pending',
  available_at TIMESTAMP NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMP,
  CONSTRAINT notification_outbox_event_type_ck CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT notification_outbox_version_ck CHECK (event_version > 0),
  CONSTRAINT notification_outbox_delivery_state_ck CHECK (delivery_state IN ('pending', 'claimed', 'delivered', 'failed')),
  CONSTRAINT notification_outbox_attempt_event_unique UNIQUE (attempt_id, event_type, event_version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON notification_outbox(delivery_state, available_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS integrity_observations (
  observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES execution_attempts(attempt_id) ON DELETE RESTRICT,
  artifact_sha256 VARCHAR(64),
  manifest_sha256 VARCHAR(64),
  observation_kind VARCHAR(32) NOT NULL,
  observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT integrity_observations_hash_ck CHECK (
    artifact_sha256 IS NOT NULL OR manifest_sha256 IS NOT NULL
  ),
  CONSTRAINT integrity_observations_artifact_hash_ck CHECK (
    artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  CONSTRAINT integrity_observations_manifest_hash_ck CHECK (
    manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  CONSTRAINT integrity_observations_kind_ck CHECK (length(btrim(observation_kind)) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS integrity_observations_attempt_idx
  ON integrity_observations(attempt_id, observed_at);
--> statement-breakpoint

-- Attempts, memberships, specifications, evidence and observations are historical.
-- Their rows cannot be rewritten or erased by the application connection.
CREATE OR REPLACE FUNCTION sdm_execution_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is append-only; DELETE is denied', TG_TABLE_NAME;
  END IF;
  RAISE EXCEPTION '% is append-only; UPDATE is denied', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'run_specifications', 'execution_members', 'execution_attempts',
    'execution_attempt_members', 'attempt_events', 'attempt_run_results',
    'attempt_provenance', 'attempt_start_attestations', 'attempt_final_manifests',
    'integrity_observations'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = table_name || '_append_only_trigger'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sdm_execution_append_only()',
        table_name || '_append_only_trigger', table_name
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- A retry must remain on the same execution and follow its predecessor.
CREATE OR REPLACE FUNCTION sdm_execution_attempt_retry_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  predecessor_execution UUID;
  predecessor_ordinal INTEGER;
BEGIN
  IF NEW.retry_of_attempt_id IS NOT NULL THEN
    SELECT execution_id, ordinal INTO predecessor_execution, predecessor_ordinal
      FROM execution_attempts WHERE attempt_id = NEW.retry_of_attempt_id;
    IF predecessor_execution IS NULL THEN
      RAISE EXCEPTION 'retry predecessor does not exist';
    END IF;
    IF predecessor_execution <> NEW.execution_id OR predecessor_ordinal >= NEW.ordinal THEN
      RAISE EXCEPTION 'retry predecessor must be an earlier attempt of the same execution';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'execution_attempts_retry_guard'
  ) THEN
    CREATE TRIGGER execution_attempts_retry_guard
      BEFORE INSERT ON execution_attempts
      FOR EACH ROW EXECUTE FUNCTION sdm_execution_attempt_retry_guard();
  END IF;
END $$;
--> statement-breakpoint

-- Event sequence allocation is serialized per attempt.  A duplicate event ID
-- can be made a no-op with INSERT ... ON CONFLICT DO NOTHING; a new event may
-- never reuse an existing sequence.
CREATE OR REPLACE FUNCTION sdm_attempt_event_sequence_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  highest_sequence BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM attempt_events WHERE event_id = NEW.event_id) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.attempt_id::text, 0));
  SELECT max(sequence) INTO highest_sequence FROM attempt_events WHERE attempt_id = NEW.attempt_id;
  IF highest_sequence IS NOT NULL AND NEW.sequence <= highest_sequence THEN
    RAISE EXCEPTION 'attempt event sequence must increase';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attempt_events_sequence_guard'
  ) THEN
    CREATE TRIGGER attempt_events_sequence_guard
      BEFORE INSERT ON attempt_events
      FOR EACH ROW EXECUTE FUNCTION sdm_attempt_event_sequence_guard();
  END IF;
END $$;
