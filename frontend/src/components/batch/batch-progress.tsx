"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/services/api";

interface JobStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  metrics: Record<string, unknown> | null;
}

interface BatchProgressProps {
  jobIds: string[];
}

export function BatchProgress({ jobIds }: BatchProgressProps) {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(jobIds.length > 0);

  useEffect(() => {
    if (jobIds.length === 0) {
      setLoading(false);
      return;
    }

    Promise.all(
      jobIds.map((id) =>
        apiGet<JobStatus>(`/api/v1/sdm/status/${id}`).catch(() => ({
          id,
          status: "queued" as const,
          metrics: null,
        }))
      )
    ).then((results) => {
      setJobs(results);
      setLoading(false);
    });
  }, [jobIds]);

  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const total = jobs.length || jobIds.length;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Batch Progress</h3>
        {loading ? (
          <span className="text-sm text-muted-foreground animate-pulse">Loading...</span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {completedCount}/{total} completed
          </span>
        )}
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${total > 0 ? (completedCount / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
