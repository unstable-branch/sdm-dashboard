import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs, inputAssetLegacyMappings, inputAssets, projectMembers, uploadedFiles, uploads } from "../db/schema.js";

export const INPUT_ASSET_SCOPES = ["private", "project", "system"] as const;
export const INPUT_ASSET_KINDS = ["raw_occurrence", "cleaned_occurrence", "custom_boundary", "target_group"] as const;
export const INPUT_ASSET_STATES = ["ready", "deleted", "quarantined"] as const;
export type InputAssetScope = (typeof INPUT_ASSET_SCOPES)[number];
export type InputAssetKind = (typeof INPUT_ASSET_KINDS)[number];
export type InputAssetState = (typeof INPUT_ASSET_STATES)[number];
export type InputAssetAction = "read" | "use";

export interface InputAssetPrincipal {
  id: string;
  role: string;
}

export interface InputAssetRootMap {
  [rootName: string]: string;
}

export interface AssetFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isFile(): boolean; size?: number }>;
  readFile(path: string): Promise<Buffer>;
}

const fileSystem: AssetFileSystem = { realpath, lstat, readFile };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const HASH_RE = /^[0-9a-f]{64}$/i;
const ASSET_ACTIONS = new Set<InputAssetAction>(["read", "use"]);
const ASSET_KINDS = new Set<string>(INPUT_ASSET_KINDS);
const ASSET_SCOPES = new Set<string>(INPUT_ASSET_SCOPES);
const ASSET_STATES = new Set<string>(INPUT_ASSET_STATES);
const PRINCIPAL_ROLES = new Set(["admin", "editor", "viewer"]);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export type InputAssetRow = typeof inputAssets.$inferSelect;

type Database = typeof db;

export interface InputAssetDependencies {
  database?: Database;
  roots?: InputAssetRootMap;
  fs?: AssetFileSystem;
  auditAdminAccess?: (entry: InputAssetAdminAuditEntry) => Promise<void>;
}

export interface InputAssetAdminAuditEntry {
  principalId: string;
  assetId: string;
  action: InputAssetAction;
  assetScope: InputAssetScope;
  projectId: string | null;
}

export type InputAssetDenialReason =
  | "invalid_request"
  | "not_found"
  | "not_authorized"
  | "invalid_asset"
  | "invalid_lineage"
  | "unsafe_storage"
  | "unavailable"
  | "legacy_unmapped";

export type InputAssetResolution =
  | { ok: true; asset: InputAssetRow; absolutePath: string; adminAccess: boolean }
  | { ok: false; reason: InputAssetDenialReason };

export class InputAssetRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputAssetRegistrationError";
  }
}

export interface RegisterInputAssetInput {
  creatorUserId: string;
  scope: Exclude<InputAssetScope, "system">;
  kind: InputAssetKind;
  projectId?: string | null;
  root: string;
  relativePath: string;
  contentSha256?: string;
}

export interface RegisterSystemInputAssetInput {
  creatorUserId: string;
  kind: InputAssetKind;
  root: string;
  relativePath: string;
  contentSha256?: string;
}

export interface RegisterDerivedInputAssetInput extends RegisterInputAssetInput {
  parentAssetId: string;
  /** Principal performing the derivation; distinct from immutable child creator metadata. */
  actorUserId?: string;
}

export interface RegisterServerPathInput {
  creatorUserId: string;
  scope: Exclude<InputAssetScope, "system">;
  kind: InputAssetKind;
  projectId?: string | null;
  absolutePath: string;
  contentSha256?: string;
}

export interface RegisterDerivedServerPathInput extends RegisterServerPathInput {
  parentAssetId: string;
  actorUserId?: string;
}

