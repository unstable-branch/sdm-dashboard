-- Enforce uniqueness of (project_id, name) on species to eliminate
-- TOCTOU race between SELECT and INSERT in the async SDM run flow.
-- Two concurrent POST /api/v1/sdm/run requests with the same species name
-- would previously try to INSERT the same (project_id, name) pair, causing
-- either a silent duplicate row or a caught-but-swallowed error.
-- With this constraint the second INSERT fails with a unique-violation
-- which is handled gracefully by ON CONFLICT DO NOTHING in the API.

ALTER TABLE "species" ADD CONSTRAINT "species_project_name_unique"
  UNIQUE ("project_id", "name");
