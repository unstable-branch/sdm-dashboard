"use client";

import { useState, useEffect } from "react";
import { ConservationSummary } from "@/components/ecology/conservation-summary";
import { ExportPanel } from "@/components/ecology/export-panel";
import { useCompletedRuns } from "@/hooks/use-runs";
import { Leaf, Loader2 } from "lucide-react";

export default function EcologyPage() {
  const { data: runs, isLoading } = useCompletedRuns();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  useEffect(() => {
    if (runs.length > 0 && !selectedRun) {
      setSelectedRun(runs[0].id);
    }
  }, [runs, selectedRun]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Ecology</h1>
        <p className="text-sdm-muted">EOO/AOO, AOA, climate matching, and conservation status.</p>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Ecology</h1>
        <p className="text-sdm-muted mt-1">
          Extent and area of occurrence, area of applicability, and conservation status.
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center">
          <Leaf className="h-10 w-10 text-sdm-muted mx-auto mb-3" />
          <p className="text-sm text-sdm-heading font-medium">No completed runs available</p>
          <p className="text-xs text-sdm-muted mt-1">Run a model first to see ecology outputs.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
              <h3 className="text-sm font-semibold text-sdm-heading">Select a run</h3>
              <div className="space-y-1">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRun(run.id)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                      selectedRun === run.id
                        ? "bg-sdm-accent/10 text-sdm-accent border border-sdm-accent/30"
                        : "bg-sdm-surface-soft text-sdm-text hover:bg-sdm-surface border border-transparent"
                    }`}
                  >
                    <p className="font-medium">{run.species}</p>
                    <p className="text-xs text-sdm-muted">{run.model_id} · {new Date(run.started_at).toLocaleDateString()}</p>
                  </button>
                ))}
              </div>
            </div>

            {selectedRun && (
              <div className="mt-4">
                <ExportPanel runId={selectedRun} />
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            {selectedRun ? (
              <ConservationSummary runId={selectedRun} />
            ) : (
              <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
                Select a run to view ecology data.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
