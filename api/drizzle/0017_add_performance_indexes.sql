CREATE INDEX IF NOT EXISTS "idx_runs_species_name" ON "runs" ("species_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_occurrences_species_project" ON "occurrences" ("species_id", "project_id");