export interface ResolveInputAssetOptions {
  assetId: string;
  principal: InputAssetPrincipal;
  action?: InputAssetAction;
  expectedKind?: InputAssetKind;
  allowedKinds?: readonly InputAssetKind[];
  expectedParentAssetId?: string | null;
  destinationProjectId?: string | null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function defaultRoots(): InputAssetRootMap {
  const projectRoot = resolve(process.env.SDM_PROJECT_ROOT || PROJECT_ROOT);
  return {
    boundaries: process.env.SDM_INPUT_ASSET_BOUNDARY_ROOT || join(projectRoot, "data", "uploads", "boundaries"),
    uploads: process.env.SDM_INPUT_ASSET_UPLOAD_ROOT || join(projectRoot, "data", "uploads"),
    system: process.env.SDM_INPUT_ASSET_SYSTEM_ROOT || join(projectRoot, "data", "system"),
  };
}

function isContained(root: string, candidate: string): boolean {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  return candidateResolved === rootResolved || candidateResolved.startsWith(rootResolved + sep);
}

function parseLocator(locator: string): { root: string; segments: string[] } | null {
  if (typeof locator !== "string" || locator.length === 0 || locator.length > 2048) return null;
  if (locator !== locator.trim() || /[\u0000-\u001f\u007f]/.test(locator) || locator.includes("\\") || locator.includes(":")) return null;
  if (locator.startsWith("/") || locator.includes("//")) return null;
  const parts = locator.split("/");
  const root = parts.shift() || "";
  if (!ROOT_NAME_RE.test(root) || parts.length === 0 || parts.some((part) => !part || part === "." || part === "..")) return null;
  return { root, segments: parts };
}

/** Convert a server-owned root and relative path into the only locator format accepted by the resolver. */
export function makeInputAssetLocator(root: string, relativePath: string, roots: InputAssetRootMap = defaultRoots()): string | null {
  if (!ROOT_NAME_RE.test(root) || typeof relativePath !== "string" || relativePath.length === 0) return null;
  const parsed = parseLocator(root + "/" + relativePath);
  if (!parsed || !Object.prototype.hasOwnProperty.call(roots, root)) return null;
  return root + "/" + parsed.segments.join("/");
}

/**
 * Resolve a canonical locator only under a configured root.  Realpath and an
 * lstat walk reject symlink components, so an in-root name cannot redirect to
 * another tenant's file.  Missing/non-regular files fail closed.
 */
export async function resolveInputAssetStorage(
  locator: string,
  roots: InputAssetRootMap = defaultRoots(),
  fs: AssetFileSystem = fileSystem,
): Promise<{ absolutePath: string; locator: string } | null> {
  const parsed = parseLocator(locator);
  if (!parsed) return null;
  const configuredRoot = roots[parsed.root];
  if (typeof configuredRoot !== "string" || configuredRoot.length === 0) return null;

  try {
    const configuredRootPath = resolve(configuredRoot);
    const rootStat = await fs.lstat(configuredRootPath);
    if (rootStat.isSymbolicLink() || rootStat.isFile()) return null;
    const rootPath = await fs.realpath(configuredRootPath);
    const candidate = resolve(rootPath, ...parsed.segments);
    if (!isContained(rootPath, candidate)) return null;

    let current = rootPath;
    for (const segment of parsed.segments) {
      current = join(current, segment);
      const component = await fs.lstat(current);
      if (component.isSymbolicLink()) return null;
      if (current === candidate && !component.isFile()) return null;
    }

    const actualPath = await fs.realpath(candidate);
    if (!isContained(rootPath, actualPath)) return null;
    const actualStat = await fs.lstat(actualPath);
    if (actualStat.isSymbolicLink() || !actualStat.isFile()) return null;
    return { absolutePath: actualPath, locator: parsed.root + "/" + parsed.segments.join("/") };
  } catch {
    return null;
  }
}

function validateRegistrationInput(input: RegisterInputAssetInput | RegisterSystemInputAssetInput, allowSystem: boolean): void {
  if (!isUuid(input.creatorUserId) || !isOneOf(input.kind, INPUT_ASSET_KINDS)) {
    throw new InputAssetRegistrationError("Invalid input asset identity");
  }
  if (!allowSystem && (!("scope" in input) || !isOneOf(input.scope, ["private", "project"] as const))) {
    throw new InputAssetRegistrationError("System scope requires the server-only registration function");
  }
  if (!ROOT_NAME_RE.test(input.root) || typeof input.relativePath !== "string") {
    throw new InputAssetRegistrationError("Invalid server-owned storage locator");
  }
  if (input.contentSha256 !== undefined && !HASH_RE.test(input.contentSha256)) {
    throw new InputAssetRegistrationError("Invalid content identity");
  }
}

async function computeIdentity(path: string, fs: AssetFileSystem): Promise<{ contentSha256: string; contentSize: number }> {
  const content = await fs.readFile(path);
  return { contentSha256: createHash("sha256").update(content).digest("hex"), contentSize: content.length };
}

async function matchesContentIdentity(asset: InputAssetRow, path: string, fs: AssetFileSystem): Promise<boolean> {
  if (asset.contentSize == null && asset.contentSha256 == null) return true;
  const identity = await computeIdentity(path, fs);
  if (asset.contentSize != null && identity.contentSize !== asset.contentSize) return false;
  return asset.contentSha256 == null || identity.contentSha256 === asset.contentSha256.toLowerCase();
}

async function assertRegistrationParent(
  database: Database,
  input: RegisterDerivedInputAssetInput,
): Promise<void> {
  if (!isUuid(input.parentAssetId)) throw new InputAssetRegistrationError("Invalid parent asset");
  const [parent] = await database.select().from(inputAssets).where(eq(inputAssets.id, input.parentAssetId)).limit(1);
  if (!parent || parent.state !== "ready") {
    throw new InputAssetRegistrationError("Parent asset is not available");
  }
  const actorUserId = input.actorUserId || input.creatorUserId;
  if (!isUuid(actorUserId)) throw new InputAssetRegistrationError("Invalid derivative actor");
  if (parent.scope === "private" && (parent.creatorUserId !== actorUserId || input.creatorUserId !== actorUserId)) {
    throw new InputAssetRegistrationError("Private parent asset is not available to this actor");
  }
  if (input.scope !== parent.scope || (input.projectId ?? null) !== (parent.projectId ?? null)) {
    throw new InputAssetRegistrationError("Derived asset scope does not match its parent");
  }
  if (input.kind === "cleaned_occurrence" && parent.kind !== "raw_occurrence") {
    throw new InputAssetRegistrationError("Cleaned occurrence must derive from a raw occurrence");
  }
}

async function register(
  input: RegisterInputAssetInput | RegisterSystemInputAssetInput,
  dependencies: InputAssetDependencies,
  allowSystem: boolean,
  parentAssetId: string | null,
): Promise<InputAssetRow> {
  validateRegistrationInput(input, allowSystem);
  const scopedInput = input as RegisterInputAssetInput;
  const scope: InputAssetScope = allowSystem ? "system" : scopedInput.scope;
  const projectId: string | null = scope === "project" ? (scopedInput.projectId ?? null) : null;
  if (scope === "project" && !isUuid(projectId)) throw new InputAssetRegistrationError("Project scope requires a project");
  if (scope !== "project" && scopedInput.projectId != null) throw new InputAssetRegistrationError("Private/system assets cannot name a project");

  const roots = dependencies.roots || defaultRoots();
  if (scope === "system" && input.root !== "system") {
    throw new InputAssetRegistrationError("System assets must use the configured system root");
  }
  const locator = makeInputAssetLocator(input.root, input.relativePath, roots);
  if (!locator) throw new InputAssetRegistrationError("Invalid server-owned storage locator");
  const fs = dependencies.fs || fileSystem;
  const resolved = await resolveInputAssetStorage(locator, roots, fs);
  if (!resolved) throw new InputAssetRegistrationError("Input asset storage is unavailable or unsafe");

  let identity: { contentSha256: string; contentSize: number };
  try {
    identity = await computeIdentity(resolved.absolutePath, fs);
  } catch {
    throw new InputAssetRegistrationError("Input asset content is unavailable");
  }
  if (input.contentSha256 && input.contentSha256.toLowerCase() !== identity.contentSha256) {
    throw new InputAssetRegistrationError("Input asset content identity mismatch");
  }

  const database = dependencies.database || db;
  try {
    if (parentAssetId) {
      await assertRegistrationParent(database, { ...scopedInput, parentAssetId });
    }
    if (scope === "project") {
      const authorizationUserId = parentAssetId && "actorUserId" in input && typeof input.actorUserId === "string"
        ? input.actorUserId
        : input.creatorUserId;
      const [membership] = await database.select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId as string), eq(projectMembers.userId, authorizationUserId)))
        .limit(1);
      if (!membership || !["editor", "admin"].includes(membership.role)) {
        throw new InputAssetRegistrationError("Asset creator cannot add project inputs");
      }
    }
  } catch (error) {
    if (error instanceof InputAssetRegistrationError) throw error;
    throw new InputAssetRegistrationError("Input asset registration storage is unavailable");
  }

  try {
    const values = {
      creatorUserId: input.creatorUserId,
      projectId,
      scope,
      kind: input.kind,
      storageLocator: locator,
      parentAssetId,
      state: "ready" as const,
      contentSha256: identity.contentSha256,
      contentSize: identity.contentSize,
    };
    const [asset] = await database.insert(inputAssets).values(values)
      .onConflictDoNothing({ target: inputAssets.storageLocator })
      .returning();
    if (asset) return asset;

    const [existing] = await database.select().from(inputAssets)
      .where(eq(inputAssets.storageLocator, locator)).limit(1);
    if (!existing
      || existing.state !== "ready"
      || existing.creatorUserId !== values.creatorUserId
      || existing.scope !== values.scope
      || existing.kind !== values.kind
      || existing.projectId !== values.projectId
      || existing.parentAssetId !== values.parentAssetId
      || existing.contentSha256 !== values.contentSha256
      || existing.contentSize !== values.contentSize) {
      throw new InputAssetRegistrationError("Input asset locator is already registered with different identity");
    }
    return existing;
  } catch (error) {
    if (error instanceof InputAssetRegistrationError) throw error;
    throw new InputAssetRegistrationError("Input asset registration failed");
  }
}

