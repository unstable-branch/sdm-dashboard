"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";

interface DownloadProgressProps {
  jobId: string;
  onComplete: () => void;
  onFailed?: () => void;
  onCancel: () => void;
  typeLabel?: string;
}

export function DownloadProgress({ jobId, onComplete, onFailed, onCancel, typeLabel = "download" }: DownloadProgressProps) {
  const [status, setStatus] = useState("pending");
  const [progress, setProgress] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/climate/status/${jobId}`);
      if (!res.ok) return;
      const data = await res.json();
      setProgress(Math.min(100, Math.max(10, data.progress ?? 10)));
      setStatus(data.status || "pending");
      if (data.error) setError(String(data.error));
      if (Array.isArray(data.logs)) setLogs(data.logs);
      if (data.status === "completed") {
        setProgress(100);
        onComplete();
      }
      if (data.status === "failed") {
        setProgress(0);
        onFailed?.();
      }
    } catch {
      // connection error — will retry
    }
  }, [jobId, onComplete, onFailed]);

  useEffect(() => {
    const interval = setInterval(() => { pollJob(); }, 3000);
    pollJob();
    return () => clearInterval(interval);
  }, [pollJob]);

  const isComplete = status === "completed";
  const isFailed = status === "failed";

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

      {isFailed && error && (
        <div className="text-xs text-red-500 font-mono bg-red-500/5 rounded p-2">
          {error}
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted max-h-32 overflow-y-auto">
          {logs.map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
