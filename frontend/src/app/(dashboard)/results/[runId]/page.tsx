"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import { MetricCards } from "@/components/results/metric-cards";
import { FutureProjectionPanel } from "@/components/results/future-projection-panel";
import { OdmapViewer } from "@/components/results/odmap-viewer";
import { ArrowLeft, Loader2, Download, GitBranch, CheckCircle2, Layers, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { manifestRecordCount } from "@/lib/manifest";
import { apiGet, apiPost, fetchWithAuth } from "@/services/api";
import { useRunDetail } from "@/hooks/use-queries";
import { useJobSSE } from "@/hooks/use-job-sse";
import { SuitabilityMap } from "@/components/results/suitability-map";
import { OverfittingPanel } from "@/components/results/overfitting-panel";
import { DiagnosticsPanel } from "@/components/results/diagnostics-panel";
import type { RunDetail, ManifestData, ProgressStage } from "@/services/types";
import type { PlumberJobLogs } from "@sdm/shared";

function makeNames(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_.]/g, ".");
  return /^[0-9.]/.test(sanitized) ? "X" + sanitized : sanitized;
}
import type { FeatureCollection } from "geojson";
import { extentToViewState, extentToCoordinates } from "@/lib/map-utils";



async function downloadFile(filePath: string) {
  const filename = filePath.split("/").pop() || "download";
  const a = document.createElement("a");
  a.href = `/api/v1/results/file/download?path=${encodeURIComponent(filePath)}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function fetchGeoJSON(url: string): Promise<FeatureCollection | null> {
  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) return null;
    return await res.json() as FeatureCollection;
  } catch {
    return null;
  }
}

const API_BASE = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) || "";

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;

  const [benchmark, setBenchmark] = useState<{
    bestRun: { species: string; model_id: string; auc: number | null };
    diff: number;
    improving: boolean;
  } | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const [odmapMd, setOdmapMd] = useState<string | null>(null);
  const [odmapCsv, setOdmapCsv] = useState<string | null>(null);
  const [eooGeoJSON, setEooGeoJSON] = useState<FeatureCollection | null>(null);
  const [aooGeoJSON, setAooGeoJSON] = useState<FeatureCollection | null>(null);
  const [boundaryGeoJSON, setBoundaryGeoJSON] = useState<FeatureCollection | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [ensembleGenerating, setEnsembleGenerating] = useState(false);
  const [ensembleGenerated, setEnsembleGenerated] = useState(false);
  const [ensembleError, setEnsembleError] = useState<string | null>(null);
  const [selectedMultiSpeciesIdx, setSelectedMultiSpeciesIdx] = useState(-1); // -1 = show default map
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadTimeout, setLoadTimeout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrorLogs, setShowErrorLogs] = useState(false);
  const [errorLogData, setErrorLogData] = useState<string | null>(null);
  const [errorLogLoading, setErrorLogLoading] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(true);

  // Show diagnostic message after 20s of loading instead of indefinite spinner
  useEffect(() => {
    const t = setTimeout(() => setLoadTimeout(true), 20000);
    return () => clearTimeout(t);
  }, [loading]);

  // Check if Plumber backend is reachable (all proxy-dependent features need it)
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => { if (!cancelled) setBackendAvailable(r.ok); })
      .catch(() => { if (!cancelled) setBackendAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  const { data: runData, isLoading: runLoading, error: runError, refetch } = useRunDetail(runId);
  useEffect(() => {
    if (runData) {
      setRun(prev => {
        // Preserve existing progress_log/last_stage if new data has none (avoid overwriting with stale)
        if (prev && prev.status === "running" && runData.status === "running" &&
            runData.progress_log?.length === 0 && (prev.progress_log?.length ?? 0) > 0) {
          return { ...runData, progress_log: prev.progress_log, last_stage: prev.last_stage ?? runData.last_stage };
        }
        return runData;
      });
    }
    if (!runLoading) setLoading(false);
    if (runError) setError((runError as Error).message);
  }, [runData, runLoading, runError]);

  // SSE-driven job updates (always connect when we have a runId)
  const { getJob, connected } = useJobSSE(!!runId);

  // Merge SSE job updates (logs + currentStage) into run state for live display
  const sseJob = connected ? getJob(runId) : undefined;
  useEffect(() => {
    if (!sseJob || !run || run.status !== "running") return;
    const logs = sseJob.logs;
    const stage = sseJob.currentStage;
    const sseProgressJson = sseJob.progressJson;
    let changed = false;
    const next = { ...run };
    // Only merge SSE logs if they contain real data (not the synthetic bootstrap placeholder)
    if (logs && logs.length > 0 && logs[0] !== "Model run in progress..." &&
        (logs.length !== (run.progress_log?.length ?? 0) || logs[logs.length - 1] !== run.progress_log?.[run.progress_log.length - 1])) {
      next.progress_log = logs;
      changed = true;
    }
    if (stage && stage !== run.last_stage) {
      next.last_stage = stage;
      changed = true;
    }
    // Persist progressJson from SSE so stage chips render even when polling overwrites run
    if (sseProgressJson && Array.isArray(sseProgressJson) && sseProgressJson.length > 0) {
      (next as any).progress_json = sseProgressJson;
      changed = true;
    }
    if (changed) setRun(next);
  }, [sseJob?._receivedAt, sseJob?.currentStage, run?.status]);

  const toggleErrorLogs = useCallback(async () => {
    if (showErrorLogs) { setShowErrorLogs(false); return; }
    setShowErrorLogs(true);
    if (errorLogData) return;
    setErrorLogLoading(true);
    try {
      const data = await apiGet<PlumberJobLogs>(`/api/v1/sdm/logs/${runId}`);
      setErrorLogData(data.stderr || data.progress_log || "No log content available");
    } catch {
      setErrorLogData("Failed to load logs");
    } finally {
      setErrorLogLoading(false);
    }
  }, [runId, showErrorLogs, errorLogData]);

  const isMultiEnsemble = run?.model_id === "multi_ensemble";
  const isMultiSpecies = run?.model_id === "dnn_multispecies" || run?.model_id === "gllvm";

  // Parse multi-species output files into species list (uses run?.output_files, defined after outputFiles)
  const multiSpeciesTifs = useMemo(() => {
    const of = run?.output_files ?? null;
    if (!isMultiSpecies || !of) return [];
    const count = parseInt(of["multi_species_tif_count"] as string || "0", 10);
    if (isNaN(count) || count < 1) return [];
    const species: Array<{ name: string; tif: string }> = [];
    for (let i = 1; i <= count; i++) {
      const tif = of[`multi_species_tif_${i}`] as string | undefined;
      if (tif) {
        const name = tif.split("/").pop()?.replace(/\.tif$/i, "").replace(/^.*?_/, "") || `Species ${i}`;
        species.push({ name, tif });
      }
    }
    return species;
  }, [isMultiSpecies, run?.output_files]);

  const richnessTif = isMultiSpecies ? (run?.output_files?.["multi_species_richness_tif"] as string | undefined) : undefined;

  const handleGenerateEnsemble = useCallback(async () => {
    setEnsembleGenerating(true);
    setEnsembleError(null);
    try {
      await apiPost(`/api/v1/diagnostics/ensemble-rasters/${runId}`);
      setEnsembleGenerated(true);
    } catch (err) {
      setEnsembleGenerated(false);
      setEnsembleError(err instanceof Error ? err.message : "Ensemble generation failed");
    } finally {
      setEnsembleGenerating(false);
    }
  }, [runId]);

  // Fetch manifest after run loads (report.txt fetched below with abort signal)
  useEffect(() => {
    if (!run || run.status !== "completed") return;
    if (run.provenance) {
      setManifest(run.provenance as ManifestData);
    } else {
      apiGet<{ manifest: ManifestData }>(`/api/v1/results/${runId}/manifest`)
        .then((m) => setManifest(m?.manifest || null))
        .catch(() => console.warn("[results] Failed to fetch manifest for run", runId));
    }
  }, [run?.id, run?.status, runId]);

  // Auto-benchmark: compare against best previous run for same species
  useEffect(() => {
    if (run?.status !== "completed" || run.metrics?.auc_mean == null || typeof run.metrics.auc_mean !== "number") return;
    const currentAuc = run.metrics.auc_mean;
    setBenchmarkLoading(true);
    apiGet<{ runs: Array<{ id: string; species: string; model_id: string; metrics: { auc_mean?: number } | null }> }>(
      `/api/v1/sdm/runs?limit=50&species=${encodeURIComponent(run.species)}`
    )
      .then((data) => {
        const past = (data.runs || []).filter(
          (r) => r.id !== run.id && r.metrics?.auc_mean && typeof r.metrics.auc_mean === "number"
        );
        if (past.length === 0) { setBenchmarkLoading(false); return; }
        const best = past.reduce((a, b) => ((a.metrics?.auc_mean as number ?? 0) > (b.metrics?.auc_mean as number ?? 0) ? a : b));
        const bestAuc = best.metrics?.auc_mean as number;
        setBenchmark({
          bestRun: { species: best.species, model_id: best.model_id, auc: bestAuc },
          diff: currentAuc - bestAuc,
          improving: currentAuc > bestAuc,
        });
        setBenchmarkLoading(false);
      })
      .catch(() => setBenchmarkLoading(false));
  }, [run?.id, run?.status, run?.metrics?.auc_mean, run?.species]);

  // Polling fallback: lightweight check when SSE has only synthetic data
  useEffect(() => {
    if (!run || !["running", "loading", "pending"].includes(run.status)) return;
    const sseJob = connected ? getJob(runId) : undefined;
    const hasRealSse = sseJob != null && !(sseJob.logs?.length === 1 && sseJob.logs[0] === "Model run in progress...");
    if (connected && hasRealSse) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiGet<RunDetail>(`/api/v1/sdm/status/${runId}`);
        if (cancelled || !res) return;
        // If terminal state reached, refresh via React Query to get full data
        if (res.status === "completed" || res.status === "failed" || res.status === "cancelled") {
          refetch();
          return;
        }
        // Update stage chips and logs from polling response when SSE lags
        const pollProgressJson = res.progress_json;
        const pollProgressLog = Array.isArray(res.progress_log) ? res.progress_log : undefined;
        if ((Array.isArray(pollProgressJson) && pollProgressJson.length > 0) || pollProgressLog) {
          setRun(prev => {
            if (!prev || prev.status !== "running") return prev;
            const next = { ...prev };
            if (Array.isArray(pollProgressJson) && pollProgressJson.length > 0) {
              next.progress_json = pollProgressJson;
            }
            // Also update progress_log from polling so the log display stays current
            if (pollProgressLog && pollProgressLog.length > 0) {
              next.progress_log = pollProgressLog;
            }
            return next;
          });
        }
      } catch {
        // Polling is fallback only — errors are expected when SSE is primary
      }
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [run?.id, run?.status, runId, refetch]);

  // Manual data fetching for report, boundaries after completion
  useEffect(() => {
    if (!runId || !run || run.status !== "completed") return;
    const abort = new AbortController();
    fetchWithAuth(`/api/v1/results/${runId}/report.txt`, { signal: abort.signal })
      .then((res) => res.ok ? res.text() : null)
      .then((text) => setReportText(text))
      .catch(() => {});
    const odmapMdPath = run.output_files?.odmap_report_md;
    const odmapCsvPath = run.output_files?.odmap_report_csv;
    if (odmapMdPath) {
      fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(odmapMdPath)}`, { signal: abort.signal })
        .then((res) => res.ok ? res.text() : null)
        .then((text) => setOdmapMd(text))
        .catch(() => {});
    }
    if (odmapCsvPath) {
      fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(odmapCsvPath)}`, { signal: abort.signal })
        .then((res) => res.ok ? res.text() : null)
        .then((text) => setOdmapCsv(text))
        .catch(() => {});
    }
    const eooPath = run.output_files?.eoo_polygon;
    const aooPath = run.output_files?.aoo_grid;
    if (eooPath) {
      fetchGeoJSON(`/api/v1/results/file/${encodeURIComponent(eooPath)}`)
        .then((geo) => setEooGeoJSON(geo))
        .catch(() => {});
    }
    if (aooPath) {
      fetchGeoJSON(`/api/v1/results/file/${encodeURIComponent(aooPath)}`)
        .then((geo) => setAooGeoJSON(geo))
        .catch(() => {});
    }
    fetchGeoJSON("/api/v1/data/boundary/default")
      .then((geo) => setBoundaryGeoJSON(geo))
      .catch(() => {});
    return () => abort.abort();
  }, [runId, run?.id, run?.status, run?.output_files]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        <span className="text-sdm-muted">Loading results...</span>
        {loadTimeout && (
          <div className="text-center space-y-2">
            <p className="text-sm text-sdm-warning">This is taking longer than expected.</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => router.refresh()}
                className="rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface"
              >
                Refresh page
              </button>
              <button
                onClick={() => router.push("/results")}
                className="rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface"
              >
                Back to results
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-sdm-muted hover:text-sdm-text">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-4 text-sm text-red-500">
          {error || "Run not found"}
        </div>
      </div>
    );
  }

  const outputFiles = run?.output_files ?? null;

  const stageData: ProgressStage[] | null = sseJob?.progressJson ?? run.progress_json ?? null;
  const stageChips = stageData && stageData.length > 0 ? (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {stageData.map((entry, i) => (
        <span key={i} className={`text-xs rounded px-1.5 py-0.5 ${
          entry.stage === "unknown" ? "bg-sdm-surface text-sdm-muted" :
          i === stageData.length - 1
            ? "bg-sdm-accent/15 text-sdm-accent animate-pulse"
            : "bg-sdm-accent/10 text-sdm-accent"
        }`}>
          {entry.stage}: {Math.round((entry.percent || 0) * 100)}%
        </span>
      ))}
    </div>
  ) : null;
  const logLines = run.progress_log?.slice(-200) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-sdm-muted hover:text-sdm-text" aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-sdm-heading">{run.species || "Results"}</h1>
            <p className="text-sm text-sdm-muted">
              {run.model_id} · Started {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
            </p>
          </div>
        </div>
        <span className={
          run.status === "completed" ? "px-3 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-500" :
          run.status === "failed" ? "px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-500" :
          run.status === "cancelled" ? "px-3 py-1 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-500" :
          run.status === "queued" || run.status === "pending" ? "px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-500" :
          "px-3 py-1 rounded-full text-xs font-medium bg-sdm-accent/10 text-sdm-accent animate-pulse"
        }>
          {run.status}
        </span>
        <button
          onClick={() => router.push(`/model?fork=${run.id}`)}
          className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft"
        >
          <GitBranch className="h-3.5 w-3.5" />
          Fork this run
        </button>
        {isMultiEnsemble && (
          <button
            onClick={handleGenerateEnsemble}
            disabled={ensembleGenerating || ensembleGenerated}
            className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-50"
          >
            {ensembleGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : ensembleGenerated ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Layers className="h-3.5 w-3.5" />
            )}
            {ensembleGenerating ? "Generating..." : ensembleGenerated ? "Ensemble stats generated" : "Generate ensemble rasters"}
          </button>
        )}
        {ensembleError && (
          <p className="text-xs text-sdm-danger ml-1">{ensembleError}</p>
        )}
      </div>

      {(run.status === "running" || run.status === "loading" || run.status === "pending") && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 text-sm text-sdm-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {run.status === "loading" ? "Initializing model..." :
               run.status === "pending" ? "Queued..." :
               `Model is still running${!connected ? " (polling)" : ""}...`}
            </span>
            {run.last_stage && (
              <span className="ml-auto rounded bg-sdm-accent/10 px-2 py-0.5 text-xs text-sdm-accent">
                {run.last_stage}
              </span>
            )}
          </div>
          {stageChips}
          {(run.progress_log?.length ?? 0) > 0 ? (
            <div className="mt-2 rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted max-h-32 overflow-y-auto">
              {logLines.map((line, i) => (
                <div key={i} className="break-words whitespace-pre-wrap">{line}</div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-sdm-muted italic">No log output yet</div>
          )}
        </div>
      )}

      {run.status === "failed" && (
        <div className="space-y-2">
          {run.error && (
            <div className="rounded-md border border-red-300/30 bg-red-500/5 p-4 text-sm text-red-500">
              {run.error}
            </div>
          )}
          {typeof run.error_code === "string" && run.error_code && (
            <div className="text-xs font-mono text-sdm-muted ml-1">Code: {run.error_code}</div>
          )}
          {typeof run.error_hint === "string" && run.error_hint && (
            <div className="text-xs text-sdm-warning ml-1">Hint: {run.error_hint}</div>
          )}
          <button
            onClick={toggleErrorLogs}
            className="inline-flex items-center gap-1 text-xs text-sdm-muted hover:text-sdm-accent ml-1"
          >
            {showErrorLogs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showErrorLogs ? "Hide" : "Show"} error logs
          </button>
          {showErrorLogs && (
            <div className="rounded-md border border-sdm-danger/20 bg-sdm-danger/[0.03] p-3">
              {errorLogLoading ? (
                <div className="flex items-center gap-2 text-xs text-sdm-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading logs...
                </div>
              ) : (
                <pre className="text-xs text-sdm-text leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                  {errorLogData || "No log content available"}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {!backendAvailable && run.status === "completed" && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
          The R computation backend is not available. Some features (diagnostic charts, report downloads, maps) may not load.
        </div>
      )}

      {run.status === "completed" && (
        <>
          {run.metrics && (
            <div className="space-y-3">
              <MetricCards metrics={run.metrics} modelId={run.model_id} />
              {isMultiSpecies && multiSpeciesTifs.length > 0 && (
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <h3 className="text-sm font-semibold text-sdm-heading mb-2">Species</h3>
                  <div className="flex flex-wrap gap-2">
                    {multiSpeciesTifs.map((sp, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-2.5 py-1 text-xs text-sdm-text">
                        {sp.name}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {multiSpeciesTifs.map((sp, i) => (
                      <button
                        key={i}
                        onClick={() => downloadFile(sp.tif)}
                        className="text-xs text-sdm-accent hover:underline bg-transparent border-none cursor-pointer"
                      >
                        Download {sp.name}
                      </button>
                    ))}
                    {richnessTif && (
                      <button
                        onClick={() => downloadFile(richnessTif!)}
                        className="text-xs text-sdm-accent hover:underline bg-transparent border-none cursor-pointer"
                      >
                        Download richness
                      </button>
                    )}
                  </div>
                </div>
              )}
              {benchmark && (
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3 text-xs">
                  <span className="text-sdm-muted">vs. best previous run: </span>
                  <span className={cn(
                    "font-medium",
                    benchmark.improving ? "text-sdm-success" : "text-sdm-warning"
                  )}>
                    {benchmark.improving ? "+" : ""}{benchmark.diff.toFixed(3)} AUC
                  </span>
                  <span className="text-sdm-muted ml-1">
                    ({benchmark.bestRun.model_id} — {benchmark.bestRun.species})
                  </span>
                </div>
              )}
            </div>
          )}
              {benchmarkLoading && (
            <div className="flex items-center gap-2 text-xs text-sdm-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              Comparing with past runs...
            </div>
          )}
          <Link
            href={`/ecology?runId=${run.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
          >
            View ecology analysis →
          </Link>

          <Tabs defaultValue="map" className="space-y-4">
            <TabsList className="grid w-full max-w-lg grid-cols-6">
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="overfitting">Overfitting</TabsTrigger>
              <TabsTrigger value="future">Future</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
              <TabsTrigger value="provenance">Provenance</TabsTrigger>
            </TabsList>

            <TabsContent value="map">
              {isMultiSpecies && multiSpeciesTifs.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-sdm-muted">Species:</span>
                  <button
                    onClick={() => setSelectedMultiSpeciesIdx(-1)}
                    className={`text-xs rounded px-2 py-1 border ${selectedMultiSpeciesIdx === -1
                      ? "bg-sdm-accent/15 text-sdm-accent border-sdm-accent/30"
                      : "bg-sdm-surface text-sdm-muted border-sdm-border hover:text-sdm-text"
                    }`}
                  >
                    All species
                  </button>
                  {multiSpeciesTifs.map((sp, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedMultiSpeciesIdx(i)}
                      className={`text-xs rounded px-2 py-1 border ${selectedMultiSpeciesIdx === i
                        ? "bg-sdm-accent/15 text-sdm-accent border-sdm-accent/30"
                        : "bg-sdm-surface text-sdm-muted border-sdm-border hover:text-sdm-text"
                      }`}
                    >
                      {sp.name}
                    </button>
                  ))}
                  {richnessTif && (
                    <button
                      onClick={() => setSelectedMultiSpeciesIdx(-2)}
                      className={`text-xs rounded px-2 py-1 border ${selectedMultiSpeciesIdx === -2
                        ? "bg-sdm-accent/15 text-sdm-accent border-sdm-accent/30"
                        : "bg-sdm-surface text-sdm-muted border-sdm-border hover:text-sdm-text"
                      }`}
                    >
                      Richness
                    </button>
                  )}
                </div>
              )}
              <SuitabilityMap key={`${runId}-${selectedMultiSpeciesIdx}`}
                bandName={(() => {
                  if (!isMultiSpecies) return undefined;
                  if (selectedMultiSpeciesIdx === -2 && richnessTif) return "richness";
                  if (selectedMultiSpeciesIdx >= 0 && selectedMultiSpeciesIdx < multiSpeciesTifs.length) {
                    return makeNames(multiSpeciesTifs[selectedMultiSpeciesIdx].name);
                  }
                  return "suitability";
                })()}
                outputFiles={(() => {
                  const of = run?.output_files ?? null;
                  if (!isMultiSpecies || selectedMultiSpeciesIdx < 0 || !of) return of;
                  const override = { ...of };
                  if (selectedMultiSpeciesIdx === -2 && richnessTif) {
                    override.tif = richnessTif;
                  } else if (selectedMultiSpeciesIdx >= 0 && selectedMultiSpeciesIdx < multiSpeciesTifs.length) {
                    override.tif = multiSpeciesTifs[selectedMultiSpeciesIdx].tif;
                  }
                  return override;
                })()}
                runId={runId}
                projectionExtent={(run.config?.projection_extent as [number, number, number, number] | undefined) ?? null}
                initialViewState={extentToViewState((run.config?.projection_extent ?? undefined) as [number, number, number, number] | undefined)}
                coordinates={extentToCoordinates((run.config?.projection_extent ?? undefined) as [number, number, number, number] | undefined)}
                eooGeoJSON={eooGeoJSON}
                aooGeoJSON={aooGeoJSON}
                boundaryGeoJSON={boundaryGeoJSON}
              />
            </TabsContent>

            <TabsContent value="diagnostics">
              <DiagnosticsPanel run={run} />
            </TabsContent>

            <TabsContent value="overfitting">
              <OverfittingPanel run={run} />
            </TabsContent>

            <TabsContent value="future">
              <FutureProjectionPanel outputFiles={run.output_files} config={run.config} />
            </TabsContent>

            <TabsContent value="report">
              <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-sdm-heading">Run report</h3>
                  <div className="flex gap-3">
                    {outputFiles?.odmap_report_csv && (
                      <button
                        onClick={() => downloadFile(outputFiles!.odmap_report_csv!)}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline bg-transparent border-none cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP CSV
                      </button>
                    )}
                    {outputFiles?.odmap_report_md && (
                      <button
                        onClick={() => downloadFile(outputFiles!.odmap_report_md!)}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline bg-transparent border-none cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP Markdown
                      </button>
                    )}
                    {outputFiles?.report && (
                      <button
                        onClick={() => downloadFile(outputFiles!.report!)}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline bg-transparent border-none cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" /> Download report
                      </button>
                    )}
                    <a
                      href={`/api/v1/results/${run.id}/script`}
                      className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> Reproducible R script
                    </a>
                    <a
                      href={`/api/v1/results/${run.id}/manifest`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> Run manifest
                    </a>
                  </div>
                </div>
                {reportText ? (
                  <pre className="text-xs text-sdm-text font-mono whitespace-pre-wrap max-h-[60vh] overflow-y-auto bg-sdm-surface-soft p-4 rounded-lg">
                    {reportText}
                  </pre>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-sdm-muted">Formatted report not available. Showing run log:</p>
                    <pre className="text-xs text-sdm-muted font-mono whitespace-pre-wrap max-h-96 overflow-y-auto bg-sdm-surface-soft p-4 rounded-lg">
                      {run.progress_log.join("\n")}
                    </pre>
                  </div>
                )}
              </div>
              {(odmapMd || odmapCsv) && (
                <OdmapViewer odmapMd={odmapMd} odmapCsv={odmapCsv} loading={false} />
              )}
            </TabsContent>

            <TabsContent value="provenance">
              <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
                <h3 className="text-sm font-semibold text-sdm-heading">Run Provenance</h3>
                {manifest ? (
                  <div className="space-y-4">
                    {manifest.app_version && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Environment</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">R:</span><span className="text-sdm-text">{manifest.app_version.r_version}</span>
                          <span className="text-sdm-muted">Platform:</span><span className="text-sdm-text">{manifest.app_version.platform}</span>
                          {manifest.app_version.git_sha && (<>
                            <span className="text-sdm-muted">Git SHA:</span><span className="text-sdm-text">{manifest.app_version.git_sha.slice(0, 7)}</span>
                          </>)}
                        </div>
                      </div>
                    )}
                    {manifest.data && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Input Data</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">Records:</span><span className="text-sdm-text">{manifestRecordCount(manifest)?.toLocaleString() ?? "-"}</span>
                          <span className="text-sdm-muted">SHA-256:</span><span className="text-sdm-text truncate">{manifest.data.occurrence_hash_sha256?.slice(0, 16) ?? "-"}</span>
                        </div>
                      </div>
                    )}
                    {manifest.covariates && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Covariates</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">Source:</span><span className="text-sdm-text">{manifest.covariates.source}</span>
                          <span className="text-sdm-muted">Resolution:</span><span className="text-sdm-text">{manifest.covariates.resolution}m</span>
                          <span className="text-sdm-muted">BIO vars:</span><span className="text-sdm-text">{manifest.covariates.biovars?.join(", ")}</span>
                          <span className="text-sdm-muted">Files:</span><span className="text-sdm-text">{manifest.covariates.file_count}</span>
                        </div>
                      </div>
                    )}
                    {manifest.extent && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Extent</h4>
                        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">xmin:</span><span className="text-sdm-text">{manifest.extent.xmin}</span>
                          <span className="text-sdm-muted">xmax:</span><span className="text-sdm-text">{manifest.extent.xmax}</span>
                          <span className="text-sdm-muted">ymin:</span><span className="text-sdm-text">{manifest.extent.ymin}</span>
                          <span className="text-sdm-muted">ymax:</span><span className="text-sdm-text">{manifest.extent.ymax}</span>
                        </div>
                      </div>
                    )}
                    {manifest.validation && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Cross-Validation</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">Strategy:</span><span className="text-sdm-text">{manifest.validation.cv_strategy}</span>
                          <span className="text-sdm-muted">Folds:</span><span className="text-sdm-text">{manifest.validation.cv_folds}</span>
                          {manifest.validation.cv_block_size_km && (<>
                            <span className="text-sdm-muted">Block size:</span><span className="text-sdm-text">{manifest.validation.cv_block_size_km} km</span>
                          </>)}
                          <span className="text-sdm-muted">Seed:</span><span className="text-sdm-text">{manifest.validation.seed}</span>
                        </div>
                      </div>
                    )}
                    {manifest.resources && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Resources (R)</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">CPU time:</span><span className="text-sdm-text">{manifest.resources.r_cpu_time_ms != null ? `${(manifest.resources.r_cpu_time_ms / 1000).toFixed(1)}s` : "-"}</span>
                          <span className="text-sdm-muted">Peak memory:</span><span className="text-sdm-text">{manifest.resources.r_peak_memory_mb != null ? `${manifest.resources.r_peak_memory_mb} MB` : "-"}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-sdm-muted">Manifest not available.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
