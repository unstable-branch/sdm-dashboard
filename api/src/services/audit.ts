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

import type { Context } from "hono";
import { randomUUID } from "crypto";
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
  const logLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  console.log(`[audit] ${logLine}`);

  if (buffer.length >= MAX_BUFFER_SIZE) {
    dropCount++;
    return;
  }

  buffer.push(entry);

  if (buffer.length >= FLUSH_BATCH_SIZE) {
    void flushBuffer();
  } else {
    scheduleFlush();
  }
}

export function extractClientInfo(c: Context | any) {
  // Use the trusted-proxy-aware IP resolution. When TRUSTED_PROXY_CIDRS is not
  // configured, client-supplied X-Forwarded-For / X-Real-IP / CF-Connecting-IP
  // headers are ignored to prevent spoofed IPs in audit logs.
  const ipAddress = (() => {
    if (!c || typeof getClientIp !== "function") return null;
    const ip = getClientIp(c as Context);
    return ip === "unknown" ? null : ip;
  })();

  const rawUserAgent = c.req?.header?.("user-agent");
  const userAgent = typeof rawUserAgent === "string" && rawUserAgent.length > 0
    ? rawUserAgent.slice(0, 500)
    : null;

  // Request ID is set by the request-id middleware (api/src/middleware/request-id.ts).
  // Falls back to a freshly generated UUID v4 when the middleware hasn't run,
  // which can happen during tests where the Hono app is constructed without
  // the full middleware stack.
  const stored = c?.get?.("requestId");
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
  await flushBuffer();
}
