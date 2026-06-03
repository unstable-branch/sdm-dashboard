"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Ban, Trash2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { apiGet, apiPost, apiDelete } from "@/services/api";
import { useJobSSE } from "@/hooks/use-job-sse";
import type { RunSummary } from "@/services/types";
import type { PlumberJobLogs } from "@sdm/shared";

interface RunHistoryProps {
  onRunSelect?: (runId: string) => void;
  refreshKey?: number;
  activeJobId?: string | null;
}

const statusIcons: Record<string, React.ReactNode> = {
  running: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  loading: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-sdm-success" />,
  failed: <XCircle className="h-4 w-4 text-sdm-danger" />,
  queued: <Clock className="h-4 w-4 text-sdm-muted" />,
  pending: <Clock className="h-4 w-4 text-sdm-muted" />,
  cancelled: <Ban className="h-4 w-4 text-sdm-warning" />,
};

function hasActiveRuns(runs: RunSummary[]): boolean {
  return runs.some((r) => ["queued", "running", "loading", "pending", "active"].includes(r.status));
}

export function RunHistory({ onRunSelect, refreshKey, activeJobId }: RunHistoryProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"cancel" | "delete" | null>(null);
    const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [displayLimit, setDisplayLimit] = useState(10);
  const [expandedLogRunId, setExpandedLogRunId] = useState<string | null>(null);
  const [logData, setLogData] = useState<Record<string, PlumberJobLogs>>({});
  const [logErrors, setLogErrors] = useState<Record<string, string>>({});
  const [logLoading, setLogLoading] = useState(false);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  // SSE-driven live updates — reduce polling frequency when connected
  const { jobs: sseJobs, connected: sseConnected, version: sseVersion } = useJobSSE(true);
  const prevSseVersion = useRef(0);
  useEffect(() => {
    if (sseVersion === prevSseVersion.current) return;
    prevSseVersion.current = sseVersion;
    if (sseJobs.size === 0) return;
    setRuns(prev => {
      let changed = false;
      const existingIds = new Set(prev.map(r => r.id));
      const next = prev.map(r => {
        const event = sseJobs.get(r.id);
        if (!event || event.state === r.status) return r;
        const mappedState = event.state === "active" ? "running" : event.state;
        if (mappedState === r.status) return r;
        changed = true;
        return { ...r, status: mappedState, error: event.failedReason ?? r.error };
      });
      // Add new runs from SSE that aren't yet in the list
      for (const [id, event] of sseJobs) {
        if (!existingIds.has(id) && (event.type === "sdm_model" || event.type === "model")) {
          next.push({
            id,
            species: event.id,
            model_id: "",
            status: event.state === "active" ? "running" : event.state as any,
            started_at: "",
            completed_at: null,
            metrics: null,
            output_files: null,
            error: event.failedReason ?? null,
            error_code: null,
            error_hint: event.error_hint ?? null,
          });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sseVersion, sseJobs]);

  const fetchRuns = useCallback(() => {
    apiGet<{ runs: RunSummary[] }>("/api/v1/sdm/runs")
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
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (hasActiveRuns(runsRef.current)) fetchRuns();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  useEffect(() => {
    if (!runsRef.current.some((r) => r.status === "queued")) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [runs]);

  const activeCount = useMemo(() => runs.filter((r) => ["queued", "running", "loading", "pending"].includes(r.status)).length, [runs]);
  const clearableCount = useMemo(() => runs.filter((r) => ["completed", "failed", "cancelled"].includes(r.status)).length, [runs]);
  const queuedRuns = useMemo(() => runs.filter((r) => r.id !== activeJobId && ["queued", "pending", "loading"].includes(r.status)), [runs, activeJobId]);
  const otherRuns = useMemo(() => runs.filter((r) => r.id !== activeJobId && !["queued", "pending", "loading"].includes(r.status)), [runs, activeJobId]);

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
    } catch (err) {
      console.error("[run-history] Action failed:", err instanceof Error ? err.message : err);
      setError(actionType === "cancel" ? "Failed to cancel run" : "Failed to delete run");
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

  const toggleLogs = async (runId: string) => {
    if (expandedLogRunId === runId) {
      setExpandedLogRunId(null);
      return;
    }
    setExpandedLogRunId(runId);
    if (logData[runId]) return;
    setLogLoading(true);
    setLogErrors(prev => { const next = { ...prev }; delete next[runId]; return next; });
    try {
      const data = await apiGet<PlumberJobLogs>(`/api/v1/sdm/logs/${runId}`);
      setLogData(prev => ({ ...prev, [runId]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch logs";
      setLogErrors(prev => ({ ...prev, [runId]: msg }));
    } finally {
      setLogLoading(false);
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
      {queuedRuns.length > 0 && (
        <div className="space-y-2">
          {queuedRuns.slice(0, 3).map((run) => {
            const startedMs = run.started_at ? new Date(run.started_at).getTime() : NaN;
            const elapsed = Number.isFinite(startedMs) ? Math.floor((now - startedMs) / 1000) : 0;
            return (
              <div
                key={run.id}
                className="rounded-lg border-2 border-dashed border-sdm-accent/30 bg-sdm-accent/[0.03] p-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="relative mt-0.5 shrink-0">
                    <Loader2 className="h-5 w-5 text-sdm-accent animate-spin" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-sdm-text">
                      Model run submitted
                      <span className="text-sdm-muted font-normal"> — waiting for progress...</span>
                    </p>
                    <p className="text-xs text-sdm-muted mt-1">
                      {run.species} · {run.model_id}
                      <span className="inline-block ml-2 tabular-nums text-sdm-accent/70">
                        {elapsed < 60
                          ? `${elapsed}s`
                          : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
                      </span>
                    </p>
                  </div>
                  {run.id !== activeJobId && (
                    <button
                      onClick={async () => {
                        if (!window.confirm("Cancel this run?")) return;
                        try {
                          await apiPost(`/api/v1/sdm/cancel/${run.id}`);
                          fetchRuns();
                        } catch { /* best-effort */ }
                      }}
                      className="shrink-0 rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-muted hover:text-sdm-danger hover:border-sdm-danger/30 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        {otherRuns.slice(0, displayLimit).map((run) => {
          const isCancellable = ["queued", "running", "loading", "pending"].includes(run.status);
          const isDeletable = ["completed", "failed", "cancelled"].includes(run.status);
          const isActioning = actionRunId === run.id;

          return (
            <div
              key={run.id}
              className={cn(
                "rounded-lg border border-sdm-border bg-sdm-surface p-3 transition-colors",
                (run.status === "running" || run.status === "loading") && "border-sdm-accent/30"
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
                    run.status === "running" || run.status === "loading" ? "bg-sdm-accent/10 text-sdm-accent" :
                    run.status === "pending" ? "bg-sdm-muted/10 text-sdm-muted" :
                    "bg-sdm-muted/10 text-sdm-muted"
                  )}>
                    {run.status}
                  </span>
                  {isCancellable && run.id !== activeJobId && (
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
              {run.status === "failed" && (
                <div className="mt-2">
                  <div className="flex items-start gap-1">
                    <div className="flex-1 min-w-0">
                      {run.error && (
                        <span className="text-xs text-sdm-danger break-words">{run.error}</span>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {run.error_code && (
                          <span className="inline-flex items-center rounded bg-sdm-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-sdm-danger uppercase tracking-wide">
                            {run.error_code}
                          </span>
                        )}
                        {run.error_hint && (
                          <span className="text-[10px] text-sdm-muted italic">{run.error_hint}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleLogs(run.id)}
                      className="shrink-0 mt-0.5 text-sdm-muted hover:text-sdm-accent transition-colors"
                    >
                      {expandedLogRunId === run.id ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  {expandedLogRunId === run.id && (
                    <div className="mt-2 rounded-md border border-sdm-danger/20 bg-sdm-danger/[0.03] p-3">
                      {logLoading ? (
                        <div className="flex items-center gap-2 text-xs text-sdm-muted">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading logs...
                        </div>
                      ) : logErrors[run.id] ? (
                        <div className="flex items-center gap-2 text-xs text-sdm-danger">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Failed to load logs: {logErrors[run.id]}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {logData[run.id]?.stderr ? (
                            <details open>
                              <summary className="text-xs font-medium text-sdm-muted cursor-pointer hover:text-sdm-text">stderr</summary>
                              <pre className="mt-1 text-xs text-sdm-text leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                                {logData[run.id].stderr}
                              </pre>
                            </details>
                          ) : null}
                          {logData[run.id]?.stdout ? (
                            <details>
                              <summary className="text-xs font-medium text-sdm-muted cursor-pointer hover:text-sdm-text">stdout</summary>
                              <pre className="mt-1 text-xs text-sdm-text leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                                {logData[run.id].stdout}
                              </pre>
                            </details>
                          ) : null}
                          {logData[run.id]?.progress_log ? (
                            <details>
                              <summary className="text-xs font-medium text-sdm-muted cursor-pointer hover:text-sdm-text">progress log</summary>
                              <pre className="mt-1 text-xs text-sdm-text leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                                {logData[run.id].progress_log}
                              </pre>
                            </details>
                          ) : null}
                          {!logData[run.id]?.stderr && !logData[run.id]?.stdout && !logData[run.id]?.progress_log && (
                            <div className="flex items-center gap-2 text-xs text-sdm-muted">
                              <AlertTriangle className="h-3 w-3" />
                              No log content available
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
      {otherRuns.length > displayLimit && (
        <button
          onClick={() => setDisplayLimit(prev => prev + 10)}
          className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-xs text-sdm-muted hover:text-sdm-accent hover:border-sdm-accent/30 transition-colors"
        >
          Load {Math.min(10, otherRuns.length - displayLimit)} more ({otherRuns.length - displayLimit} remaining)
        </button>
      )}
      </div>
    </div>
  );
}
