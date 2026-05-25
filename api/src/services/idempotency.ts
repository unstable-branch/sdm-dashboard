import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, type DB } from "../db/index.js";
import { idempotencyKeys } from "../db/schema.js";

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const IDEMPOTENCY_STATES = ["processing", "completed", "failed"] as const;
export type IdempotencyState = (typeof IDEMPOTENCY_STATES)[number];

export type IdempotencyEntry = Pick<
  typeof idempotencyKeys.$inferSelect,
  | "id"
  | "projectId"
  | "userId"
  | "method"
  | "route"
  | "idempotencyKey"
  | "requestHash"
  | "state"
  | "statusCode"
  | "responseBody"
  | "resourceType"
  | "resourceId"
  | "expiresAt"
  | "createdAt"
  | "updatedAt"
>;

export type BeginIdempotentRequestResult =
  | { outcome: "started"; entry: IdempotencyEntry; reusedFailedEntry: boolean; reusedExpiredEntry: boolean }
  | { outcome: "processing"; entry: IdempotencyEntry }
  | { outcome: "replay"; entry: IdempotencyEntry }
  | { outcome: "conflict"; entry: IdempotencyEntry; reason: "hash_mismatch" };

export interface BeginIdempotentRequestInput {
  projectId?: string | null;
  userId?: string | null;
  method: string;
  route: string;
  idempotencyKey: string;
  requestBody?: unknown;
  requestHash?: string;
  ttlSeconds?: number;
  now?: Date;
  database?: DB;
}

export interface CompleteIdempotentRequestInput {
  id: string;
  statusCode: number;
  responseBody?: Record<string, unknown> | null;
  resourceType?: string | null;
  resourceId?: string | null;
  database?: DB;
  now?: Date;
}

export interface FailIdempotentRequestInput {
  id: string;
  statusCode?: number | null;
  responseBody?: Record<string, unknown> | null;
  database?: DB;
  now?: Date;
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };
type HeaderValue = string | string[] | undefined;
type HeaderSource = Headers | Record<string, HeaderValue>;

function isCanonicalObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCanonicalJson(value: unknown): CanonicalJson | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = toCanonicalJson(item);
      return normalized === undefined ? null : normalized;
    });
  }

  if (isCanonicalObject(value)) {
    const out: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = toCanonicalJson(value[key]);
      if (normalized !== undefined) {
        out[key] = normalized;
      }
    }
    return out;
  }

  return undefined;
}

function toEntry(row: typeof idempotencyKeys.$inferSelect): IdempotencyEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    method: row.method,
    route: row.route,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    state: row.state as IdempotencyState,
    statusCode: row.statusCode,
    responseBody: row.responseBody,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertState(value: string): asserts value is IdempotencyState {
  if (!IDEMPOTENCY_STATES.includes(value as IdempotencyState)) {
    throw new Error(`Invalid idempotency state: ${value}`);
  }
}

function isPgUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

async function findScopedIdempotencyEntry(
  database: DB,
  scope: {
    projectId: string | null;
    userId: string | null;
    method: string;
    route: string;
    idempotencyKey: string;
  }
): Promise<IdempotencyEntry | null> {
  const [row] = await database
    .select()
    .from(idempotencyKeys)
    .where(and(
      scope.projectId === null ? isNull(idempotencyKeys.projectId) : eq(idempotencyKeys.projectId, scope.projectId),
      scope.userId === null ? isNull(idempotencyKeys.userId) : eq(idempotencyKeys.userId, scope.userId),
      eq(idempotencyKeys.method, scope.method),
      eq(idempotencyKeys.route, scope.route),
      eq(idempotencyKeys.idempotencyKey, scope.idempotencyKey)
    ))
    .limit(1);

  return row ? toEntry(row) : null;
}

export function stableStringify(value: unknown): string {
  const normalized = toCanonicalJson(value);
  return JSON.stringify(normalized === undefined ? null : normalized);
}

