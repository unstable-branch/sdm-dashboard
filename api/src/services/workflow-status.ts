export const WORKFLOW_STATUS_SCHEMA = "workflow_status.v1";

export type WorkflowLifecycleStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";

export type WorkflowStatusRun = {
  id: string;
  status: string;
  error?: string | null;
};

export type WorkflowStatusLayer = {
  status_schema: typeof WORKFLOW_STATUS_SCHEMA;
  run_id: string;
  workflow_id: string;
  status: WorkflowLifecycleStatus;
  terminal: boolean;
  progress_percent: number | null;
  poll_after_ms: number | null;
  error: string | null;
};

const ACTIVE_POLL_AFTER_MS = 2000;

const TERMINAL_STATUSES = new Set<WorkflowLifecycleStatus>(["completed", "failed", "cancelled"]);

export function buildWorkflowStatusLayer(
  run: WorkflowStatusRun,
  overrides: { status?: unknown; error?: unknown; progress?: unknown; progress_percent?: unknown } = {},
): WorkflowStatusLayer {
  const statusValue = Object.prototype.hasOwnProperty.call(overrides, "status") ? overrides.status : run.status;
  const errorValue = Object.prototype.hasOwnProperty.call(overrides, "error") ? overrides.error : run.error;
  const progressValue = Object.prototype.hasOwnProperty.call(overrides, "progress_percent") && overrides.progress_percent !== undefined
    ? overrides.progress_percent
    : overrides.progress;
  const status = normalizeWorkflowStatus(statusValue);
  const terminal = TERMINAL_STATUSES.has(status);

  return {
    status_schema: WORKFLOW_STATUS_SCHEMA,
    run_id: run.id,
    workflow_id: run.id,
    status,
    terminal,
    progress_percent: normalizeProgressPercent(progressValue, status),
    poll_after_ms: terminal ? null : ACTIVE_POLL_AFTER_MS,
    error: normalizeWorkflowError(errorValue),
  };
}

export function normalizeWorkflowStatus(value: unknown): WorkflowLifecycleStatus {
  switch (value) {
    case "queued":
    case "running":
    case "completed":
    case "failed":
    case "cancelled":
      return value;
    default:
      return "unknown";
  }
}

function normalizeProgressPercent(value: unknown, status: WorkflowLifecycleStatus): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }
  if (status === "completed") {
    return 100;
  }
  return null;
}

function normalizeWorkflowError(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
