import { pgTable, uuid, varchar, text, timestamp, integer, doublePrecision, jsonb, boolean } from "drizzle-orm/pg-core";

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
  modelId: varchar("model_id", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  config: jsonb("config").notNull(),
  metrics: jsonb("metrics"),
  resultPath: text("result_path"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const occurrences = pgTable("occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  speciesId: uuid("species_id").references(() => species.id),
  longitude: doublePrecision("longitude").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  source: varchar("source", { length: 255 }),
  flagged: boolean("flagged").default(false),
  flagReason: varchar("flag_reason", { length: 255 }),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
