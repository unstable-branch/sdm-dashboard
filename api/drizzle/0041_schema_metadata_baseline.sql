-- Metadata-only checkpoint. Migration 0040 aligns the replayed database with
-- api/src/db/schema.ts; meta/0041_snapshot.json records that agreed baseline
-- so future Drizzle generation does not infer renames from snapshot 0005.
SELECT 1;