/** Register a private or explicitly project-scoped asset.  There is no locator update API. */
export async function registerInputAsset(input: RegisterInputAssetInput, dependencies: InputAssetDependencies = {}): Promise<InputAssetRow> {
  return register(input, dependencies, false, null);
}

/** Register a derivative after verifying its immutable parent and scope. */
export async function registerDerivedInputAsset(input: RegisterDerivedInputAssetInput, dependencies: InputAssetDependencies = {}): Promise<InputAssetRow> {
  return register(input, dependencies, false, input.parentAssetId);
}

/**
 * Translate a path produced by this server (or its colocated Plumber worker)
 * into a canonical root/relative locator.  This is intentionally separate
 * from the HTTP request shape: callers must obtain the path from a server
 * producer, never from a client field.  The registration path re-checks the
 * realpath, every component, and the content identity before inserting.
 */
export async function registerInputAssetFromServerPath(
  input: RegisterServerPathInput,
  dependencies: InputAssetDependencies = {},
): Promise<InputAssetRow> {
  if (typeof input.absolutePath !== "string" || !input.absolutePath.startsWith("/")) {
    throw new InputAssetRegistrationError("Server producer returned an invalid storage path");
  }
  const roots = dependencies.roots || defaultRoots();
  const fs = dependencies.fs || fileSystem;
  let producerPath = resolve(input.absolutePath);
  // Docker's colocated services use /app while local API tests use the
  // checkout root.  This translation is only for an internal producer path.
  const configuredProjectRoot = resolve(process.env.SDM_PROJECT_ROOT || PROJECT_ROOT);
  if (producerPath.startsWith("/app/") && configuredProjectRoot !== "/app") {
    producerPath = resolve(configuredProjectRoot, producerPath.slice("/app/".length));
  }

  let pathParts: { root: string; relativePath: string } | null = null;
  try {
    const actualProducerPath = await fs.realpath(producerPath);
    for (const [rootName, configuredRoot] of Object.entries(roots)) {
      if (typeof configuredRoot !== "string" || configuredRoot.length === 0) continue;
      const actualRoot = await fs.realpath(resolve(configuredRoot));
      const rel = relative(actualRoot, actualProducerPath);
      if (rel && !rel.startsWith("..") && !rel.includes(".." + sep) && !rel.startsWith(sep)) {
        pathParts = { root: rootName, relativePath: rel.split(sep).join("/") };
        break;
      }
    }
  } catch {
    // The common registration path below turns this into a stable denial.
  }
  if (!pathParts) throw new InputAssetRegistrationError("Server producer output is unavailable or unsafe");

  return register({ ...input, root: pathParts.root, relativePath: pathParts.relativePath }, dependencies, false, null);
}

