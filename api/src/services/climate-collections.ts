import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, type DB } from "../db/index.js";
import {
  climateCollectionMembers,
  climateCollectionParents,
  climateCollections,
  climateVariableCatalog,
  inputAssets,
  users,
} from "../db/schema.js";
import {
  makeInputAssetLocator,
  readInputAssetIdentityAnchored,
  getInputAssetRoots,
  type AssetIdentityFileSystem,
  type InputAssetRootMap,
} from "./input-assets.js";

export const CLIMATE_MANIFEST_SCHEMA_VERSION = 1;
/** Bound offset pagination to at most 9,900 skipped rows at the maximum page size. */
export const MAX_CLIMATE_COLLECTION_PAGE = 100;
export const MAX_CLIMATE_COLLECTION_PAGE_SIZE = 100;

type ClimateCollectionKind = "current_baseline" | "future_scenario" | "derived_future";
type ClimateCollectionState = "staging" | "ready" | "quarantined" | "deleted";

export class ClimateCollectionError extends Error {
  constructor(
    readonly code: "invalid_request" | "not_found" | "forbidden" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ClimateCollectionError";
  }
}

export interface TrustedClimateMemberInput {
  /** Server-generated path relative to the configured system root. Never accept this from HTTP. */
  systemRelativePath: string;
  variableKey: string;
  mediaKind: "image/tiff";
  units: string;
  datatype: string;
  scaleFactor?: number;
  addOffset?: number;
  nodataSemantics: Record<string, unknown>;
  gridFingerprint: string;
  validationEvidence: Record<string, unknown>;
}

export interface TrustedClimateCollectionInput {
  kind: ClimateCollectionKind;
  provider: string;
  dataset: string;
  datasetVersion: string;
  licence: string;
  attribution: string;
  sourceEvidence: Record<string, unknown>;
  gridFingerprint: string;
  gridDefinition: Record<string, unknown>;
  baselineStart?: string;
  baselineEnd?: string;
  futurePeriod?: string;
  ssp?: string;
  gcm?: string;
  scenarioLabel?: string;
  baselineCollectionId?: string;
  parentCollectionIds?: string[];
  derivationAlgorithmId?: string;
  derivationAlgorithmVersion?: string;
  derivationParameters?: Record<string, unknown>;
  missingCellPolicy?: string;
  derivationSoftwareIdentity?: Record<string, unknown>;
  validatorIdentity: string;
  validationReport: Record<string, unknown>;
  members: TrustedClimateMemberInput[];
}

