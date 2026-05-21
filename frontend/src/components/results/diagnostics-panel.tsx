"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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

  const getMetric = (key: string) => {
    const val = run.metrics?.[key];
    return typeof val === "number" ? val.toFixed(3) : "—";
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="cv" className="space-y-4">
        <TabsList className="grid grid-cols-6 w-full max-w-2xl">
          <TabsTrigger value="cv" className="text-xs">CV Folds</TabsTrigger>
          <TabsTrigger value="importance" className="text-xs">Importance</TabsTrigger>
          <TabsTrigger value="curves" className="text-xs">Response Curves</TabsTrigger>
          <TabsTrigger value="roc" className="text-xs">ROC</TabsTrigger>
          <TabsTrigger value="cbi" className="text-xs">CBI</TabsTrigger>
          <TabsTrigger value="log" className="text-xs">Run Log</TabsTrigger>
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
          <DiagnosticImage src={variableImportancePng} label="Variable importance" className="max-h-[70vh]" />
        </TabsContent>

        <TabsContent value="curves">
          <DiagnosticImage src={responseCurvesPng} label="Response curves" className="max-h-[70vh]" />
        </TabsContent>

        <TabsContent value="roc">
          <DiagnosticImage src={rocCurvePng} label="ROC curve" className="max-h-[70vh]" />
        </TabsContent>

        <TabsContent value="cbi">
          <DiagnosticImage src={cbiPng} label="Continuous Boyce Index" className="max-h-[70vh]" />
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