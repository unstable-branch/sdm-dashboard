"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { RunHistory } from "@/components/model/run-history";
import { JobProgress } from "@/components/jobs/job-progress";
import { useSDMStore } from "@/stores/sdm-store";
import { apiPost, apiGet } from "@/services/api";
import { Ban, AlertTriangle, Loader2 } from "lucide-react";
import type { ModelConfig } from "@sdm/shared";

const ModelConfigForm = dynamic(
  () => import("@/components/model/model-config-form").then(m => m.ModelConfigForm),
  { loading: () => <div className="h-96 rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted"><Loader2 className="h-6 w-6 animate-spin" /></div> }
);

interface ActiveRun {
  id: string;
  species: string;
  model_id: string;
  status: string;
}

export default function ModelPage() {
  const router = useRouter();
  const occurrenceFile = useSDMStore((s) => s.occurrenceFilePath);
  const recordCount = useSDMStore((s) => s.recordCount);
  const species = useSDMStore((s) => s.species);
  const cleanedOccurrence = useSDMStore((s) => s.cleanedOccurrence);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStartTime, setJobStartTime] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [checkingRuns, setCheckingRuns] = useState(true);
  const [runRefreshKey, setRunRefreshKey] = useState(0);
  const activeRunsRef = useRef(activeRuns.length);
  activeRunsRef.current = activeRuns.length;

  // Fork from existing run: pre-fill species from ?fork=<runId>
  const searchParams = useSearchParams();
  const forkId = searchParams.get("fork");
  useEffect(() => {
    if (!forkId) return;
    apiGet<Record<string, unknown>>(`/api/v1/sdm/status/${forkId}`)
      .then((data) => {
        const speciesName = (data as any).species || (data as any).speciesName;
        if (speciesName) {
          useSDMStore.getState().setSpecies(speciesName);
        }
      })
      .catch(() => {});
  }, [forkId]);

  const fetchActiveRuns = useCallback(async () => {
    try {
      const data = await apiGet<{ runs: ActiveRun[] }>("/api/v1/sdm/runs?status=active&limit=50");
      setActiveRuns(data.runs || []);
    } catch {
      setActiveRuns([]);
    } finally {
      setCheckingRuns(false);
    }
  }, []);

  // Initial fetch only — SSE updates handle subsequent changes
  useEffect(() => {
    fetchActiveRuns();
  }, [fetchActiveRuns]);

  // Lightweight poll fallback — only when active runs exist (30s interval, SSE is primary)
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeRunsRef.current > 0) {
        fetchActiveRuns();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchActiveRuns]);

  const handleSubmit = async (config: Partial<ModelConfig>) => {
    if (activeRuns.length > 0) {
      setError(
        `A model run is already in progress (${activeRuns.length} active). Wait for it to complete before starting a new one.`
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await apiPost<{ jobId: string }>("/api/v1/sdm/run", { ...config, async: true });
      if (result.jobId) {
        setJobId(result.jobId);
        setJobStartTime(new Date().toISOString());
        setRunRefreshKey(k => k + 1);
        // Optimistically add to active runs
        setActiveRuns(prev => [...prev, { id: result.jobId, species: config.species || "Unknown", model_id: config.modelId || "glm", status: "running" }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model run failed");
    } finally {
      setLoading(false);
    }
  };

  const handleJobComplete = () => {
    fetchActiveRuns();
  };

  const handleDismissJob = () => {
    setJobId(null);
    setJobStartTime(null);
    fetchActiveRuns();
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
          {cleanedOccurrence && cleanedOccurrence.validRecords === 0 && (
            <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-500">Cleaning produced 0 valid records</p>
                <p className="text-xs text-red-400">The occurrence data has no valid records after cleaning. Go back to the Data page and check your data before running a model.</p>
              </div>
            </div>
          )}
          {!cleanedOccurrence && occurrenceFile && (
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-500">Cleaning recommended</p>
                <p className="text-xs text-amber-400">Clean your data first on the <Link href="/data?tab=clean" className="underline">Data page</Link>. Without previewing, the model will clean automatically but you won't see the results.</p>
              </div>
            </div>
          )}

          {activeRuns.length > 0 && !jobId && (
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
              <p className="text-sm text-sdm-warning">
                {activeRuns.length === 1
                  ? `A model run is already in progress: ${activeRuns[0].species} (${activeRuns[0].model_id})`
                  : `${activeRuns.length} model runs are already in progress.`}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-sdm-muted">
                  Wait for the active run(s) to complete before starting a new one.
                </p>
                <button
                  onClick={async () => {
                    try {
                      await apiPost("/api/v1/sdm/cancel-all", { status: "active" });
                      fetchActiveRuns();
                    } catch {
                      setError("Failed to cancel run(s)");
                    }
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20"
                >
                  <Ban className="h-3 w-3" />
                  Cancel {activeRuns.length === 1 ? "run" : "all"}
                </button>
              </div>
            </div>
          )}

          <ModelConfigForm
            occurrenceFile={occurrenceFile}
            recordCount={recordCount}
            cleanedOccurrence={cleanedOccurrence}
            onSubmit={handleSubmit}
            loading={loading || checkingRuns || activeRuns.length > 0}
          />

          {error && (
            <div className="mt-4 rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
              {error}
            </div>
          )}

          {jobId && (
            <div className="mt-4">
              <JobProgress jobId={jobId} startTime={jobStartTime ?? undefined} onComplete={handleJobComplete} onDismiss={handleDismissJob} />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
            <h2 className="text-sm font-semibold text-sdm-heading mb-3">Data source</h2>
            {cleanedOccurrence && cleanedOccurrence.filePath ? (
              <div>
                <p className="text-sm text-sdm-text font-medium">Cleaned occurrence data</p>
                <p className="text-xs text-sdm-muted mt-1">{cleanedOccurrence.originalRows.toLocaleString()} original → {cleanedOccurrence.validRecords.toLocaleString()} cleaned records</p>
                <p className="text-xs text-sdm-accent mt-1"><Link href="/data?tab=clean" className="underline">Review on Data page</Link></p>
                {species && species !== "Untitled species" && (
                  <p className="text-xs text-sdm-accent mt-1">Species: {species}</p>
                )}
              </div>
            ) : occurrenceFile ? (
              <div>
                <div className="flex items-center gap-2 text-sm text-amber-500">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <p className="text-sm text-sdm-text font-mono truncate">{typeof occurrenceFile === "string" ? occurrenceFile.split("/").pop() : String(occurrenceFile)}</p>
                </div>
                <p className="text-xs text-sdm-muted mt-1">{recordCount.toLocaleString()} records loaded</p>
                <p className="text-xs text-amber-400 mt-1">Not cleaned. <Link href="/data?tab=clean" className="underline">Clean on Data page</Link> first.</p>
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

          <RunHistory onRunSelect={handleRunSelect} refreshKey={runRefreshKey} />
        </div>
      </div>
    </div>
  );
}