export function hashRequestBody(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function getIdempotencyKeyFromHeaders(headers: HeaderSource): string | null {
  const names = ["idempotency-key", "x-idempotency-key"];

  if (headers instanceof Headers) {
    for (const name of names) {
      const value = headers.get(name);
      if (value && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  for (const name of names) {
    const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct.trim();
    }
    if (Array.isArray(direct)) {
      const first = direct.find((item) => typeof item === "string" && item.trim().length > 0);
      if (first) return first.trim();
    }
  }

  return null;
}

export async function beginIdempotentRequest(input: BeginIdempotentRequestInput): Promise<BeginIdempotentRequestResult> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const ttlSeconds = Math.max(1, input.ttlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const scope = {
    projectId: input.projectId ?? null,
    userId: input.userId ?? null,
    method: input.method.toUpperCase(),
    route: input.route,
    idempotencyKey: input.idempotencyKey,
  };
  const requestHash = input.requestHash ?? hashRequestBody(input.requestBody);

  let existing = await findScopedIdempotencyEntry(database, scope);

  if (!existing) {
    try {
      const [inserted] = await database
        .insert(idempotencyKeys)
        .values({
          projectId: scope.projectId,
          userId: scope.userId,
          method: scope.method,
          route: scope.route,
          idempotencyKey: scope.idempotencyKey,
          requestHash,
          state: "processing",
          expiresAt,
          updatedAt: now,
        })
        .returning();

      return { outcome: "started", entry: toEntry(inserted), reusedFailedEntry: false, reusedExpiredEntry: false };
    } catch (error) {
      if (!isPgUniqueViolation(error)) {
        throw error;
      }
      existing = await findScopedIdempotencyEntry(database, scope);
    }
  }

  if (!existing) {
    throw new Error("Unable to resolve idempotency key state");
  }

  assertState(existing.state);

  if (existing.expiresAt <= now) {
    const [restarted] = await database
      .update(idempotencyKeys)
      .set({
        requestHash,
        state: "processing",
        statusCode: null,
        responseBody: null,
        resourceType: null,
        resourceId: null,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(idempotencyKeys.id, existing.id))
      .returning();

    return {
      outcome: "started",
      entry: toEntry(restarted),
      reusedFailedEntry: existing.state === "failed",
      reusedExpiredEntry: true,
    };
  }

  if (existing.requestHash !== requestHash) {
    return { outcome: "conflict", entry: existing, reason: "hash_mismatch" };
  }

  if (existing.state === "completed") {
    return { outcome: "replay", entry: existing };
  }

  if (existing.state === "processing") {
    return { outcome: "processing", entry: existing };
  }

  const [restarted] = await database
    .update(idempotencyKeys)
    .set({
      state: "processing",
      statusCode: null,
      responseBody: null,
      resourceType: null,
      resourceId: null,
      expiresAt,
      updatedAt: now,
    })
    .where(eq(idempotencyKeys.id, existing.id))
    .returning();

  return { outcome: "started", entry: toEntry(restarted), reusedFailedEntry: true, reusedExpiredEntry: false };
}

export async function completeIdempotentRequest(input: CompleteIdempotentRequestInput): Promise<IdempotencyEntry | null> {
  const database = input.database ?? db;

  const [updated] = await database
    .update(idempotencyKeys)
    .set({
      state: "completed",
      statusCode: input.statusCode,
      responseBody: input.responseBody ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      updatedAt: input.now ?? new Date(),
    })
    .where(eq(idempotencyKeys.id, input.id))
    .returning();

  return updated ? toEntry(updated) : null;
}

export async function failIdempotentRequest(input: FailIdempotentRequestInput): Promise<IdempotencyEntry | null> {
  const database = input.database ?? db;

  const [updated] = await database
    .update(idempotencyKeys)
    .set({
      state: "failed",
      statusCode: input.statusCode ?? null,
      responseBody: input.responseBody ?? null,
      updatedAt: input.now ?? new Date(),
    })
    .where(eq(idempotencyKeys.id, input.id))
    .returning();

  return updated ? toEntry(updated) : null;
}
