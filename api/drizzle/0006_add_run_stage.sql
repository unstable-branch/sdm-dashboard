-- Track last known processing stage for model runs
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "last_stage" text;
