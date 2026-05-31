"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VifTable } from "@/components/diagnostics/vif-table";
import { ImportanceChart } from "@/components/diagnostics/importance-chart";
import { ResponseCurvesChart } from "@/components/diagnostics/response-curves-chart";
import { CbiChart } from "@/components/diagnostics/cbi-chart";
import { CvFoldsChart } from "@/components/diagnostics/cv-folds-chart";
import { RocChart } from "@/components/diagnostics/roc-chart";
import { CalibrationChart } from "@/components/diagnostics/calibration-chart";
import { ThresholdChart } from "@/components/diagnostics/threshold-chart";
import { DensityChart } from "@/components/diagnostics/density-chart";
import { AleChart } from "@/components/diagnostics/ale-chart";
import { ClimateDriverChart } from "@/components/diagnostics/climate-driver-chart";
import { MessSummary } from "@/components/diagnostics/mess-summary";
import { OverfittingPanel } from "@/components/results/overfitting-panel";
import { apiGet } from "@/services/api";
import { Download } from "lucide-react";
import type {
  VifData, ImportanceData, ResponseCurvesData, CbiData, MessData,
  RocData, CalibrationData, CvFoldsData, ThresholdData, DensityData,
  RunDetail,
} from "@/services/types";

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

  useEffect(() => {
    if (run.status !== "completed") {
      setLoadingDiagnostics(false);
      return;
    }

    setLoadingDiagnostics(true);
    const fetchDiagnostics = async () => {
      const endpoints = [
        { url: `/api/v1/diagnostics/vif/${run.id}`, setter: setVifData },
        { url: `/api/v1/diagnostics/importance/${run.id}`, setter: setImportanceData },
        { url: `/api/v1/diagnostics/response-curves/${run.id}`, setter: setResponseCurvesData },
        { url: `/api/v1/diagnostics/cbi/${run.id}`, setter: setCbiData },
        { url: `/api/v1/diagnostics/mess/${run.id}`, setter: setMessData },
        { url: `/api/v1/diagnostics/roc/${run.id}`, setter: setRocData },
        { url: `/api/v1/diagnostics/calibration/${run.id}`, setter: setCalibrationData },
        { url: `/api/v1/diagnostics/cv-folds/${run.id}`, setter: setCvFoldsData },
        { url: `/api/v1/diagnostics/threshold/${run.id}`, setter: setThresholdData },
        { url: `/api/v1/diagnostics/density/${run.id}`, setter: setDensityData },
        { url: `/api/v1/diagnostics/ale/${run.id}`, setter: setAleData },
        { url: `/api/v1/diagnostics/climate-drivers/${run.id}`, setter: setClimateDriverData },
      ];

      await Promise.all(
        endpoints.map(async ({ url, setter }) => {
          try {
            const data = await apiGet<any>(url);
            setter(data);
          } catch {
            // Silently fail — Recharts components handle null state
          }
        })
      );
      setLoadingDiagnostics(false);
    };

    fetchDiagnostics();
  }, [run.id, run.status]);

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

      <Tabs defaultValue="cv" className="space-y-4">
        <TabsList className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 w-full max-w-4xl">
          <TabsTrigger value="cv" className="text-xs">CV Folds</TabsTrigger>
          <TabsTrigger value="importance" className="text-xs">Importance</TabsTrigger>
          <TabsTrigger value="curves" className="text-xs">Response Curves</TabsTrigger>
          <TabsTrigger value="roc" className="text-xs">ROC</TabsTrigger>
          <TabsTrigger value="cbi" className="text-xs">CBI</TabsTrigger>
          <TabsTrigger value="calibration" className="text-xs">Calibration</TabsTrigger>
          <TabsTrigger value="threshold" className="text-xs">Threshold</TabsTrigger>
          <TabsTrigger value="density" className="text-xs">Density</TabsTrigger>
          <TabsTrigger value="vif" className="text-xs">VIF</TabsTrigger>
          <TabsTrigger value="mess" className="text-xs">MESS</TabsTrigger>
          <TabsTrigger value="overfitting" className="text-xs text-amber-500">Overfitting</TabsTrigger>
          <TabsTrigger value="log" className="text-xs">Log</TabsTrigger>
        </TabsList>

        <TabsContent value="cv">
          <CvFoldsChart data={cvFoldsData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="importance">
          <ImportanceChart data={importanceData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="curves">
          <ResponseCurvesChart data={responseCurvesData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="roc">
          <RocChart data={rocData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="cbi">
          <CbiChart data={cbiData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="calibration">
          <CalibrationChart data={calibrationData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="threshold">
          <ThresholdChart data={thresholdData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="density">
          <DensityChart data={densityData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="vif">
          <VifTable data={vifData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="mess">
          <MessSummary data={messData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="ale">
          <AleChart data={aleData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="climate-drivers">
          <ClimateDriverChart data={climateDriverData} loading={loadingDiagnostics} />
        </TabsContent>

        <TabsContent value="overfitting">
          <OverfittingPanel run={run} />
        </TabsContent>

        <TabsContent value="shap">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface-soft p-6 text-center">
            <p className="text-sm text-sdm-muted">
              Click a cell on the <strong>suitability map</strong> (Results → Map tab) to get a per-pixel SHAP explanation.
            </p>
            <p className="text-xs text-sdm-muted mt-2">
              SHAP values decompose the model prediction into per-covariate contributions,
              showing which environmental variables drive suitability at each location.
            </p>
          </div>
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