/** Register a cleaner output while enforcing immutable raw-parent lineage. */
export async function registerDerivedInputAssetFromServerPath(
  input: RegisterDerivedServerPathInput,
  dependencies: InputAssetDependencies = {},
): Promise<InputAssetRow> {
  if (typeof input.absolutePath !== "string" || !input.absolutePath.startsWith("/")) {
    throw new InputAssetRegistrationError("Cleaner returned an invalid storage path");
  }
  const roots = dependencies.roots || defaultRoots();
  const fs = dependencies.fs || fileSystem;
  const producerPath = resolve(input.absolutePath);
  const configuredProjectRoot = resolve(process.env.SDM_PROJECT_ROOT || PROJECT_ROOT);
  const translatedPath = producerPath.startsWith("/app/") && configuredProjectRoot !== "/app"
    ? resolve(configuredProjectRoot, producerPath.slice("/app/".length))
    : producerPath;
  let pathParts: { root: string; relativePath: string } | null = null;
  try {
    const actualProducerPath = await fs.realpath(translatedPath);
    for (const [rootName, configuredRoot] of Object.entries(roots)) {
      if (typeof configuredRoot !== "string" || configuredRoot.length === 0) continue;
      const actualRoot = await fs.realpath(resolve(configuredRoot));
      const rel = relative(actualRoot, actualProducerPath);
      if (rel && !rel.startsWith("..") && !rel.includes(".." + sep) && !rel.startsWith(sep)) {
        pathParts = { root: rootName, relativePath: rel.split(sep).join("/") };
        break;
      }
    }
  } catch {
    // Stable fail-closed error below.
  }
  if (!pathParts) throw new InputAssetRegistrationError("Cleaner output is unavailable or unsafe");
  return registerDerivedInputAsset({ ...input, root: pathParts.root, relativePath: pathParts.relativePath }, dependencies);
}

