"use client";

import { useJobSSE } from "@/hooks/use-job-sse";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

interface JobProgressProps {
  jobId: string | null;
  onComplete?: (result: Record<string, unknown>) => void;
}

const stateIcons = {
  waiting: <Clock className="h-4 w-4 text-sdm-muted" />,
  active: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  delayed: <Clock className="h-4 w-4 text-sdm-warning" />,
  paused: <Clock className="h-4 w-4 text-sdm-muted" />,
};

export function JobProgress({ jobId, onComplete }: JobProgressProps) {
  const { getJob, connected } = useJobSSE(!!jobId);

  const job = jobId ? getJob(jobId) : null;

  if (!jobId || !job) {
    return null;
  }

  if (job.state === "completed" && job.result) {
    onComplete?.(job.result);
  }

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {stateIcons[job.state]}
          <span className="text-sm font-medium text-sdm-text capitalize">
            {job.state}
          </span>
        </div>
        <span className="text-xs text-sdm-muted">
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

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
                : "bg-sdm-accent"
            )}
            style={{ width: `${job.progress}%` }}
          />
        </div>
      </div>

      {job.logs && job.logs.length > 0 && (
        <div className="rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted max-h-24 overflow-y-auto">
          {job.logs.map((log, i) => (
            <div key={i} className="truncate">
              {log}
            </div>
          ))}
        </div>
      )}

      {job.state === "failed" && job.failedReason && (
        <div className="text-sm text-red-500">
          {job.failedReason}
        </div>
      )}
    </div>
  );
}
