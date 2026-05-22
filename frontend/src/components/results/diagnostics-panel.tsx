"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { VifTable } from "@/components/diagnostics/vif-table";
import { ImportanceChart } from "@/components/diagnostics/importance-chart";
import { ResponseCurvesChart } from "@/components/diagnostics/response-curves-chart";
import { CbiChart } from "@/components/diagnostics/cbi-chart";
import { MessSummary } from "@/components/diagnostics/mess-summary";

interface RunStatus {
  id: string;
  status: string;
  species: string;
  model_id: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  metrics: Record<string, unknown> | null;
  output_files: Record<string, string> | null;
  progress_log: string[];
}

interface DiagnosticsPanelProps {
  run: RunStatus;
}

function DiagnosticImage({
  src,
  label,
  className,
}: {
  src: string | null;
  label: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-sdm-border bg-sdm-surface-soft h-64 text-sm text-sdm-muted italic",
          className
        )}
      >
        {label} — not yet available
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={label}
      className={cn("rounded-lg border border-sdm-border w-full object-contain", className)}
    />
  );
}

export function DiagnosticsPanel({ run }: DiagnosticsPanelProps) {
  const outputFiles = run.output_files || {};

  const cvFoldsPng = outputFiles.cv_folds_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.cv_folds_png)}`
    : null;

  const variableImportancePng = outputFiles.variable_importance_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.variable_importance_png)}`
    : null;

  const responseCurvesPng = outputFiles.response_curves_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.response_curves_png)}`
    : null;

  const rocCurvePng = outputFiles.roc_curve_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.roc_curve_png)}`
    : null;

  const cbiPng = outputFiles.cbi_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.cbi_png)}`
    : null;

  const calibrationPng = outputFiles.calibration_png
    ? `/api/v1/results/file/${encodeURIComponent(outputFiles.calibration_png)}`
    : null;

  const [vifData, setVifData] = useState<Record<string, unknown> | null>(null);
  const [importanceData, setImportanceData] = useState<Record<string, unknown> | null>(null);
  const [responseCurvesData, setResponseCurvesData] = useState<Record<string, unknown> | null>(null);
  const [cbiData, setCbiData] = useState<Record<string, unknown> | null>(null);
  const [messData, setMessData] = useState<Record<string, unknown> | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true);

  useEffect(() => {
    if (run.status !== "completed") return;

    setLoadingDiagnostics(true);
    const endpoints = [
      { url: `/api/v1/diagnostics/vif/${run.id}`, setter: setVifData },
      { url: `/api/v1/diagnostics/importance/${run.id}`, setter: setImportanceData },
      { url: `/api/v1/diagnostics/response-curves/${run.id}`, setter: setResponseCurvesData },
      { url: `/api/v1/diagnostics/cbi/${run.id}`, setter: setCbiData },
      { url: `/api/v1/diagnostics/mess/${run.id}`, setter: setMessData },
    ];

    Promise.all(
      endpoints.map(async ({ url, setter }) => {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            setter(data);
          }
        } catch {
          // Silently fail — PNG fallback remains
        }
      })
    ).finally(() => setLoadingDiagnostics(false));
  }, [run.id, run.status]);

  const getMetric = (key: string) => {
    const val = run.metrics?.[key];
    return typeof val === "number" ? val.toFixed(3) : "—";
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="cv" className="space-y-4">
        <TabsList className="grid grid-cols-9 w-full max-w-4xl">
          <TabsTrigger value="cv" className="text-xs">CV Folds</TabsTrigger>
          <TabsTrigger value="importance" className="text-xs">Importance</TabsTrigger>
          <TabsTrigger value="curves" className="text-xs">Response Curves</TabsTrigger>
          <TabsTrigger value="roc" className="text-xs">ROC</TabsTrigger>
          <TabsTrigger value="cbi" className="text-xs">CBI</TabsTrigger>
          <TabsTrigger value="calibration" className="text-xs">Calibration</TabsTrigger>
          <TabsTrigger value="vif" className="text-xs">VIF</TabsTrigger>
          <TabsTrigger value="mess" className="text-xs">MESS</TabsTrigger>
          <TabsTrigger value="log" className="text-xs">Log</TabsTrigger>
        </TabsList>

        <TabsContent value="cv">
          <div className="space-y-4">
            <DiagnosticImage src={cvFoldsPng} label="CV Folds bar chart" />
            {run.metrics && (
              <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">
                  CV Summary
                </h4>
                <div className="grid grid-cols-4 gap-6 text-sm">
                  <div>
                    <div className="text-sdm-muted text-xs mb-1">AUC Mean</div>
                    <div className="text-sdm-text font-semibold tabular-nums">{getMetric("auc_mean")}</div>
                  </div>
                  <div>
                    <div className="text-sdm-muted text-xs mb-1">AUC SD</div>
                    <div className="text-sdm-text font-semibold tabular-nums">{getMetric("auc_sd")}</div>
                  </div>
                  <div>
                    <div className="text-sdm-muted text-xs mb-1">TSS Mean</div>
                    <div className="text-sdm-text font-semibold tabular-nums">{getMetric("tss_mean")}</div>
                  </div>
                  <div>
                    <div className="text-sdm-muted text-xs mb-1">TSS SD</div>
                    <div className="text-sdm-text font-semibold tabular-nums">{getMetric("tss_sd")}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="importance">
          <div className="space-y-4">
            <ImportanceChart
              data={importanceData as any}
              loading={loadingDiagnostics}
            />
            <DiagnosticImage src={variableImportancePng} label="Variable importance (PNG fallback)" className="max-h-[40vh]" />
          </div>
        </TabsContent>

        <TabsContent value="curves">
          <div className="space-y-4">
            <ResponseCurvesChart
              data={responseCurvesData as any}
              loading={loadingDiagnostics}
            />
            <DiagnosticImage src={responseCurvesPng} label="Response curves (PNG fallback)" className="max-h-[40vh]" />
          </div>
        </TabsContent>

        <TabsContent value="roc">
          <DiagnosticImage src={rocCurvePng} label="ROC curve" className="max-h-[70vh]" />
        </TabsContent>

        <TabsContent value="cbi">
          <div className="space-y-4">
            <CbiChart
              data={cbiData as any}
              loading={loadingDiagnostics}
            />
            <DiagnosticImage src={cbiPng} label="CBI (PNG fallback)" className="max-h-[40vh]" />
          </div>
        </TabsContent>

        <TabsContent value="calibration">
          <DiagnosticImage src={calibrationPng} label="Calibration Curve" className="max-h-[70vh]" />
        </TabsContent>

        <TabsContent value="vif">
          <VifTable
            data={vifData as any}
            loading={loadingDiagnostics}
          />
        </TabsContent>

        <TabsContent value="mess">
          <MessSummary
            data={messData as any}
            loading={loadingDiagnostics}
          />
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
