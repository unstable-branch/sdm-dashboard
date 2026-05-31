// Audit logging has been removed (task 12: drop audit_logs table).
// Keep client metadata extraction available for callers that include it in
// structured security logs, but avoid writing to the removed audit_logs table.

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

export async function logAction(_entry: AuditEntry): Promise<void> {
  // No-op: audit_logs table has been removed
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
