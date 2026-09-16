import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const migration = readFileSync(resolve(root, "api/drizzle/0040_execution_attempt_foundation.sql"), "utf8");
const journal = JSON.parse(readFileSync(resolve(root, "api/drizzle/meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};
const schema = readFileSync(resolve(root, "api/src/db/schema.ts"), "utf8");

const tableNames = [
  "executions", "run_specifications", "execution_members", "execution_attempts",
  "execution_attempt_members", "attempt_events", "attempt_state", "attempt_jobs",
  "attempt_run_results", "attempt_provenance", "attempt_start_attestations",
  "attempt_final_manifests", "operation_keys", "dispatch_outbox", "notification_outbox",
  "integrity_observations",
];

function tableBlock(name: string): string {
  const start = migration.indexOf("CREATE TABLE IF NOT EXISTS " + name);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("M4 execution foundation migration contract", () => {
  it("is the additive migration after 0039 and is represented in the Drizzle journal", () => {
    const entries = journal.entries;
    expect(entries.at(-2)).toMatchObject({ idx: 39, tag: "0039_occurrence_clean_jobs" });
    expect(entries.at(-1)).toMatchObject({ idx: 40, tag: "0040_execution_attempt_foundation" });
    expect(migration).toContain("Existing 0037, 0038 and 0039 migrations remain authoritative");
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i);
  });

  it("declares every execution, attempt, evidence, key and outbox relation", () => {
    for (const name of tableNames) expect(migration).toContain("CREATE TABLE IF NOT EXISTS " + name);
    expect(migration).toContain("attempt_state_one_active_execution_idx");
    expect(migration).toContain("WHERE current_state IN");
    expect(migration).toContain("UNIQUE (execution_id, ordinal)");
    expect(migration).toContain("UNIQUE (backend_instance_namespace, backend_job_id)");
    expect(migration).toContain("UNIQUE (attempt_id, event_type, event_version)");
    expect(migration).toContain("UNIQUE (principal_id, scope_kind, scope_namespace, scope_project_id");
  });

  it("uses strict hashes, canonical bytes, restricted deletion, and explicit scopes", () => {
    expect(migration).toContain("canonical_bytes BYTEA NOT NULL");
    expect(migration).toMatch(/sha256 VARCHAR\(64\) NOT NULL/);
    expect(migration).not.toMatch(/ON DELETE CASCADE/);
    expect(migration).toContain("scope_kind IN ('private', 'project')");
    expect(migration).toContain("scope_project_id IS NULL");
    expect(migration).toContain("scope_namespace VARCHAR(128) NOT NULL");
    expect(tableBlock("operation_keys")).toContain("operation_keys_target_ck");
  });

  it("installs append-only guards for historical rows and retry/sequence guards", () => {
    for (const name of [
      "run_specifications", "execution_members", "execution_attempts", "execution_attempt_members",
      "attempt_events", "attempt_run_results", "attempt_provenance", "attempt_start_attestations",
      "attempt_final_manifests", "integrity_observations",
    ]) expect(migration).toContain("'" + name + "'");
    expect(migration).toContain("sdm_execution_append_only");
    expect(migration).toContain("sdm_execution_attempt_retry_guard");
    expect(migration).toContain("sdm_attempt_event_sequence_guard");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("keeps schema exports aligned with the additive table set", () => {
    for (const name of [
      "executions", "runSpecifications", "executionMembers", "executionAttempts",
      "executionAttemptMembers", "attemptEvents", "attemptState", "attemptJobs",
      "attemptRunResults", "attemptProvenance", "attemptStartAttestations", "attemptFinalManifests",
      "operationKeys", "dispatchOutbox", "notificationOutbox", "integrityObservations",
    ]) expect(schema).toContain("export const " + name + " = pgTable");
  });

  it("makes evidence rows immutable while leaving delivery projection mutable", () => {
    const guarded = ["run_specifications", "execution_attempts", "attempt_events", "attempt_final_manifests"];
    for (const name of guarded) expect(tableBlock(name)).toMatch(/PRIMARY KEY|NOT NULL/);
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON %I");
    expect(tableBlock("dispatch_outbox")).toContain("delivery_state");
  });
});
