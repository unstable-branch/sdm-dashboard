import { pgTable, uuid, varchar, text, timestamp, integer, smallint, bigint, doublePrecision, jsonb, boolean, pgEnum, index, uniqueIndex, check, AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

const statusEnum = pgEnum("run_status", ["queued", "running", "completed", "failed", "cancelled"]);
const roleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);
export const inputAssetScopeEnum = pgEnum("input_asset_scope", ["private", "project", "system"]);
export const inputAssetKindEnum = pgEnum("input_asset_kind", ["raw_occurrence", "cleaned_occurrence", "custom_boundary", "target_group", "climate_raster"]);
export const inputAssetStateEnum = pgEnum("input_asset_state", ["ready", "deleted", "quarantined"]);
export const climateCollectionKindEnum = pgEnum("climate_collection_kind", ["current_baseline", "future_scenario", "derived_future"]);
export const climateCollectionStateEnum = pgEnum("climate_collection_state", ["staging", "ready", "quarantined", "deleted"]);
export const climateValidationStateEnum = pgEnum("climate_validation_state", ["pending", "valid", "invalid"]);
export const climateMemberStateEnum = pgEnum("climate_member_state", ["staging", "validated", "quarantined", "deleted"]);
export const climateBindingRoleEnum = pgEnum("climate_binding_role", ["current", "future_primary", "future_secondary"]);
export const climateInputModeEnum = pgEnum("climate_input_mode", ["legacy_unverified", "canonical"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }),
  role: roleEnum("role").default("viewer").notNull(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  organization: text("organization"),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }).default(1073741824),
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).notNull().default(0),
  lastLoginAt: timestamp("last_login_at"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  // Incrementing this invalidates every access JWT for the user.
  authVersion: integer("auth_version").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_users_reset_token").on(t.resetToken),
  index("idx_users_reset_token_expiry").on(t.resetTokenExpiry),
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  ownerId: uuid("owner_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectMembers = pgTable("project_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  role: roleEnum("role").default("viewer").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_project_members_project").on(t.projectId),
  index("idx_project_members_user").on(t.userId),
]);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  keyHash: text("key_hash").notNull(),
  keyPreview: varchar("key_preview", { length: 16 }),
  name: varchar("name", { length: 255 }).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (t) => [
  index("idx_api_keys_user").on(t.userId),
]);

export const species = pgTable("species", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  userId: uuid("user_id").references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  occurrenceCount: integer("occurrence_count").default(0),
}, (t) => [
  index("idx_species_project").on(t.projectId),
  index("idx_species_user_id").on(t.userId),
  index("idx_species_name").on(t.name),
  uniqueIndex("species_project_name_unique").on(t.projectId, t.name),
]);

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  name: varchar("name", { length: 255 }),
  totalJobs: integer("total_jobs").notNull().default(0),
  completedJobs: integer("completed_jobs").notNull().default(0),
  failedJobs: integer("failed_jobs").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  jobId: varchar("job_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("idx_batches_project").on(t.projectId),
  index("idx_batches_user").on(t.userId),
]);

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  speciesId: uuid("species_id").references(() => species.id),
  speciesName: varchar("species_name", { length: 255 }),
  modelId: varchar("model_id", { length: 50 }).notNull(),
  status: statusEnum("status").notNull().default("queued"),
  jobId: varchar("job_id", { length: 100 }),
  bullmqId: varchar("bullmq_id", { length: 100 }),
  runNumber: integer("run_number"),
  progressLog: jsonb("progress_log").default([]),
  config: jsonb("config").notNull(),
  pipelineRunId: uuid("pipeline_run_id"),
  metrics: jsonb("metrics"),
  outputFiles: jsonb("output_files"),
  error: text("error"),
  parentRunId: uuid("parent_run_id").references((): AnyPgColumn => runs.id),
  provenance: jsonb("provenance"),
  peakMemoryMb: integer("peak_memory_mb"),
  rCpuTimeMs: integer("r_cpu_time_ms"),
  rPeakMemoryMb: integer("r_peak_memory_mb"),
  runStorageBytes: bigint("run_storage_bytes", { mode: "number" }).default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  lastStage: text("last_stage"),
  errorCode: text("error_code"),
  errorHint: text("error_hint"),
  climateInputMode: climateInputModeEnum("climate_input_mode").notNull().default("legacy_unverified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_runs_project").on(t.projectId),
  index("idx_runs_status").on(t.status),
  index("idx_runs_pipeline").on(t.pipelineRunId),
  index("idx_runs_parent").on(t.parentRunId),
  index("idx_runs_species_name").on(t.speciesName),
  index("idx_runs_created_at").on(t.createdAt),
  index("idx_runs_job_id").on(t.jobId),
  index("idx_runs_status_created").on(t.status, t.createdAt),
  index("idx_runs_bullmq_id").on(t.bullmqId),
  uniqueIndex("idx_runs_project_run_number").on(t.projectId, t.runNumber),
]);

