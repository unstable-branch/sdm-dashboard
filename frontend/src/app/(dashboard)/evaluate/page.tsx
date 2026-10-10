"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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

type DiagnosticKey = "vif" | "importance" | "response-curves" | "cbi";
type DiagnosticState = "idle" | "loading" | "ready" | "error";
const INITIAL_DIAGNOSTICS: Record<DiagnosticKey, DiagnosticState> = {
  vif: "idle", importance: "idle", "response-curves": "idle", cbi: "idle",
};

function DiagnosticRequestState({ label, state, onRetry }: {
  label: string; state: DiagnosticState; onRetry: () => void;
}) {
  if (state === "loading") return <p role="status" className="py-4 text-sm text-sdm-muted">Loading {label}…</p>;
  if (state !== "error") return null;
  return (
    <div role="alert" className="rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-4 text-sm">
      <p className="text-sdm-danger">{label} could not be loaded. This does not establish that the output is absent.</p>
      <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-sdm-border px-3 py-2 text-sdm-text hover:bg-sdm-surface-soft">Retry {label}</button>
    </div>
  );
}

function fmtMetric(v: unknown): string {
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === "")) return "—";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : "—";
}

export default function EvaluatePage() {
  const { data: runs, isLoading, error, refetch } = useRuns();
  const [selectedRun, setSelectedRun] = useState<ApiRunDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [runError, setRunError] = useState(false);

  const [vifData, setVifData] = useState<VifData | null>(null);
  const [importanceData, setImportanceData] = useState<ImportanceData | null>(null);
  const [responseCurvesData, setResponseCurvesData] = useState<ResponseCurvesData | null>(null);
  const [cbiData, setCbiData] = useState<CbiData | null>(null);
  const [diagnosticStates, setDiagnosticStates] = useState(INITIAL_DIAGNOSTICS);
  const latestRequestRef = useRef(0);

  const loadDiagnostic = useCallback(async (key: DiagnosticKey, id: string, requestId: number) => {
    if (requestId !== latestRequestRef.current) return;
    setDiagnosticStates(prev => ({ ...prev, [key]: "loading" }));
    const setters = { vif: setVifData, importance: setImportanceData, "response-curves": setResponseCurvesData, cbi: setCbiData };
    try {
      const data = await apiGet<VifData | ImportanceData | ResponseCurvesData | CbiData>(`/api/v1/diagnostics/${key}/${id}`);
      if (requestId !== latestRequestRef.current) return;
      if (data.error) throw new Error("Diagnostic response reports failure");
      setters[key](data);
      setDiagnosticStates(prev => ({ ...prev, [key]: "ready" }));
    } catch {
      if (requestId !== latestRequestRef.current) return;
      setDiagnosticStates(prev => ({ ...prev, [key]: "error" }));
    }
  }, []);

  const selectRun = useCallback((id: string) => {
    const requestId = ++latestRequestRef.current;
    setSelectedId(id);
    setSelectedRun(null);
    setLoadingRun(true);
    setRunError(false);
    setVifData(null);
    setImportanceData(null);
    setResponseCurvesData(null);
    setCbiData(null);
    setDiagnosticStates(INITIAL_DIAGNOSTICS);
    apiGet<ApiRunDetail>(`/api/v1/sdm/status/${id}`)
      .then((detail) => {
        if (requestId !== latestRequestRef.current) return;
        setSelectedRun(detail);
        setLoadingRun(false);
        (Object.keys(INITIAL_DIAGNOSTICS) as DiagnosticKey[]).forEach(key => {
          void loadDiagnostic(key, id, requestId);
        });
      })
      .catch(() => {
        if (requestId !== latestRequestRef.current) return;
        setLoadingRun(false);
        setRunError(true);
      });
  }, [loadDiagnostic]);

  useEffect(() => {
    if (!runs) return;
    const completed = (runs.runs || []).filter(run => run.status === "completed");
    if (selectedId && completed.some(run => run.id === selectedId)) return;
    if (completed.length > 0) {
      const first = completed.reduce((latest, run) =>
        (run.completed_at ?? "") > (latest.completed_at ?? "") ? run : latest
      );
      selectRun(first.id);
    } else if (selectedId) {
      latestRequestRef.current++;
      setSelectedId(null);
      setSelectedRun(null);
      setVifData(null);
      setImportanceData(null);
      setResponseCurvesData(null);
      setCbiData(null);
      setLoadingRun(false);
      setDiagnosticStates(INITIAL_DIAGNOSTICS);
      setRunError(false);
    }
  }, [runs, selectedId, selectRun]);

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
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-sdm-accent">Model evidence and diagnostics</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-sdm-heading">Evaluate</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-sdm-muted">
          Inspect a completed run, compare model evidence and explore diagnostics. Completion alone does not establish scientific validity.
        </p>
      </div>

      {completedRuns.length > 0 && <section aria-label="Evaluation context" className="rounded-xl border border-sdm-border bg-sdm-surface p-5 sm:p-6">
        <label className="block max-w-2xl text-sm font-medium text-sdm-text">
          Evaluation run
          <select value={selectedId ?? ""} onChange={event => selectRun(event.target.value)} className="mt-2 block min-h-11 w-full rounded-lg border border-sdm-border bg-sdm-surface-soft px-3 font-normal text-sdm-text focus-visible:outline-2 focus-visible:outline-sdm-accent">
            {!selectedId && <option value="" disabled>Select a completed run</option>}
            {completedRuns.map(run => <option key={run.id} value={run.id}>{run.species || "Unnamed run"} ({run.model_id}) · {run.id}</option>)}
          </select>
        </label>
        <p className="mt-3 text-sm leading-6 text-sdm-muted">Applies to Map, Threshold, Diagnostics and VIF. Compare and Niche use their own multi-run selections.</p>
        {loadingRun && <p role="status" className="mt-3 text-sm text-sdm-muted">Loading selected run details…</p>}
        {runError && <div role="alert" className="mt-4 rounded-lg border border-sdm-danger/30 p-4">
          <p className="text-sm text-sdm-danger">Selected run details could not be loaded. No previous run's map or metrics are shown in their place.</p>
          <button type="button" onClick={() => selectedId && selectRun(selectedId)} className="mt-3 rounded-md border border-sdm-border px-3 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft focus-visible:outline-2 focus-visible:outline-sdm-accent">Retry selected run</button>
        </div>}
      </section>}

      <Tabs defaultValue="map" className="space-y-4">
        <TabsList aria-label="Evaluation views" className="flex h-auto w-full flex-wrap justify-start gap-1">
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
              {selectedRun ? (
                <SuitabilityMap outputFiles={selectedRun.output_files} projectionExtent={(selectedRun.config?.projectionExtent as number[]) ?? null} runId={selectedRun.id} />
              ) : (
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
                  {loadingRun ? "Loading the selected run's suitability map…" : "Select a run, or retry its details above, to view the suitability map."}
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
          {selectedRun ? (
            <ThresholdExplorer
              aucMean={selectedRun.metrics?.auc_mean as number | null | undefined}
              tssMean={selectedRun.metrics?.tss_mean as number | null | undefined}
              sensitivity={selectedRun.metrics?.sensitivity_mean as number | null | undefined}
              specificity={selectedRun.metrics?.specificity_mean as number | null | undefined}
            />
          ) : (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
              {selectedId ? "The selected run's details are not ready. Check its loading or error state above." : "Run a model first to explore thresholds."}
            </div>
          )}
        </TabsContent>

        <TabsContent value="diagnostics">
          {completedRuns.length > 0 ? (
            <div className="space-y-4">
              {selectedRun && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Variable Importance</h4>
                      {diagnosticStates.importance === "loading" || diagnosticStates.importance === "error" ? (
                        <DiagnosticRequestState label="Variable importance" state={diagnosticStates.importance} onRetry={() => selectedId && void loadDiagnostic("importance", selectedId, latestRequestRef.current)} />
                      ) : importanceData?.available ? (
                        <ImportanceChart data={importanceData} loading={false} />
                      ) : outputFiles.variable_importance_png ? (
                        <div className="mt-3 aspect-video relative">
                          <img
                            src={`/api/v1/results/file/${encodeURIComponent(outputFiles.variable_importance_png)}`}
                            alt="Variable importance PNG"
                            loading="lazy"
                            className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">Not available</div>
                      )}
                    </div>
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Response Curves</h4>
                      {diagnosticStates["response-curves"] === "loading" || diagnosticStates["response-curves"] === "error" ? (
                        <DiagnosticRequestState label="Response curves" state={diagnosticStates["response-curves"]} onRetry={() => selectedId && void loadDiagnostic("response-curves", selectedId, latestRequestRef.current)} />
                      ) : responseCurvesData?.available ? (
                        <ResponseCurvesChart data={responseCurvesData} loading={false} />
                      ) : outputFiles.response_curves_png ? (
                        <div className="mt-3 aspect-video relative">
                          <img
                            src={`/api/v1/results/file/${encodeURIComponent(outputFiles.response_curves_png)}`}
                            alt="Response curves PNG"
                            loading="lazy"
                            className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">Not available</div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                      <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">CBI</h4>
                      {diagnosticStates.cbi === "loading" || diagnosticStates.cbi === "error" ? (
                        <DiagnosticRequestState label="CBI" state={diagnosticStates.cbi} onRetry={() => selectedId && void loadDiagnostic("cbi", selectedId, latestRequestRef.current)} />
                      ) : cbiData?.available ? (
                        <CbiChart data={cbiData} loading={false} />
                      ) : outputFiles.cbi_png ? (
                        <div className="mt-3 aspect-video relative">
                          <img
                            src={`/api/v1/results/file/${encodeURIComponent(outputFiles.cbi_png)}`}
                            alt="CBI PNG"
                            loading="lazy"
                            className="absolute inset-0 w-full h-full rounded border border-sdm-border/50 object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">Not available</div>
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
                          <div><span className="text-sdm-muted">AUC</span><p className="font-semibold text-sdm-text">{fmtMetric(selectedRun.metrics.auc_mean)}</p></div>
                          <div><span className="text-sdm-muted">TSS</span><p className="font-semibold text-sdm-text">{fmtMetric(selectedRun.metrics.tss_mean)}</p></div>
                          <div><span className="text-sdm-muted">AUC SD</span><p className="font-semibold text-sdm-text">{fmtMetric(selectedRun.metrics.auc_sd)}</p></div>
                          <div><span className="text-sdm-muted">TSS SD</span><p className="font-semibold text-sdm-text">{fmtMetric(selectedRun.metrics.tss_sd)}</p></div>
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
              {diagnosticStates.vif === "error" ? (
                <DiagnosticRequestState label="VIF" state={diagnosticStates.vif} onRetry={() => selectedId && void loadDiagnostic("vif", selectedId, latestRequestRef.current)} />
              ) : (
                <>
                  <DiagnosticRequestState label="VIF" state={diagnosticStates.vif} onRetry={() => selectedId && void loadDiagnostic("vif", selectedId, latestRequestRef.current)} />
                  <VifTable data={vifData} loading={loadingRun || diagnosticStates.vif === "loading"} />
                </>
              )}
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