/** System scope is intentionally exposed as a separate server-only function. */
export async function registerSystemInputAsset(input: RegisterSystemInputAssetInput, dependencies: InputAssetDependencies = {}): Promise<InputAssetRow> {
  return register(input, dependencies, true, null);
}

/** Only lifecycle state can be changed after registration; ownership and locator are immutable. */
export async function updateInputAssetState(
  assetId: string,
  state: Exclude<InputAssetState, "ready">,
  dependencies: InputAssetDependencies = {},
): Promise<boolean> {
  if (!isUuid(assetId) || !isOneOf(state, ["deleted", "quarantined"] as const)) return false;
  const database = dependencies.database || db;
  try {
    const now = new Date();
    const expectedState: InputAssetState = state === "quarantined" ? "ready" : "quarantined";
    const [updated] = await database.update(inputAssets).set({
      state,
      deletedAt: state === "deleted" ? now : null,
      quarantinedAt: state === "quarantined" ? now : null,
      updatedAt: now,
    }).where(and(eq(inputAssets.id, assetId), eq(inputAssets.state, expectedState))).returning({ id: inputAssets.id });
    return Boolean(updated);
  } catch {
    return false;
  }
}

export async function quarantineInputAsset(assetId: string, dependencies: InputAssetDependencies = {}): Promise<boolean> {
  return updateInputAssetState(assetId, "quarantined", dependencies);
}

