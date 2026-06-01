"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import { MetricCards } from "@/components/results/metric-cards";
import { FutureProjectionPanel } from "@/components/results/future-projection-panel";
import { OdmapViewer } from "@/components/results/odmap-viewer";
import { ArrowLeft, Loader2, Download, GitBranch, CheckCircle2, Layers } from "lucide-react";
import { apiGet, apiPost, fetchWithAuth } from "@/services/api";
import { useRunDetail } from "@/hooks/use-queries";
import { useJobSSE } from "@/hooks/use-job-sse";
import { SuitabilityMap } from "@/components/results/suitability-map";
import { DiagnosticsPanel } from "@/components/results/diagnostics-panel";
import type { RunDetail, ManifestData } from "@/services/types";
import type { ViewState } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";

function extentToViewState(extent?: [number, number, number, number]): Partial<ViewState> | undefined {
  if (!extent || extent.length < 4) return undefined;
  const [xmin, xmax, ymin, ymax] = extent;
  const lngSpan = xmax - xmin;
  const latSpan = ymax - ymin;
  const maxSpan = Math.max(lngSpan, latSpan);
  const zoom = maxSpan > 50 ? 4 : maxSpan > 20 ? 5 : maxSpan > 10 ? 6 : maxSpan > 5 ? 7 : 8;
  return { longitude: (xmin + xmax) / 2, latitude: (ymin + ymax) / 2, zoom };
}

function extentToCoordinates(extent?: [number, number, number, number]): [[number, number], [number, number], [number, number], [number, number]] | undefined {
  if (!extent || extent.length < 4) return undefined;
  const [xmin, xmax, ymin, ymax] = extent;
  return [[xmin, ymax], [xmax, ymax], [xmax, ymin], [xmin, ymin]];
}



