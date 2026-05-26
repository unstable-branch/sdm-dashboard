"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import { MetricCards } from "@/components/results/metric-cards";
import { FutureProjectionPanel } from "@/components/results/future-projection-panel";
import { ArrowLeft, Loader2, Download, GitBranch } from "lucide-react";
import { apiGet } from "@/services/api";
import { useJobSSE } from "@/hooks/use-job-sse";
import type { RunDetail } from "@/services/types";

const SuitabilityMap = dynamic(
  () => import("@/components/results/suitability-map").then(m => m.SuitabilityMap),
  { ssr: false, loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div> }
);

const DiagnosticsPanel = dynamic(
  () => import("@/components/results/diagnostics-panel").then(m => m.DiagnosticsPanel),
  { ssr: false, loading: () => <div className="h-64 rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading diagnostics...</div> }
);

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);

  // SSE-driven job updates (only connect when initial status is running)
  const { getJob, connected } = useJobSSE(true);

  const fetchRun = useCallback(async () => {
    if (!runId) return;
    try {
      const data = await apiGet<RunDetail>(`/api/v1/sdm/status/${runId}`);
      setRun(data);
      setLoading(false);

      if (data.status === "completed") {
        apiGet<string>(`/api/v1/results/${runId}/report.txt`).catch(() => null).then((text) => setReportText(text));
        // Use provenance from the status endpoint directly; fall back
        // to a separate manifest fetch if it's not populated yet.
        if (data.provenance) {
          setManifest(data.provenance as Record<string, unknown>);
        } else {
          apiGet<{ manifest: Record<string, unknown> }>(`/api/v1/results/${runId}/manifest`)
            .then((m) => setManifest(m?.manifest || null))
            .catch(() => {});
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
      setLoading(false);
    }
  }, [runId]);

  // Initial fetch
  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  // SSE fallback: poll only if SSE is disconnected and run is still running
  useEffect(() => {
    if (!run || run.status !== "running") return;
    if (connected) return; // SSE is active, no polling needed

    const interval = setInterval(fetchRun, 5000);
    return () => clearInterval(interval);
  }, [run?.status, connected, fetchRun]);

  // SSE update: when a job event arrives for this runId, refresh
  useEffect(() => {
    if (!runId) return;
    const job = getJob(runId);
    if (!job) return;

    if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") {
      fetchRun();
    }
  }, [runId, getJob, fetchRun]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-sdm-muted hover:text-sdm-text">
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
          {run.metrics && <MetricCards metrics={run.metrics} />}

          <Tabs defaultValue="map" className="space-y-4">
            <TabsList className="grid w-full max-w-lg grid-cols-5">
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="future">Future</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
              <TabsTrigger value="provenance">Provenance</TabsTrigger>
            </TabsList>

            <TabsContent value="map">
              <SuitabilityMap outputFiles={run.output_files} projectionExtent={((run.config?.projectionExtent as number[]) ?? (run.config?.projection_extent as string)?.split(",").map(Number) ?? null) as number[] | null} />
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
                    {run.output_files?.odmap_report_csv && (
                      <a
                        href={`/api/v1/results/file/download?path=${encodeURIComponent(run.output_files.odmap_report_csv)}`}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP CSV
                      </a>
                    )}
                    {run.output_files?.odmap_report_md && (
                      <a
                        href={`/api/v1/results/file/download?path=${encodeURIComponent(run.output_files.odmap_report_md)}`}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP Markdown
                      </a>
                    )}
                    {run.output_files?.report && (
                      <a
                        href={`/api/v1/results/file/download?path=${encodeURIComponent(run.output_files.report)}`}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download report
                      </a>
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
            </TabsContent>

            <TabsContent value="provenance">
              <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
                <h3 className="text-sm font-semibold text-sdm-heading">Run Provenance</h3>
                {manifest ? (
                  <div className="space-y-4">
                    {(manifest as any).app_version && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Environment</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">R:</span><span className="text-sdm-text">{(manifest as any).app_version.r_version}</span>
                          <span className="text-sdm-muted">Platform:</span><span className="text-sdm-text">{(manifest as any).app_version.platform}</span>
                          {(manifest as any).app_version.git_sha && (<>
                            <span className="text-sdm-muted">Git SHA:</span><span className="text-sdm-text">{(manifest as any).app_version.git_sha.slice(0, 7)}</span>
                          </>)}
                        </div>
                      </div>
                    )}
                    {(manifest as any).data && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Input Data</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">Records:</span><span className="text-sdm-text">{(manifest as any).data.occurrence_rows ?? "-"}</span>
                          <span className="text-sdm-muted">SHA-256:</span><span className="text-sdm-text truncate">{(manifest as any).data.occurrence_hash_sha256?.slice(0, 16) ?? "-"}</span>
                        </div>
                      </div>
                    )}
                    {(manifest as any).covariates && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Covariates</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">Source:</span><span className="text-sdm-text">{(manifest as any).covariates.source}</span>
                          <span className="text-sdm-muted">Resolution:</span><span className="text-sdm-text">{(manifest as any).covariates.resolution}m</span>
                          <span className="text-sdm-muted">BIO vars:</span><span className="text-sdm-text">{(manifest as any).covariates.biovars?.join(", ")}</span>
                          <span className="text-sdm-muted">Files:</span><span className="text-sdm-text">{(manifest as any).covariates.file_count}</span>
                        </div>
                      </div>
                    )}
                    {(manifest as any).extent && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Extent</h4>
                        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">xmin:</span><span className="text-sdm-text">{(manifest as any).extent.xmin}</span>
                          <span className="text-sdm-muted">xmax:</span><span className="text-sdm-text">{(manifest as any).extent.xmax}</span>
                          <span className="text-sdm-muted">ymin:</span><span className="text-sdm-text">{(manifest as any).extent.ymin}</span>
                          <span className="text-sdm-muted">ymax:</span><span className="text-sdm-text">{(manifest as any).extent.ymax}</span>
                        </div>
                      </div>
                    )}
                    {(manifest as any).validation && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Cross-Validation</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">Strategy:</span><span className="text-sdm-text">{(manifest as any).validation.cv_strategy}</span>
                          <span className="text-sdm-muted">Folds:</span><span className="text-sdm-text">{(manifest as any).validation.cv_folds}</span>
                          {(manifest as any).validation.cv_block_size_km && (<>
                            <span className="text-sdm-muted">Block size:</span><span className="text-sdm-text">{(manifest as any).validation.cv_block_size_km} km</span>
                          </>)}
                          <span className="text-sdm-muted">Seed:</span><span className="text-sdm-text">{(manifest as any).validation.seed}</span>
                        </div>
                      </div>
                    )}
                    {(manifest as any).resources && (
                      <div>
                        <h4 className="text-xs font-medium text-sdm-muted uppercase mb-1">Resources (R)</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <span className="text-sdm-muted">CPU time:</span><span className="text-sdm-text">{(manifest as any).resources.r_cpu_time_ms != null ? `${((manifest as any).resources.r_cpu_time_ms / 1000).toFixed(1)}s` : "-"}</span>
                          <span className="text-sdm-muted">Peak memory:</span><span className="text-sdm-text">{(manifest as any).resources.r_peak_memory_mb != null ? `${(manifest as any).resources.r_peak_memory_mb} MB` : "-"}</span>
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
