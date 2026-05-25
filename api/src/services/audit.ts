import { db } from "../db/index.js";
import { apiAuditEvents } from "../db/schema.js";

export type AuditEventInput = {
  actorUserId?: string | null;
  actorApiKeyId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  method?: string | null;
  route?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  await db.insert(apiAuditEvents).values({
    actorUserId: event.actorUserId ?? null,
    actorApiKeyId: event.actorApiKeyId ?? null,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    method: event.method ?? null,
    route: event.route ?? null,
    statusCode: event.statusCode ?? null,
    metadata: event.metadata ?? null,
  });
}

export async function recordAuditEventBestEffort(event: AuditEventInput): Promise<void> {
  try {
    await recordAuditEvent(event);
  } catch {
    // Audit should not make user-facing auth routes fail.
  }
}
