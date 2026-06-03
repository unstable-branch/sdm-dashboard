"use client";

import { useState, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VifTable } from "@/components/diagnostics/vif-table";
import { MessSummary } from "@/components/diagnostics/mess-summary";
import { OverfittingPanel } from "@/components/results/overfitting-panel";
import { apiGet } from "@/services/api";
import ErrorBoundary from "@/components/ui/error-boundary";
import { Download, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import type {
  VifData, ImportanceData, ResponseCurvesData, CbiData, MessData,
  RocData, CalibrationData, CvFoldsData, ThresholdData, DensityData,
  RunDetail,
} from "@/services/types";


function ChartLoading() {
  return (
    <div className="flex items-center justify-center h-64 text-sdm-muted">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      <span className="text-sm">Loading chart...</span>
    </div>
  );
}

type ChartProps = { data: any; loading: boolean };

const DynCvFoldsChart = dynamic(() => import("@/components/diagnostics/cv-folds-chart").then(m => ({ default: m.CvFoldsChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynImportanceChart = dynamic(() => import("@/components/diagnostics/importance-chart").then(m => ({ default: m.ImportanceChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynResponseCurvesChart = dynamic(() => import("@/components/diagnostics/response-curves-chart").then(m => ({ default: m.ResponseCurvesChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynRocChart = dynamic(() => import("@/components/diagnostics/roc-chart").then(m => ({ default: m.RocChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynCbiChart = dynamic(() => import("@/components/diagnostics/cbi-chart").then(m => ({ default: m.CbiChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynCalibrationChart = dynamic(() => import("@/components/diagnostics/calibration-chart").then(m => ({ default: m.CalibrationChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynThresholdChart = dynamic(() => import("@/components/diagnostics/threshold-chart").then(m => ({ default: m.ThresholdChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynDensityChart = dynamic(() => import("@/components/diagnostics/density-chart").then(m => ({ default: m.DensityChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynAleChart = dynamic(() => import("@/components/diagnostics/ale-chart").then(m => ({ default: m.AleChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;
const DynClimateDriverChart = dynamic(() => import("@/components/diagnostics/climate-driver-chart").then(m => ({ default: m.ClimateDriverChart })), { ssr: false, loading: () => <ChartLoading /> }) as React.ComponentType<ChartProps>;

interface DiagnosticsPanelProps {
  run: RunDetail;
}

export function DiagnosticsPanel({ run }: DiagnosticsPanelProps) {
  const outputFiles = run.output_files || {};
  const diagnosticsZip = outputFiles.diagnostics_zip
    ? `/api/v1/results/file/download?path=${encodeURIComponent(outputFiles.diagnostics_zip)}`
    : null;

  const [vifData, setVifData] = useState<VifData | null>(null);
  const [importanceData, setImportanceData] = useState<ImportanceData | null>(null);
  const [responseCurvesData, setResponseCurvesData] = useState<ResponseCurvesData | null>(null);
  const [cbiData, setCbiData] = useState<CbiData | null>(null);
  const [messData, setMessData] = useState<MessData | null>(null);
  const [rocData, setRocData] = useState<RocData | null>(null);
  const [calibrationData, setCalibrationData] = useState<CalibrationData | null>(null);
  const [cvFoldsData, setCvFoldsData] = useState<CvFoldsData | null>(null);
  const [thresholdData, setThresholdData] = useState<ThresholdData | null>(null);
  const [densityData, setDensityData] = useState<DensityData | null>(null);
  const [aleData, setAleData] = useState<any>(null);
  const [climateDriverData, setClimateDriverData] = useState<any>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true);
  const [failedEndpointCount, setFailedEndpointCount] = useState(0);
  const [activeTab, setActiveTab] = useState("cv");
  const fetchedTabs = useRef(new Set<string>());

  const TAB_ENDPOINTS: Record<string, string> = {
    cv: "cv-folds", importance: "importance", curves: "response-curves",
    roc: "roc", cbi: "cbi", calibration: "calibration",
    threshold: "threshold", density: "density", vif: "vif",
    mess: "mess", ale: "ale", "climate-drivers": "climate-drivers",
  };

  const TAB_SETTERS: Record<string, (data: any) => void> = {
    cv: setCvFoldsData, importance: setImportanceData, curves: setResponseCurvesData,
    roc: setRocData, cbi: setCbiData, calibration: setCalibrationData,
    threshold: setThresholdData, density: setDensityData, vif: setVifData,
    mess: setMessData, ale: setAleData, "climate-drivers": setClimateDriverData,
  };

  // Fetch data only when the active tab is clicked for the first time
  useEffect(() => {
    if (run.status !== "completed") {
      setLoadingDiagnostics(false);
      return;
    }
    if (fetchedTabs.current.has(activeTab)) {
      setLoadingDiagnostics(false);
      return;
    }
    fetchedTabs.current.add(activeTab);
    setLoadingDiagnostics(true);

    const ep = TAB_ENDPOINTS[activeTab];
    const setter = TAB_SETTERS[activeTab];
    if (ep && setter) {
      apiGet<any>(`/api/v1/diagnostics/${ep}/${run.id}`)
        .then((data) => { setter(data); setLoadingDiagnostics(false); })
        .catch((err) => {
          console.warn(`[diagnostics] Failed to fetch ${ep}:`, err instanceof Error ? err.message : String(err));
          setFailedEndpointCount((c) => c + 1);
          setLoadingDiagnostics(false);
        });
    } else {
      setLoadingDiagnostics(false);
    }
  }, [activeTab, run.id, run.status]);

  return (
    <div className="space-y-4">
      {diagnosticsZip && (
        <div className="flex justify-end">
          <a
            href={diagnosticsZip}
            className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download all data (ZIP)
          </a>
        </div>
      )}

      {!loadingDiagnostics && failedEndpointCount >= 12 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
          The R computation backend is not available — all diagnostic endpoints failed to load.
          Start it with <code className="bg-amber-500/10 px-1 rounded">docker compose up plumber</code> or <code className="bg-amber-500/10 px-1 rounded">Rscript launch_app.R</code>.
        </div>
      )}

      {!loadingDiagnostics && failedEndpointCount > 0 && failedEndpointCount < 12 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
          {failedEndpointCount} of 12 diagnostics endpoints could not be loaded. Some charts may show &ldquo;Not available&rdquo;.
        </div>
      )}

      <ErrorBoundary>
      <Tabs defaultValue="cv" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex overflow-x-auto gap-1 pb-px scrollbar-thin">
          <TabsTrigger value="cv" className="text-xs shrink-0">CV Folds</TabsTrigger>
          <TabsTrigger value="importance" className="text-xs shrink-0">Importance</TabsTrigger>
          <TabsTrigger value="curves" className="text-xs shrink-0">Response Curves</TabsTrigger>
          <TabsTrigger value="roc" className="text-xs shrink-0">ROC</TabsTrigger>
          <TabsTrigger value="cbi" className="text-xs shrink-0">CBI</TabsTrigger>
          <TabsTrigger value="calibration" className="text-xs shrink-0">Calibration</TabsTrigger>
          <TabsTrigger value="threshold" className="text-xs shrink-0">Threshold</TabsTrigger>
          <TabsTrigger value="density" className="text-xs shrink-0">Density</TabsTrigger>
          <TabsTrigger value="vif" className="text-xs shrink-0">VIF</TabsTrigger>
          <TabsTrigger value="mess" className="text-xs shrink-0">MESS</TabsTrigger>
          <TabsTrigger value="ale" className="text-xs shrink-0">ALE</TabsTrigger>
          <TabsTrigger value="climate-drivers" className="text-xs shrink-0">Climate</TabsTrigger>
          <TabsTrigger value="overfitting" className="text-xs shrink-0 text-amber-500">Overfitting</TabsTrigger>
          <TabsTrigger value="log" className="text-xs shrink-0">Log</TabsTrigger>
        </TabsList>

        <TabsContent value="cv">
          <DynCvFoldsChart data={cvFoldsData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="importance">
          <DynImportanceChart data={importanceData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="curves">
          <DynResponseCurvesChart data={responseCurvesData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="roc">
          <DynRocChart data={rocData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="cbi">
          <DynCbiChart data={cbiData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="calibration">
          <DynCalibrationChart data={calibrationData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="threshold">
          <DynThresholdChart data={thresholdData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="density">
          <DynDensityChart data={densityData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="vif">
          <VifTable data={vifData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="mess">
          <MessSummary data={messData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="ale">
          <DynAleChart data={aleData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="climate-drivers">
          <DynClimateDriverChart data={climateDriverData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="overfitting">
          <OverfittingPanel run={run} />
        </TabsContent>

        <TabsContent value="log">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
            <h3 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">
              Performance log
            </h3>
            <div className="rounded bg-sdm-surface-soft p-3 font-mono text-xs text-sdm-muted max-h-96 overflow-y-auto">
              {run.progress_log.length > 0 ? (
                run.progress_log.map((line, i) => (
                  <div key={i} className="truncate">{line}</div>
                ))
              ) : (
                <span className="italic">No log entries</span>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
      </ErrorBoundary>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h3 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">
          Run configuration
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="text-sdm-muted">Model</div>
          <div className="text-sdm-text font-medium">{run.model_id}</div>
          <div className="text-sdm-muted">Species</div>
          <div className="text-sdm-text font-medium">{run.species}</div>
          <div className="text-sdm-muted">Started</div>
          <div className="text-sdm-text">{new Date(run.started_at).toLocaleString()}</div>
          {run.completed_at && (
            <>
              <div className="text-sdm-muted">Completed</div>
              <div className="text-sdm-text">{new Date(run.completed_at).toLocaleString()}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
export { DiagnosticsPanel as default }
