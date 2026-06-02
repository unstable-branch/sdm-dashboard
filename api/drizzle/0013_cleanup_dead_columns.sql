-- Drop dead columns and tables
-- result_path: unused, outputs now tracked via output_files/provenance
-- cpu_time_ms: consolidated into r_cpu_time_ms (R-level timing)
-- audit_logs: removed (was unused in production)
-- maintenance_log: removed (was unused in production)

ALTER TABLE "runs" DROP COLUMN IF EXISTS "result_path";
ALTER TABLE "runs" DROP COLUMN IF EXISTS "cpu_time_ms";

DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "maintenance_log" CASCADE;