export interface ClimateCollectionSummary {
  id: string;
  kind: ClimateCollectionKind;
  state: ClimateCollectionState;
  validationState: "pending" | "valid" | "invalid";
  provider: string;
  dataset: string;
  datasetVersion: string;
  licence: string;
  attribution: string;
  expectedVariableKeys: string[];
  gridFingerprint: string;
  baselineStart: string | null;
  baselineEnd: string | null;
  futurePeriod: string | null;
  ssp: string | null;
  gcm: string | null;
  scenarioLabel: string | null;
  baselineCollectionId: string | null;
  memberCount: number;
  manifestSha256: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface ClimateCollectionDetail extends ClimateCollectionSummary {
  members: Array<{
    ordinal: number;
    variableKey: string;
    state: "staging" | "validated" | "quarantined" | "deleted";
    mediaKind: string;
    byteSize: number;
    sha256: string;
    units: string;
    datatype: string;
    scaleFactor: number;
    addOffset: number;
    nodataSemantics: unknown;
    gridFingerprint: string;
  }>;
}

type ClimateDatabase = DB;
export interface ClimateCollectionDependencies {
  database?: ClimateDatabase;
  roots?: InputAssetRootMap;
  fs?: AssetIdentityFileSystem;
  now?: () => Date;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function containsForbiddenPersistenceData(value: unknown): boolean {
  if (typeof value === "string") {
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || /^file:/i.test(value)) return true;
    try {
      const url = new URL(value);
      if (url.username || url.password) return true;
      if ([...url.searchParams.keys()].some((key) => /(password|secret|token|credential|api[-_]?key|private[-_]?key|signature)/i.test(key))) {
        return true;
      }
    } catch {
      // Non-URL scientific labels and identifiers are permitted.
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(containsForbiddenPersistenceData);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return /(path|directory|dirname|locator|password|secret|token|credential|apikey|privatekey)/.test(normalized)
      || containsForbiddenPersistenceData(child);
  });
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function validateTrustedInput(input: TrustedClimateCollectionInput, actorUserId: string): void {
  if (!isUuid(actorUserId) || !["current_baseline", "future_scenario", "derived_future"].includes(input.kind)) {
    throw new ClimateCollectionError("invalid_request", "Invalid climate collection identity");
  }
  if (!Array.isArray(input.members) || input.members.length === 0 || input.members.some((member) => !member || typeof member !== "object")) {
    throw new ClimateCollectionError("invalid_request", "Climate collection members are required");
  }
  if (![input.provider, input.dataset, input.datasetVersion, input.licence, input.attribution].every(isNonEmptyText)
    || !isJsonObject(input.sourceEvidence) || !isJsonObject(input.gridDefinition)) {
    throw new ClimateCollectionError("invalid_request", "Climate collection metadata is invalid");
  }
  const variableKeys = input.members.map((member) => member.variableKey);
  if (variableKeys.some((key) => !/^[a-z][a-z0-9_]{1,63}$/.test(key)) || new Set(variableKeys).size !== variableKeys.length) {
    throw new ClimateCollectionError("invalid_request", "Climate collection variables must be unique");
  }
  if (!isHash(input.gridFingerprint) || input.members.some((member) => !isHash(member.gridFingerprint))) {
    throw new ClimateCollectionError("invalid_request", "Invalid climate grid identity");
  }
  if (!isNonEmptyText(input.validatorIdentity) || !isJsonObject(input.validationReport)) {
    throw new ClimateCollectionError("invalid_request", "Trusted climate validation evidence is required");
  }
  if (input.members.some((member) => !isNonEmptyText(member.systemRelativePath)
    || member.mediaKind !== "image/tiff"
    || !isNonEmptyText(member.units) || !isNonEmptyText(member.datatype)
    || !Number.isFinite(member.scaleFactor ?? 1) || !Number.isFinite(member.addOffset ?? 0)
    || !isJsonObject(member.nodataSemantics) || !isJsonObject(member.validationEvidence)
    || member.gridFingerprint !== input.gridFingerprint)) {
    throw new ClimateCollectionError("invalid_request", "Trusted climate member metadata is invalid");
  }

  const hasCurrentMetadata = isNonEmptyText(input.baselineStart) && isNonEmptyText(input.baselineEnd)
    && [input.futurePeriod, input.ssp, input.gcm, input.scenarioLabel, input.baselineCollectionId].every(isAbsent);
  const hasFutureMetadata = [input.baselineStart, input.baselineEnd].every(isAbsent)
    && [input.futurePeriod, input.ssp, input.scenarioLabel].every(isNonEmptyText)
    && isUuid(input.baselineCollectionId);
  const derivationValues = [input.derivationAlgorithmId, input.derivationAlgorithmVersion, input.missingCellPolicy];
  const hasNoDerivation = derivationValues.every(isAbsent)
    && isAbsent(input.derivationParameters) && isAbsent(input.derivationSoftwareIdentity);
  const hasDerivation = derivationValues.every(isNonEmptyText)
    && isJsonObject(input.derivationParameters) && isJsonObject(input.derivationSoftwareIdentity);
  const parentIds = input.parentCollectionIds ?? [];
  const validParents = parentIds.every(isUuid) && new Set(parentIds).size === parentIds.length;
  const kindIsValid = input.kind === "current_baseline"
    ? hasCurrentMetadata && hasNoDerivation && parentIds.length === 0
    : input.kind === "future_scenario"
      ? hasFutureMetadata && isNonEmptyText(input.gcm) && hasNoDerivation && parentIds.length === 0
      : hasFutureMetadata && isAbsent(input.gcm) && hasDerivation && parentIds.length > 0;
  if (!validParents || !kindIsValid) {
    throw new ClimateCollectionError("invalid_request", "Climate collection kind metadata is invalid");
  }
  const persistedEvidence = [
    input.sourceEvidence,
    input.gridDefinition,
    input.derivationParameters,
    input.derivationSoftwareIdentity,
    input.validatorIdentity,
    input.provider,
    input.dataset,
    input.datasetVersion,
    input.licence,
    input.attribution,
    input.baselineStart,
    input.baselineEnd,
    input.futurePeriod,
    input.ssp,
    input.gcm,
    input.scenarioLabel,
    input.derivationAlgorithmId,
    input.derivationAlgorithmVersion,
    input.missingCellPolicy,
    ...input.members.flatMap((member) => [member.units, member.datatype]),
    ...input.members.flatMap((member) => [member.nodataSemantics, member.validationEvidence]),
  ];
  if (persistedEvidence.some(containsForbiddenPersistenceData)) {
    throw new ClimateCollectionError("invalid_request", "Climate collection metadata contains forbidden storage or credential data");
  }
}

function asSummary(row: Omit<ClimateCollectionSummary, "memberCount"> & { memberCount: number | string }): ClimateCollectionSummary {
  return { ...row, memberCount: Number(row.memberCount) };
}

const summaryFields = {
  id: climateCollections.id,
  kind: climateCollections.kind,
  state: climateCollections.state,
  validationState: climateCollections.validationState,
  provider: climateCollections.provider,
  dataset: climateCollections.dataset,
  datasetVersion: climateCollections.datasetVersion,
  licence: climateCollections.licence,
  attribution: climateCollections.attribution,
  expectedVariableKeys: climateCollections.expectedVariableKeys,
  gridFingerprint: climateCollections.gridFingerprint,
  baselineStart: climateCollections.baselineStart,
  baselineEnd: climateCollections.baselineEnd,
  futurePeriod: climateCollections.futurePeriod,
  ssp: climateCollections.ssp,
  gcm: climateCollections.gcm,
  scenarioLabel: climateCollections.scenarioLabel,
  baselineCollectionId: climateCollections.baselineCollectionId,
  manifestSha256: climateCollections.manifestSha256,
  createdAt: climateCollections.createdAt,
  publishedAt: climateCollections.publishedAt,
} as const;

/**
 * Stage already-validated files produced by a trusted server downloader/importer.
 * This function is deliberately not wired to an HTTP request body.
 */
export async function stageValidatedClimateCollectionFromTrustedFiles(
  input: TrustedClimateCollectionInput,
  actorUserId: string,
  dependencies: ClimateCollectionDependencies = {},
): Promise<ClimateCollectionDetail> {
  validateTrustedInput(input, actorUserId);
  const database = dependencies.database || db;
  const roots = dependencies.roots || getInputAssetRoots();
  const fs = dependencies.fs;
  const now = (dependencies.now || (() => new Date()))();
  const memberLocators = input.members.map((member) => makeInputAssetLocator("system", member.systemRelativePath, roots));
  if (memberLocators.some((locator) => !locator) || new Set(memberLocators).size !== memberLocators.length) {
    throw new ClimateCollectionError("invalid_request", "Trusted climate storage identities must be unique");
  }

  const [currentActor] = await database.select({ role: users.role }).from(users)
    .where(eq(users.id, actorUserId)).limit(1);
  if (!currentActor || currentActor.role !== "admin") {
    throw new ClimateCollectionError("forbidden", "Administrator authority is required");
  }

  const collectionId = await database.transaction(async (tx) => {
    const [actor] = await tx.select({ role: users.role }).from(users)
      .where(eq(users.id, actorUserId)).for("update").limit(1);
    if (!actor || actor.role !== "admin") throw new ClimateCollectionError("forbidden", "Administrator authority is required");

    const baselineId = input.baselineCollectionId || null;
    const parentIds = input.parentCollectionIds || [];
    const expectedVariableKeys = input.members.map((member) => member.variableKey);
    if (baselineId) {
      const [baseline] = await tx.select({
        id: climateCollections.id,
        state: climateCollections.state,
        kind: climateCollections.kind,
        gridFingerprint: climateCollections.gridFingerprint,
        expectedVariableKeys: climateCollections.expectedVariableKeys,
      }).from(climateCollections).where(eq(climateCollections.id, baselineId)).for("share").limit(1);
      if (!baseline || baseline.state !== "ready" || baseline.kind !== "current_baseline"
        || baseline.gridFingerprint !== input.gridFingerprint
        || stableJson(baseline.expectedVariableKeys) !== stableJson(expectedVariableKeys)) {
        throw new ClimateCollectionError("conflict", "The baseline climate collection is unavailable or incompatible");
      }
      const baselineMembers = await tx.select({
        variableKey: climateCollectionMembers.variableKey,
        units: climateCollectionMembers.units,
        datatype: climateCollectionMembers.datatype,
        scaleFactor: climateCollectionMembers.scaleFactor,
        addOffset: climateCollectionMembers.addOffset,
        nodataSemantics: climateCollectionMembers.nodataSemantics,
      }).from(climateCollectionMembers)
        .where(eq(climateCollectionMembers.collectionId, baselineId))
        .orderBy(asc(climateCollectionMembers.ordinal)).for("share");
      const requestedSemantics = input.members.map((member) => ({
        variableKey: member.variableKey,
        units: member.units,
        datatype: member.datatype,
        scaleFactor: member.scaleFactor ?? 1,
        addOffset: member.addOffset ?? 0,
        nodataSemantics: member.nodataSemantics,
      }));
      if (stableJson(baselineMembers) !== stableJson(requestedSemantics)) {
        throw new ClimateCollectionError("conflict", "The baseline climate variable semantics are incompatible");
      }
    }

    const parentById = new Map<string, string>();
    if (parentIds.length > 0) {
      const parents = await tx.select({
        id: climateCollections.id,
        state: climateCollections.state,
        kind: climateCollections.kind,
        hash: climateCollections.manifestSha256,
        gridFingerprint: climateCollections.gridFingerprint,
        expectedVariableKeys: climateCollections.expectedVariableKeys,
        futurePeriod: climateCollections.futurePeriod,
        ssp: climateCollections.ssp,
        gcm: climateCollections.gcm,
        baselineCollectionId: climateCollections.baselineCollectionId,
      }).from(climateCollections).where(inArray(climateCollections.id, parentIds)).for("share");
      for (const parent of parents) {
        if (parent.state !== "ready" || parent.kind !== "future_scenario" || !parent.hash
          || parent.gridFingerprint !== input.gridFingerprint
          || stableJson(parent.expectedVariableKeys) !== stableJson(expectedVariableKeys)
          || parent.futurePeriod !== input.futurePeriod || parent.ssp !== input.ssp
          || parent.baselineCollectionId !== baselineId) {
          throw new ClimateCollectionError("conflict", "A parent climate collection is unavailable or incompatible");
        }
        parentById.set(parent.id, parent.hash);
      }
      if (parents.length !== parentIds.length) {
        throw new ClimateCollectionError("conflict", "A parent climate collection is unavailable or incompatible");
      }
      if (input.derivationAlgorithmId === "multi_gcm_average"
        && (parents.length < 2 || new Set(parents.map((parent) => parent.gcm)).size < 2)) {
        throw new ClimateCollectionError("conflict", "Multi-GCM derivation requires at least two distinct GCM parents");
      }
    }

    const catalogVariables = await tx.select({
      variableKey: climateVariableCatalog.variableKey,
      active: climateVariableCatalog.active,
    }).from(climateVariableCatalog)
      .where(inArray(climateVariableCatalog.variableKey, expectedVariableKeys)).for("share");
    if (catalogVariables.length !== expectedVariableKeys.length || catalogVariables.some((variable) => !variable.active)) {
      throw new ClimateCollectionError("conflict", "A climate variable is unavailable");
    }
    const existingAssets = await tx.select({ id: inputAssets.id }).from(inputAssets)
      .where(inArray(inputAssets.storageLocator, memberLocators as string[])).for("share");
    if (existingAssets.length > 0) {
      throw new ClimateCollectionError("conflict", "A trusted climate storage identity is already registered");
    }

    const preparedMembers = [] as Array<TrustedClimateMemberInput & {
      assetId: string;
      ordinal: number;
      storageLocator: string;
      byteSize: number;
      sha256: string;
    }>;
    for (const [index, member] of input.members.entries()) {
      const locator = memberLocators[index] as string;
      const identity = await readInputAssetIdentityAnchored(locator, roots, fs);
      if (!identity) throw new ClimateCollectionError("unavailable", "Trusted climate member is unavailable");
      preparedMembers.push({
        ...member,
        assetId: randomUUID(),
        ordinal: index + 1,
        storageLocator: identity.locator,
        byteSize: identity.contentSize,
        sha256: identity.contentSha256,
      });
    }

    const [collection] = await tx.insert(climateCollections).values({
      kind: input.kind,
      createdByUserId: actorUserId,
      provider: input.provider,
      dataset: input.dataset,
      datasetVersion: input.datasetVersion,
      licence: input.licence,
      attribution: input.attribution,
      sourceEvidence: input.sourceEvidence,
      expectedVariableKeys: preparedMembers.map((member) => member.variableKey),
      gridFingerprint: input.gridFingerprint,
      gridDefinition: input.gridDefinition,
      baselineStart: input.baselineStart || null,
      baselineEnd: input.baselineEnd || null,
      futurePeriod: input.futurePeriod || null,
      ssp: input.ssp || null,
      gcm: input.gcm || null,
      scenarioLabel: input.scenarioLabel || null,
      baselineCollectionId: baselineId,
      derivationAlgorithmId: input.derivationAlgorithmId || null,
      derivationAlgorithmVersion: input.derivationAlgorithmVersion || null,
      derivationParameters: input.derivationParameters || null,
      missingCellPolicy: input.missingCellPolicy || null,
      derivationSoftwareIdentity: input.derivationSoftwareIdentity || null,
      validationState: "valid",
      validationReportSha256: createHash("sha256").update(stableJson(input.validationReport)).digest("hex"),
      validatorIdentity: input.validatorIdentity,
      validatedAt: now,
      updatedAt: now,
    }).returning({ id: climateCollections.id });
    if (!collection) throw new ClimateCollectionError("unavailable", "Climate collection staging failed");

    await tx.insert(inputAssets).values(preparedMembers.map((member) => ({
      id: member.assetId,
      creatorUserId: actorUserId,
      scope: "system" as const,
      kind: "climate_raster" as const,
      storageLocator: member.storageLocator,
      state: "ready" as const,
      contentSha256: member.sha256,
      contentSize: member.byteSize,
    })));
    await tx.insert(climateCollectionMembers).values(preparedMembers.map((member) => ({
      collectionId: collection.id,
      assetId: member.assetId,
      ordinal: member.ordinal,
      variableKey: member.variableKey,
      state: "validated" as const,
      mediaKind: member.mediaKind,
      byteSize: member.byteSize,
      sha256: member.sha256,
      units: member.units,
      datatype: member.datatype,
      scaleFactor: member.scaleFactor ?? 1,
      addOffset: member.addOffset ?? 0,
      nodataSemantics: member.nodataSemantics,
      gridFingerprint: member.gridFingerprint,
      validationEvidence: member.validationEvidence,
      validatedAt: now,
    })));

    if (parentIds.length > 0) {
      await tx.insert(climateCollectionParents).values(parentIds.map((id, index) => ({
        childCollectionId: collection.id,
        parentOrdinal: index + 1,
        parentCollectionId: id,
        parentManifestSha256: parentById.get(id) as string,
      })));
    }
    return collection.id;
  });

  const detail = await getAdminClimateCollection(collectionId, dependencies);
  if (!detail) throw new ClimateCollectionError("unavailable", "Climate collection staging could not be read back");
  return detail;
}

export async function listAdminClimateCollections(
  options: { state?: ClimateCollectionState; kind?: ClimateCollectionKind; page?: number; limit?: number } = {},
  dependencies: ClimateCollectionDependencies = {},
): Promise<{ collections: ClimateCollectionSummary[]; total: number; page: number; limit: number }> {
  const database = dependencies.database || db;
  const page = options.page ?? 1;
  const requestedLimit = options.limit ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_CLIMATE_COLLECTION_PAGE
    || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new ClimateCollectionError("invalid_request", "Invalid climate collection pagination");
  }
  const limit = Math.min(requestedLimit, MAX_CLIMATE_COLLECTION_PAGE_SIZE);
  const filters: SQL[] = [];
  if (options.state) filters.push(eq(climateCollections.state, options.state));
  if (options.kind) filters.push(eq(climateCollections.kind, options.kind));
  const where = filters.length === 0 ? undefined : and(...filters);

