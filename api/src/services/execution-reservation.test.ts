import "../testing/disposable-execution-postgres.guard.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createExecutionReservationService, type ReservationErrorCode } from "./execution-reservation.js";

const databaseUrl = process.env.SDM_EXECUTION_TEST_DATABASE_URL;
const required = process.env.SDM_EXECUTION_TEST_REQUIRED === "1";
if (required && !databaseUrl) throw new Error("Required disposable execution database URL is missing");
const suite = databaseUrl ? describe : describe.skip;
const p1 = "11111111-1111-4111-8111-111111111111";
const p2 = "44444444-4444-4444-8444-444444444444";
const project = "22222222-2222-4222-8222-222222222222";
const valid = (key: string, principal = p1, hash = "a".repeat(64), requestHash = "b".repeat(64)) => ({
  principal, projectId: project, key, requestHash, payloadHash: hash,
  modelId: "test-glm", config: { species: "synthetic-test" },
});

suite("durable execution reservation (disposable PostgreSQL)", () => {
  let pool: Pool;
  let service: ReturnType<typeof createExecutionReservationService>;
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    service = createExecutionReservationService(pool);
    await pool.query("INSERT INTO users (id,email,password_hash,role) VALUES ($1,'exec-reserve-a@test.local','x','admin'),($2,'exec-reserve-b@test.local','x','admin') ON CONFLICT (id) DO NOTHING", [p1, p2]);
    await pool.query("INSERT INTO projects (id,name,owner_id) VALUES ($1,'exec-reservation-test',$2) ON CONFLICT (id) DO NOTHING", [project,p1]);
  });
  afterAll(async () => { await pool?.end(); });

  it("persists one run, execution, and response for a valid reservation", async () => {
    const input = valid(`first-${crypto.randomUUID()}`);
    const pending = service.reserve(input);
    await expect(pending).resolves.toMatchObject({ kind: "created", responseStatus: 202 });
    const result = await pending;
    expect(result.kind).toBe("created");
    const rows = await pool.query(
      `SELECT r.id AS run_id, e.id AS execution_id, q.response_status, q.response_body
       FROM runs r JOIN executions e ON e.run_id=r.id
       JOIN idempotency_requests q ON q.run_id=r.id
       WHERE q.principal=$1 AND q.key=$2`, [p1,input.key],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].run_id).toBe(result.runId);
    expect(rows.rows[0].execution_id).toBe(result.executionId);
    expect(rows.rows[0].response_status).toBe(result.responseStatus);
    expect(rows.rows[0].response_body).toEqual(result.responseBody);
  });

  it("replays the original execution after a later execution exists", async () => {
    const input = valid(`lineage-${crypto.randomUUID()}`);
    const original = await service.reserve(input);
    await pool.query("UPDATE executions SET status='failed',finalized_at=now() WHERE id=$1", [original.executionId]);
    const laterId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO executions (id,run_id,run_seq,status,idempotency_key,nonce128,payload_hash,reserved_by_principal,project_id,retry_of_execution_id) SELECT $1,run_id,2,'reserved',$2,$3,payload_hash,reserved_by_principal,project_id,id FROM executions WHERE id=$4",
      [laterId, `later-${crypto.randomUUID()}`, "e".repeat(32), original.executionId],
    );
    const pending = service.reserve(input);
    await expect(pending).resolves.toMatchObject({ kind: "replayed", executionId: original.executionId });
    const replay = await pending;
    expect(replay.responseStatus).toBe(original.responseStatus);
    expect(replay.responseBody).toEqual(original.responseBody);
    expect(replay.executionId).not.toBe(laterId);
    expect((await pool.query("SELECT count(*)::int AS n FROM executions WHERE run_id=$1", [original.runId])).rows[0].n).toBe(2);
  });

  it("rolls reservation failures back, leaving the key available", async () => {
    const input = valid(`rollback-${crypto.randomUUID()}`);
    await expect(service.reserve({ ...input, modelId: "x".repeat(51) })).rejects.toBeTruthy();
    const result = await service.reserve(input);
    expect(result.kind).toBe("created");
  });

  it("observes the exact PostgreSQL waiter→blocker edge for a concurrent idempotency reservation", async () => {
    const input = valid(`blocked-${crypto.randomUUID()}`);
    const blocker = await pool.connect();
    const blockerPid = Number((await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid);
    const runId = crypto.randomUUID();
    const executionId = crypto.randomUUID();
    const nonce = "d".repeat(32);
    const dispatchKey = "dispatch-blocker-key";
    const body = { runId, queuedAt: new Date().toISOString() };
    await blocker.query("BEGIN");
    try {
      await blocker.query("SET CONSTRAINTS ALL DEFERRED");
      await blocker.query("INSERT INTO idempotency_requests (principal,key,project_id,request_hash,run_id,response_status,response_body,expires_at) VALUES ($1,$2,$3,$4,$5,202,$6::jsonb,now()+interval '48 hours')", [p1,input.key,project,input.requestHash,runId,JSON.stringify(body)]);
      await blocker.query("INSERT INTO runs (id,project_id,model_id,status,config) VALUES ($1,$2,$3,'queued',$4::jsonb)", [runId,project,input.modelId,JSON.stringify(input.config)]);
      await blocker.query("INSERT INTO executions (id,run_id,run_seq,status,idempotency_key,nonce128,payload_hash,reserved_by_principal,project_id) VALUES ($1,$2,1,'reserved',$3,$4,$5,$6,$7)", [executionId,runId,dispatchKey,nonce,input.payloadHash,p1,project]);
      const contender = service.reserve(input);
      const deadline = Date.now() + 3000;
      let edge: { pid: number; blocking: number[]; query: string } | undefined;
      while (Date.now() < deadline && !edge) {
        const observations = await pool.query<{ pid: number; blocking: number[]; query: string }>(
          `SELECT a.pid,pg_blocking_pids(a.pid) AS blocking,a.query FROM pg_stat_activity a
           WHERE a.datname=current_database() AND a.query LIKE 'INSERT INTO idempotency_requests%' AND a.pid<>$1`, [blockerPid],
        );
        edge = observations.rows.find(row => row.blocking.includes(blockerPid));
        if (!edge) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(edge).toBeDefined();
      expect(edge?.query).toContain("INSERT INTO idempotency_requests");
      await blocker.query("COMMIT");
      const result = await contender;
      expect(result.kind).toBe("replayed");
      expect(result.runId).toBe(runId);
      expect(result.responseBody).toEqual(body);
    } catch (error) {
      await blocker.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      blocker.release();
    }
  });

  it("serializes concurrent same-key requests to one run/execution and exact stored response", async () => {
    const input = valid(`same-${crypto.randomUUID()}`);
    const results = await Promise.all(Array.from({ length: 8 }, () => service.reserve(input)));
    const rows = await pool.query("SELECT r.run_id, r.response_status, r.response_body, e.id AS execution_id FROM idempotency_requests r JOIN executions e ON e.run_id=r.run_id WHERE r.principal=$1 AND r.key=$2", [p1,input.key]);
    expect(rows.rowCount).toBe(1);
    expect(new Set(results.map(r => r.runId)).size).toBe(1);
    expect(results.filter(r => r.kind === "created")).toHaveLength(1);
    expect(results.every(r => JSON.stringify(r.responseBody) === JSON.stringify(rows.rows[0].response_body))).toBe(true);
    const counts = await pool.query("SELECT (SELECT count(*) FROM runs WHERE id=$1)::int AS runs,(SELECT count(*) FROM executions WHERE run_id=$1)::int AS executions", [rows.rows[0].run_id]);
    expect(counts.rows[0]).toEqual({ runs: 1, executions: 1 });
  });

  it("denies changed request hash or project without side effects", async () => {
    const input = valid(`conflict-${crypto.randomUUID()}`);
    await service.reserve(input);
    await expect(service.reserve({ ...input, requestHash: "c".repeat(64) })).rejects.toMatchObject({ code: "idempotency_key_reused_with_different_payload", status: 422 });
    await expect(service.reserve({ ...input, projectId: p2 })).rejects.toMatchObject({ code: "key_scope_mismatch", status: 409 });
    const count = await pool.query("SELECT count(*)::int AS n FROM idempotency_requests r JOIN runs ON runs.id=r.run_id WHERE r.principal=$1 AND r.key=$2", [p1,input.key]);
    expect(count.rows[0].n).toBe(1);
  });

  it("replays equivalent request-hash encodings in either case ordering", async () => {
    for (const upperFirst of [false, true]) {
      const input = valid(`hash-case-${crypto.randomUUID()}`);
      const firstHash = upperFirst ? input.requestHash.toUpperCase() : input.requestHash;
      const secondHash = upperFirst ? input.requestHash : input.requestHash.toUpperCase();
      const original = await service.reserve({ ...input, requestHash: firstHash });
      const replay = await service.reserve({ ...input, requestHash: secondHash });
      expect(replay).toEqual({ ...original, kind: "replayed" });
      const stored = await pool.query("SELECT request_hash FROM idempotency_requests WHERE principal=$1 AND key=$2", [p1, input.key]);
      expect(stored.rows[0].request_hash).toBe(input.requestHash.toLowerCase());
      expect((await pool.query("SELECT count(*)::int AS n FROM executions WHERE run_id=$1", [original.runId])).rows[0].n).toBe(1);
    }
  });

  it("scopes identical keys by principal", async () => {
    const key = `principal-${crypto.randomUUID()}`;
    const [a,b] = await Promise.all([service.reserve(valid(key,p1)), service.reserve(valid(key,p2))]);
    expect(a.runId).not.toBe(b.runId);
  });

  it("retains expired and housekept tombstones permanently", async () => {
    const input = valid(`expired-${crypto.randomUUID()}`);
    const first = await service.reserve(input);
    await pool.query("UPDATE idempotency_requests SET expires_at=now()-interval '1 second', response_body=NULL WHERE principal=$1 AND key=$2", [p1,input.key]);
    await expect(service.reserve(input)).rejects.toMatchObject({ code: "idempotency_key_expired" satisfies ReservationErrorCode });
    const rows = await pool.query("SELECT count(*)::int AS rows, count(response_body)::int AS bodies FROM idempotency_requests WHERE principal=$1 AND key=$2", [p1,input.key]);
    expect(rows.rows[0]).toEqual({ rows: 1, bodies: 0 });
    expect((await pool.query("SELECT id FROM runs WHERE id=$1", [first.runId])).rowCount).toBe(1);
  });

  it("rejects malformed keys and hashes before acquiring a database connection", async () => {
    let connects = 0;
    const noConnectPool = { connect: async () => { connects += 1; throw new Error("unexpected connection"); } } as unknown as Pool;
    const noConnectService = createExecutionReservationService(noConnectPool);
    await expect(noConnectService.reserve(valid("short"))).rejects.toMatchObject({ code: "invalid_idempotency_key", status: 400 });
    await expect(noConnectService.reserve({ ...valid(`valid-${crypto.randomUUID()}`), requestHash: "g".repeat(64) })).rejects.toMatchObject({ code: "invalid_hash", status: 400 });
    await expect(noConnectService.reserve({ ...valid(`valid-${crypto.randomUUID()}`), payloadHash: "a".repeat(63) })).rejects.toMatchObject({ code: "invalid_hash", status: 400 });
    for (const key of [undefined, null, 12345678, { toString: () => "valid-key" }]) {
      await expect(noConnectService.reserve({ ...valid("valid-key"), key } as unknown as Parameters<typeof noConnectService.reserve>[0]))
        .rejects.toMatchObject({ code: "invalid_idempotency_key", status: 400 });
    }
    for (const field of ["requestHash", "payloadHash"] as const) {
      await expect(noConnectService.reserve({ ...valid("valid-key"), [field]: { toString: () => "a".repeat(64) } } as unknown as Parameters<typeof noConnectService.reserve>[0]))
        .rejects.toMatchObject({ code: "invalid_hash", status: 400 });
    }
    expect(connects).toBe(0);
  });

  it("rejects a committed reservation without a response as in progress", async () => {
    const input = valid(`in-progress-${crypto.randomUUID()}`);
    const original = await service.reserve(input);
    await pool.query("UPDATE idempotency_requests SET response_status=NULL,response_body=NULL WHERE principal=$1 AND key=$2", [p1,input.key]);
    await expect(service.reserve(input)).rejects.toMatchObject({ code: "idempotency_key_in_progress", status: 409 });
    const rows = await pool.query("SELECT count(*)::int AS reservations,(SELECT count(*)::int FROM runs WHERE id=$1) AS runs,(SELECT count(*)::int FROM executions WHERE run_id=$1) AS executions FROM idempotency_requests WHERE principal=$2 AND key=$3", [original.runId,p1,input.key]);
    expect(rows.rows[0]).toEqual({ reservations: 1, runs: 1, executions: 1 });
  });

  it("allocates exactly one attempt through the dispatch CAS under eight contenders", async () => {
    const input = valid(`cas-${crypto.randomUUID()}`);
    const reservation = await service.reserve(input);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => service.reserveDispatch(reservation.executionId)));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const stored = await pool.query("SELECT status,attempt_count FROM executions WHERE id=$1", [reservation.executionId]);
    expect(stored.rows[0]).toEqual({ status: "dispatching", attempt_count: 1 });
    const attemptRows = await pool.query("SELECT attempt_no,attempt_key,kind FROM execution_attempts WHERE execution_id=$1", [reservation.executionId]);
    expect(attemptRows.rows).toHaveLength(1);
    expect(attemptRows.rows[0]).toMatchObject({ attempt_no: 1, attempt_key: `${(await pool.query<{ idempotency_key: string }>("SELECT idempotency_key FROM executions WHERE id=$1", [reservation.executionId])).rows[0].idempotency_key}:1`, kind: "initial" });
  });

  it("cancels a reserved execution directly without creating an attempt", async () => {
    const cancelInput = valid(`cancel-${crypto.randomUUID()}`);
    const cancelReservation = await service.reserve(cancelInput);
    const cancelledResult = await service.cancelReserved(cancelReservation.executionId);
    expect(cancelledResult).toBe(true);
    const cancelled = await pool.query("SELECT status,attempt_count,cancel_requested_at,finalized_at FROM executions WHERE id=$1", [cancelReservation.executionId]);
    const noAttempt = await pool.query("SELECT count(*)::int AS n FROM execution_attempts WHERE execution_id=$1", [cancelReservation.executionId]);
    expect(cancelled.rows[0].status).toBe("cancelled");
    expect(cancelled.rows[0].attempt_count).toBe(0);
    expect(cancelled.rows[0].cancel_requested_at).toBeInstanceOf(Date);
    expect(cancelled.rows[0].finalized_at).toBeInstanceOf(Date);
    expect(noAttempt.rows[0].n).toBe(0);
    expect(await service.reserveDispatch(cancelReservation.executionId)).toBeNull();
  });

  it("serializes reserved cancellation against dispatch so exactly one wins", async () => {
    const input = valid(`race-${crypto.randomUUID()}`);
    const reservation = await service.reserve(input);
    const [dispatch, cancelled] = await Promise.all([
      service.reserveDispatch(reservation.executionId),
      service.cancelReserved(reservation.executionId),
    ]);
    expect(Boolean(dispatch) !== cancelled).toBe(true);
    const row = await pool.query("SELECT status,attempt_count,cancel_requested_at FROM executions WHERE id=$1", [reservation.executionId]);
    const attempts = await pool.query("SELECT count(*)::int AS n FROM execution_attempts WHERE execution_id=$1", [reservation.executionId]);
    if (dispatch) {
      expect(row.rows[0]).toMatchObject({ status: "dispatching", attempt_count: 1, cancel_requested_at: null });
      expect(attempts.rows[0].n).toBe(1);
    } else {
      expect(row.rows[0].status).toBe("cancelled");
      expect(attempts.rows[0].n).toBe(0);
    }
  });
});
