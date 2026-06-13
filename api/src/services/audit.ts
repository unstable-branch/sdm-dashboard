// Structured audit logging — writes JSON entries to stdout for log collection.
// Each entry is a single line of JSON that can be ingested by Docker, ELK,
// Grafana Loki, or any log aggregator.
//
// If you need DB-backed audit logs, re-create the audit_logs table and
// replace the console.log below with a DB insert.

import type { Context } from "hono";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logAction(entry: AuditEntry): Promise<void> {
  const logLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  console.log(`[audit] ${logLine}`);
}

export function extractClientInfo(c: Context | any) {
  const forwardedFor = c.req?.header?.("x-forwarded-for");
  const ipAddress = typeof forwardedFor === "string" && forwardedFor.trim()
    ? forwardedFor.split(",")[0]?.trim() || null
    : null;

  const rawUserAgent = c.req?.header?.("user-agent");
  const userAgent = typeof rawUserAgent === "string" && rawUserAgent.length > 0
    ? rawUserAgent.slice(0, 500)
    : null;

  return {
    ipAddress,
    userAgent,
  };
}
