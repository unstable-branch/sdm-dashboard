// Audit logging has been removed (task 12: drop audit_logs table)
// This file is kept as a stub to avoid import errors.
// logAction is now a no-op; callers have been updated.

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

export function extractClientInfo(_c: Context | any) {
  return {
    ipAddress: null as string | null,
    userAgent: null as string | null,
  };
}
