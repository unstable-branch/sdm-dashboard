/**
 * Durable execution ownership — S1 schema.ts contract (docs/DESIGN_DURABLE_EXECUTION_OWNERSHIP.md §2.2).
 *
 * Unit test: pins the drizzle table definitions that slices S3+ will import,
 * mirroring migration 0041 (the SQL-level truth is asserted by
 * execution-migration.test.ts against a real PostgreSQL).
 */
import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  executions,
  executionAttempts,
  idempotencyRequests,
  plumberInstances,
  plumberInstanceBoots,
  executionEvents,
  executionStatusEnum,
  executionAttemptKindEnum,
} from "./schema.js";

const columnNames = (table: PgTable): string[] => getTableConfig(table).columns.map((c) => c.name);

describe("durable execution drizzle schema", () => {
  it("exposes the six durable-execution tables", () => {
    expect(getTableConfig(executions).name).toBe("executions");
    expect(getTableConfig(executionAttempts).name).toBe("execution_attempts");
    expect(getTableConfig(idempotencyRequests).name).toBe("idempotency_requests");
    expect(getTableConfig(plumberInstances).name).toBe("plumber_instances");
    expect(getTableConfig(plumberInstanceBoots).name).toBe("plumber_instance_boots");
    expect(getTableConfig(executionEvents).name).toBe("execution_events");
  });

  it("pins the execution enums to the design's values", () => {
    expect(executionStatusEnum.enumValues).toEqual([
      "reserved",
      "dispatching",
      "cancel_requested",
      "accepted",
      "lost_response",
      "adopted",
      "succeeded",
      "failed",
      "cancelled",
      "expired",
    ]);
    expect(executionAttemptKindEnum.enumValues).toEqual(["initial", "reconciliation"]);
  });

  it("keeps executions attempt-canonical: no owner or job columns (invariant 3)", () => {
    const names = columnNames(executions);
    expect(names).toEqual([
      "id",
      "run_id",
      "run_seq",
      "status",
      "attempt_count",
      "cancel_requested_at",
      "idempotency_key",
      "nonce128",
      "payload_hash",
      "retry_of_execution_id",
      "lease_expires_at",
      "reserved_by_principal",
      "project_id",
      "created_at",
      "finalized_at",
    ]);
    const ownerCols = names.filter((n) => ["owner_instance_id", "owner_boot_id", "plumber_job_id"].includes(n));
    expect(ownerCols).toEqual([]);
  });

  it("pins executions column nullability and defaults", () => {
    const cfg = getTableConfig(executions);
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(byName.run_id.notNull).toBe(true);
    expect(byName.run_seq.notNull).toBe(true);
    expect(byName.status.notNull).toBe(true);
    expect(byName.status.hasDefault).toBe(true);
    expect(byName.attempt_count.notNull).toBe(true);
    expect(byName.attempt_count.hasDefault).toBe(true);
    expect(byName.cancel_requested_at.notNull).toBe(false);
    expect(byName.idempotency_key.notNull).toBe(true);
    expect(byName.nonce128.notNull).toBe(true);
    expect(byName.payload_hash.notNull).toBe(true);
    expect(byName.retry_of_execution_id.notNull).toBe(false);
    expect(byName.lease_expires_at.notNull).toBe(false);
    expect(byName.reserved_by_principal.notNull).toBe(true);
    expect(byName.project_id.notNull).toBe(true);
    expect(byName.finalized_at.notNull).toBe(false);
  });

  it("types execution_attempts with the owner snapshot and one-time job id", () => {
    expect(columnNames(executionAttempts)).toEqual([
      "id",
      "execution_id",
      "attempt_no",
      "attempt_key",
      "kind",
      "plumber_job_id",
      "owner_instance_id",
      "owner_boot_id",
      "outcome",
      "error_code",
      "error_hint",
      "started_at",
      "finalized_at",
    ]);
    const cfg = getTableConfig(executionAttempts);
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(byName.execution_id.notNull).toBe(true);
    expect(byName.attempt_no.notNull).toBe(true);
    expect(byName.attempt_key.notNull).toBe(true);
    expect(byName.kind.notNull).toBe(true);
    expect(byName.plumber_job_id.notNull).toBe(false);
    expect(byName.owner_instance_id.notNull).toBe(false);
    expect(byName.owner_boot_id.notNull).toBe(false);
    expect(byName.finalized_at.notNull).toBe(false);
  });

  it("types idempotency_requests with the permanent-tombstone shape", () => {
    expect(columnNames(idempotencyRequests)).toEqual([
      "principal",
      "key",
      "project_id",
      "request_hash",
      "run_id",
      "response_status",
      "response_body",
      "created_at",
      "expires_at",
    ]);
    const cfg = getTableConfig(idempotencyRequests);
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(byName.principal.notNull).toBe(true);
    expect(byName.key.notNull).toBe(true);
    expect(byName.project_id.notNull).toBe(true);
    expect(byName.request_hash.notNull).toBe(true);
    expect(byName.run_id.notNull).toBe(true);
    expect(byName.response_status.notNull).toBe(false);
    expect(byName.response_body.notNull).toBe(false);
    expect(byName.expires_at.notNull).toBe(true);
    // PK (principal, key) is the one-key/one-execution gate.
    expect(cfg.primaryKeys.map((pk) => pk.columns.map((c) => c.name).join(","))).toContain("principal,key");
  });

  it("types the instance boot registry with pid_chain_verified defaulting false", () => {
    expect(columnNames(plumberInstances)).toEqual(["id", "api_base_url", "first_seen_at", "last_seen_at"]);
    expect(columnNames(plumberInstanceBoots)).toEqual([
      "boot_id",
      "instance_id",
      "announced_at",
      "last_seen_at",
      "pid_chain_verified",
    ]);
    const cfg = getTableConfig(plumberInstanceBoots);
    const pidChain = cfg.columns.find((c) => c.name === "pid_chain_verified");
    expect(pidChain?.notNull).toBe(true);
    expect(pidChain?.hasDefault).toBe(true);
  });

  it("keeps execution_events append-only with per-execution sequence", () => {
    expect(columnNames(executionEvents)).toEqual(["id", "execution_id", "attempt_no", "seq", "event", "observed", "emitted_at"]);
    const cfg = getTableConfig(executionEvents);
    expect(cfg.indexes.map((i) => i.config.name)).toContain("execution_events_execution_seq_unique");
    const seqIdx = cfg.indexes.find((i) => i.config.name === "execution_events_execution_seq_unique");
    const seqCols = (seqIdx?.config.columns ?? []).map((c) => (c && typeof c === "object" && "name" in c ? String((c as { name: unknown }).name) : String(c)));
    expect(seqCols).toEqual(["execution_id", "seq"]);
  });

  it("declares the design's unique indexes on executions and attempts", () => {
    const execIdx = getTableConfig(executions).indexes.map((i) => i.config.name);
    expect(execIdx).toContain("executions_open_per_run_uq");
    const attemptIdx = getTableConfig(executionAttempts).indexes.map((i) => i.config.name);
    expect(attemptIdx).toContain("execution_attempts_open_uq");
  });
});