export const occurrences = pgTable("occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  userId: uuid("user_id").references(() => users.id),
  speciesId: uuid("species_id").references(() => species.id).notNull(),
  filePath: text("file_path"),
  pipelineRunId: uuid("pipeline_run_id"),
  longitude: doublePrecision("longitude").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  source: varchar("source", { length: 255 }),
  flagged: boolean("flagged").default(false),
  flagReason: varchar("flag_reason", { length: 255 }),
  cleaned: boolean("cleaned").default(false),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_occurrences_project").on(t.projectId),
  index("idx_occurrences_species").on(t.speciesId),
  index("idx_occurrences_user_id").on(t.userId),
  index("idx_occurrences_pipeline").on(t.pipelineRunId),
  index("idx_occurrences_species_project").on(t.speciesId, t.projectId),
  index("idx_occurrences_file_path").on(t.filePath),
]);

export const userSettings = pgTable("user_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  defaultModelId: varchar("default_model_id", { length: 50 }).default("glm"),
  pinnedModelIds: text("pinned_model_ids").array().default([]),
  defaultBiovars: text("default_biovars").default("1,4,6,12,15,18"),
  defaultClimateSource: varchar("default_climate_source", { length: 20 }).default("worldclim"),
  defaultClimateRes: doublePrecision("default_climate_res").default(10),
  defaultCvStrategy: varchar("default_cv_strategy", { length: 20 }).default("random"),
  defaultCvK: integer("default_cv_k").default(5),
  defaultBackgroundN: integer("default_background_n").default(10000),
  defaultPaReplications: integer("default_pa_replications").default(5),
  theme: varchar("theme", { length: 20 }).default("system"),
  tablePageSize: integer("table_page_size").default(50),
  compactMode: boolean("compact_mode").default(false),
  gbifUsername: text("gbif_username"),
  gbifPassword: text("gbif_password"),
  gbifEmail: text("gbif_email"),
  alaApiKey: text("ala_api_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("idx_user_settings_user_id").on(t.userId),
]);

export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("idx_system_settings_key").on(t.key),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  entity: varchar("entity", { length: 100 }),
  entityId: uuid("entity_id"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  requestId: uuid("request_id"),
  method: varchar("method", { length: 10 }),
  path: varchar("path", { length: 500 }),
  statusCode: smallint("status_code"),
  retentionDays: integer("retention_days").default(90),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_audit_logs_user").on(t.userId),
  index("idx_audit_logs_action").on(t.action),
  index("idx_audit_logs_created").on(t.createdAt),
  index("idx_audit_logs_entity").on(t.entity, t.entityId),
  index("idx_audit_logs_request").on(t.requestId),
  index("idx_audit_logs_status").on(t.statusCode),
]);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  filename: varchar("filename", { length: 255 }).notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").default(0),
  format: varchar("format", { length: 20 }).default("csv"),
  nRows: integer("n_rows"),
  species: varchar("species", { length: 255 }),
  columnsDetected: jsonb("columns_detected"),
  isCleaned: boolean("is_cleaned").default(false),
  cleanedFilePath: text("cleaned_file_path"),
  cleanedValidRecords: integer("cleaned_valid_records"),
  cleanedOriginalRows: integer("cleaned_original_rows"),
  cleaningCcLog: jsonb("cleaning_cc_log"),
  cleaningSourceCounts: jsonb("cleaning_source_counts"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_uploads_user_id").on(t.userId),
  index("idx_uploads_created").on(t.createdAt),
]);