async function downloadFile(filePath: string) {
  try {
    const res = await fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(filePath)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filePath.split("/").pop() || "download";
    a.click();
    URL.revokeObjectURL(url);
  } catch { /* ignore */ }
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

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;

  const [benchmark, setBenchmark] = useState<{
    bestRun: { species: string; model_id: string; auc: number | null };
    diff: number;
    improving: boolean;
  } | null>(null);
  const [_benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const [odmapMd, setOdmapMd] = useState<string | null>(null);
  const [odmapCsv, setOdmapCsv] = useState<string | null>(null);
  const [eooGeoJSON, setEooGeoJSON] = useState<FeatureCollection | null>(null);
  const [aooGeoJSON, setAooGeoJSON] = useState<FeatureCollection | null>(null);
  const [boundaryGeoJSON, setBoundaryGeoJSON] = useState<FeatureCollection | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [ensembleGenerating, setEnsembleGenerating] = useState(false);
  const [ensembleGenerated, setEnsembleGenerated] = useState(false);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: runData, isLoading: runLoading, error: runError, refetch } = useRunDetail(runId);
  useEffect(() => {
    if (runData) setRun(runData);
    if (!runLoading) setLoading(false);
    if (runError) setError((runError as Error).message);
  }, [runData, runLoading, runError]);

  // SSE-driven job updates (only connect when initial status is running)
  const { getJob, connected } = useJobSSE(true);

  const isMultiEnsemble = run?.model_id === "multi_ensemble";

  const handleGenerateEnsemble = useCallback(async () => {
    setEnsembleGenerating(true);
    try {
      await apiPost(`/api/v1/diagnostics/ensemble-rasters/${runId}`);
      setEnsembleGenerated(true);
    } catch {
    } finally {
      setEnsembleGenerating(false);
    }
  }, [runId]);

  // Fetch report + manifest after run loads
  useEffect(() => {
    if (!run || run.status !== "completed") return;
    apiGet<string>(`/api/v1/results/${runId}/report.txt`).catch(() => null).then((text) => setReportText(text));
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

  // SSE fallback: poll only if SSE is disconnected and run is still running
  useEffect(() => {
    if (!run || run.status !== "running") return;
    if (connected) return;

    const interval = setInterval(() => { if (!document.hidden) refetch(); }, 5000);
    return () => clearInterval(interval);
  }, [run?.id, run?.status, connected, refetch]);

  // SSE update: when a job event arrives for this runId, refresh
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const abort = new AbortController();

    const fetchStatus = () => {
      if (cancelled) return;
      apiGet<RunDetail>(`/api/v1/sdm/status/${runId}`)
        .then((data) => {
          if (cancelled) return;
          setRun(data);
          setLoading(false);
          if (data.status === "completed") {
            fetchWithAuth(`/api/v1/results/${runId}/report.txt`, { signal: abort.signal })
              .then((res) => res.ok ? res.text() : null)
              .then((text) => { if (!cancelled) setReportText(text); })
              .catch(() => {});
            const odmapMdPath = data.output_files?.odmap_report_md;
            const odmapCsvPath = data.output_files?.odmap_report_csv;
            if (odmapMdPath) {
              fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(odmapMdPath)}`, { signal: abort.signal })
                .then((res) => res.ok ? res.text() : null)
                .then((text) => { if (!cancelled) setOdmapMd(text); })
                .catch(() => {});
            }
            if (odmapCsvPath) {
              fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(odmapCsvPath)}`, { signal: abort.signal })
                .then((res) => res.ok ? res.text() : null)
                .then((text) => { if (!cancelled) setOdmapCsv(text); })
                .catch(() => {});
            }
            const eooPath = data.output_files?.eoo_polygon;
            const aooPath = data.output_files?.aoo_grid;
            if (eooPath) {
              fetchGeoJSON(`/api/v1/results/file/${encodeURIComponent(eooPath)}`)
                .then((geo) => { if (!cancelled) setEooGeoJSON(geo); })
                .catch(() => {});
            }
            if (aooPath) {
              fetchGeoJSON(`/api/v1/results/file/${encodeURIComponent(aooPath)}`)
                .then((geo) => { if (!cancelled) setAooGeoJSON(geo); })
                .catch(() => {});
            }
            fetchGeoJSON("/api/v1/data/boundary/default")
              .then((geo) => { if (!cancelled) setBoundaryGeoJSON(geo); })
              .catch(() => {});
          }
          if (data.status === "running") {
            timeoutId = setTimeout(fetchStatus, 3000);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);
          setLoading(false);
        });
    };

    fetchStatus();
    return () => {
      cancelled = true;
      abort.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [runId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        <span className="ml-2 text-sdm-muted">Loading results...</span>
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
              {run.model_id} · Started {new Date(run.started_at).toLocaleString()}
            </p>
          </div>
        </div>
        <span className={
          run.status === "completed" ? "px-3 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-500" :
          run.status === "failed" ? "px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-500" :
          "px-3 py-1 rounded-full text-xs font-medium bg-sdm-accent/10 text-sdm-accent animate-pulse"
        }>
          {run.status}
        </span>
        <Link
          href={`/model?fork=${run.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft"
        >
          <GitBranch className="h-3.5 w-3.5" />
          Fork this run
        </Link>
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
      </div>

      {run.status === "running" && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 text-sm text-sdm-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Model is still running{!connected && " (polling)"}...
          </div>
          {run.progress_log.length > 0 && (
            <div className="mt-2 rounded bg-sdm-surface-soft p-2 font-mono text-xs text-sdm-muted max-h-32 overflow-y-auto">
              {run.progress_log.map((line, i) => (
                <div key={i} className="truncate">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {run.status === "failed" && run.error && (
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-4 text-sm text-red-500">
          {run.error}
        </div>
      )}

      {run.status === "completed" && (
        <>
          {run.metrics && <MetricCards metrics={run.metrics} modelId={run.model_id} />}

          <Tabs defaultValue="map" className="space-y-4">
            <TabsList className="grid w-full max-w-lg grid-cols-5">
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="future">Future</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
              <TabsTrigger value="provenance">Provenance</TabsTrigger>
            </TabsList>

            <TabsContent value="map">
              <SuitabilityMap
                outputFiles={run.output_files}
                runId={runId}
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
                        onClick={() => downloadFile(outputFiles!.odmap_report_csv)}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline bg-transparent border-none cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP CSV
                      </button>
                    )}
                    {outputFiles?.odmap_report_md && (
                      <button
                        onClick={() => downloadFile(outputFiles!.odmap_report_md)}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline bg-transparent border-none cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP Markdown
                      </button>
                    )}
                    {outputFiles?.report && (
                      <button
                        onClick={() => downloadFile(outputFiles!.report)}
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
                          <span className="text-sdm-muted">Records:</span><span className="text-sdm-text">{manifest.data.occurrence_rows ?? "-"}</span>
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
