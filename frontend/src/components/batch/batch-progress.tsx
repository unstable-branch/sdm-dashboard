"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2, CheckCircle2, XCircle, Clock, RotateCcw, X, Download } from "lucide-react";
import { apiGet } from "@/services/api";
import type { RunSummary } from "@/services/types";

interface BatchJob {
  id: string;
  species: string;
  model_id: string;
  status: string;
  metrics?: Record<string, unknown> | null;
}

interface BatchProgressProps {
  jobIds: string[];
  batchId?: string;
  onComplete?: () => void;
  onRetryFailed?: () => void;
  onCancel?: () => void;
}

export function BatchProgress({ jobIds, batchId, onComplete, onRetryFailed, onCancel }: BatchProgressProps) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchInfo, setBatchInfo] = useState<any>(null);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    const fetchStatus = async () => {
      const results = await Promise.all(
        jobIds.map(async (id) => {
          try {
            const data = await apiGet<RunSummary>(`/api/v1/sdm/status/${id}`);
            return {
              id: data.id,
              species: data.species,
              model_id: data.model_id,
              status: data.status,
              metrics: data.metrics,
            };
          } catch {
            return { id, species: "Unknown", model_id: "", status: "error" };
          }
        })
      );
      if (cancelledRef.current) return;
      setJobs(results);
      setLoading(false);

      if (batchId) {
        try {
          const batchData = await apiGet<any>(`/api/v1/sdm/batch/${batchId}`);
          setBatchInfo(batchData.batch);
        } catch { /* ignore */ }
      }

      const allDone = results.every((j) =>
        j.status === "completed" || j.status === "failed" || j.status === "cancelled"
      );
      if (allDone) {
        onComplete?.();
      } else if (!document.hidden) {
        timeoutRef.current = setTimeout(fetchStatus, 5000);
      }
    };

    fetchStatus();
    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [jobIds, batchId, onComplete]);

  const completed = useMemo(() => jobs.filter((j) => j.status === "completed").length, [jobs]);
  const failed = useMemo(() => jobs.filter((j) => j.status === "failed").length, [jobs]);
  const running = useMemo(() => jobs.filter((j) => j.status === "running" || j.status === "queued").length, [jobs]);
  const cancelled = useMemo(() => jobs.filter((j) => j.status === "cancelled").length, [jobs]);
  const progress = jobs.length > 0 ? (completed / jobs.length) * 100 : 0;

  const hasFailed = failed > 0;
  const hasRunning = running > 0;

  return (
    <div className="space-y-4">
      {batchInfo && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-lg font-bold text-sdm-text">{batchInfo.total_jobs}</div>
            <div className="text-xs text-sdm-muted">Total jobs</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-500">{batchInfo.completed_jobs}</div>
            <div className="text-xs text-sdm-muted">Completed</div>
          </div>
          <div>
            <div className="text-lg font-bold text-red-500">{batchInfo.failed_jobs}</div>
            <div className="text-xs text-sdm-muted">Failed</div>
          </div>
          <div>
            <div className="text-lg font-bold text-sdm-text">{batchInfo.status}</div>
            <div className="text-xs text-sdm-muted">Status</div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-sdm-heading">Batch Progress</h3>
          <span className="text-xs text-sdm-muted">
            {completed}/{jobs.length} completed
          </span>
        </div>

        <div className="w-full bg-sdm-surface-soft rounded-full h-2">
          <div
            className="bg-sdm-accent h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1 text-green-400">
              <CheckCircle2 className="h-3 w-3" /> {completed} completed
            </span>
            <span className="flex items-center gap-1 text-sdm-accent">
              <Loader2 className="h-3 w-3 animate-spin" /> {running} running
            </span>
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3" /> {failed} failed
            </span>
            {cancelled > 0 && (
              <span className="flex items-center gap-1 text-sdm-muted">
                <X className="h-3 w-3" /> {cancelled} cancelled
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {hasFailed && !hasRunning && onRetryFailed && (
              <button
                onClick={onRetryFailed}
                className="inline-flex items-center gap-1 rounded-md border border-sdm-border bg-sdm-surface-soft px-2.5 py-1 text-xs text-sdm-text hover:bg-sdm-surface transition-colors"
              >
                <RotateCcw className="h-3 w-3" /> Retry failed
              </button>
            )}
            {hasRunning && onCancel && (
              <button
                onClick={onCancel}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-sdm-border">
              <th className="text-left px-4 py-2 font-medium text-sdm-muted">Species</th>
              <th className="text-left px-4 py-2 font-medium text-sdm-muted">Model</th>
              <th className="text-left px-4 py-2 font-medium text-sdm-muted">Status</th>
              <th className="text-right px-4 py-2 font-medium text-sdm-muted">AUC</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-sdm-border/50">
                <td className="px-4 py-2 text-sdm-text">{job.species}</td>
                <td className="px-4 py-2 text-sdm-muted">{job.model_id}</td>
                <td className="px-4 py-2">
                  {job.status === "completed" && (
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle2 className="h-3 w-3" /> Done
                    </span>
                  )}
                  {job.status === "running" && (
                    <span className="flex items-center gap-1 text-sdm-accent">
                      <Loader2 className="h-3 w-3 animate-spin" /> Running
                    </span>
                  )}
                  {job.status === "failed" && (
                    <span className="flex items-center gap-1 text-red-400">
                      <XCircle className="h-3 w-3" /> Failed
                    </span>
                  )}
                  {job.status === "cancelled" && (
                    <span className="flex items-center gap-1 text-sdm-muted">
                      <X className="h-3 w-3" /> Cancelled
                    </span>
                  )}
                  {(job.status === "queued" || job.status === "pending") && (
                    <span className="flex items-center gap-1 text-sdm-muted">
                      <Clock className="h-3 w-3" /> Queued
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {job.metrics?.auc_mean ? (job.metrics.auc_mean as number).toFixed(3) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
