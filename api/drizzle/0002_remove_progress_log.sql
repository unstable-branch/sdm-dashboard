-- Remove unused progress_log column from runs table
-- This column was never populated - progress logs come from Plumber's progress.log file

ALTER TABLE "runs" DROP COLUMN IF EXISTS "progress_log";