-- Reconcile pre-fix orphan rows created during Sep 3-5 2026.
-- These runs were left in status='running' with job_id=NULL because the
-- API queue catch block (queue.ts) wrote rCpuTimeMs without Math.round(),
-- causing PostgreSQL to reject fractional ms values and the catch block
-- itself to throw, leaving the run stranded until the 10-minute orphan
-- check fired (WORKER_ORPHAN).
-- With the fix deployed, these rows can be safely transitioned to failed.

UPDATE runs
SET
  status = 'failed',
  error = COALESCE(error, 'Pre-fix WORKER_ORPHAN — rCpuTimeMs integer parse failure (Group Q)'),
  error_code = COALESCE(error_code, 'WORKER_ORPHAN'),
  completed_at = COALESCE(completed_at, NOW())
WHERE
  status = 'running'
  AND job_id IS NULL
  AND bullmq_id IS NOT NULL
  AND started_at < NOW() - INTERVAL '10 minutes';
