"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModelConfigForm } from "@/components/model/model-config-form";
import { RunHistory } from "@/components/model/run-history";
import { JobProgress } from "@/components/jobs/job-progress";
import { useSDMStore } from "@/stores/sdm-store";
import type { ModelConfig } from "@sdm/shared";

export default function ModelPage() {
  const router = useRouter();
  const occurrenceFile = useSDMStore((s) => s.occurrenceFilePath);
  const recordCount = useSDMStore((s) => s.recordCount);
  const species = useSDMStore((s) => s.species);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const handleSubmit = async (config: Partial<ModelConfig>) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/sdm/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, async: true }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Model run failed");
      }

      const result = await res.json();
      if (result.jobId) {
        setJobId(result.jobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model run failed");
    } finally {
      setLoading(false);
    }
  };

  const handleJobComplete = () => {
    router.refresh();
  };

  const handleRunSelect = (runId: string) => {
    router.push(`/results/${runId}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Run SDM</h1>
        <p className="text-sdm-muted mt-1">
          Configure and run a species distribution model.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ModelConfigForm
            occurrenceFile={occurrenceFile}
            onSubmit={handleSubmit}
            loading={loading}
          />

          {error && (
            <div className="mt-4 rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
              {error}
            </div>
          )}

          {jobId && (
            <div className="mt-4">
              <JobProgress jobId={jobId} onComplete={handleJobComplete} />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
            <h2 className="text-sm font-semibold text-sdm-heading mb-3">Data source</h2>
            {occurrenceFile ? (
              <div>
                <p className="text-sm text-sdm-text font-mono truncate">{occurrenceFile.split("/").pop()}</p>
                <p className="text-xs text-sdm-muted mt-1">{recordCount.toLocaleString()} records loaded</p>
                {species && species !== "Untitled species" && (
                  <p className="text-xs text-sdm-accent mt-1">Species: {species}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-sdm-muted">
                Upload occurrence data in the Data tab first.
              </p>
            )}
          </div>

          <RunHistory onRunSelect={handleRunSelect} />
        </div>
      </div>
    </div>
  );
}
