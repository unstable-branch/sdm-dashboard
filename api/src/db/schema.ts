import { pgTable, uuid, varchar, text, timestamp, integer, doublePrecision, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";

const statusEnum = pgEnum("run_status", ["queued", "running", "completed", "failed", "cancelled"]);

export const species = pgTable("species", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  occurrenceCount: integer("occurrence_count").default(0),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  speciesId: uuid("species_id").references(() => species.id),
  speciesName: varchar("species_name", { length: 255 }),
  modelId: varchar("model_id", { length: 50 }).notNull(),
  status: statusEnum("status").notNull().default("queued"),
  jobId: varchar("job_id", { length: 100 }),
  config: jsonb("config").notNull(),
  metrics: jsonb("metrics"),
  outputFiles: jsonb("output_files"),
  progressLog: jsonb("progress_log").$type<Array<{ timestamp: string; level: string; message: string }>>(),
  error: text("error"),
  resultPath: text("result_path"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const occurrences = pgTable("occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});