/**
 * Create a verified compatibility mapping only from a legacy row and a
 * canonical asset already owned by the server. The legacy locator is read
 * from the database, never supplied by a request. Every row sharing that
 * locator must have the same owner/project tuple and the canonical real path
 * must be identical; otherwise the row remains unmapped and denied.
 */
export async function registerVerifiedLegacyMapping(
  legacyTable: "uploads" | "uploaded_files",
  legacyRowId: string,
  inputAssetId: string,
  dependencies: InputAssetDependencies = {},
): Promise<boolean> {
  if ((legacyTable !== "uploads" && legacyTable !== "uploaded_files") || !isUuid(legacyRowId) || !isUuid(inputAssetId)) return false;
  const database = dependencies.database || db;
  try {
    const legacyTableRef = legacyTable === "uploads" ? uploads : uploadedFiles;
    const [legacy] = await database.select().from(legacyTableRef).where(eq(legacyTableRef.id, legacyRowId)).limit(1);
    const [asset] = await database.select().from(inputAssets).where(eq(inputAssets.id, inputAssetId)).limit(1);
    if (!legacy || !asset || asset.state !== "ready" || asset.kind !== "raw_occurrence") return false;
    if (!isUuid(legacy.userId) || legacy.userId !== asset.creatorUserId || typeof legacy.filePath !== "string" || legacy.filePath.length === 0) return false;
    const expectedProjectId = legacyTable === "uploaded_files" ? (legacy as unknown as { projectId: string }).projectId : null;
    if ((asset.projectId ?? null) !== (expectedProjectId ?? null) || (legacyTable === "uploads" && asset.scope !== "private") || (legacyTable === "uploaded_files" && asset.scope !== "project")) return false;

    const matchingUploads = await database.select().from(uploads).where(eq(uploads.filePath, legacy.filePath));
    const matchingProjectUploads = await database.select().from(uploadedFiles).where(eq(uploadedFiles.filePath, legacy.filePath));
    const ownershipTuples = [
      ...matchingUploads.map((row) => (row.userId ?? "") + "|"),
      ...matchingProjectUploads.map((row) => row.userId + "|" + row.projectId),
    ];
    const expectedTuple = legacy.userId + "|" + (expectedProjectId ?? "");
    if (ownershipTuples.length === 0 || ownershipTuples.some((tuple) => tuple !== expectedTuple)) return false;

    const storage = await resolveInputAssetStorage(asset.storageLocator, dependencies.roots || defaultRoots(), dependencies.fs || fileSystem);
    if (!storage || resolve(legacy.filePath) !== storage.absolutePath) return false;
    const values = {
      legacyTable,
      legacyRowId,
      legacyLocator: legacy.filePath,
      legacyUserId: legacy.userId,
      legacyProjectId: expectedProjectId,
      inputAssetId,
      mappingState: "verified" as const,
      quarantineReason: null,
    };
    await database.insert(inputAssetLegacyMappings).values(values);
    return true;
  } catch {
    return false;
  }
}

async function defaultAdminAudit(database: Database, entry: InputAssetAdminAuditEntry): Promise<void> {
  await database.insert(auditLogs).values({
    userId: entry.principalId,
    action: "input_asset_admin_access",
    entity: "input_asset",
    entityId: entry.assetId,
    statusCode: 200,
    details: { action: entry.action, scope: entry.assetScope, projectId: entry.projectId },
  });
}

