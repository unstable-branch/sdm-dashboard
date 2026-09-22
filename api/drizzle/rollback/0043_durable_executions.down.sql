-- Phase A rollback for 0043_durable_executions (docs/DESIGN_DURABLE_EXECUTION_OWNERSHIP.md §5).
-- The S1 migration is inert, so dropping the new objects restores the exact
-- pre-0043 state; no existing table or column is touched. Child tables are
-- dropped before their parents; enums last (they are referenced by the tables).
BEGIN;

DROP TABLE IF EXISTS execution_events;
DROP TABLE IF EXISTS execution_attempts;
DROP TABLE IF EXISTS idempotency_requests;
DROP TABLE IF EXISTS plumber_instance_boots;
DROP TABLE IF EXISTS plumber_instances;
DROP TABLE IF EXISTS executions;

DROP TYPE IF EXISTS execution_status;
DROP TYPE IF EXISTS execution_attempt_kind;

COMMIT;