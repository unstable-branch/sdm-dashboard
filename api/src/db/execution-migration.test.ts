/**
 * Durable execution ownership — S1 schema contract (docs/DESIGN_DURABLE_EXECUTION_OWNERSHIP.md §2.2).
 *
 * Integration test: applies the real drizzle migration sequence to a throwaway
 * PostgreSQL database and pins the exact schema invariants the execution state
 * machine (slice S3) will rely on.
 *
 * Requires SDM_MIGRATION_TEST_DATABASE_URL pointing at an EMPTY, disposable
 * database (its `public` schema is dropped and recreated). Skips otherwise.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const DATABASE_URL = process.env.SDM_MIGRATION_TEST_DATABASE_URL;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NONCE = "a".repeat(32);
const PAYLOAD_HASH = "b".repeat(64);

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface FkInfo {
  conname: string;
  def: string;
  is_deferrable: string;
  initially_deferred: string;
}

interface ExecOverrides {
  runId?: string;
  runSeq?: number;
  idempotencyKey?: string;
  nonce?: string;
  payloadHash?: string;
  status?: string;
  finalized?: Date | null;
}

interface AttemptOverrides {
  executionId?: string | null;
  attemptNo?: number;
  attemptKey?: string;
  kind?: string;
  jobId?: string | null;
  finalized?: Date | null;
}

describe.skipIf(!DATABASE_URL)("durable execution schema (migration 0043)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    // Guarantee a clean slate: this must only ever be a disposable test DB.
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    await pool.query("INSERT INTO users (id, email, password_hash, role) VALUES ($1, 'exec-schema@test.local', 'x', 'admin')", [USER_ID]);
    await pool.query("INSERT INTO projects (id, name, owner_id) VALUES ($1, 'exec-schema-project', $2)", [PROJECT_ID, USER_ID]);
  });

  const enumLabels = async (name: string): Promise<string[]> => {
    const res = await pool.query(
      "SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname=$1 ORDER BY e.enumsortorder",
      [name],
    );
    return res.rows.map((r: { enumlabel: string }) => r.enumlabel);
  };

  const columnNames = async (table: string): Promise<string[]> => {
    const res = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
      [table],
    );
    return res.rows.map((r: { column_name: string }) => r.column_name);
  };

  const columns = async (table: string): Promise<Record<string, ColumnInfo>> => {
    const res = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [table],
    );
    return Object.fromEntries(res.rows.map((c: ColumnInfo) => [c.column_name, c]));
  };

  const indexDefs = async (table: string): Promise<string[]> => {
    const res = await pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1", [table]);
    return res.rows.map((r: { indexdef: string }) => r.indexdef);
  };

  const fkDefs = async (table: string): Promise<FkInfo[]> => {
    const res = await pool.query(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def, tc.is_deferrable, tc.initially_deferred
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN information_schema.table_constraints tc
         ON tc.constraint_name = con.conname AND tc.table_name = rel.relname AND tc.constraint_type = 'FOREIGN KEY'
       WHERE rel.relname = $1 AND con.contype = 'f'`,
      [table],
    );
    return res.rows;
  };

  const createRun = async (): Promise<string> => {
    const res = await pool.query("INSERT INTO runs (project_id, model_id, config) VALUES ($1, 'test-glm', '{}'::jsonb) RETURNING id", [
      PROJECT_ID,
    ]);
    return res.rows[0].id;
  };

  const insertExecution = async (overrides: ExecOverrides = {}): Promise<Required<ExecOverrides> & { runId: string }> => {
    const p = {
      runId: await createRun(),
      runSeq: 1,
      idempotencyKey: `ik-${Math.random().toString(36).slice(2, 10)}`,
      nonce: NONCE,
      payloadHash: PAYLOAD_HASH,
      status: "reserved",
      finalized: null as Date | null,
      ...overrides,
    };
    await pool.query(
      `INSERT INTO executions (run_id, run_seq, status, idempotency_key, nonce128, payload_hash,
         reserved_by_principal, project_id, finalized_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.runId, p.runSeq, p.status, p.idempotencyKey, p.nonce, p.payloadHash, USER_ID, PROJECT_ID, p.finalized],
    );
    return p;
  };

  const insertAttempt = async (overrides: AttemptOverrides = {}): Promise<void> => {
    const p = {
      executionId: null as string | null,
      attemptNo: 1,
      attemptKey: `ak-${Math.random().toString(36).slice(2, 10)}`,
      kind: "initial",
      jobId: null as string | null,
      finalized: null as Date | null,
      ...overrides,
    };
    await pool.query(
      `INSERT INTO execution_attempts (execution_id, attempt_no, attempt_key, kind, plumber_job_id, finalized_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.executionId, p.attemptNo, p.attemptKey, p.kind, p.jobId, p.finalized],
    );
  };

  const executionIdForKey = async (idempotencyKey: string): Promise<string> =>
    (await pool.query("SELECT id FROM executions WHERE idempotency_key=$1", [idempotencyKey])).rows[0].id;

  it("creates executions with exactly the design's columns and no owner/job columns (invariant 3)", async () => {
    const names = await columnNames("executions");
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

  it("types executions columns exactly", async () => {
    const c = await columns("executions");
    expect(c.id.data_type).toBe("uuid");
    expect(c.run_id.data_type).toBe("uuid");
    expect(c.run_id.is_nullable).toBe("NO");
    expect(c.run_seq.data_type).toBe("integer");
    expect(c.run_seq.is_nullable).toBe("NO");
    expect(c.status.data_type).toBe("USER-DEFINED");
    expect(c.status.column_default).toBe("'reserved'::execution_status");
    expect(c.attempt_count.column_default).toBe("0");
    expect(c.cancel_requested_at.is_nullable).toBe("YES");
    expect(c.idempotency_key.is_nullable).toBe("NO");
    expect(c.nonce128.is_nullable).toBe("NO");
    expect(c.payload_hash.is_nullable).toBe("NO");
    expect(c.retry_of_execution_id.is_nullable).toBe("YES");
    expect(c.lease_expires_at.is_nullable).toBe("YES");
    expect(c.reserved_by_principal.is_nullable).toBe("NO");
    expect(c.project_id.is_nullable).toBe("NO");
    expect(c.finalized_at.is_nullable).toBe("YES");
  });

  it("pins the execution_status enum to the design's ten states", async () => {
    expect(await enumLabels("execution_status")).toEqual([
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
  });

  it("pins the execution_attempt_kind enum", async () => {
    expect(await enumLabels("execution_attempt_kind")).toEqual(["initial", "reconciliation"]);
  });

  it("enforces one non-terminal execution per run (invariant 1)", async () => {
    const runId = await createRun();
    await insertExecution({ runId, runSeq: 1, idempotencyKey: "inv1-open" });
    await expect(insertExecution({ runId, runSeq: 2, idempotencyKey: "inv1-collide" })).rejects.toMatchObject({ code: "23505" });
    // A terminal execution coexists with the open one.
    await insertExecution({ runId, runSeq: 2, idempotencyKey: "inv1-terminal", status: "failed", finalized: new Date() });
  });

  it("keeps run_seq unique per run", async () => {
    const runId = await createRun();
    await insertExecution({ runId, runSeq: 1, idempotencyKey: "seq-first" });
    await expect(insertExecution({ runId, runSeq: 1, idempotencyKey: "seq-dup", finalized: new Date() })).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("defaults executions.status to reserved and rejects non-design statuses", async () => {
    const runId = await createRun();
    const res = await pool.query(
      `INSERT INTO executions (run_id, run_seq, idempotency_key, nonce128, payload_hash, reserved_by_principal, project_id)
       VALUES ($1, 1, 'ik-default', $2, $3, $4, $5) RETURNING status`,
      [runId, NONCE, PAYLOAD_HASH, USER_ID, PROJECT_ID],
    );
    expect(res.rows[0].status).toBe("reserved");
    await expect(
      pool.query(
        `INSERT INTO executions (run_id, run_seq, status, idempotency_key, nonce128, payload_hash, reserved_by_principal, project_id)
         VALUES ($1, 2, 'respawning', 'ik-bad-status', $2, $3, $4, $5)`,
        [runId, NONCE, PAYLOAD_HASH, USER_ID, PROJECT_ID],
      ),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  it("enforces nonce and payload-hash shape", async () => {
    await expect(insertExecution({ idempotencyKey: "ik-bad-nonce", nonce: "zz" })).rejects.toMatchObject({ code: "23514" });
    await expect(insertExecution({ idempotencyKey: "ik-bad-hash", payloadHash: "nothex" })).rejects.toMatchObject({ code: "23514" });
  });

  it("types execution_attempts exactly", async () => {
    expect(await columnNames("execution_attempts")).toEqual([
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
  });

  it("keeps attempt_no unique and one open attempt per execution", async () => {
    const p = await insertExecution({ idempotencyKey: "ik-attempts" });
    const exec = await executionIdForKey(p.idempotencyKey);
    await insertAttempt({ executionId: exec, attemptNo: 1, attemptKey: "ik-attempts:1" });
    await expect(insertAttempt({ executionId: exec, attemptNo: 1, attemptKey: "ik-attempts:1b" })).rejects.toMatchObject({
      code: "23505",
    });
    await expect(insertAttempt({ executionId: exec, attemptNo: 2, attemptKey: "ik-attempts:1" })).rejects.toMatchObject({
      code: "23505",
    });
    // A second open attempt on the same execution is refused (partial unique index).
    await expect(insertAttempt({ executionId: exec, attemptNo: 2, attemptKey: "ik-attempts:2" })).rejects.toMatchObject({
      code: "23505",
    });
    // Finalizing the attempt frees the slot for the reconciliation attempt.
    await pool.query("UPDATE execution_attempts SET finalized_at=now(), outcome='unknown' WHERE attempt_key='ik-attempts:1'");
    await insertAttempt({ executionId: exec, attemptNo: 2, attemptKey: "ik-attempts:2", kind: "reconciliation" });
  });

  it("keeps plumber_job_id unique across attempts while allowing many NULLs", async () => {
    const a = await insertExecution({ idempotencyKey: "ik-job-a" });
    const b = await insertExecution({ idempotencyKey: "ik-job-b" });
    const execA = await executionIdForKey(a.idempotencyKey);
    const execB = await executionIdForKey(b.idempotencyKey);
    await insertAttempt({ executionId: execA, attemptNo: 1, attemptKey: "ik-job-a:1", jobId: "run-1-1234" });
    await expect(insertAttempt({ executionId: execB, attemptNo: 1, attemptKey: "ik-job-b:1", jobId: "run-1-1234" })).rejects.toMatchObject({
      code: "23505",
    });
    await insertAttempt({ executionId: execB, attemptNo: 1, attemptKey: "ik-job-b:2", jobId: null });
  });

  it("writes owner snapshots on the attempt, never on the execution (invariants 3, 12)", async () => {
    const p = await insertExecution({ idempotencyKey: "ik-owner" });
    const exec = await executionIdForKey(p.idempotencyKey);
    await insertAttempt({ executionId: exec, attemptNo: 1, attemptKey: "ik-owner:1" });
    const r = await pool.query("SELECT id FROM execution_attempts WHERE attempt_key='ik-owner:1'");
    const instanceId = "88888888-8888-4888-8888-888888888888";
    const bootId = "99999999-9999-4999-8999-999999999999";
    await pool.query("UPDATE execution_attempts SET plumber_job_id='run-2-9999', owner_instance_id=$1, owner_boot_id=$2 WHERE id=$3", [
      instanceId,
      bootId,
      r.rows[0].id,
    ]);
    const stored = await pool.query("SELECT owner_instance_id, owner_boot_id, plumber_job_id FROM execution_attempts WHERE id=$1", [r.rows[0].id]);
    expect(stored.rows[0]).toEqual({ owner_instance_id: instanceId, owner_boot_id: bootId, plumber_job_id: "run-2-9999" });
  });

  it("pins idempotency_requests shape and (principal, key) scoping (invariant 9)", async () => {
    expect(await columnNames("idempotency_requests")).toEqual([
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
    const otherUser = "44444444-4444-4444-8444-444444444444";
    await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, 'other@test.local', 'x')", [otherUser]);
    await pool.query(
      "INSERT INTO idempotency_requests (principal, key, project_id, request_hash, run_id, expires_at) VALUES ($1,'key-1',$2,'hash-1',$3, now()+interval '48 hours')",
      [USER_ID, PROJECT_ID, await createRun()],
    );
    await expect(
      pool.query(
        "INSERT INTO idempotency_requests (principal, key, project_id, request_hash, run_id, expires_at) VALUES ($1,'key-1',$2,'hash-1',gen_random_uuid(), now()+interval '48 hours')",
        [USER_ID, PROJECT_ID],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    // Same key from another principal is a different logical request (keys are scoped).
    await pool.query(
      "INSERT INTO idempotency_requests (principal, key, project_id, request_hash, run_id, expires_at) VALUES ($1,'key-1',$2,'hash-1',$3, now()+interval '48 hours')",
      [otherUser, PROJECT_ID, await createRun()],
    );
  });

  it("resolves the idempotency run_id FK at commit only (§2.2.2 winner path)", async () => {
    const runIdFk = (await fkDefs("idempotency_requests")).find((f) => f.def.includes("run_id"));
    expect(runIdFk).toBeTruthy();
    expect(runIdFk?.is_deferrable).toBe("YES");
    expect(runIdFk?.initially_deferred).toBe("YES");
    // Winner path: reservation inserted before the run row, satisfied at commit.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const runUuid = "55555555-5555-4555-8555-555555555555";
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query(
        "INSERT INTO idempotency_requests (principal, key, project_id, request_hash, run_id, expires_at) VALUES ($1,'key-defer',$2,'hash-defer',$3, now()+interval '48 hours')",
        [USER_ID, PROJECT_ID, runUuid],
      );
      await client.query("INSERT INTO runs (id, project_id, model_id, config) VALUES ($1,$2,'test-glm','{}'::jsonb)", [runUuid, PROJECT_ID]);
      await client.query("COMMIT");
      // Run deletion is restricted while the tombstone exists (rows are never deleted).
      await expect(pool.query("DELETE FROM runs WHERE id=$1", [runUuid])).rejects.toMatchObject({ code: "23503" });
      // A reservation whose referenced run row never exists fails the deferred FK at commit.
      await expect(
        pool.query(
          "INSERT INTO idempotency_requests (principal, key, project_id, request_hash, run_id, expires_at) VALUES ($1,'key-orphan',$2,'hash',$3, now()+interval '48 hours')",
          [USER_ID, PROJECT_ID, "66666666-6666-4666-8666-666666666666"],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      client.release();
    }
  });

  it("keeps run_id unique across idempotency rows", async () => {
    const runUuid = await createRun();
    await pool.query(
      "INSERT INTO idempotency_requests (principal, key, project_id, request_hash, run_id, expires_at) VALUES ($1,'key-run-1',$2,'h',$3, now()+interval '48 hours')",
      [USER_ID, PROJECT_ID, runUuid],
    );
    await expect(
      pool.query(
        "INSERT INTO idempotency_requests (principal, key, project_id, request_hash, run_id, expires_at) VALUES ($1,'key-run-2',$2,'h',$3, now()+interval '48 hours')",
        [USER_ID, PROJECT_ID, runUuid],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("pins plumber_instances, plumber_instance_boots, and execution_events", async () => {
    expect(await columnNames("plumber_instances")).toEqual(["id", "api_base_url", "first_seen_at", "last_seen_at"]);
    expect(await columnNames("plumber_instance_boots")).toEqual([
      "boot_id",
      "instance_id",
      "announced_at",
      "last_seen_at",
      "pid_chain_verified",
    ]);
    expect(await columnNames("execution_events")).toEqual(["id", "execution_id", "attempt_no", "seq", "event", "observed", "emitted_at"]);
    expect((await fkDefs("plumber_instance_boots")).some((f) => f.def.includes("plumber_instances"))).toBe(true);
    // pid_chain_verified defaults to false: a boot is unverified until it proves its chain.
    const instance = await pool.query(
      "INSERT INTO plumber_instances (id, api_base_url) VALUES ($1, 'http://plumber:8000') RETURNING id",
      ["88888888-8888-4888-8888-888888888888"],
    );
    const boot = await pool.query(
      "INSERT INTO plumber_instance_boots (boot_id, instance_id, announced_at, last_seen_at) VALUES (gen_random_uuid(), $1, now(), now()) RETURNING pid_chain_verified",
      [instance.rows[0].id],
    );
    expect(boot.rows[0].pid_chain_verified).toBe(false);
    // Events are unique per (execution, seq).
    const p = await insertExecution({ idempotencyKey: "ik-events" });
    const exec = await executionIdForKey(p.idempotencyKey);
    await pool.query("INSERT INTO execution_events (execution_id, seq, event) VALUES ($1, 0, 'reserved')", [exec]);
    await expect(pool.query("INSERT INTO execution_events (execution_id, seq, event) VALUES ($1, 0, 'duplicate')", [exec])).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("pins the design's partial unique indexes", async () => {
    const execIdx = await indexDefs("executions");
    expect(execIdx.some((d) => d.includes("(run_id)") && d.includes("WHERE (finalized_at IS NULL)"))).toBe(true);
    const attemptIdx = await indexDefs("execution_attempts");
    expect(attemptIdx.some((d) => d.includes("(execution_id)") && d.includes("WHERE (finalized_at IS NULL)"))).toBe(true);
  });

  it("keeps executions.run_id and retry_of_execution_id foreign keys", async () => {
    const fks = await fkDefs("executions");
    const runFk = fks.find((f) => f.def.includes("runs"));
    expect(runFk).toBeTruthy();
    expect(runFk?.def).toContain("run_id");
    const retryFk = fks.find((f) => f.def.includes("retry_of_execution_id"));
    expect(retryFk?.def).toContain("executions");
  });

  it("binds execution_attempts and execution_events to executions", async () => {
    expect((await fkDefs("execution_events")).some((f) => f.def.includes("executions"))).toBe(true);
    expect((await fkDefs("execution_attempts")).some((f) => f.def.includes("executions"))).toBe(true);
  });

  it("rolls back cleanly (drop tables + enums) and can be re-applied (Phase A rollback)", async () => {
    const sql = await readFile(path.resolve(process.cwd(), "drizzle", "rollback", "0043_durable_executions.down.sql"), "utf8");
    await pool.query(sql);
    for (const table of ["executions", "execution_attempts", "idempotency_requests", "plumber_instances", "plumber_instance_boots", "execution_events"]) {
      expect((await columnNames(table)).length).toBe(0);
    }
    for (const type of ["execution_status", "execution_attempt_kind"]) {
      const res = await pool.query("SELECT 1 FROM pg_type WHERE typname=$1", [type]);
      expect(res.rows.length).toBe(0);
    }
    // Re-apply the forward migration raw; idempotent on an empty database.
    const forward = await readFile(path.resolve(process.cwd(), "drizzle", "0043_durable_executions.sql"), "utf8");
    await pool.query(forward);
    expect((await columnNames("executions")).length).toBeGreaterThan(0);
  });
});