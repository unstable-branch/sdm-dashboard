"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useJobSSE } from "@/hooks/use-job-sse";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock, X, Ban } from "lucide-react";
import { apiPost } from "@/services/api";
import { extractStage } from "@sdm/shared";

interface JobProgressProps {
  jobId: string | null;
  onComplete?: (result: Record<string, unknown>) => void;
  onDismiss?: () => void;
  onCancel?: () => void;
  startTime?: string;
}

const stateIcons = {
  waiting: <Clock className="h-4 w-4 text-sdm-muted" />,
  active: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  delayed: <Clock className="h-4 w-4 text-sdm-warning" />,
  paused: <Clock className="h-4 w-4 text-sdm-muted" />,
  cancelled: <Ban className="h-4 w-4 text-amber-500" />,
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

export function JobProgress({ jobId, onComplete, onDismiss, onCancel, startTime }: JobProgressProps) {
  const { getJob, connected } = useJobSSE(!!jobId);
  const [dismissed, setDismissed] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const job = jobId ? getJob(jobId) : null;

  useEffect(() => {
    if (!startTime && !job) return;
    const startMs = startTime ? new Date(startTime).getTime() : Date.now();
    const tick = () => setElapsed(Date.now() - startMs);
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startTime, job?.state]);

  useEffect(() => {
    if (job?.state === "completed" && job?.result) {
      onComplete?.(job.result);
    }
  }, [job?.state, job?.result, onComplete]);

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

  if (!jobId || !job || dismissed) {
    return null;
  }

  const isTerminal = job.state === "completed" || job.state === "failed" || job.state === "cancelled";
  const lastLog = job.logs && job.logs.length > 0 ? job.logs[job.logs.length - 1] : null;
  const currentStage = extractStage(lastLog || "");

  return (
    <div className={cn(
      "rounded-lg border bg-sdm-surface p-4 space-y-3",
      job.state === "completed" && "border-green-500/30 bg-green-500/5",
      job.state === "failed" && "border-red-500/30 bg-red-500/5",
      job.state === "cancelled" && "border-amber-500/30 bg-amber-500/5",
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {stateIcons[job.state] || <XCircle className="h-4 w-4 text-sdm-muted" />}
          <span className="text-sm font-medium text-sdm-text capitalize">
            {job.state}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-sdm-muted tabular-nums">
            {formatElapsed(elapsed)}
          </span>
          <span className="text-xs text-sdm-muted">
            {connected ? "Live" : "Disconnected"}
          </span>
          {job.state === "active" && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={cancelling}
              className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
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

      {currentStage && job.state === "active" && (
        <div className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-3 py-2">
          <p className="text-xs font-medium text-sdm-text">{currentStage}</p>
        </div>
      )}

      {showCancelConfirm && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex items-center justify-between">
          <p className="text-xs text-sdm-warning">Cancel this run? Partial results will be lost.</p>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-50"
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
          <span className="text-sdm-text font-medium">{Math.round(job.progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-sdm-surface-soft overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              job.state === "failed"
                ? "bg-red-500"
                : job.state === "completed"
                ? "bg-green-500"
                : job.state === "cancelled"
                ? "bg-amber-500"
                : "bg-sdm-accent"
            )}
            style={{ width: `${job.progress}%` }}
          />
        </div>
      </div>

      {job.logs && job.logs.length > 0 && (
        <div className={cn(
          "rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted overflow-y-auto",
          job.state === "failed" ? "max-h-64" : "max-h-24"
        )}>
          {job.logs.slice(-50).map((log, i) => (
            <div key={i} className="break-words whitespace-pre-wrap">
              {log}
            </div>
          ))}
          {job.logs.length > 50 && (
            <div className="text-xs text-sdm-muted italic mt-1">...{job.logs.length - 50} earlier lines hidden</div>
          )}
        </div>
      )}

      {job.state === "failed" && job.failedReason && (
        <div className="text-sm text-red-500 break-words">
          <span className="font-semibold">Error: </span>{job.failedReason}
        </div>
      )}

      {job.state === "completed" && (
        <div className="text-sm text-green-500">
          Job completed in {formatElapsed(elapsed)}.
        </div>
      )}

      {job.state === "cancelled" && (
        <div className="text-sm text-amber-500">
          Run cancelled after {formatElapsed(elapsed)}.
        </div>
      )}
    </div>
  );
}
