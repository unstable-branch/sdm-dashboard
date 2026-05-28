"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Ban, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiDelete } from "@/services/api";
import type { RunSummary } from "@/services/types";

interface Run extends RunSummary {
  error: string | null;
}

interface RunHistoryProps {
  onRunSelect?: (runId: string) => void;
  refreshKey?: number;
}

const statusIcons: Record<string, React.ReactNode> = {
  running: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-sdm-success" />,
  failed: <XCircle className="h-4 w-4 text-sdm-danger" />,
  queued: <Clock className="h-4 w-4 text-sdm-muted" />,
  cancelled: <Ban className="h-4 w-4 text-sdm-warning" />,
};

function hasActiveRuns(runs: Run[]): boolean {
  return runs.some((r) => r.status === "queued" || r.status === "running");
}

export function RunHistory({ onRunSelect, refreshKey }: RunHistoryProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"cancel" | "delete" | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const fetchRuns = useCallback(() => {
    apiGet<{ runs: Run[] }>("/api/v1/sdm/runs")
      .then((data) => {
        setRuns(data.runs || []);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns, refreshKey]);

  useEffect(() => {
    if (!hasActiveRuns(runsRef.current)) return;

    const interval = setInterval(() => { if (!document.hidden) fetchRuns(); }, 10000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const activeCount = useMemo(() => runs.filter((r) => r.status === "queued" || r.status === "running").length, [runs]);
  const clearableCount = useMemo(() => runs.filter((r) => ["completed", "failed", "cancelled"].includes(r.status)).length, [runs]);

  const handleCancel = async (runId: string) => {
    setActionRunId(runId);
    setActionType("cancel");
  };

  const handleDelete = async (runId: string) => {
    setActionRunId(runId);
    setActionType("delete");
  };

  const confirmAction = async () => {
    if (!actionRunId || !actionType) return;

    try {
      if (actionType === "cancel") {
        await apiPost(`/api/v1/sdm/cancel/${actionRunId}`);
      } else {
        await apiDelete(`/api/v1/sdm/runs/delete/${actionRunId}`);
      }
      fetchRuns();
    } catch {
    } finally {
      setActionRunId(null);
      setActionType(null);
    }
  };

  const handleClearAll = () => {
    if (clearableCount === 0) return;
    setShowClearConfirm(true);
  };

  const confirmClearAll = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      await apiPost("/api/v1/sdm/runs/clear-all", { includeCompleted: true });
      fetchRuns();
    } catch {
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading run history...</div>;
  }

  if (error && runs.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-sdm-danger">{error}</div>
        <button
          onClick={fetchRuns}
          className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (runs.length === 0) {
    return <div className="text-sm text-sdm-muted">No runs yet. Configure and run your first model above.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-sdm-heading">Recent runs</h3>
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sdm-accent/10 px-2 py-0.5 text-xs font-medium text-sdm-accent">
              <Loader2 className="h-3 w-3 animate-spin" />
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {clearableCount > 0 && (
            <button
              onClick={handleClearAll}
              disabled={clearing}
              className="inline-flex items-center gap-1 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-muted hover:text-sdm-text disabled:opacity-50"
              title="Clear all completed/failed/cancelled runs"
            >
              <Trash2 className="h-3 w-3" />
              Clear all
            </button>
          )}
          {error && (
            <button
              onClick={fetchRuns}
              className="inline-flex items-center gap-1 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-muted hover:text-sdm-text"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="text-xs text-sdm-warning">Showing cached data — connection issue</div>
      )}
      {showClearConfirm && (
        <div className="rounded-md border border-sdm-danger/30 bg-sdm-danger/5 px-3 py-2 flex items-center justify-between">
          <p className="text-xs text-sdm-danger">Clear {clearableCount} run{clearableCount === 1 ? "" : "s"} and delete all output files? This cannot be undone.</p>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <button
              onClick={confirmClearAll}
              disabled={clearing}
              className="rounded bg-sdm-danger px-2 py-1 text-xs text-white hover:bg-sdm-danger disabled:opacity-50"
            >
              {clearing ? "Clearing..." : "Yes, clear"}
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="rounded border border-sdm-border px-2 py-1 text-xs text-sdm-text hover:bg-sdm-surface-soft"
            >
              No
            </button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {runs.slice(0, 10).map((run) => {
          const isCancellable = run.status === "queued" || run.status === "running";
          const isDeletable = ["completed", "failed", "cancelled"].includes(run.status);
          const isActioning = actionRunId === run.id;

          return (
            <div
              key={run.id}
              className={cn(
                "rounded-lg border border-sdm-border bg-sdm-surface p-3 transition-colors",
                run.status === "running" && "border-sdm-accent/30"
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onRunSelect?.(run.id)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  {statusIcons[run.status] || <Clock className="h-4 w-4 text-sdm-muted" />}
                  <span className="text-sm font-medium text-sdm-text truncate">{run.species}</span>
                </button>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    run.status === "completed" ? "bg-sdm-success/10 text-sdm-success" :
                    run.status === "failed" ? "bg-sdm-danger/10 text-sdm-danger" :
                    run.status === "cancelled" ? "bg-sdm-warning/10 text-sdm-warning" :
                    run.status === "running" ? "bg-sdm-accent/10 text-sdm-accent" :
                    "bg-sdm-muted/10 text-sdm-muted"
                  )}>
                    {run.status}
                  </span>
                  {isCancellable && (
                    <button
                      onClick={() => handleCancel(run.id)}
                      disabled={isActioning}
                      className="p-1 rounded hover:bg-sdm-danger/10 text-sdm-muted hover:text-sdm-danger disabled:opacity-50"
                      aria-label="Cancel run"
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {isDeletable && (
                    <button
                      onClick={() => handleDelete(run.id)}
                      disabled={isActioning}
                      className="p-1 rounded hover:bg-sdm-danger/10 text-sdm-muted hover:text-sdm-danger disabled:opacity-50"
                      aria-label="Delete run"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-sdm-muted">
                <span>{run.model_id}</span>
                <span>·</span>
                <span>{new Date(run.started_at).toLocaleString()}</span>
                {run.metrics && (
                  <>
                    <span>·</span>
                    <span>AUC: {(run.metrics as Record<string, unknown> | undefined)?.auc_mean ? Number((run.metrics as Record<string, unknown>)?.auc_mean).toFixed(3) : "—"}</span>
                  </>
                )}
              </div>
              {run.status === "failed" && run.error && (
                <div className="mt-2 text-xs text-sdm-danger break-words">{run.error}</div>
              )}

              {isActioning && actionType === "cancel" && (
                <div className="mt-2 rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-3 py-2 flex items-center justify-between">
                  <p className="text-xs text-sdm-warning">Cancel this run? Partial results will be lost.</p>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <button
                      onClick={confirmAction}
                      className="rounded bg-sdm-danger px-2 py-1 text-xs text-white hover:bg-sdm-danger"
                    >
                      Yes, cancel
                    </button>
                    <button
                      onClick={() => { setActionRunId(null); setActionType(null); }}
                      className="rounded border border-sdm-border px-2 py-1 text-xs text-sdm-text hover:bg-sdm-surface-soft"
                    >
                      No
                    </button>
                  </div>
                </div>
              )}

              {isActioning && actionType === "delete" && (
                <div className="mt-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 px-3 py-2 flex items-center justify-between">
                  <p className="text-xs text-sdm-danger">Delete this run and all output files? This cannot be undone.</p>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <button
                      onClick={confirmAction}
                      className="rounded bg-sdm-danger px-2 py-1 text-xs text-white hover:bg-sdm-danger"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => { setActionRunId(null); setActionType(null); }}
                      className="rounded border border-sdm-border px-2 py-1 text-xs text-sdm-text hover:bg-sdm-surface-soft"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
