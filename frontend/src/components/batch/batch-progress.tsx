"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { apiGet } from "@/services/api";

interface BatchJob {
  id: string;
  species: string;
  model_id: string;
  status: string;
  metrics?: Record<string, unknown>;
}

interface BatchProgressProps {
  jobIds: string[];
  onComplete?: () => void;
}

export function BatchProgress({ jobIds, onComplete }: BatchProgressProps) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelledRef.current = false;

    const fetchStatus = async () => {
      const results = await Promise.all(
        jobIds.map(async (id) => {
          try {
            const data = await apiGet<Record<string, unknown>>(`/api/v1/sdm/status/${id}`);
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

      const allDone = results.every((j) => j.status === "completed" || j.status === "failed");
      if (allDone) {
        onComplete?.();
      } else {
        timeoutRef.current = setTimeout(fetchStatus, 5000);
      }
    };

    fetchStatus();
    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [jobIds, onComplete]);

  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const running = jobs.filter((j) => j.status === "running").length;
  const progress = jobs.length > 0 ? (completed / jobs.length) * 100 : 0;

  return (
    <div className="space-y-4">
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

        <div className="flex gap-4 mt-3 text-xs">
          <span className="flex items-center gap-1 text-green-400">
            <CheckCircle2 className="h-3 w-3" /> {completed} completed
          </span>
          <span className="flex items-center gap-1 text-sdm-accent">
            <Loader2 className="h-3 w-3 animate-spin" /> {running} running
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <XCircle className="h-3 w-3" /> {failed} failed
          </span>
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
