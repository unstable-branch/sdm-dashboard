"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";

interface DownloadProgressProps {
  jobId: string;
  onComplete: () => void;
  onCancel: () => void;
}

interface DownloadStatus {
  id: string;
  type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  progress_log: string[];
}

export function DownloadProgress({ jobId, onComplete, onCancel }: DownloadProgressProps) {
  const [status, setStatus] = useState<DownloadStatus | null>(null);
  const [progress, setProgress] = useState(10);

  const pollStatus = useCallback(() => {
    fetch(`/api/v1/climate/status/${jobId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Status not found");
        return res.json();
      })
      .then((data: DownloadStatus) => {
        setStatus(data);
        const logLines = data.progress_log?.length ?? 0;
        setProgress(Math.min(95, 10 + Math.round(logLines * 0.5)));

        if (data.status === "completed") {
          setProgress(100);
          onComplete();
        } else if (data.status === "failed") {
          setProgress(0);
        }
      })
      .catch(() => {});
  }, [jobId, onComplete]);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  if (!status) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <div className="flex items-center gap-2 text-sm text-sdm-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Initializing download...
        </div>
      </div>
    );
  }

  const isComplete = status.status === "completed";
  const isFailed = status.status === "failed";

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
            {isComplete ? "Download complete" : isFailed ? "Download failed" : `Downloading ${status.type}...`}
          </span>
        </div>
        {!isComplete && !isFailed && (
          <button onClick={onCancel} className="text-xs text-sdm-muted hover:text-sdm-danger flex items-center gap-1">
            <X className="h-3 w-3" /> Cancel
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

      {isFailed && status.error && (
        <div className="text-xs text-red-500 font-mono bg-red-500/5 rounded p-2">
          {status.error}
        </div>
      )}

      {status.progress_log && status.progress_log.length > 0 && (
        <div className="rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted max-h-32 overflow-y-auto">
          {status.progress_log.map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
