"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import { apiGet } from "@/services/api";

interface DownloadProgressProps {
  jobId: string;
  onComplete: () => void;
  onFailed?: () => void;
  onCancel: () => void;
  typeLabel?: string;
}

interface DownloadStatusResponse {
  id?: string;
  type?: string;
  status?: string;
  progress_log?: string[];
  failed_vars?: number[] | string;
  error?: string | null;
  completed_at?: string | null;
}

export function DownloadProgress({ jobId, onComplete, onFailed, onCancel, typeLabel = "download" }: DownloadProgressProps) {
  const [status, setStatus] = useState("pending");
  const [progress, setProgress] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [failedVars, setFailedVars] = useState<number[]>([]);

  const pollJob = useCallback(async () => {
    try {
      const data = await apiGet<DownloadStatusResponse>(`/api/v1/downloads/status/${encodeURIComponent(jobId)}`);
      const logsArr = Array.isArray(data.progress_log) ? data.progress_log : [];
      setLogs(logsArr);
      const lastPct = (() => {
        for (let i = logsArr.length - 1; i >= 0; i--) {
          const m = /\[(\d+)%\]/.exec(logsArr[i] ?? "");
          if (m) return Math.min(100, Math.max(0, parseInt(m[1], 10)));
        }
        return null;
      })();
      setProgress(lastPct ?? Math.min(100, Math.max(10, status === "completed" ? 100 : 10)));
      setStatus(data.status || "pending");
      if (data.error) setError(String(data.error));
      if (Array.isArray(data.failed_vars)) {
        setFailedVars(data.failed_vars.filter((v): v is number => typeof v === "number"));
      } else {
        setFailedVars([]);
      }
      if (data.status === "completed") {
        setProgress(100);
        onComplete();
      }
      if (data.status === "failed") {
        setProgress(0);
        onFailed?.();
      }
    } catch {
      // transient — will retry on next interval
    }
  }, [jobId, onComplete, onFailed, status]);

  useEffect(() => {
    const interval = setInterval(() => { pollJob(); }, 3000);
    pollJob();
    return () => clearInterval(interval);
  }, [pollJob]);

  const isComplete = status === "completed";
  const isFailed = status === "failed";
  const isPartial = status === "partial";
  const hasFailedVars = failedVars.length > 0;

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
            {isComplete
              ? hasFailedVars
                ? `Download finished with ${failedVars.length} missing layer${failedVars.length === 1 ? "" : "s"}`
                : "Download complete"
              : isFailed
                ? "Download failed"
                : `Downloading ${typeLabel}...`}
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

      {(isFailed || isPartial) && hasFailedVars && (
        <div className="text-xs text-amber-500 font-mono bg-amber-500/5 rounded p-2">
          Missing layers: {failedVars.join(", ")}
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
