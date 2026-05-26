ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "r_cpu_time_ms" integer;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "r_peak_memory_mb" integer;
