import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type DB } from "../db/index.js";
import { occurrenceDatasets, projectMembers } from "../db/schema.js";

export const OCCURRENCE_DATASET_KINDS = ["upload", "gbif", "dwca", "cleaned", "registered"] as const;
export type OccurrenceDatasetKind = (typeof OCCURRENCE_DATASET_KINDS)[number];

export const OCCURRENCE_DATASET_STATUSES = ["pending", "ready", "failed"] as const;
export type OccurrenceDatasetStatus = (typeof OCCURRENCE_DATASET_STATUSES)[number];

export type OccurrenceDatasetAggregate = Pick<
  typeof occurrenceDatasets.$inferSelect,
  | "id"
  | "projectId"
  | "speciesId"
  | "parentDatasetId"
  | "kind"
  | "status"
  | "fileId"
  | "fileName"
  | "recordCount"
  | "validCount"
  | "summary"
  | "metadata"
  | "createdBy"
  | "createdAt"
  | "updatedAt"
>;

export interface CreateOccurrenceDatasetInput {
  projectId: string;
  speciesId?: string | null;
  parentDatasetId?: string | null;
  kind: OccurrenceDatasetKind;
  status?: OccurrenceDatasetStatus;
  fileId: string;
  fileName?: string | null;
  recordCount?: number | null;
  validCount?: number | null;
  summary?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
  database?: DB;
}

export interface ListOccurrenceDatasetsInput {
  projectId: string;
  speciesId?: string | null;
  parentDatasetId?: string | null;
  kind?: OccurrenceDatasetKind;
  status?: OccurrenceDatasetStatus;
  limit?: number;
  offset?: number;
  database?: DB;
}

export interface GetOccurrenceDatasetForUserInput {
  datasetId: string;
  userId: string;
  userRole?: string;
  projectId?: string;
  database?: DB;
}

export interface UpdateOccurrenceDatasetStatusInput {
  datasetId: string;
  status: OccurrenceDatasetStatus;
  recordCount?: number | null;
  validCount?: number | null;
  summary?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  database?: DB;
}

export interface UpdateOccurrenceDatasetSummaryInput {
  datasetId: string;
  recordCount?: number | null;
  validCount?: number | null;
  summary?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  database?: DB;
}

function assertDatasetKind(kind: string): asserts kind is OccurrenceDatasetKind {
  if (!OCCURRENCE_DATASET_KINDS.includes(kind as OccurrenceDatasetKind)) {
    throw new Error(`Invalid occurrence dataset kind: ${kind}`);
  }
}

function assertDatasetStatus(status: string): asserts status is OccurrenceDatasetStatus {
  if (!OCCURRENCE_DATASET_STATUSES.includes(status as OccurrenceDatasetStatus)) {
    throw new Error(`Invalid occurrence dataset status: ${status}`);
  }
}

function toAggregate(row: typeof occurrenceDatasets.$inferSelect): OccurrenceDatasetAggregate {
  return {
    id: row.id,
    projectId: row.projectId,
    speciesId: row.speciesId,
    parentDatasetId: row.parentDatasetId,
    kind: row.kind,
    status: row.status,
    fileId: row.fileId,
    fileName: row.fileName,
    recordCount: row.recordCount,
    validCount: row.validCount,
    summary: row.summary,
    metadata: row.metadata,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createOccurrenceDataset(input: CreateOccurrenceDatasetInput): Promise<OccurrenceDatasetAggregate> {
  assertDatasetKind(input.kind);
  if (input.status) {
    assertDatasetStatus(input.status);
  }

  const database = input.database ?? db;
  const now = new Date();

  const [created] = await database
    .insert(occurrenceDatasets)
    .values({
      projectId: input.projectId,
      speciesId: input.speciesId ?? null,
      parentDatasetId: input.parentDatasetId ?? null,
      kind: input.kind,
      status: input.status ?? "pending",
      fileId: input.fileId,
      fileName: input.fileName ?? null,
      recordCount: input.recordCount ?? null,
      validCount: input.validCount ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
      createdBy: input.createdBy ?? null,
      updatedAt: now,
    })
    .returning();

  return toAggregate(created);
}

export async function listOccurrenceDatasets(input: ListOccurrenceDatasetsInput): Promise<OccurrenceDatasetAggregate[]> {
  if (input.kind) {
    assertDatasetKind(input.kind);
  }
  if (input.status) {
    assertDatasetStatus(input.status);
  }

  const database = input.database ?? db;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);

  const rows = await database
    .select()
    .from(occurrenceDatasets)
    .where(and(
      eq(occurrenceDatasets.projectId, input.projectId),
      input.speciesId === undefined
        ? undefined
        : input.speciesId === null
          ? isNull(occurrenceDatasets.speciesId)
          : eq(occurrenceDatasets.speciesId, input.speciesId),
      input.parentDatasetId === undefined
        ? undefined
        : input.parentDatasetId === null
          ? isNull(occurrenceDatasets.parentDatasetId)
          : eq(occurrenceDatasets.parentDatasetId, input.parentDatasetId),
      input.kind ? eq(occurrenceDatasets.kind, input.kind) : undefined,
      input.status ? eq(occurrenceDatasets.status, input.status) : undefined
    ))
    .orderBy(desc(occurrenceDatasets.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toAggregate);
}

export async function getOccurrenceDatasetForUser(input: GetOccurrenceDatasetForUserInput): Promise<OccurrenceDatasetAggregate | null> {
  const database = input.database ?? db;
  const projectScopeCondition = input.projectId ? eq(occurrenceDatasets.projectId, input.projectId) : undefined;

  if (input.userRole === "admin") {
    const [row] = await database
      .select()
      .from(occurrenceDatasets)
      .where(and(eq(occurrenceDatasets.id, input.datasetId), projectScopeCondition))
      .limit(1);
    return row ? toAggregate(row) : null;
  }

  const [row] = await database
    .select({ dataset: occurrenceDatasets })
    .from(occurrenceDatasets)
    .innerJoin(projectMembers, eq(projectMembers.projectId, occurrenceDatasets.projectId))
    .where(and(
      eq(occurrenceDatasets.id, input.datasetId),
      projectScopeCondition,
      eq(projectMembers.userId, input.userId)
    ))
    .limit(1);

  return row ? toAggregate(row.dataset) : null;
}

export async function updateOccurrenceDatasetStatus(
  input: UpdateOccurrenceDatasetStatusInput
): Promise<OccurrenceDatasetAggregate | null> {
  assertDatasetStatus(input.status);
  const database = input.database ?? db;

  const [updated] = await database
    .update(occurrenceDatasets)
    .set({
      status: input.status,
      recordCount: input.recordCount,
      validCount: input.validCount,
      summary: input.summary,
      metadata: input.metadata,
      updatedAt: new Date(),
    })
    .where(eq(occurrenceDatasets.id, input.datasetId))
    .returning();

  return updated ? toAggregate(updated) : null;
}

export async function updateOccurrenceDatasetSummary(
  input: UpdateOccurrenceDatasetSummaryInput
): Promise<OccurrenceDatasetAggregate | null> {
  const database = input.database ?? db;

  const [updated] = await database
    .update(occurrenceDatasets)
    .set({
      recordCount: input.recordCount,
      validCount: input.validCount,
      summary: input.summary,
      metadata: input.metadata,
      updatedAt: new Date(),
    })
    .where(eq(occurrenceDatasets.id, input.datasetId))
    .returning();

  return updated ? toAggregate(updated) : null;
}
