"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import { RunComparison } from "@/components/evaluate/run-comparison";
import { ThresholdExplorer } from "@/components/evaluate/threshold-explorer";
import { VifTable } from "@/components/diagnostics/vif-table";
import { useRuns } from "@/hooks/use-runs";
import { apiGet } from "@/services/api";
import { BarChart3, Loader2, Image, Map as MapIcon } from "lucide-react";
import type { ImportanceData, ResponseCurvesData, CbiData, VifData, RunDetail as ApiRunDetail } from "@/services/types";

const NicheOverlap = dynamic(() => import("@/components/evaluate/niche-overlap"), { ssr: false });
const ImportanceChart = dynamic(() => import("@/components/diagnostics/importance-chart"), { ssr: false });
const ResponseCurvesChart = dynamic(() => import("@/components/diagnostics/response-curves-chart"), { ssr: false });
const CbiChart = dynamic(() => import("@/components/diagnostics/cbi-chart"), { ssr: false });
const SuitabilityMap = dynamic(
  () => import("@/components/results/suitability-map"),
  { ssr: false, loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div> }
);

export default function EvaluatePage() {
  const { data: runs, isLoading, error, refetch } = useRuns();
  const [selectedRun, setSelectedRun] = useState<ApiRunDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [vifData, setVifData] = useState<VifData | null>(null);
  const [importanceData, setImportanceData] = useState<ImportanceData | null>(null);
  const [responseCurvesData, setResponseCurvesData] = useState<ResponseCurvesData | null>(null);
  const [cbiData, setCbiData] = useState<CbiData | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  useEffect(() => {
    if (!runs) return;
    const allRuns = runs.runs || [];
    const completed = allRuns.filter((r) => r.status === "completed");
    if (completed.length > 0) {
      const first = completed[0];
      setSelectedId(first.id);
      apiGet<ApiRunDetail>(`/api/v1/sdm/status/${first.id}`)
        .then((detail) => setSelectedRun(detail))
        .catch(() => console.warn("[evaluate] Failed to fetch initial run details"));
    }
  }, [runs]);

  const selectRun = (id: string) => {
    setSelectedId(id);
    setVifData(null);
    setImportanceData(null);
    setResponseCurvesData(null);
    setCbiData(null);
    setLoadingDiagnostics(true);
    apiGet<ApiRunDetail>(`/api/v1/sdm/status/${id}`)
      .then((detail) => {
        setSelectedRun(detail);
        const fetchDiagnostics = async () => {
          const endpoints = [
            { url: `/api/v1/diagnostics/vif/${id}`, setter: setVifData },
            { url: `/api/v1/diagnostics/importance/${id}`, setter: setImportanceData },
            { url: `/api/v1/diagnostics/response-curves/${id}`, setter: setResponseCurvesData },
            { url: `/api/v1/diagnostics/cbi/${id}`, setter: setCbiData },
          ];
          await Promise.all(
            endpoints.map(async ({ url, setter }) => {
              try {
                const data = await apiGet<VifData | ImportanceData | ResponseCurvesData | CbiData>(url);
                setter(data);
              } catch {}
            })
          );
          setLoadingDiagnostics(false);
        };
        fetchDiagnostics();
      })
      .catch(() => setLoadingDiagnostics(false));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Evaluate</h1>
        <p className="text-sdm-muted">ROC curves, calibration plots, variable importance, and AOA.</p>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Evaluate</h1>
        <p className="text-sdm-muted">ROC curves, calibration plots, variable importance, and AOA.</p>
        <div className="rounded-lg border border-red-300/30 bg-red-500/5 p-8 text-center">
          <p className="text-sm text-sdm-danger">{error.message}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const allRuns = runs?.runs || [];
  const completedRuns = allRuns.filter((r) => r.status === "completed");
  const latestRun = completedRuns[0];

  const outputFiles = selectedRun?.output_files || {};
  const rocCurvePng = outputFiles.roc_curve_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.roc_curve_png)}`
    : null;
  const calibrationPng = outputFiles.calibration_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.calibration_png)}`
    : null;
  const cvFoldsPng = outputFiles.cv_folds_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.cv_folds_png)}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Evaluate</h1>
        <p className="text-sdm-muted mt-1">
          Compare model runs, explore thresholds, and assess model performance.
        </p>
      </div>

      <Tabs defaultValue="map" className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-6">
          <TabsTrigger value="map" className="flex items-center gap-1.5">
            <MapIcon className="h-3.5 w-3.5" />
            Map
          </TabsTrigger>
          <TabsTrigger value="comparison" className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="threshold">Threshold</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="niche">Niche</TabsTrigger>
          <TabsTrigger value="vif">VIF</TabsTrigger>
        </TabsList>

        <TabsContent value="map">
          {completedRuns.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {completedRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => selectRun(run.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      selectedId === run.id
                        ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                        : "border-sdm-border bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
                    }`}
                  >
                    {run.species} ({run.model_id})
                  </button>
                ))}
              </div>
              {selectedRun ? (
                <SuitabilityMap outputFiles={selectedRun.output_files} projectionExtent={(selectedRun.config?.projectionExtent as number[]) ?? null} runId={selectedRun.id} />
              ) : (
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
                  Select a run to view its suitability map.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
              No completed runs available. Run a model first to view suitability maps.
            </div>
          )}
        </TabsContent>

        <TabsContent value="comparison">
          <RunComparison runs={allRuns} />
        </TabsContent>

        <TabsContent value="threshold">
          {latestRun ? (
            <ThresholdExplorer
              aucMean={latestRun.metrics?.auc_mean}
              tssMean={latestRun.metrics?.tss_mean}
              sensitivity={latestRun.metrics?.sensitivity_mean}
              specificity={latestRun.metrics?.specificity_mean}
            />
          ) : (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
              Run a model first to explore thresholds.
            </div>
          )}
        </TabsContent>

        <TabsContent value="diagnostics">
          {completedRuns.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {completedRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => selectRun(run.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      selectedId === run.id
                        ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                        : "border-sdm-border bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
                    }`}
                  >
                    {run.species} ({run.model_id})
                  </button>
                ))}
              </div>

              {selectedRun && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Variable Importance</h4>
                      <ImportanceChart data={importanceData} loading={loadingDiagnostics} />
                      {!importanceData && outputFiles.variable_importance_png && (
                        <div className="mt-3 aspect-video relative">
                          <img
                            src={`/api/v1/results/file/${encodeURIComponent(outputFiles.variable_importance_png)}`}
                            alt="Variable importance PNG"
                            loading="lazy"
                            className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain"
                          />
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Response Curves</h4>
                      <ResponseCurvesChart data={responseCurvesData} loading={loadingDiagnostics} />
                      {!responseCurvesData && outputFiles.response_curves_png && (
                        <div className="mt-3 aspect-video relative">
                          <img
                            src={`/api/v1/results/file/${encodeURIComponent(outputFiles.response_curves_png)}`}
                            alt="Response curves PNG"
                            loading="lazy"
                            className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">CBI</h4>
                      <CbiChart data={cbiData} loading={loadingDiagnostics} />
                      {!cbiData && outputFiles.cbi_png && (
                        <div className="mt-3 aspect-video relative">
                          <img
                            src={`/api/v1/results/file/${encodeURIComponent(outputFiles.cbi_png)}`}
                            alt="CBI PNG"
                            loading="lazy"
                            className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain"
                          />
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">ROC Curve</h4>
                      {rocCurvePng ? (
                        <div className="aspect-video relative">
                          <img src={rocCurvePng} alt="ROC curve" className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain" loading="lazy" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">
                          <Image className="h-4 w-4 mr-1" /> Not available
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Calibration</h4>
                      {calibrationPng ? (
                        <div className="aspect-video relative">
                          <img src={calibrationPng} alt="Calibration curve" className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain" loading="lazy" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">
                          <Image className="h-4 w-4 mr-1" /> Not available
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">CV Folds</h4>
                      {cvFoldsPng ? (
                        <div className="aspect-video relative">
                          <img src={cvFoldsPng} alt="CV folds" className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain" loading="lazy" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">
                          <Image className="h-4 w-4 mr-1" /> Not available
                        </div>
                      )}
                      {selectedRun.metrics && (
                        <div className="mt-3 grid grid-cols-4 gap-3 text-xs">
                          <div><span className="text-sdm-muted">AUC</span><p className="font-semibold text-sdm-text">{(selectedRun.metrics.auc_mean as number)?.toFixed(3)}</p></div>
                          <div><span className="text-sdm-muted">TSS</span><p className="font-semibold text-sdm-text">{(selectedRun.metrics.tss_mean as number)?.toFixed(3)}</p></div>
                          <div><span className="text-sdm-muted">AUC SD</span><p className="font-semibold text-sdm-text">{(selectedRun.metrics.auc_sd as number)?.toFixed(3)}</p></div>
                          <div><span className="text-sdm-muted">TSS SD</span><p className="font-semibold text-sdm-text">{(selectedRun.metrics.tss_sd as number)?.toFixed(3)}</p></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
              No completed runs available.
            </div>
          )}
        </TabsContent>

        <TabsContent value="niche">
          <NicheOverlap runs={completedRuns.map((r) => ({ id: r.id, species: r.species, model_id: r.model_id }))} />
        </TabsContent>

        <TabsContent value="vif">
          {completedRuns.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {completedRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => selectRun(run.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      selectedId === run.id
                        ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                        : "border-sdm-border bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
                    }`}
                  >
                    {run.species} ({run.model_id})
                  </button>
                ))}
              </div>
              <VifTable data={vifData} loading={loadingDiagnostics} />
            </div>
          ) : (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
              No completed runs available.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
