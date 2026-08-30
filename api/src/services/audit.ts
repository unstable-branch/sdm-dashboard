// Structured audit logging — writes JSON entries to stdout for log collection
// AND inserts rows into the audit_logs table for queryable history.
// Each stdout entry is a single line of JSON that can be ingested by Docker,
// ELK, Grafana Loki, or any log aggregator.
//
// DB writes are buffered to avoid hot-path overhead:
// - Flush every 5 seconds OR every 50 entries, whichever comes first
// - If the buffer overflows before flush, additional entries are dropped to
//   stdout (with a warning) rather than blocking the call site
// - On shutdown, the buffer is flushed synchronously
//
// Resource hygiene:
// - Each `details` payload is capped at 4 KB to prevent any single audit
//   row from blowing up (e.g. a caller dumping a large response body).
// - A retention prune runs every 24 hours (configurable via
//   SDM_AUDIT_RETENTION_INTERVAL_MS) and deletes rows whose
//   `created_at` is older than `retentionDays`. Test runs set the interval
//   to 0 to disable the prune (so a test row is never deleted mid-run).

import type { Context } from "hono";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";
import { getClientIp } from "../middleware/client-ip.js";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  details?: Record<string, unknown> | null;
}

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 50;
const MAX_BUFFER_SIZE = 500;
const MAX_DETAILS_BYTES = 4 * 1024;
const RETENTION_PRUNE_INTERVAL_MS = parseInt(
  process.env.SDM_AUDIT_RETENTION_INTERVAL_MS ?? "86400000",
  10,
);

let buffer: AuditEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dropCount = 0;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBuffer();
  }, FLUSH_INTERVAL_MS);
}

function isValidUuid(s: string | null | undefined): s is string {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;
  const entries = buffer;
  buffer = [];

  if (dropCount > 0) {
    console.warn(`[audit] Dropped ${dropCount} entries due to buffer overflow`);
    dropCount = 0;
  }

  try {
    const rows = entries
      .filter((e) => isValidUuid(e.userId) || e.userId === null || e.userId === undefined)
      .filter((e) => isValidUuid(e.entityId) || e.entityId === null || e.entityId === undefined)
      .filter((e) => isValidUuid(e.requestId) || e.requestId === null || e.requestId === undefined)
      .map((e) => ({
        userId: isValidUuid(e.userId) ? e.userId : null,
        action: e.action,
        entity: e.entity ?? null,
        entityId: isValidUuid(e.entityId) ? e.entityId : null,
        ipAddress: e.ipAddress ?? null,
        userAgent: e.userAgent ?? null,
        requestId: isValidUuid(e.requestId) ? e.requestId : null,
        method: e.method ?? null,
        path: e.path ?? null,
        statusCode: typeof e.statusCode === "number" ? e.statusCode : null,
        details: e.details ?? null,
      }));

    if (rows.length > 0) {
      await db.insert(auditLogs).values(rows);
    }
  } catch (err) {
    console.error("[audit] DB flush failed, re-buffering:", (err as Error).message);
    buffer.unshift(...entries);
  }
}

export async function logAction(entry: AuditEntry): Promise<void> {
  // Cap details to prevent a single audit row from carrying arbitrarily
  // large payloads. Convert to JSON once and check the byte length; if it
  // exceeds MAX_DETAILS_BYTES, drop it on the floor (replacing with a
  // sentinel so the rest of the row is still useful) and emit a warning.
  let safeEntry = entry;
  if (entry.details) {
    const details_json = JSON.stringify(entry.details);
    if (typeof details_json === "string" && details_json.length > MAX_DETAILS_BYTES) {
      console.warn(
        `[audit] Dropping oversized details (${details_json.length} bytes > ${MAX_DETAILS_BYTES}) on action '${entry.action}'`
      );
      safeEntry = { ...entry, details: { _truncated: true, original_bytes: details_json.length } };
    }
  }
  const logLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...safeEntry,
  });
  console.log(`[audit] ${logLine}`);

  if (buffer.length >= MAX_BUFFER_SIZE) {
    dropCount++;
    return;
  }

  buffer.push(safeEntry);

  if (buffer.length >= FLUSH_BATCH_SIZE) {
    void flushBuffer();
  } else {
    scheduleFlush();
  }
}

export function extractClientInfo(c: Context) {
  // Use the trusted-proxy-aware IP resolution. When TRUSTED_PROXY_CIDRS is not
  // configured, client-supplied X-Forwarded-For / X-Real-IP / CF-Connecting-IP
  // headers are ignored to prevent spoofed IPs in audit logs.
  const ipAddress = (() => {
    const ip = getClientIp(c);
    return ip === "unknown" ? null : ip;
  })();

  const rawUserAgent = c.req.header("user-agent");
  const userAgent = typeof rawUserAgent === "string" && rawUserAgent.length > 0
    ? rawUserAgent.slice(0, 500)
    : null;

  // Request ID is set by the request-id middleware (api/src/middleware/request-id.ts).
  // Falls back to a freshly generated UUID v4 when the middleware hasn't run,
  // which can happen during tests where the Hono app is constructed without
  // the full middleware stack.
  const stored = c.get("requestId");
  const requestId = typeof stored === "string" && stored.length > 0
    ? stored
    : randomUUID();

  return {
    ipAddress,
    userAgent,
    requestId,
  };
}

export async function shutdownAudit(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (retentionTimer) {
    clearTimeout(retentionTimer);
    retentionTimer = null;
  }
  try {
    await pruneAuditRetention();
  } catch (err) {
    console.warn("[audit] Retention prune failed during shutdown:", (err as Error).message);
  }
  await flushBuffer();
}

// --- Retention prune ------------------------------------------------------
// Each row carries a `retention_days` column (default 90). We delete rows
// whose `created_at` is older than that threshold. The interval is
// configurable via SDM_AUDIT_RETENTION_INTERVAL_MS (default 1 day); set to
// 0 to disable the prune entirely (used in tests so a fixture row is
// never deleted mid-run).
let retentionTimer: ReturnType<typeof setTimeout> | null = null;
let retentionLastRunMs = 0;

async function pruneAuditRetention(): Promise<void> {
  if (RETENTION_PRUNE_INTERVAL_MS <= 0) return;
  const deleted = await db.execute(sql`
    DELETE FROM audit_logs
    WHERE created_at < NOW() - (retention_days || ' days')::interval
  `);
  const rows = Number((deleted as unknown as { count?: number }).count ?? 0);
  if (rows > 0) {
    console.log(`[audit] Retention prune removed ${rows} old row(s)`);
  }
}

function scheduleRetentionPrune(): void {
  if (RETENTION_PRUNE_INTERVAL_MS <= 0) return;
  if (retentionTimer) return;
  retentionTimer = setTimeout(async () => {
    retentionTimer = null;
    retentionLastRunMs = Date.now();
    try {
      await pruneAuditRetention();
    } catch (err) {
      console.warn("[audit] Retention prune failed:", (err as Error).message);
    }
    scheduleRetentionPrune();
  }, RETENTION_PRUNE_INTERVAL_MS);
}

export function startRetentionPrune(): void {
  scheduleRetentionPrune();
}


