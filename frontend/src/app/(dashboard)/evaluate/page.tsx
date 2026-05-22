"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunComparison } from "@/components/evaluate/run-comparison";
import { ThresholdExplorer } from "@/components/evaluate/threshold-explorer";
import { NicheOverlap } from "@/components/evaluate/niche-overlap";
import { ImportanceChart } from "@/components/diagnostics/importance-chart";
import { ResponseCurvesChart } from "@/components/diagnostics/response-curves-chart";
import { CbiChart } from "@/components/diagnostics/cbi-chart";
import { VifTable } from "@/components/diagnostics/vif-table";
import { useRuns } from "@/hooks/use-runs";
import { BarChart3, Loader2, Image } from "lucide-react";

interface RunDetail {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  metrics: Record<string, number | null> | null;
  output_files: Record<string, string> | null;
  progress_log: string[];
}

export default function EvaluatePage() {
  const { data: runs, isLoading } = useRuns();
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [vifData, setVifData] = useState<Record<string, unknown> | null>(null);
  const [importanceData, setImportanceData] = useState<Record<string, unknown> | null>(null);
  const [responseCurvesData, setResponseCurvesData] = useState<Record<string, unknown> | null>(null);
  const [cbiData, setCbiData] = useState<Record<string, unknown> | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  useEffect(() => {
    if (!runs) return;
    const allRuns = runs.runs || [];
    const completed = allRuns.filter((r) => r.status === "completed");
    if (completed.length > 0) {
      const first = completed[0];
      setSelectedId(first.id);
      fetch(`/api/v1/sdm/status/${first.id}`, { signal: AbortSignal.timeout(10000) })
        .then((res) => res.json())
        .then((detail) => setSelectedRun(detail))
        .catch(() => {});
    }
  }, [runs]);

  const selectRun = (id: string) => {
    setSelectedId(id);
    setVifData(null);
    setImportanceData(null);
    setResponseCurvesData(null);
    setCbiData(null);
    setLoadingDiagnostics(true);
    fetch(`/api/v1/sdm/status/${id}`, { signal: AbortSignal.timeout(10000) })
      .then((res) => res.json())
      .then((detail) => {
        setSelectedRun(detail);
        const endpoints = [
          { url: `/api/v1/diagnostics/vif/${id}`, setter: setVifData },
          { url: `/api/v1/diagnostics/importance/${id}`, setter: setImportanceData },
          { url: `/api/v1/diagnostics/response-curves/${id}`, setter: setResponseCurvesData },
          { url: `/api/v1/diagnostics/cbi/${id}`, setter: setCbiData },
        ];
        Promise.all(
          endpoints.map(async ({ url, setter }) => {
            try {
              const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
              if (res.ok) setter(await res.json());
            } catch {}
          })
        ).finally(() => setLoadingDiagnostics(false));
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

      <Tabs defaultValue="comparison" className="space-y-4">
        <TabsList className="grid w-full max-w-lg grid-cols-5">
          <TabsTrigger value="comparison" className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="threshold">Threshold</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="niche">Niche</TabsTrigger>
          <TabsTrigger value="vif">VIF</TabsTrigger>
        </TabsList>

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
                      <ImportanceChart data={importanceData as any} loading={loadingDiagnostics} />
                      {outputFiles.variable_importance_png && (
                        <img
                          src={`/api/v1/results/file/${encodeURIComponent(outputFiles.variable_importance_png)}`}
                          alt="Variable importance PNG"
                          className="w-full mt-3 rounded border border-sdm-border/50"
                        />
                      )}
                    </div>
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Response Curves</h4>
                      <ResponseCurvesChart data={responseCurvesData as any} loading={loadingDiagnostics} />
                      {outputFiles.response_curves_png && (
                        <img
                          src={`/api/v1/results/file/${encodeURIComponent(outputFiles.response_curves_png)}`}
                          alt="Response curves PNG"
                          className="w-full mt-3 rounded border border-sdm-border/50"
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">CBI</h4>
                      <CbiChart data={cbiData as any} loading={loadingDiagnostics} />
                      {outputFiles.cbi_png && (
                        <img
                          src={`/api/v1/results/file/${encodeURIComponent(outputFiles.cbi_png)}`}
                          alt="CBI PNG"
                          className="w-full mt-3 rounded border border-sdm-border/50"
                        />
                      )}
                    </div>
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">ROC Curve</h4>
                      {rocCurvePng ? (
                        <img src={rocCurvePng} alt="ROC curve" className="w-full rounded border border-sdm-border/50" />
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
                        <img src={calibrationPng} alt="Calibration curve" className="w-full rounded border border-sdm-border/50" />
                      ) : (
                        <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">
                          <Image className="h-4 w-4 mr-1" /> Not available
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">CV Folds</h4>
                      {cvFoldsPng ? (
                        <img src={cvFoldsPng} alt="CV folds" className="w-full rounded border border-sdm-border/50" />
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
              <VifTable data={vifData as any} loading={loadingDiagnostics} />
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