/** Canonical input resources; legacy tables are compatibility metadata only. */
export const inputAssets = pgTable("input_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorUserId: uuid("creator_user_id").references(() => users.id, { onDelete: "restrict" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
  scope: inputAssetScopeEnum("scope").notNull(),
  kind: inputAssetKindEnum("kind").notNull(),
  storageLocator: text("storage_locator").notNull(),
  parentAssetId: uuid("parent_asset_id").references((): AnyPgColumn => inputAssets.id, { onDelete: "restrict" }),
  state: inputAssetStateEnum("state").notNull().default("ready"),
  contentSha256: varchar("content_sha256", { length: 64 }),
  contentSize: bigint("content_size", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  quarantinedAt: timestamp("quarantined_at"),
}, (t) => [
  uniqueIndex("input_assets_storage_locator_unique").on(t.storageLocator),
  index("input_assets_creator_idx").on(t.creatorUserId),
  index("input_assets_project_idx").on(t.projectId),
  index("input_assets_scope_state_idx").on(t.scope, t.state),
  index("input_assets_kind_state_idx").on(t.kind, t.state),
  index("input_assets_parent_idx").on(t.parentAssetId),
  check("input_assets_scope_project_ck", sql`("scope" = 'private' AND "project_id" IS NULL) OR ("scope" = 'project' AND "project_id" IS NOT NULL) OR ("scope" = 'system' AND "project_id" IS NULL)`),
  check("input_assets_locator_nonempty_ck", sql`length(btrim("storage_locator")) > 0`),
  check("input_assets_hash_ck", sql`"content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-fA-F]{64}$'`),
  check("input_assets_size_ck", sql`"content_size" IS NULL OR "content_size" >= 0`),
  check("input_assets_deleted_time_ck", sql`"state" <> 'deleted' OR "deleted_at" IS NOT NULL`),
  check("input_assets_quarantined_time_ck", sql`"state" <> 'quarantined' OR "quarantined_at" IS NOT NULL`),
]);

/** Durable binding between a Plumber clean job and its canonical raw/derived assets. */
export const occurrenceCleanJobs = pgTable("occurrence_clean_jobs", {
  jobId: varchar("job_id", { length: 255 }).primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }).notNull(),
  rawAssetId: uuid("raw_asset_id").references(() => inputAssets.id, { onDelete: "restrict" }).notNull(),
  cleanedAssetId: uuid("cleaned_asset_id").references(() => inputAssets.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("occurrence_clean_jobs_user_idx").on(t.userId),
  index("occurrence_clean_jobs_raw_asset_idx").on(t.rawAssetId),
  index("occurrence_clean_jobs_cleaned_asset_idx").on(t.cleanedAssetId),
]);

/** Unmapped or quarantined legacy rows can never be used as path aliases. */
export const inputAssetLegacyMappings = pgTable("input_asset_legacy_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  legacyTable: varchar("legacy_table", { length: 32 }).notNull(),
  legacyRowId: uuid("legacy_row_id").notNull(),
  legacyLocator: text("legacy_locator").notNull(),
  legacyUserId: uuid("legacy_user_id").references(() => users.id, { onDelete: "set null" }),
  legacyProjectId: uuid("legacy_project_id").references(() => projects.id, { onDelete: "set null" }),
  inputAssetId: uuid("input_asset_id").references(() => inputAssets.id, { onDelete: "restrict" }),
  mappingState: varchar("mapping_state", { length: 20 }).notNull().default("quarantined"),
  quarantineReason: text("quarantine_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("input_asset_legacy_source_unique").on(t.legacyTable, t.legacyRowId),
  index("input_asset_legacy_locator_idx").on(t.legacyLocator),
  index("input_asset_legacy_asset_idx").on(t.inputAssetId),
  index("input_asset_legacy_state_idx").on(t.mappingState),
  check("input_asset_legacy_table_ck", sql`"legacy_table" IN ('uploads', 'uploaded_files')`),
  check("input_asset_legacy_locator_ck", sql`length(btrim("legacy_locator")) > 0`),
  check("input_asset_legacy_state_ck", sql`"mapping_state" IN ('verified', 'quarantined')`),
  check("input_asset_legacy_verified_ck", sql`"mapping_state" <> 'verified' OR "input_asset_id" IS NOT NULL`),
]);

