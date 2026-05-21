"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunComparison } from "@/components/evaluate/run-comparison";
import { ThresholdExplorer } from "@/components/evaluate/threshold-explorer";
import { BarChart3, Loader2, Image } from "lucide-react";

interface RunSummary {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  metrics: Record<string, number | null> | null;
  output_files: Record<string, string> | null;
}

interface RunDetail extends RunSummary {
  progress_log: string[];
}

export default function EvaluatePage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/sdm/runs")
      .then((res) => res.json())
      .then((data) => {
        const allRuns = data.runs || [];
        setRuns(allRuns);
        const completed = allRuns.filter((r: RunSummary) => r.status === "completed");
        if (completed.length > 0) {
          const first = completed[0];
          setSelectedId(first.id);
          fetch(`/api/v1/sdm/status/${first.id}`)
            .then((res) => res.json())
            .then((detail) => setSelectedRun(detail))
            .catch(() => {});
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selectRun = (id: string) => {
    setSelectedId(id);
    fetch(`/api/v1/sdm/status/${id}`)
      .then((res) => res.json())
      .then((detail) => setSelectedRun(detail))
      .catch(() => {});
  };

  if (loading) {
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

  const completedRuns = runs.filter((r) => r.status === "completed");
  const latestRun = completedRuns[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Evaluate</h1>
        <p className="text-sdm-muted mt-1">
          Compare model runs, explore thresholds, and assess model performance.
        </p>
      </div>

      <Tabs defaultValue="comparison" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="comparison" className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="threshold">Threshold</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="comparison">
          <RunComparison runs={runs} />
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

              {selectedRun && selectedRun.output_files ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { key: "roc_curve_png", label: "ROC Curve" },
                    { key: "variable_importance_png", label: "Variable Importance" },
                    { key: "response_curves_png", label: "Response Curves" },
                    { key: "cv_folds_png", label: "CV Folds" },
                    { key: "cbi_png", label: "Continuous Boyce Index" },
                  ].map(({ key, label }) => {
                    const path = selectedRun.output_files?.[key];
                    const url = path ? `/api/v1/results/file/${encodeURIComponent(path)}` : null;
                    return (
                      <div key={key} className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
                        <div className="px-3 py-2 border-b border-sdm-border text-xs font-medium text-sdm-heading">{label}</div>
                        {url ? (
                          <img src={url} alt={label} className="w-full" />
                        ) : (
                          <div className="flex items-center justify-center h-48 text-sm text-sdm-muted italic">
                            <Image className="h-4 w-4 mr-1" /> Not available
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
                  Loading diagnostic images...
                </div>
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
