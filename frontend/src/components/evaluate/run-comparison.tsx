"use client";

import { useState, useEffect } from "react";
import { BarChart3, ArrowRight } from "lucide-react";
import { apiGet } from "@/services/api";
import type { RunDetail } from "@/services/types";
import { RunComparisonReport } from "./run-comparison-report";

type RunSummary = import("@/services/types").RunSummary;

interface RunComparisonProps {
  runs: RunSummary[];
}

export function RunComparison({ runs }: RunComparisonProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [runDetails, setRunDetails] = useState<Record<string, RunSummary>>({});
  const [detailedReport, setDetailedReport] = useState(false);

  const completedRuns = runs.filter((r) => r.status === "completed");

  useEffect(() => {
    const fetchDetails = async () => {
      const details: Record<string, RunSummary> = {};
      await Promise.all(
        completedRuns.map(async (r) => {
          try {
            const full = await apiGet<RunDetail>(`/api/v1/sdm/status/${r.id}`);
            details[r.id] = { ...r, config: full.config };
          } catch {
            details[r.id] = r;
          }
        })
      );
      setRunDetails(details);
    };
    fetchDetails();
  }, [completedRuns]);

  const toggleRun = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  };

  const selectedRuns = selected.map((id) => runDetails[id]).filter(Boolean);

  const metrics = ["auc_mean", "auc_sd", "tss_mean", "tss_sd", "elapsed_seconds", "presence_records", "background_points"];
  const metricLabels: Record<string, string> = {
    auc_mean: "AUC (mean)",
    auc_sd: "AUC (SD)",
    tss_mean: "TSS (mean)",
    tss_sd: "TSS (SD)",
    elapsed_seconds: "Elapsed (s)",
    presence_records: "Presence records",
    background_points: "Background points",
  };

  const formatMetric = (key: string, value: number | null | undefined): string => {
    if (value == null) return "—";
    if (key.includes("seconds")) return `${Math.round(value)}s`;
    if (key.includes("records") || key.includes("points")) return value.toLocaleString();
    if (key.includes("sd")) return value.toFixed(4);
    return value.toFixed(3);
  };

  if (completedRuns.length === 0) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        <BarChart3 className="h-8 w-8 mx-auto mb-2 text-sdm-muted/50" />
        <p className="text-sm">No completed runs to compare.</p>
        <p className="text-xs mt-1">Run a model first to see evaluation comparisons.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-sdm-heading mb-2">Select runs to compare (up to 4)</h3>
        <div className="flex flex-wrap gap-2">
          {completedRuns.map((run) => (
            <button
              key={run.id}
              onClick={() => toggleRun(run.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                selected.includes(run.id)
                  ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                  : "border-sdm-border bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
              }`}
            >
              {run.species} ({run.model_id})
            </button>
          ))}
        </div>
      </div>

      {selectedRuns.length > 0 && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-sdm-border">
                  <th className="text-left px-4 py-2 font-medium text-sdm-muted">Metric</th>
                  {selectedRuns.map((run) => (
                    <th key={run.id} className="text-right px-4 py-2 font-medium text-sdm-heading">
                      {run.species}
                      <span className="block text-sdm-muted font-normal">{run.model_id}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map((key) => (
                  <tr key={key} className="border-b border-sdm-border/50">
                    <td className="px-4 py-2 text-sdm-text font-medium">{metricLabels[key]}</td>
                    {selectedRuns.map((run) => {
                      const value = run.metrics?.[key] as number | null | undefined;
                      const formatted = formatMetric(key, value);
                      const isBest = selectedRuns.length > 1 && (key === "auc_mean" || key === "tss_mean") && value != null;
                      const bestValue = isBest
                        ? Math.max(...selectedRuns.map((r) => (r.metrics?.[key] as number) || 0))
                        : null;
                      const isTop = isBest && value === bestValue;

                      return (
                        <td key={run.id} className={`px-4 py-2 text-right tabular-nums ${isTop ? "text-sdm-accent font-semibold" : "text-sdm-text"}`}>
                          {formatted}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedRuns.length >= 2 && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">Configuration differences</h4>
          <div className="grid grid-cols-2 gap-4 text-xs">
            {selectedRuns.map((run) => (
              <div key={run.id} className="space-y-1">
                <p className="text-sdm-muted font-medium">{run.species}</p>
                <p className="text-sdm-text">Threshold: {String((run.config as Record<string, unknown> | undefined)?.threshold ?? "—")}</p>
                <p className="text-sdm-text">Started: {new Date(run.started_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedRuns.length === 2 && (
        <div className="flex justify-center">
          <button
            onClick={() => setDetailedReport(!detailedReport)}
            className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 transition-colors"
          >
            {detailedReport ? "Hide" : "Show"} detailed comparison <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {detailedReport && selectedRuns.length === 2 && (
        <RunComparisonReport run1={selectedRuns[0] as RunDetail} run2={selectedRuns[1] as RunDetail} />
      )}
    </div>
  );
}