async function authorizeAsset(
  asset: InputAssetRow,
  principal: InputAssetPrincipal,
  action: InputAssetAction,
  destinationProjectId: string | null,
  database: Database,
): Promise<{ allowed: boolean; adminAccess: boolean }> {
  if (!isUuid(principal.id) || !PRINCIPAL_ROLES.has(principal.role) || !ASSET_SCOPES.has(asset.scope) || !ASSET_KINDS.has(asset.kind) || !ASSET_STATES.has(asset.state)) {
    return { allowed: false, adminAccess: false };
  }
  if (!ASSET_ACTIONS.has(action) || asset.state !== "ready") return { allowed: false, adminAccess: false };
  if ((asset.scope === "private" || asset.scope === "system") && asset.projectId !== null) return { allowed: false, adminAccess: false };
  if (asset.scope === "project" && !isUuid(asset.projectId)) return { allowed: false, adminAccess: false };
  if (destinationProjectId !== null && !isUuid(destinationProjectId)) return { allowed: false, adminAccess: false };
  if (destinationProjectId !== null && asset.scope === "project" && asset.projectId !== destinationProjectId) return { allowed: false, adminAccess: false };

  // Private assets are never implicitly shared, including with admins: only
  // the immutable creator identity may read or use them.
  if (asset.scope === "private") {
    if (asset.creatorUserId !== principal.id) return { allowed: false, adminAccess: false };
    if (destinationProjectId === null) return { allowed: true, adminAccess: false };
    const [membership] = await database.select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, destinationProjectId), eq(projectMembers.userId, principal.id)))
      .limit(1);
    if (!membership || !PRINCIPAL_ROLES.has(membership.role)) return { allowed: false, adminAccess: false };
    if (action === "use" && membership.role === "viewer") return { allowed: false, adminAccess: false };
    return { allowed: true, adminAccess: false };
  }

  const adminAccess = principal.role === "admin";
  if (adminAccess) return { allowed: true, adminAccess: true };
  if (asset.scope === "system" && destinationProjectId === null) return { allowed: true, adminAccess: false };

  // Project assets are governed by their own project. System assets used in a
  // project run are governed by the destination project, never by a null
  // project_id lookup. This keeps globally configured inputs usable without
  // allowing a revoked/viewer member to submit project computation.
  const authorizationProjectId = asset.scope === "project" ? asset.projectId : destinationProjectId;
  if (!authorizationProjectId) return { allowed: false, adminAccess: false };
  const [membership] = await database.select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, authorizationProjectId), eq(projectMembers.userId, principal.id)))
    .limit(1);
  if (!membership || !PRINCIPAL_ROLES.has(membership.role)) return { allowed: false, adminAccess: false };
  if (action === "use" && membership.role === "viewer") return { allowed: false, adminAccess: false };
  return { allowed: true, adminAccess: false };
}

