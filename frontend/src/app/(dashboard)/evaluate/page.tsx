"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunComparison } from "@/components/evaluate/run-comparison";
import { ThresholdExplorer } from "@/components/evaluate/threshold-explorer";
import { BarChart3, Loader2 } from "lucide-react";

interface RunSummary {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  metrics: Record<string, number | null> | null;
}

export default function EvaluatePage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/sdm/runs")
      .then((res) => res.json())
      .then((data) => {
        setRuns(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
              <p className="text-sm text-sdm-heading mb-2">Diagnostic images are available in the Results tab for each run.</p>
              <p className="text-xs text-sdm-muted">
                Each completed run generates: ROC curve, variable importance, response curves, CV fold metrics, and Continuous Boyce Index.
              </p>
              <div className="mt-4 space-y-2">
                {completedRuns.slice(0, 5).map((run) => (
                  <a
                    key={run.id}
                    href={`/results/${run.id}`}
                    className="flex items-center justify-between rounded-md border border-sdm-border bg-sdm-surface-soft px-4 py-2 text-sm text-sdm-text hover:border-sdm-accent/50 transition-colors"
                  >
                    <span>{run.species} ({run.model_id})</span>
                    <span className="text-xs text-sdm-muted">
                      AUC: {(run.metrics?.auc_mean ?? 0).toFixed(3)}
                    </span>
                  </a>
                ))}
              </div>
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
