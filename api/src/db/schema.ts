import { pgTable, uuid, varchar, text, timestamp, integer, smallint, bigint, doublePrecision, jsonb, boolean, pgEnum, index, uniqueIndex, check, AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

const statusEnum = pgEnum("run_status", ["queued", "running", "completed", "failed", "cancelled"]);
const roleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);
export const inputAssetScopeEnum = pgEnum("input_asset_scope", ["private", "project", "system"]);
export const inputAssetKindEnum = pgEnum("input_asset_kind", ["raw_occurrence", "cleaned_occurrence", "custom_boundary", "target_group"]);
export const inputAssetStateEnum = pgEnum("input_asset_state", ["ready", "deleted", "quarantined"]);

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
