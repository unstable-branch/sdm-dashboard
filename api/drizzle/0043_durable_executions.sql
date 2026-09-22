-- 0043: durable execution ownership — S1 schema slice.
--
-- Implements the schema half of docs/DESIGN_DURABLE_EXECUTION_OWNERSHIP.md §2.2
-- (rev 6). This migration is deliberately inert (Phase A of the §5 rollout): it
-- adds new tables and enums only, touches no existing table, and changes no
-- behavior. Rollback: drizzle/rollback/0043_durable_executions.down.sql
-- (drop the six tables and two enums).
--
-- Design notes encoded here:
-- - executions carries NO owner columns and NO plumber_job_id: ownership and
--   external job identity are attempt-canonical, living only on
--   execution_attempts (§2.2, invariant 3/12).
-- - idempotency_requests.run_id → runs.id is DEFERRABLE INITIALLY DEFERRED so
--   the reservation row can be inserted before the run row inside one
--   transaction and the FK is checked at commit (§2.2.2). Rows are never
--   deleted (permanent tombstones, §2.2.2 retention); ON DELETE RESTRICT keeps
--   run deletion from silently reopening a key.
-- - plumber_instance_boots is append-only (one row per Plumber process start);
--   pid_chain_verified defaults to false — a boot is unverified until it proves
--   its container-lifetime chain via /proc at boot (§2.2.4, invariant 14).
-- - execution_events is append-only, transitions only, unique per
--   (execution_id, seq) (§2.6).

DO $$
BEGIN
  CREATE TYPE execution_status AS ENUM (
    'reserved',
    'dispatching',
    'cancel_requested',
    'accepted',
    'lost_response',
    'adopted',
    'succeeded',
    'failed',
    'cancelled',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE execution_attempt_kind AS ENUM ('initial', 'reconciliation');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  run_seq INTEGER NOT NULL,
  status execution_status NOT NULL DEFAULT 'reserved',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  cancel_requested_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  nonce128 TEXT NOT NULL CHECK (nonce128 ~ '^[0-9a-fA-F]{32}$'),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-fA-F]{64}$'),
  retry_of_execution_id UUID REFERENCES executions(id) ON DELETE CASCADE,
  lease_expires_at TIMESTAMPTZ,
  reserved_by_principal UUID NOT NULL,
  project_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  CONSTRAINT executions_run_seq_unique UNIQUE (run_id, run_seq)
);
--> statement-breakpoint
-- Invariant 1: at most one non-terminal execution per run.
CREATE UNIQUE INDEX IF NOT EXISTS executions_open_per_run_uq
  ON executions (run_id) WHERE finalized_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS executions_run_id_idx ON executions (run_id);
--> statement-breakpoint
-- Sweep lookup: non-terminal executions for reconciliation.
CREATE INDEX IF NOT EXISTS executions_open_status_idx
  ON executions (status) WHERE finalized_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS execution_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  attempt_key TEXT NOT NULL UNIQUE CHECK (length(btrim(attempt_key)) > 0),
  kind execution_attempt_kind NOT NULL,
  -- External Plumber job identity lives here only, written at most once per attempt.
  plumber_job_id VARCHAR(100) UNIQUE,
  -- Owner snapshot of the Plumber instance boot that accepted this attempt
  -- (audit/routing data; no hard FK so prior-boot evidence is never destroyed).
  owner_instance_id UUID,
  owner_boot_id UUID,
  outcome TEXT,
  error_code TEXT,
  error_hint TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  -- Gapless attempt lineage: attempt_no is unique per execution across ALL
  -- attempts, finalized or open (§2.2); the partial index below separately
  -- keeps at most one open attempt per execution.
  CONSTRAINT execution_attempts_attempt_no_uq UNIQUE (execution_id, attempt_no)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS execution_attempts_open_uq
  ON execution_attempts (execution_id) WHERE finalized_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS idempotency_requests (
  principal UUID NOT NULL,
  key TEXT NOT NULL,
  project_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  run_id UUID NOT NULL UNIQUE,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT idempotency_requests_pk PRIMARY KEY (principal, key),
  -- Reservation is inserted before the run row in the same transaction and is
  -- checked at commit (§2.2.2). RESTRICT: tombstones are never deleted.
  CONSTRAINT idempotency_requests_run_id_fk FOREIGN KEY (run_id)
    REFERENCES runs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
-- Housekeeping prunes response_body past expires_at + 7d; never deletes rows.
CREATE INDEX IF NOT EXISTS idempotency_requests_expires_idx ON idempotency_requests (expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plumber_instances (
  id UUID PRIMARY KEY,
  api_base_url TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plumber_instance_boots (
  boot_id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES plumber_instances(id) ON DELETE RESTRICT,
  announced_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  pid_chain_verified BOOLEAN NOT NULL DEFAULT FALSE
);
--> statement-breakpoint
-- Current boot for an instance = greatest announced_at (routing hint only).
CREATE INDEX IF NOT EXISTS plumber_instance_boots_instance_idx
  ON plumber_instance_boots (instance_id, announced_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS execution_events (
  id BIGSERIAL PRIMARY KEY,
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  attempt_no INTEGER,
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,
  observed JSONB,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT execution_events_execution_seq_unique UNIQUE (execution_id, seq)
);