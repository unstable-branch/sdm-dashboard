"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ModelConfigForm from "@/components/model/model-config-form";
import { RunHistory } from "@/components/model/run-history";
import { JobProgress } from "@/components/jobs/job-progress";
import { useJobSSE } from "@/hooks/use-job-sse";
import { useSDMStore } from "@/stores/sdm-store";
import { apiPost, apiGet } from "@/services/api";
import { Ban, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { ModelConfig } from "@sdm/shared";

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
  const uploadResult = useSDMStore((s) => s.uploadResult);
  const setCleanedOccurrence = useSDMStore((s) => s.setCleanedOccurrence);
  const setRecordCount = useSDMStore((s) => s.setRecordCount);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobId = useSDMStore((s) => s.modelJobId);
  const setJobId = useSDMStore((s) => s.setModelJobId);
  const jobStartTime = useSDMStore((s) => s.modelJobStartTime);
  const setJobStartTime = useSDMStore((s) => s.setModelJobStartTime);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [autoRedirect, setAutoRedirect] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState(8);
  const [checkingRuns, setCheckingRuns] = useState(true);
  const [runRefreshKey, setRunRefreshKey] = useState(0);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [showCancelAllConfirm, setShowCancelAllConfirm] = useState(false);
  const activeRunsRef = useRef(activeRuns.length);
  activeRunsRef.current = activeRuns.length;

  // SSE-driven active run tracking
  const { jobs: sseJobs, connected: sseConnected } = useJobSSE(true);

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

  // Initial fetch
  useEffect(() => {
    fetchActiveRuns();
  }, [fetchActiveRuns]);

  // Safety net: if upload was cleaned but store hasn't caught up, populate cleanedOccurrence
  useEffect(() => {
    if (!cleanedOccurrence && uploadResult?.cleaned_file_id) {
      setCleanedOccurrence({
        filePath: uploadResult.cleaned_file_id as string,
        df: (uploadResult.cleaned_records || []) as Record<string, unknown>[],
        sourceCounts: (uploadResult.source_counts || {}) as Record<string, number>,
        nAbsentExcluded: (uploadResult.n_absent_excluded as number) || 0,
        originalRows: (uploadResult.original_rows as number) || Number(uploadResult.n_rows || 0),
        validRecords: (uploadResult.valid_records as number) || (uploadResult.cleaned_valid_records as number) || 0,
      });
      const count = (uploadResult.valid_records as number) || (uploadResult.cleaned_valid_records as number) || 0;
      if (count) setRecordCount(count);
    }
  }, [cleanedOccurrence, uploadResult, setCleanedOccurrence, setRecordCount]);

  // SSE-driven updates: on terminal state transitions, refresh active runs
  useEffect(() => {
    if (sseJobs.size === 0) return;
    let needsRefresh = false;
    for (const [id, event] of sseJobs) {
      if (["completed", "failed", "cancelled"].includes(event.state)) {
        if (activeRuns.some(r => r.id === id)) { needsRefresh = true; break; }
      }
    }
    if (needsRefresh) fetchActiveRuns();
  }, [sseJobs, activeRuns, fetchActiveRuns]);

  // Lightweight poll fallback — only when active runs exist and SSE is disconnected
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (activeRunsRef.current > 0 && !sseConnected) {
        fetchActiveRuns();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchActiveRuns, sseConnected]);

  const handleSubmit = async (config: Partial<ModelConfig>) => {
    if (activeRuns.length > 0) {
      setError(
        `A model run is already in progress (${activeRuns.length} active). Wait for it to complete before starting a new one.`
      );
      return;
    }

    setLoading(true);
    setError(null);

    let submittedRunId: string | undefined;
    try {
      const result = await apiPost<{ runId: string; jobId: string }>("/api/v1/sdm/run", { ...config, async: true });
      // Use runId (DB UUID) as the canonical identifier — SSE events and API endpoints use this
      const runId = result.runId || result.jobId;
      submittedRunId = runId;
      if (runId) {
        setJobId(runId);
        setJobStartTime(new Date().toISOString());
        setRunRefreshKey(k => k + 1);
        // Optimistically add to active runs (id matches fetchActiveRuns which returns runs.id)
        setActiveRuns(prev => [...prev, { id: runId, species: config.species || "Untitled species", model_id: config.modelId || "glm", status: "queued" }]);
      }
    } catch (err) {
      if (submittedRunId) setActiveRuns(prev => prev.filter(r => r.id !== submittedRunId));
      setError(err instanceof Error ? err.message : "Model run failed");
    } finally {
      setLoading(false);
    }
  };

  const handleJobComplete = (_result: Record<string, unknown>) => {
    fetchActiveRuns();
    setAutoRedirect(true);
    setRedirectCountdown(8);
  };

  useEffect(() => {
    if (!autoRedirect || !jobId) return;
    if (redirectCountdown <= 0) {
      router.push(`/results/${jobId}`);
      return;
    }
    const timer = setTimeout(() => setRedirectCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [autoRedirect, redirectCountdown, jobId, router]);

  const handleCancelRedirect = () => {
    setAutoRedirect(false);
  };

  const handleDismissJob = () => {
    setJobId(null);
    setJobStartTime(null);
    setAutoRedirect(false);
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
          {activeRuns.length > 0 && !jobId && (
            <div className="mb-4 rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3 space-y-2">
              <p className="text-sm text-sdm-warning">
                {activeRuns.length === 1
                  ? `A model run is already in progress: ${activeRuns[0].species} (${activeRuns[0].model_id})`
                  : `${activeRuns.length} model runs are already in progress.`}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-sdm-muted">
                  Wait for the active run(s) to complete before starting a new one.
                </p>
                {showCancelAllConfirm ? (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-sdm-warning">Cancel {activeRuns.length === 1 ? "this run" : "all runs"}?</span>
                    <button
                      onClick={async () => {
                        setCancellingAll(true);
                        try {
                          await apiPost("/api/v1/sdm/cancel-all", { status: "active" });
                          setRunRefreshKey(k => k + 1);
                          fetchActiveRuns();
                        } catch {
                          setError("Failed to cancel run(s)");
                        } finally {
                          setCancellingAll(false);
                          setShowCancelAllConfirm(false);
                        }
                      }}
                      disabled={cancellingAll}
                      className="rounded bg-sdm-danger px-2 py-1 text-xs text-white hover:bg-sdm-danger disabled:opacity-50"
                    >
                      {cancellingAll ? "Cancelling..." : "Yes"}
                    </button>
                    <button
                      onClick={() => setShowCancelAllConfirm(false)}
                      className="rounded border border-sdm-border px-2 py-1 text-xs text-sdm-text hover:bg-sdm-surface-soft"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCancelAllConfirm(true)}
                    className="ml-auto inline-flex items-center gap-1 rounded border border-sdm-danger/30 bg-sdm-danger/10 px-2 py-1 text-xs text-sdm-danger hover:bg-sdm-danger/20"
                  >
                    <Ban className="h-3 w-3" />
                    Cancel {activeRuns.length === 1 ? "run" : "all"}
                  </button>
                )}
              </div>
            </div>
          )}

          <ModelConfigForm
            occurrenceFile={occurrenceFile}
            recordCount={recordCount}
            cleanedOccurrence={cleanedOccurrence}
            onSubmit={handleSubmit}
            loading={loading || activeRuns.length > 0}
          />

          {checkingRuns && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-xs text-sdm-muted">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Checking for active runs...
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
              {error}
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
                <div className="flex items-center gap-2 text-sm text-sdm-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <p className="text-sm text-sdm-text font-mono truncate">{typeof occurrenceFile === "string" ? occurrenceFile.split("/").pop() : String(occurrenceFile)}</p>
                </div>
                <p className="text-xs text-sdm-muted mt-1">{recordCount.toLocaleString()} records loaded</p>
                <p className="text-xs text-sdm-warning mt-1">Not cleaned. <Link href="/data?tab=clean" className="underline">Clean on Data page</Link> first.</p>
                {species && species !== "Untitled species" && (
                  <p className="text-xs text-sdm-accent mt-1">Species: {species}</p>
                )}
              </div>
            ) : (
              <Link href="/data?tab=upload" className="text-xs text-sdm-accent underline hover:no-underline">
                Upload occurrence data in the Data tab first.
              </Link>
            )}
          </div>

          {jobId && (
            <JobProgress
              jobId={jobId}
              startTime={jobStartTime ?? undefined}
              onComplete={handleJobComplete}
              onDismiss={handleDismissJob}
              completedActions={
                autoRedirect && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-sdm-muted">
                      Auto-navigating to results in {redirectCountdown}s
                      <button onClick={handleCancelRedirect} className="ml-2 underline hover:text-sdm-text">Cancel</button>
                    </span>
                    <Link
                      href={`/results/${jobId}`}
                      className="inline-flex items-center gap-1 rounded bg-sdm-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sdm-accent/90"
                    >
                      View Results →
                    </Link>
                  </div>
                )
              }
            />
          )}

          <RunHistory onRunSelect={handleRunSelect} refreshKey={runRefreshKey} activeJobId={jobId} />
        </div>
      </div>
    </div>
  );
}
