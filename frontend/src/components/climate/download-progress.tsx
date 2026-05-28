"use client";

import { useState, useEffect } from "react";
import { Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import { useJobProgress } from "@/hooks/useJobProgress";

interface DownloadProgressProps {
  jobId: string;
  onComplete: () => void;
  onFailed?: () => void;
  onCancel: () => void;
}

const typeLabel = "climate download";

export function DownloadProgress({ jobId, onComplete, onFailed, onCancel }: DownloadProgressProps) {
  const [progress, setProgress] = useState(10);
  const { job: wsJob } = useJobProgress(jobId);

  useEffect(() => {
    if (!wsJob) return;
    setProgress(Math.min(100, Math.max(10, wsJob.progress)));
    if (wsJob.state === "completed") {
      setProgress(100);
      onComplete();
    } else if (wsJob.state === "failed") {
      setProgress(0);
      onFailed?.();
    }
  }, [wsJob, onComplete, onFailed]);

  if (!wsJob) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <div className="flex items-center gap-2 text-sm text-sdm-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Initializing download...
        </div>
      </div>
    );
  }

  const state = wsJob.state;
  const isComplete = state === "completed";
  const isFailed = state === "failed";
  const logs = Array.isArray(wsJob.logs) ? wsJob.logs : [];

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {isComplete ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : isFailed ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-sdm-accent" />
          )}
          <span className={isComplete ? "text-green-500" : isFailed ? "text-red-500" : "text-sdm-text"}>
            {isComplete ? "Download complete" : isFailed ? "Download failed" : `Downloading ${typeLabel}...`}
          </span>
        </div>
        {!isComplete && !isFailed && (
          <button onClick={onCancel} className="text-xs text-sdm-muted hover:text-sdm-danger flex items-center gap-1">
            <X className="h-3 w-3" /> Cancel
          </button>
        )}
        {isFailed && onFailed && (
          <button onClick={onFailed} className="text-xs text-sdm-muted hover:text-sdm-text flex items-center gap-1">
            <X className="h-3 w-3" /> Dismiss
          </button>
        )}
      </div>

      {!isComplete && !isFailed && (
        <div className="w-full h-2 bg-sdm-surface-soft rounded-full overflow-hidden">
          <div
            className="h-full bg-sdm-accent transition-all duration-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {isFailed && wsJob.failedReason && (
        <div className="text-xs text-red-500 font-mono bg-red-500/5 rounded p-2">
          {typeof wsJob.failedReason === "string" ? wsJob.failedReason : JSON.stringify(wsJob.failedReason)}
        </div>
      )}

      {logs && logs.length > 0 && (
        <div className="rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted max-h-32 overflow-y-auto">
          {logs.map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