  const base = database.select({
    ...summaryFields,
    memberCount: count(climateCollectionMembers.id),
  }).from(climateCollections)
    .leftJoin(climateCollectionMembers, eq(climateCollectionMembers.collectionId, climateCollections.id));
  const rows = await (where ? base.where(where) : base)
    .groupBy(climateCollections.id).orderBy(desc(climateCollections.createdAt), desc(climateCollections.id))
    .limit(limit).offset((page - 1) * limit);
  const countBase = database.select({ total: count() }).from(climateCollections);
  const [totalRow] = await (where ? countBase.where(where) : countBase);
  return { collections: rows.map(asSummary), total: Number(totalRow?.total || 0), page, limit };
}

export async function getAdminClimateCollection(
  collectionId: string,
  dependencies: ClimateCollectionDependencies = {},
): Promise<ClimateCollectionDetail | null> {
  if (!isUuid(collectionId)) throw new ClimateCollectionError("invalid_request", "Invalid climate collection ID");
  const database = dependencies.database || db;
  const [row] = await database.select({
    ...summaryFields,
    memberCount: count(climateCollectionMembers.id),
  }).from(climateCollections)
    .leftJoin(climateCollectionMembers, eq(climateCollectionMembers.collectionId, climateCollections.id))
    .where(eq(climateCollections.id, collectionId)).groupBy(climateCollections.id).limit(1);
  if (!row) return null;
  const members = await database.select({
    ordinal: climateCollectionMembers.ordinal,
    variableKey: climateCollectionMembers.variableKey,
    state: climateCollectionMembers.state,
    mediaKind: climateCollectionMembers.mediaKind,
    byteSize: climateCollectionMembers.byteSize,
    sha256: climateCollectionMembers.sha256,
    units: climateCollectionMembers.units,
    datatype: climateCollectionMembers.datatype,
    scaleFactor: climateCollectionMembers.scaleFactor,
    addOffset: climateCollectionMembers.addOffset,
    nodataSemantics: climateCollectionMembers.nodataSemantics,
    gridFingerprint: climateCollectionMembers.gridFingerprint,
  }).from(climateCollectionMembers)
    .where(eq(climateCollectionMembers.collectionId, collectionId))
    .orderBy(asc(climateCollectionMembers.ordinal));
  return { ...asSummary(row), members };
}

export async function publishClimateCollection(
  collectionId: string,
  actorUserId: string,
  dependencies: ClimateCollectionDependencies = {},
): Promise<{ id: string; state: "ready"; manifestSha256: string; publishedAt: Date }> {
  if (!isUuid(collectionId) || !isUuid(actorUserId)) throw new ClimateCollectionError("invalid_request", "Invalid publication identity");
  const database = dependencies.database || db;
  const roots = dependencies.roots || getInputAssetRoots();
  const fs = dependencies.fs;
  const now = (dependencies.now || (() => new Date()))();

  try {
    return await database.transaction(async (tx) => {
      const [actor] = await tx.select({ role: users.role }).from(users)
        .where(eq(users.id, actorUserId)).for("update").limit(1);
      if (!actor || actor.role !== "admin") throw new ClimateCollectionError("forbidden", "Administrator authority is required");
      const [collection] = await tx.select({
        id: climateCollections.id,
        state: climateCollections.state,
        validationState: climateCollections.validationState,
      }).from(climateCollections).where(eq(climateCollections.id, collectionId)).for("update").limit(1);
      if (!collection) throw new ClimateCollectionError("not_found", "Climate collection not found");
      if (collection.state !== "staging" || collection.validationState !== "valid") {
        throw new ClimateCollectionError("conflict", "Climate collection is not publishable");
      }

      const members = await tx.select({
        assetId: inputAssets.id,
        locator: inputAssets.storageLocator,
        assetState: inputAssets.state,
        assetHash: inputAssets.contentSha256,
        assetSize: inputAssets.contentSize,
        memberState: climateCollectionMembers.state,
        memberHash: climateCollectionMembers.sha256,
        memberSize: climateCollectionMembers.byteSize,
      }).from(climateCollectionMembers)
        .innerJoin(inputAssets, eq(inputAssets.id, climateCollectionMembers.assetId))
        .where(eq(climateCollectionMembers.collectionId, collectionId))
        .orderBy(asc(climateCollectionMembers.ordinal)).for("share", { of: inputAssets });
      if (members.length === 0) throw new ClimateCollectionError("conflict", "Climate collection has no members");
      for (const member of members) {
        if (member.assetState !== "ready" || member.memberState !== "validated"
          || member.assetHash !== member.memberHash || member.assetSize !== member.memberSize) {
          throw new ClimateCollectionError("conflict", "Climate collection member identity is invalid");
        }
        const identity = await readInputAssetIdentityAnchored(member.locator, roots, fs);
        if (!identity) throw new ClimateCollectionError("unavailable", "Climate collection member storage is unavailable");
        if (identity.contentSize !== member.memberSize || identity.contentSha256 !== member.memberHash) {
          throw new ClimateCollectionError("conflict", "Climate collection member content has changed");
        }
      }

      const [published] = await tx.update(climateCollections).set({
        state: "ready",
        manifestSchemaVersion: CLIMATE_MANIFEST_SCHEMA_VERSION,
        manifest: sql`sdm_build_climate_manifest(${climateCollections.id}, ${CLIMATE_MANIFEST_SCHEMA_VERSION})`,
        manifestSha256: sql`encode(digest(convert_to(sdm_build_climate_manifest(${climateCollections.id}, ${CLIMATE_MANIFEST_SCHEMA_VERSION})::text, 'UTF8'), 'sha256'), 'hex')`,
        publishedByUserId: actorUserId,
        publishedAt: now,
        updatedAt: now,
      }).where(and(eq(climateCollections.id, collectionId), eq(climateCollections.state, "staging"))).returning({
        id: climateCollections.id,
        state: climateCollections.state,
        manifestSha256: climateCollections.manifestSha256,
        publishedAt: climateCollections.publishedAt,
      });
      if (!published || published.state !== "ready" || !published.manifestSha256 || !published.publishedAt) {
        throw new ClimateCollectionError("conflict", "Climate collection publication conflicted");
      }
      return { ...published, state: "ready" as const, manifestSha256: published.manifestSha256, publishedAt: published.publishedAt };
    });
  } catch (error) {
    if (error instanceof ClimateCollectionError) throw error;
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "P0001" || code.startsWith("23")) {
      throw new ClimateCollectionError("conflict", "Climate collection publication failed validation");
    }
    throw new ClimateCollectionError("unavailable", "Climate collection service is unavailable");
  }
}