/** Stable semantic keys independent of provider filenames. */
export const climateVariableCatalog = pgTable("climate_variable_catalog", {
  variableKey: varchar("variable_key", { length: 64 }).primaryKey(),
  family: varchar("family", { length: 32 }).notNull(),
  displayName: text("display_name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("climate_variable_catalog_key_ck", sql`"variable_key" ~ '^[a-z][a-z0-9_]{1,63}$'`),
  check("climate_variable_catalog_family_ck", sql`length(btrim("family")) > 0`),
  check("climate_variable_catalog_name_ck", sql`length(btrim("display_name")) > 0`),
]);

/** Immutable ordered climate collections; only lifecycle fields may change after publication. */
export const climateCollections = pgTable("climate_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: climateCollectionKindEnum("kind").notNull(),
  state: climateCollectionStateEnum("state").notNull().default("staging"),
  validationState: climateValidationStateEnum("validation_state").notNull().default("pending"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  publishedByUserId: uuid("published_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  dataset: text("dataset").notNull(),
  datasetVersion: text("dataset_version").notNull(),
  licence: text("licence").notNull(),
  attribution: text("attribution").notNull(),
  sourceEvidence: jsonb("source_evidence").notNull(),
  expectedVariableKeys: text("expected_variable_keys").array().notNull(),
  gridFingerprint: varchar("grid_fingerprint", { length: 64 }).notNull(),
  gridDefinition: jsonb("grid_definition").notNull(),
  baselineStart: varchar("baseline_start", { length: 32 }),
  baselineEnd: varchar("baseline_end", { length: 32 }),
  futurePeriod: varchar("future_period", { length: 64 }),
  ssp: varchar("ssp", { length: 64 }),
  gcm: varchar("gcm", { length: 128 }),
  scenarioLabel: text("scenario_label"),
  baselineCollectionId: uuid("baseline_collection_id").references((): AnyPgColumn => climateCollections.id, { onDelete: "restrict" }),
  derivationAlgorithmId: text("derivation_algorithm_id"),
  derivationAlgorithmVersion: text("derivation_algorithm_version"),
  derivationParameters: jsonb("derivation_parameters"),
  missingCellPolicy: text("missing_cell_policy"),
  derivationSoftwareIdentity: jsonb("derivation_software_identity"),
  validationReportSha256: varchar("validation_report_sha256", { length: 64 }),
  validatorIdentity: text("validator_identity"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  manifestSchemaVersion: integer("manifest_schema_version"),
  manifestSha256: varchar("manifest_sha256", { length: 64 }),
  manifest: jsonb("manifest"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
  quarantineReason: text("quarantine_reason"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletionReceipt: jsonb("deletion_receipt"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("climate_collections_manifest_unique").on(t.id, t.manifestSha256),
  index("climate_collections_state_idx").on(t.state),
  index("climate_collections_kind_state_idx").on(t.kind, t.state),
  index("climate_collections_baseline_idx").on(t.baselineCollectionId),
  check("climate_collections_text_ck", sql`length(btrim("provider")) > 0 AND length(btrim("dataset")) > 0 AND length(btrim("dataset_version")) > 0 AND length(btrim("licence")) > 0 AND length(btrim("attribution")) > 0`),
  check("climate_collections_source_ck", sql`jsonb_typeof("source_evidence") = 'object'`),
  check("climate_collections_variables_ck", sql`cardinality("expected_variable_keys") > 0`),
  check("climate_collections_grid_hash_ck", sql`"grid_fingerprint" ~ '^[0-9a-f]{64}$'`),
  check("climate_collections_grid_ck", sql`jsonb_typeof("grid_definition") = 'object'`),
  check("climate_collections_validation_hash_ck", sql`"validation_report_sha256" IS NULL OR "validation_report_sha256" ~ '^[0-9a-f]{64}$'`),
  check("climate_collections_manifest_hash_ck", sql`"manifest_sha256" IS NULL OR "manifest_sha256" ~ '^[0-9a-f]{64}$'`),
  check("climate_collections_manifest_version_ck", sql`"manifest_schema_version" IS NULL OR "manifest_schema_version" > 0`),
  check("climate_collections_manifest_json_ck", sql`"manifest" IS NULL OR jsonb_typeof("manifest") = 'object'`),
  check("climate_collections_ready_ck", sql`"state" <> 'ready' OR ("validation_state" = 'valid' AND "validation_report_sha256" IS NOT NULL AND "validator_identity" IS NOT NULL AND length(btrim("validator_identity")) > 0 AND "validated_at" IS NOT NULL AND "manifest_schema_version" IS NOT NULL AND "manifest_sha256" IS NOT NULL AND "manifest" IS NOT NULL AND "published_by_user_id" IS NOT NULL AND "published_at" IS NOT NULL)`),
  check("climate_collections_quarantine_ck", sql`"state" <> 'quarantined' OR ("quarantined_at" IS NOT NULL AND length(btrim("quarantine_reason")) > 0)`),
  check("climate_collections_deleted_ck", sql`"state" <> 'deleted' OR ("deleted_at" IS NOT NULL AND "deletion_receipt" IS NOT NULL)`),
  check("climate_collections_kind_ck", sql`("kind" = 'current_baseline' AND "baseline_start" IS NOT NULL AND length(btrim("baseline_start")) > 0 AND "baseline_end" IS NOT NULL AND length(btrim("baseline_end")) > 0 AND "future_period" IS NULL AND "ssp" IS NULL AND "gcm" IS NULL AND "scenario_label" IS NULL AND "baseline_collection_id" IS NULL) OR ("kind" IN ('future_scenario', 'derived_future') AND "baseline_start" IS NULL AND "baseline_end" IS NULL AND "future_period" IS NOT NULL AND length(btrim("future_period")) > 0 AND "ssp" IS NOT NULL AND length(btrim("ssp")) > 0 AND "scenario_label" IS NOT NULL AND length(btrim("scenario_label")) > 0 AND "baseline_collection_id" IS NOT NULL)`),
  check("climate_collections_gcm_ck", sql`("kind" = 'future_scenario' AND "gcm" IS NOT NULL AND length(btrim("gcm")) > 0) OR ("kind" <> 'future_scenario' AND "gcm" IS NULL)`),
  check("climate_collections_derivation_ck", sql`("kind" = 'derived_future' AND "derivation_algorithm_id" IS NOT NULL AND length(btrim("derivation_algorithm_id")) > 0 AND "derivation_algorithm_version" IS NOT NULL AND length(btrim("derivation_algorithm_version")) > 0 AND "derivation_parameters" IS NOT NULL AND jsonb_typeof("derivation_parameters") = 'object' AND "missing_cell_policy" IS NOT NULL AND length(btrim("missing_cell_policy")) > 0 AND "derivation_software_identity" IS NOT NULL AND jsonb_typeof("derivation_software_identity") = 'object') OR ("kind" <> 'derived_future' AND "derivation_algorithm_id" IS NULL AND "derivation_algorithm_version" IS NULL AND "derivation_parameters" IS NULL AND "missing_cell_policy" IS NULL AND "derivation_software_identity" IS NULL)`),
]);

/** Ordered collection members point to immutable system-scoped climate raster assets. */
export const climateCollectionMembers = pgTable("climate_collection_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  collectionId: uuid("collection_id").references(() => climateCollections.id, { onDelete: "restrict" }).notNull(),
  assetId: uuid("asset_id").references(() => inputAssets.id, { onDelete: "restrict" }).notNull(),
  ordinal: integer("ordinal").notNull(),
  variableKey: varchar("variable_key", { length: 64 }).references(() => climateVariableCatalog.variableKey, { onDelete: "restrict" }).notNull(),
  state: climateMemberStateEnum("state").notNull().default("staging"),
  mediaKind: varchar("media_kind", { length: 32 }).notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  units: text("units").notNull(),
  datatype: text("datatype").notNull(),
  scaleFactor: doublePrecision("scale_factor").notNull().default(1),
  addOffset: doublePrecision("add_offset").notNull().default(0),
  nodataSemantics: jsonb("nodata_semantics").notNull(),
  gridFingerprint: varchar("grid_fingerprint", { length: 64 }).notNull(),
  validationEvidence: jsonb("validation_evidence"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("climate_collection_members_ordinal_unique").on(t.collectionId, t.ordinal),
  uniqueIndex("climate_collection_members_variable_unique").on(t.collectionId, t.variableKey),
  index("climate_collection_members_asset_idx").on(t.assetId),
  check("climate_collection_members_ordinal_ck", sql`"ordinal" > 0`),
  check("climate_collection_members_size_ck", sql`"byte_size" >= 0`),
  check("climate_collection_members_hash_ck", sql`"sha256" ~ '^[0-9a-f]{64}$'`),
  check("climate_collection_members_grid_hash_ck", sql`"grid_fingerprint" ~ '^[0-9a-f]{64}$'`),
  check("climate_collection_members_media_ck", sql`"media_kind" = 'image/tiff'`),
  check("climate_collection_members_text_ck", sql`length(btrim("units")) > 0 AND length(btrim("datatype")) > 0`),
  check("climate_collection_members_nodata_ck", sql`jsonb_typeof("nodata_semantics") = 'object'`),
  check("climate_collection_members_validated_ck", sql`"state" <> 'validated' OR ("validation_evidence" IS NOT NULL AND jsonb_typeof("validation_evidence") = 'object' AND "validated_at" IS NOT NULL)`),
  check("climate_collection_members_quarantine_ck", sql`"state" <> 'quarantined' OR "quarantined_at" IS NOT NULL`),
  check("climate_collection_members_deleted_ck", sql`"state" <> 'deleted' OR "deleted_at" IS NOT NULL`),
]);

/** Ordered immutable lineage for derived collections. */
export const climateCollectionParents = pgTable("climate_collection_parents", {
  id: uuid("id").primaryKey().defaultRandom(),
  childCollectionId: uuid("child_collection_id").references(() => climateCollections.id, { onDelete: "restrict" }).notNull(),
  parentOrdinal: integer("parent_ordinal").notNull(),
  parentCollectionId: uuid("parent_collection_id").references(() => climateCollections.id, { onDelete: "restrict" }).notNull(),
  parentManifestSha256: varchar("parent_manifest_sha256", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("climate_collection_parents_ordinal_unique").on(t.childCollectionId, t.parentOrdinal),
  uniqueIndex("climate_collection_parents_parent_unique").on(t.childCollectionId, t.parentCollectionId),
  index("climate_collection_parents_parent_idx").on(t.parentCollectionId),
  check("climate_collection_parents_ordinal_ck", sql`"parent_ordinal" > 0`),
  check("climate_collection_parents_distinct_ck", sql`"child_collection_id" <> "parent_collection_id"`),
  check("climate_collection_parents_hash_ck", sql`"parent_manifest_sha256" ~ '^[0-9a-f]{64}$'`),
]);

/** Sealed collection identity selected by a run; paths never belong here. */
export const climateRunBindings = pgTable("climate_run_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "restrict" }).notNull(),
  role: climateBindingRoleEnum("role").notNull(),
  collectionId: uuid("collection_id").references(() => climateCollections.id, { onDelete: "restrict" }).notNull(),
  manifestSha256: varchar("manifest_sha256", { length: 64 }).notNull(),
  manifestSchemaVersion: integer("manifest_schema_version").notNull(),
  executionProtocolVersion: integer("execution_protocol_version").notNull(),
  orderedVariableKeys: text("ordered_variable_keys").array().notNull(),
  gridFingerprint: varchar("grid_fingerprint", { length: 64 }).notNull(),
  baselineCollectionId: uuid("baseline_collection_id").references(() => climateCollections.id, { onDelete: "restrict" }),
  baselineManifestSha256: varchar("baseline_manifest_sha256", { length: 64 }),
  baselinePeriod: varchar("baseline_period", { length: 64 }).notNull(),
  futurePeriod: varchar("future_period", { length: 64 }),
  ssp: varchar("ssp", { length: 64 }),
  gcm: varchar("gcm", { length: 128 }),
  scenarioLabel: text("scenario_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("climate_run_bindings_role_unique").on(t.runId, t.role),
  index("climate_run_bindings_collection_idx").on(t.collectionId),
  index("climate_run_bindings_baseline_idx").on(t.baselineCollectionId),
  check("climate_run_bindings_manifest_hash_ck", sql`"manifest_sha256" ~ '^[0-9a-f]{64}$'`),
  check("climate_run_bindings_baseline_hash_ck", sql`"baseline_manifest_sha256" IS NULL OR "baseline_manifest_sha256" ~ '^[0-9a-f]{64}$'`),
  check("climate_run_bindings_grid_hash_ck", sql`"grid_fingerprint" ~ '^[0-9a-f]{64}$'`),
  check("climate_run_bindings_versions_ck", sql`"manifest_schema_version" > 0 AND "execution_protocol_version" > 0`),
  check("climate_run_bindings_variables_ck", sql`cardinality("ordered_variable_keys") > 0`),
  check("climate_run_bindings_role_ck", sql`length(btrim("baseline_period")) > 0 AND (("role" = 'current' AND "baseline_collection_id" IS NULL AND "baseline_manifest_sha256" IS NULL AND "future_period" IS NULL AND "ssp" IS NULL AND "gcm" IS NULL AND "scenario_label" IS NULL) OR ("role" IN ('future_primary', 'future_secondary') AND "baseline_collection_id" IS NOT NULL AND "baseline_manifest_sha256" IS NOT NULL AND "future_period" IS NOT NULL AND length(btrim("future_period")) > 0 AND "ssp" IS NOT NULL AND length(btrim("ssp")) > 0 AND "scenario_label" IS NOT NULL AND length(btrim("scenario_label")) > 0))`),
]);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  apiKeys: many(apiKeys),
  settings: many(userSettings),
  species: many(species),
  occurrences: many(occurrences),
  inputAssets: many(inputAssets),
  legacyInputAssetMappings: many(inputAssetLegacyMappings),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  members: many(projectMembers),
  species: many(species),
  runs: many(runs),
  inputAssets: many(inputAssets),
  legacyInputAssetMappings: many(inputAssetLegacyMappings),
}));

export const speciesRelations = relations(species, ({ one, many }) => ({
  project: one(projects, { fields: [species.projectId], references: [projects.id] }),
  user: one(users, { fields: [species.userId], references: [users.id] }),
  occurrences: many(occurrences),
  runs: many(runs),
}));

export const occurrencesRelations = relations(occurrences, ({ one }) => ({
  project: one(projects, { fields: [occurrences.projectId], references: [projects.id] }),
  user: one(users, { fields: [occurrences.userId], references: [users.id] }),
  species: one(species, { fields: [occurrences.speciesId], references: [species.id] }),
}));

export const uploadedFiles = pgTable("uploaded_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  filePath: text("file_path").notNull(),
  originalName: text("original_name").notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull(),
  nRows: integer("n_rows"),
  cleaned: boolean("cleaned").notNull().default(false),
  cleanedFilePath: text("cleaned_file_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_uploaded_files_user").on(t.userId),
  index("idx_uploaded_files_project").on(t.projectId),
]);

export const uploadedFilesRelations = relations(uploadedFiles, ({ one }) => ({
  user: one(users, { fields: [uploadedFiles.userId], references: [users.id] }),
  project: one(projects, { fields: [uploadedFiles.projectId], references: [projects.id] }),
}));

export const inputAssetsRelations = relations(inputAssets, ({ one, many }) => ({
  creator: one(users, { fields: [inputAssets.creatorUserId], references: [users.id] }),
  project: one(projects, { fields: [inputAssets.projectId], references: [projects.id] }),
  parent: one(inputAssets, { fields: [inputAssets.parentAssetId], references: [inputAssets.id], relationName: "input_asset_parent" }),
  children: many(inputAssets, { relationName: "input_asset_parent" }),
  legacyMappings: many(inputAssetLegacyMappings),
}));

export const inputAssetLegacyMappingsRelations = relations(inputAssetLegacyMappings, ({ one }) => ({
  asset: one(inputAssets, { fields: [inputAssetLegacyMappings.inputAssetId], references: [inputAssets.id] }),
  legacyUser: one(users, { fields: [inputAssetLegacyMappings.legacyUserId], references: [users.id] }),
  legacyProject: one(projects, { fields: [inputAssetLegacyMappings.legacyProjectId], references: [projects.id] }),
}));

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  updatedByUser: one(users, { fields: [systemSettings.updatedBy], references: [users.id] }),
}));

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_refresh_tokens_user").on(t.userId),
  index("idx_refresh_tokens_hash").on(t.tokenHash),
  uniqueIndex("refresh_tokens_token_hash_unique").on(t.tokenHash),
]);

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));
