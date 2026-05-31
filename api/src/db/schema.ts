import { pgTable, uuid, varchar, text, timestamp, integer, bigint, doublePrecision, jsonb, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const statusEnum = pgEnum("run_status", ["queued", "running", "completed", "failed", "cancelled"]);
const roleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);

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
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).default(0),
  lastLoginAt: timestamp("last_login_at"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  parentRunId: uuid("parent_run_id"),
  provenance: jsonb("provenance"),
  peakMemoryMb: integer("peak_memory_mb"),
  rCpuTimeMs: integer("r_cpu_time_ms"),
  rPeakMemoryMb: integer("r_peak_memory_mb"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  lastStage: text("last_stage"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_runs_project").on(t.projectId),
  index("idx_runs_status").on(t.status),
  index("idx_runs_pipeline").on(t.pipelineRunId),
  index("idx_runs_parent").on(t.parentRunId),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_user_settings_user_id").on(t.userId),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_uploads_user_id").on(t.userId),
  index("idx_uploads_created").on(t.createdAt),
]);

export const maintenanceLog = pgTable("maintenance_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_maintenance_log_type").on(t.type),
  index("idx_maintenance_log_created").on(t.createdAt),
]);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  apiKeys: many(apiKeys),
  settings: many(userSettings),
  species: many(species),
  occurrences: many(occurrences),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  members: many(projectMembers),
  species: many(species),
  runs: many(runs),
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

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  updatedByUser: one(users, { fields: [systemSettings.updatedBy], references: [users.id] }),
}));