async function resolveInternal(
  options: ResolveInputAssetOptions,
  dependencies: InputAssetDependencies,
  depth: number,
): Promise<InputAssetResolution> {
  if (depth > 4 || !isUuid(options.assetId) || !isUuid(options.principal.id)) return { ok: false, reason: "invalid_request" };
  const action = options.action || "use";
  if (!ASSET_ACTIONS.has(action)) return { ok: false, reason: "invalid_request" };
  if (options.expectedKind && !ASSET_KINDS.has(options.expectedKind)) return { ok: false, reason: "invalid_request" };
  if (options.allowedKinds && options.allowedKinds.some((kind) => !ASSET_KINDS.has(kind))) return { ok: false, reason: "invalid_request" };
  if (options.expectedParentAssetId !== undefined && options.expectedParentAssetId !== null && !isUuid(options.expectedParentAssetId)) return { ok: false, reason: "invalid_request" };
  if (options.destinationProjectId !== undefined && options.destinationProjectId !== null && !isUuid(options.destinationProjectId)) return { ok: false, reason: "invalid_request" };

  const database = dependencies.database || db;
  try {
    const [asset] = await database.select().from(inputAssets).where(eq(inputAssets.id, options.assetId)).limit(1);
    if (!asset) return { ok: false, reason: "not_found" };
    if (options.expectedKind && asset.kind !== options.expectedKind) return { ok: false, reason: "invalid_asset" };
    if (options.allowedKinds && !options.allowedKinds.includes(asset.kind)) return { ok: false, reason: "invalid_asset" };
    if (options.expectedParentAssetId !== undefined && (asset.parentAssetId || null) !== (options.expectedParentAssetId || null)) {
      return { ok: false, reason: "invalid_lineage" };
    }
    if (asset.kind === "cleaned_occurrence" && !asset.parentAssetId) return { ok: false, reason: "invalid_lineage" };

    const auth = await authorizeAsset(asset, options.principal, action, options.destinationProjectId ?? null, database);
    if (!auth.allowed) return { ok: false, reason: "not_authorized" };

    if (asset.parentAssetId) {
      if (!isUuid(asset.parentAssetId)) return { ok: false, reason: "invalid_lineage" };
      const parent = await resolveInternal({
        assetId: asset.parentAssetId,
        principal: options.principal,
        action,
        destinationProjectId: options.destinationProjectId,
      }, dependencies, depth + 1);
      if (!parent.ok || parent.asset.projectId !== asset.projectId || parent.asset.scope !== asset.scope
        || (asset.scope === "private" && parent.asset.creatorUserId !== asset.creatorUserId)) {
        return { ok: false, reason: "invalid_lineage" };
      }
      if (asset.kind === "cleaned_occurrence" && parent.asset.kind !== "raw_occurrence") return { ok: false, reason: "invalid_lineage" };
    }

    const storage = await resolveInputAssetStorage(asset.storageLocator, dependencies.roots || defaultRoots(), dependencies.fs || fileSystem);
    if (!storage) return { ok: false, reason: "unsafe_storage" };
    if (!(await matchesContentIdentity(asset, storage.absolutePath, dependencies.fs || fileSystem))) return { ok: false, reason: "unsafe_storage" };

    if (auth.adminAccess) {
      try {
        const entry = { principalId: options.principal.id, assetId: asset.id, action, assetScope: asset.scope, projectId: asset.projectId };
        if (dependencies.auditAdminAccess) await dependencies.auditAdminAccess(entry);
        else await defaultAdminAudit(database, entry);
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    }
    return { ok: true, asset, absolutePath: storage.absolutePath, adminAccess: auth.adminAccess };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Resolve only an opaque canonical ID.  Path aliases and legacy rows are not accepted here. */
export async function resolveInputAsset(options: ResolveInputAssetOptions, dependencies: InputAssetDependencies = {}): Promise<InputAssetResolution> {
  return resolveInternal(options, dependencies, 0);
}

/**
 * Resolve an explicitly verified legacy mapping.  This is deliberately not a
 * path adapter: no mapping, quarantined mapping, duplicate source, or missing
 * canonical asset can become usable through this function.
 */
export async function resolveLegacyInputAsset(
  legacyTable: "uploads" | "uploaded_files",
  legacyRowId: string,
  options: Omit<ResolveInputAssetOptions, "assetId">,
  dependencies: InputAssetDependencies = {},
): Promise<InputAssetResolution> {
  if ((legacyTable !== "uploads" && legacyTable !== "uploaded_files") || !isUuid(legacyRowId)) return { ok: false, reason: "invalid_request" };
  const database = dependencies.database || db;
  try {
    const [mapping] = await database.select().from(inputAssetLegacyMappings).where(and(
      eq(inputAssetLegacyMappings.legacyTable, legacyTable),
      eq(inputAssetLegacyMappings.legacyRowId, legacyRowId),
      eq(inputAssetLegacyMappings.mappingState, "verified"),
    )).limit(1);
    if (!mapping || !mapping.inputAssetId || !isUuid(mapping.inputAssetId)) return { ok: false, reason: "legacy_unmapped" };
    return resolveInputAsset({ ...options, assetId: mapping.inputAssetId }, dependencies);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
