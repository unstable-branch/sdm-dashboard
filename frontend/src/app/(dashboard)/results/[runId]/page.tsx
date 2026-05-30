"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SuitabilityMap } from "@/components/results/suitability-map";
import { MetricCards } from "@/components/results/metric-cards";
import { DiagnosticsPanel } from "@/components/results/diagnostics-panel";
import { FutureProjectionPanel } from "@/components/results/future-projection-panel";
import { OdmapViewer } from "@/components/results/odmap-viewer";
import { ArrowLeft, Loader2, Download } from "lucide-react";
import { apiGet, fetchWithAuth } from "@/services/api";
import type { RunDetail } from "@/services/types";
import type { ViewState } from "react-map-gl/maplibre";

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

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const [odmapMd, setOdmapMd] = useState<string | null>(null);
  const [odmapCsv, setOdmapCsv] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchStatus = () => {
      if (cancelled) return;
      apiGet<RunDetail>(`/api/v1/sdm/status/${runId}`)
        .then((data) => {
          if (cancelled) return;
          setRun(data);
          setLoading(false);
          if (data.status === "completed") {
            fetchWithAuth(`/api/v1/results/${runId}/report.txt`)
              .then((res) => res.ok ? res.text() : null)
              .then((text) => { if (!cancelled) setReportText(text); })
              .catch(() => {});
            const odmapMdPath = data.output_files?.odmap_report_md;
            const odmapCsvPath = data.output_files?.odmap_report_csv;
            if (odmapMdPath) {
              fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(odmapMdPath)}`)
                .then((res) => res.ok ? res.text() : null)
                .then((text) => { if (!cancelled) setOdmapMd(text); })
                .catch(() => {});
            }
            if (odmapCsvPath) {
              fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(odmapCsvPath)}`)
                .then((res) => res.ok ? res.text() : null)
                .then((text) => { if (!cancelled) setOdmapCsv(text); })
                .catch(() => {});
            }
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
      </div>

      {run.status === "running" && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 text-sm text-sdm-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Model is still running...
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
            <TabsList className="grid w-full max-w-md grid-cols-4">
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="future">Future</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
            </TabsList>

            <TabsContent value="map">
              <SuitabilityMap
                outputFiles={run.output_files}
                initialViewState={extentToViewState((run.config?.projectionExtent ?? undefined) as [number, number, number, number] | undefined)}
                coordinates={extentToCoordinates((run.config?.projectionExtent ?? undefined) as [number, number, number, number] | undefined)}
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
                    {run.output_files?.odmap_report_csv && (
                      <a
                        href={`/api/v1/results/file/${encodeURIComponent(run.output_files.odmap_report_csv)}`}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP CSV
                      </a>
                    )}
                    {run.output_files?.odmap_report_md && (
                      <a
                        href={`/api/v1/results/file/${encodeURIComponent(run.output_files.odmap_report_md)}`}
                        className="inline-flex items-center gap-1.5 text-xs text-sdm-accent hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> ODMAP Markdown
                      </a>
                    )}
                    {run.output_files?.report && (
                      <a
                        href={`/api/v1/results/file/${encodeURIComponent(run.output_files.report)}`}
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
              {(odmapMd || odmapCsv) && (
                <OdmapViewer odmapMd={odmapMd} odmapCsv={odmapCsv} loading={false} />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
