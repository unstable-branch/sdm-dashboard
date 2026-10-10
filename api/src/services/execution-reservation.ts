import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { canonicalExecutionJson } from "./model-payload.js";

export type ReservationErrorCode = "invalid_idempotency_key" | "invalid_hash" | "idempotency_key_reused_with_different_payload" | "key_scope_mismatch" | "idempotency_key_expired" | "idempotency_key_in_progress";
export class ReservationError extends Error {
  constructor(public readonly code: ReservationErrorCode, public readonly status: number) {
    super(code);
    this.name = "ReservationError";
  }
}
type ReserveInput = {
  principal: string; projectId: string; key: string; requestHash: string;
  payloadHash: string; modelId: string; config: Record<string, unknown>;
};
type ReservationResult = {
  kind: "created" | "replayed"; runId: string; executionId: string;
  responseStatus: number; responseBody: { runId: string; queuedAt: string };
};
export function createExecutionReservationService(pool: Pool) {
  void pool;
  return {
    async reserve(input: ReserveInput): Promise<ReservationResult> {
      if (typeof input.key !== "string" || !/^[A-Za-z0-9._-]{8,128}$/.test(input.key)) throw new ReservationError("invalid_idempotency_key", 400);
      if (typeof input.requestHash !== "string" || typeof input.payloadHash !== "string" || !/^[0-9a-fA-F]{64}$/.test(input.requestHash) || !/^[0-9a-fA-F]{64}$/.test(input.payloadHash)) throw new ReservationError("invalid_hash", 400);
      const runId = randomUUID();
      const executionId = randomUUID();
      const nonce128 = randomBytes(16).toString("hex");
      const payloadHash = input.payloadHash.toLowerCase();
      const requestHash = input.requestHash.toLowerCase();
      const key = createHash("sha256").update(canonicalExecutionJson({ execution_id: executionId, payload_hash: payloadHash, run_seq: 1, nonce128 })).digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET CONSTRAINTS ALL DEFERRED");
        const inserted = await client.query("INSERT INTO idempotency_requests (principal,key,project_id,request_hash,run_id,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '48 hours') ON CONFLICT (principal,key) DO NOTHING RETURNING run_id", [input.principal,input.key,input.projectId,requestHash,runId]);
        if (inserted.rowCount === 0) {
          const previous = await client.query<{ run_id: string; project_id: string; request_hash: string; expired: boolean; response_status: number; response_body: ReservationResult["responseBody"] }>("SELECT run_id,project_id,request_hash,expires_at<=now() AS expired,response_status,response_body FROM idempotency_requests WHERE principal=$1 AND key=$2", [input.principal,input.key]);
          const stored = previous.rows[0];
          if (!stored) throw new Error("Committed reservation is missing");
          if (stored.request_hash.toLowerCase() !== requestHash) throw new ReservationError("idempotency_key_reused_with_different_payload", 422);
          if (stored.project_id !== input.projectId) throw new ReservationError("key_scope_mismatch", 409);
          if (stored.expired) throw new ReservationError("idempotency_key_expired", 410);
          if (stored.response_status === null) throw new ReservationError("idempotency_key_in_progress", 409);
          // This primitive creates a new run; its original execution is always sequence 1.
          const original = await client.query<{ id: string }>("SELECT id FROM executions WHERE run_id=$1 AND run_seq=1", [stored.run_id]);
          if (!original.rows[0]) throw new Error("Original reserved execution is missing");
          await client.query("COMMIT");
          return { kind: "replayed", runId: stored.run_id, executionId: original.rows[0].id, responseStatus: stored.response_status, responseBody: stored.response_body };
        }
        const created = await client.query<{ created_at: Date }>("INSERT INTO runs (id,project_id,model_id,status,species_name,config) VALUES ($1,$2,$3,'queued',$4,$5::jsonb) RETURNING created_at", [runId,input.projectId,input.modelId,typeof input.config.species === "string" ? input.config.species : null,JSON.stringify(input.config)]);
        await client.query("SELECT id FROM runs WHERE id=$1 FOR UPDATE", [runId]);
        await client.query("INSERT INTO executions (id,run_id,run_seq,idempotency_key,nonce128,payload_hash,reserved_by_principal,project_id) VALUES ($1,$2,1,$3,$4,$5,$6,$7)", [executionId,runId,key,nonce128,payloadHash,input.principal,input.projectId]);
        const responseBody = { runId, queuedAt: created.rows[0]!.created_at.toISOString() };
        await client.query("UPDATE idempotency_requests SET response_status=202,response_body=$1::jsonb WHERE principal=$2 AND key=$3", [JSON.stringify(responseBody),input.principal,input.key]);
        await client.query("COMMIT");
        return { kind: "created", runId, executionId, responseStatus: 202, responseBody };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async reserveDispatch(executionId: string): Promise<{ attemptNo: number; attemptKey: string } | null> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query<{ attempt_count: number; idempotency_key: string }>(
          "UPDATE executions SET status='dispatching',attempt_count=attempt_count+1,lease_expires_at=now()+interval '60 seconds' WHERE id=$1 AND status='reserved' RETURNING attempt_count,idempotency_key",
          [executionId],
        );
        const row = claimed.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const attemptNo = row.attempt_count;
        const attemptKey = `${row.idempotency_key}:${attemptNo}`;
        await client.query(
          "INSERT INTO execution_attempts (execution_id,attempt_no,attempt_key,kind) VALUES ($1,$2,$3,'initial')",
          [executionId, attemptNo, attemptKey],
        );
        await client.query("COMMIT");
        return { attemptNo, attemptKey };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async cancelReserved(executionId: string): Promise<boolean> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const cancelled = await client.query(
          "UPDATE executions SET status='cancelled',cancel_requested_at=now(),finalized_at=now() WHERE id=$1 AND status='reserved' AND finalized_at IS NULL RETURNING id",
          [executionId],
        );
        await client.query("COMMIT");
        return cancelled.rowCount === 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
