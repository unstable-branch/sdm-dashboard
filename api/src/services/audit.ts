import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";

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
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      details: entry.details ?? null,
    });
  } catch (err) {
    console.error("[Audit] Failed to log action:", err instanceof Error ? err.message : String(err));
  }
}

export function extractClientInfo(c: any) {
  return {
    ipAddress: c.env?.incoming?.socket?.remoteAddress || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: c.req.header("user-agent")?.slice(0, 500) || null,
  };
}