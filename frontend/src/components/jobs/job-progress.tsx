"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useJobSSE } from "@/hooks/use-job-sse";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock, X, Ban } from "lucide-react";
import { apiPost, apiGet } from "@/services/api";
import { extractStage, extractProgressPercent } from "@sdm/shared";

interface JobProgressProps {
  jobId: string | null;
  onComplete?: (result: Record<string, unknown>) => void;
  onDismiss?: () => void;
  onCancel?: () => void;
  startTime?: string;
  completedActions?: React.ReactNode;
}

const stateIcons: Record<string, React.ReactNode> = {
  waiting: <Clock className="h-4 w-4 text-sdm-muted" />,
  active: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  loading: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  pending: <Clock className="h-4 w-4 text-sdm-muted" />,
  completed: <CheckCircle2 className="h-4 w-4 text-sdm-success" />,
  failed: <XCircle className="h-4 w-4 text-sdm-danger" />,
  delayed: <Clock className="h-4 w-4 text-sdm-warning" />,
  paused: <Clock className="h-4 w-4 text-sdm-muted" />,
  cancelled: <Ban className="h-4 w-4 text-sdm-warning" />,
};

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function JobProgress({ jobId, onComplete, onDismiss, onCancel, startTime, completedActions }: JobProgressProps) {
  const { getJob, connected } = useJobSSE(!!jobId);
  const [dismissed, setDismissed] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling fallback — fetches status directly when SSE has no matching job
  const [polledJob, setPolledJob] = useState<{
    state: string;
    progress: number;
    logs: string[];
    currentStage?: string | null;
    failedReason?: string;
    error_code?: string | null;
    error_hint?: string | null;
    result?: Record<string, unknown>;
    progressJson?: unknown;
    _receivedAt: number;
  } | null>(null);

  const job = jobId ? getJob(jobId) : null;
  const isSyntheticPlaceholder =
    job != null && Array.isArray(job.logs) && job.logs.length === 1 && job.logs[0] === "Model run in progress...";

  // Continuous polling fallback — always active, takes over when SSE has only synthetic placeholder
  const lastPollErrorRef = useRef(0);
  const pollErrorThreshold = 6;

  useEffect(() => {
    if (!jobId) return;
    if (job && !isSyntheticPlaceholder) {
      if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") {
        setPolledJob(null); // SSE is authoritative for terminal states — clear polling
        return;
      }
      // SSE has real data for active job — skip polling
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await apiGet<Record<string, unknown>>(`/api/v1/sdm/status/${jobId}`);
        if (cancelled) return;
        lastPollErrorRef.current = 0;
        const plumberStatus = (status.status as string) || "unknown";
        const logs = Array.isArray(status.progress_log) ? status.progress_log : [];
        let progress = 0;
        for (let i = logs.length - 1; i >= 0; i--) {
          const p = extractProgressPercent(logs[i]);
          if (p !== undefined) { progress = p; break; }
        }
        setPolledJob({
          state: plumberStatus,
          progress,
          logs,
          currentStage: (status.last_stage as string) ?? null,
          failedReason: status.error as string | undefined,
          error_code: status.error_code as string | undefined,
          error_hint: status.error_hint as string | undefined,
          result: plumberStatus === "completed" ? (status as Record<string, unknown>) : undefined,
          progressJson: (status as any).progress_json ?? undefined,
          _receivedAt: Date.now(),
        });
      } catch (err) {
        lastPollErrorRef.current++;
        if (lastPollErrorRef.current > pollErrorThreshold) {
          console.error("[JobProgress] Polling failed repeatedly:", err instanceof Error ? err.message : err);
          lastPollErrorRef.current = 0; // Reset to avoid spamming
        }
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [jobId, job, isSyntheticPlaceholder]);

  // Use SSE job when it has real data, otherwise fall back to polling
  // Merge progressJson from polling when SSE lacks it (queue worker emits may not include it)
  const effectiveJob = (job && !isSyntheticPlaceholder)
    ? { ...job, progressJson: job.progressJson ?? (polledJob?.progressJson ?? undefined) }
    : polledJob;

  useEffect(() => {
    if (!startTime && !effectiveJob) return;
    if (effectiveJob && (effectiveJob.state === "completed" || effectiveJob.state === "failed" || effectiveJob.state === "cancelled")) {
      const startMs = startTime ? new Date(startTime).getTime() : Date.now();
      setElapsed(Date.now() - startMs);
      return;
    }
    const startMs = startTime ? new Date(startTime).getTime() : Date.now();
    const tick = () => setElapsed(Date.now() - startMs);
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startTime, effectiveJob?.state]);

  useEffect(() => {
    if (effectiveJob?.state === "completed" && effectiveJob?.result) {
      onComplete?.(effectiveJob.result);
    }
  }, [effectiveJob?.state, effectiveJob?.result, onComplete]);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    setCancelling(true);
    try {
      await apiPost(`/api/v1/sdm/cancel/${jobId}`);
      setShowCancelConfirm(false);
      onCancel?.();
    } catch (err) {
      console.error("[cancel] Failed to cancel job:", err);
      setShowCancelConfirm(false);
    } finally {
      setCancelling(false);
    }
  }, [jobId, onCancel]);

  if (!jobId || dismissed) {
    return null;
  }

  // Show connecting state while waiting for first SSE event (or poll data)
  if (!effectiveJob) {
    return (
      <div className={cn("rounded-lg border bg-sdm-surface p-4 space-y-3")}>
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />
          <span className="text-sm text-sdm-text">Model run submitted — waiting for progress...</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-sdm-muted">
          <span>{formatElapsed(elapsed)}</span>
          <span>{connected ? "Connected" : !polledJob ? "Connecting..." : "Polling"}</span>
        </div>
      </div>
    );
  }

  const isTerminal = effectiveJob.state === "completed" || effectiveJob.state === "failed" || effectiveJob.state === "cancelled";
  const lastLog = effectiveJob.logs && effectiveJob.logs.length > 0 ? effectiveJob.logs[effectiveJob.logs.length - 1] : null;
  const currentStage = extractStage(lastLog || "");

  return (
    <div className={cn(
      "rounded-lg border bg-sdm-surface p-4 space-y-3",
      effectiveJob.state === "completed" && "border-sdm-success/30 bg-sdm-success/5",
      effectiveJob.state === "failed" && "border-sdm-danger/30 bg-sdm-danger/5",
      effectiveJob.state === "cancelled" && "border-sdm-warning/30 bg-sdm-warning/5",
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {stateIcons[effectiveJob.state] || <XCircle className="h-4 w-4 text-sdm-muted" />}
          <span className="text-sm font-medium text-sdm-text capitalize">
            {effectiveJob.state}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-sdm-muted tabular-nums">
            {formatElapsed(elapsed)}
          </span>
          <span className="text-xs text-sdm-muted">
            {connected ? "Live" : job !== null ? "Disconnected" : "Polling"}
          </span>
          {!isTerminal && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={cancelling}
              className="inline-flex items-center gap-1 rounded border border-sdm-danger/30 bg-sdm-danger/10 px-2 py-1 text-xs text-sdm-danger hover:bg-sdm-danger/20 disabled:opacity-50"
            >
              <Ban className="h-3 w-3" />
              Cancel
            </button>
          )}
          {isTerminal && onDismiss && (
            <button
              onClick={() => { setDismissed(true); onDismiss?.(); }}
              className="p-1 rounded hover:bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {currentStage && effectiveJob.state === "active" && (
        <div className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-3 py-2">
          <p className="text-xs font-medium text-sdm-text">{currentStage}</p>
        </div>
      )}

      {(effectiveJob as any).progressJson && Array.isArray((effectiveJob as any).progressJson) && (
        <div className="flex flex-wrap gap-1.5">
          {(effectiveJob as any).progressJson.map((entry: any, i: number) => (
            <span key={i} className={`text-xs rounded px-1.5 py-0.5 ${
              entry.stage === "unknown" ? "bg-sdm-surface text-sdm-muted" :
              i === ((effectiveJob as any).progressJson?.length ?? 0) - 1
                ? "bg-sdm-accent/15 text-sdm-accent animate-pulse"
                : "bg-sdm-accent/10 text-sdm-accent"
            }`}>
              {entry.stage}: {Math.round((entry.percent || 0) * 100)}%
            </span>
          ))}
        </div>
      )}

      {showCancelConfirm && (
        <div className="rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-3 py-2 flex items-center justify-between">
          <p className="text-xs text-sdm-warning">Cancel this run? Partial results will be lost.</p>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="rounded bg-sdm-danger px-2 py-1 text-xs text-white hover:bg-sdm-danger disabled:opacity-50"
            >
              {cancelling ? "Cancelling..." : "Yes, cancel"}
            </button>
            <button
              onClick={() => setShowCancelConfirm(false)}
              className="rounded border border-sdm-border px-2 py-1 text-xs text-sdm-text hover:bg-sdm-surface-soft"
            >
              No
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-sdm-muted">Progress</span>
          <span className="text-sdm-text font-medium">{Math.round(effectiveJob.progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-sdm-surface-soft overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              effectiveJob.state === "failed"
                ? "bg-sdm-danger"
                : effectiveJob.state === "completed"
                ? "bg-sdm-success"
                : effectiveJob.state === "cancelled"
                ? "bg-sdm-warning"
                : "bg-sdm-accent"
            )}
            style={{ width: `${effectiveJob.progress}%` }}
          />
        </div>
      </div>

      {effectiveJob.logs && effectiveJob.logs.length > 0 ? (
        <div className={cn(
          "rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted overflow-y-auto",
          effectiveJob.state === "failed" ? "max-h-64" : "max-h-24"
        )}>
          {effectiveJob.logs.slice(-50).map((log, i) => (
            <div key={i} className="break-words whitespace-pre-wrap">
              {log}
            </div>
          ))}
          {effectiveJob.logs.length > 50 && (
            <div className="text-xs text-sdm-muted italic mt-1">...{effectiveJob.logs.length - 50} earlier lines hidden</div>
          )}
        </div>
      ) : (
        <div className="text-xs text-sdm-muted italic">No log output yet</div>
      )}

      {effectiveJob.state === "failed" && (
        <div className="space-y-1">
          {effectiveJob.failedReason && (
            <div className="text-sm text-sdm-danger break-words">
              <span className="font-semibold">Error: </span>{effectiveJob.failedReason}
            </div>
          )}
          {effectiveJob.error_code && (
            <div className="text-xs text-sdm-muted font-mono">
              Code: {effectiveJob.error_code}
            </div>
          )}
          {effectiveJob.error_hint && (
            <div className="text-xs text-sdm-warning">
              Hint: {effectiveJob.error_hint}
            </div>
          )}
        </div>
      )}

      {effectiveJob.state === "completed" && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-green-500">
            Job completed in {formatElapsed(elapsed)}.
          </span>
          {completedActions}
        </div>
      )}

      {effectiveJob.state === "cancelled" && (
        <div className="text-sm text-sdm-warning">
          Run cancelled after {formatElapsed(elapsed)}.
        </div>
      )}
    </div>
  );
}
