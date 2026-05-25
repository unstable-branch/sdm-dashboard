import { pgTable, uuid, varchar, text, timestamp, integer, doublePrecision, jsonb, boolean, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";

const statusEnum = pgEnum("run_status", ["queued", "running", "completed", "failed", "cancelled"]);
const roleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);
const occurrenceDatasetKindEnum = pgEnum("occurrence_dataset_kind", ["upload", "gbif", "dwca", "cleaned", "registered"]);
const occurrenceDatasetStatusEnum = pgEnum("occurrence_dataset_status", ["pending", "ready", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }),
  role: roleEnum("role").default("viewer").notNull(),
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
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  occurrenceCount: integer("occurrence_count").default(0),
}, (t) => [
  index("idx_species_project").on(t.projectId),
]);

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  batchId: varchar("batch_id", { length: 100 }),
  speciesId: uuid("species_id").references(() => species.id),
  speciesName: varchar("species_name", { length: 255 }),
  modelId: varchar("model_id", { length: 50 }).notNull(),
  status: statusEnum("status").notNull().default("queued"),
  jobId: varchar("job_id", { length: 100 }),
  config: jsonb("config").notNull(),
  metrics: jsonb("metrics"),
  outputFiles: jsonb("output_files"),
  error: text("error"),
  resultPath: text("result_path"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_runs_project").on(t.projectId),
  index("idx_runs_batch").on(t.batchId),
  index("idx_runs_status").on(t.status),
]);

export const occurrences = pgTable("occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  speciesId: uuid("species_id").references(() => species.id).notNull(),
  filePath: text("file_path"),
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
]);

export const occurrenceDatasets = pgTable("occurrence_datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id).notNull(),
  speciesId: uuid("species_id").references(() => species.id),
  // FK for self-reference is enforced in SQL migration to avoid declaration-order issues.
  parentDatasetId: uuid("parent_dataset_id"),
  kind: occurrenceDatasetKindEnum("kind").notNull(),
  status: occurrenceDatasetStatusEnum("status").notNull().default("pending"),
  fileId: text("file_id").notNull(),
  fileName: text("file_name"),
  recordCount: integer("record_count"),
  validCount: integer("valid_count"),
  summary: jsonb("summary").$type<Record<string, unknown> | null>(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_occurrence_datasets_project").on(t.projectId),
  index("idx_occurrence_datasets_species").on(t.speciesId),
  index("idx_occurrence_datasets_parent").on(t.parentDatasetId),
  index("idx_occurrence_datasets_status").on(t.status),
]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  userId: uuid("user_id").references(() => users.id),
  method: varchar("method", { length: 16 }).notNull(),
  route: text("route").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  state: varchar("state", { length: 32 }).notNull(),
  statusCode: integer("status_code"),
  responseBody: jsonb("response_body").$type<Record<string, unknown> | null>(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_idempotency_keys_project").on(t.projectId),
  index("idx_idempotency_keys_user").on(t.userId),
  index("idx_idempotency_keys_expires_at").on(t.expiresAt),
  // Uses COALESCE so nullable project/user still participates in uniqueness.
  uniqueIndex("idx_idempotency_keys_scope_key_unique").on(
    sql`coalesce(${t.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    sql`coalesce(${t.userId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    t.method,
    t.route,
    t.idempotencyKey
  ),
]);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  apiKeys: many(apiKeys),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  members: many(projectMembers),
  species: many(species),
  runs: many(runs),
}));
