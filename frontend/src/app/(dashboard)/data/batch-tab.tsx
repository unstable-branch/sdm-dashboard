"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiPost, apiGet } from "@/services/api";
import { useSDMStore } from "@/stores/sdm-store";
import { CheckCircle2, AlertTriangle, Loader2, Play, BarChart3, Layers } from "lucide-react";

interface BatchConfig {
  species: string;
  modelId: string;
  occurrenceFile: string;
  cleanedFilePath?: string;
  speciesFilter?: string;
}

interface SpeciesCheckbox {
  name: string;
  selected: boolean;
}

export function BatchTab() {
  const router = useRouter();
  const cleanResult = useSDMStore((s) => s.cleanResult);
  const uploadResult = useSDMStore((s) => s.uploadResult);
  const targetsRunId = useSDMStore((s) => s.targetsRunId);
  const setTargetsRunId = useSDMStore((s) => s.setTargetsRunId);
  const setTargetsProgress = useSDMStore((s) => s.setTargetsProgress);
  const targetsProgress = useSDMStore((s) => s.targetsProgress);
  const detectedSpecies = useSDMStore((s) => s.detectedSpecies);
  const setDetectedSpecies = useSDMStore((s) => s.setDetectedSpecies);

  const [species, setSpecies] = useState<SpeciesCheckbox[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [view, setView] = useState<"setup" | "progress" | "results">("setup");
  const [results, setResults] = useState<Record<string, Record<string, unknown>> | null>(null);

  useEffect(() => {
    if (detectedSpecies.length > 0) {
      setSpecies(detectedSpecies.map((n) => ({ name: n, selected: true })));
      return;
    }
    if (cleanResult?.species_counts) {
      const counts = cleanResult.species_counts as Record<string, number>;
      const names = Object.keys(counts);
      setDetectedSpecies(names);
      setSpecies(names.map((n) => ({ name: n, selected: true })));
      return;
    }
    setSpecies([]);
  }, [cleanResult, detectedSpecies, setDetectedSpecies]);

  const toggleSpecies = useCallback((name: string) => {
    setSpecies((prev) =>
      prev.map((s) => (s.name === name ? { ...s, selected: !s.selected } : s))
    );
  }, []);

  const selectAll = useCallback(() => {
    setSpecies((prev) => prev.map((s) => ({ ...s, selected: true })));
  }, []);

  const deselectAll = useCallback(() => {
    setSpecies((prev) => prev.map((s) => ({ ...s, selected: false })));
  }, []);

  const handleRun = useCallback(async () => {
    const selected = species.filter((s) => s.selected);
    if (selected.length === 0) return;
    setRunLoading(true);
    setRunError(null);
    try {
      const cleanedFileId = cleanResult?.cleaned_file_id as string || uploadResult?.file_id as string || "";
      const occurrenceFile = uploadResult?.file_id as string || "";
      const configs: BatchConfig[] = selected.map((s) => ({
        species: s.name,
        modelId: "glm",
        occurrenceFile,
        cleanedFilePath: cleanedFileId || undefined,
        speciesFilter: s.name,
      }));
      const result = await apiPost<Record<string, unknown>>("/api/v1/sdm/targets/run", { configs });
      const jid = (result.job_id || result.jobId) as string;
      setTargetsRunId(jid);
      setView("progress");
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to start batch run");
    } finally {
      setRunLoading(false);
    }
  }, [species, cleanResult, uploadResult, setTargetsRunId]);

  useEffect(() => {
    if (!targetsRunId || view !== "progress") return;
    const interval = setInterval(async () => {
      try {
        const status = await apiGet<Record<string, unknown>>(`/api/v1/sdm/targets/status/${targetsRunId}`);
        const tp = status.targets_progress as Record<string, unknown> | null;
        if (tp) {
          setTargetsProgress({
            completed: (tp.completed as number) || 0,
            errored: (tp.errored as number) || 0,
            running: (tp.running as number) || 0,
            total: (tp.total_targets as number) || 0,
          });
        }
        if (status.status === "completed") {
          clearInterval(interval);
          fetchResults();
        } else if (status.status === "failed" || status.status === "cancelled") {
          clearInterval(interval);
          setRunError((status.error as string) || "Pipeline failed");
        }
      } catch {
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [targetsRunId, view, setTargetsProgress]);

  const fetchResults = useCallback(async () => {
    if (!targetsRunId) return;
    try {
      const data = await apiGet<Record<string, unknown>>(`/api/v1/sdm/targets/results/${targetsRunId}`);
      setResults(data.results as Record<string, Record<string, unknown>>);
      setView("results");
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to fetch results");
    }
  }, [targetsRunId]);

  if (view === "setup") {
    const selectedCount = species.filter((s) => s.selected).length;
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-sdm-heading">Batch Run Setup</h2>
          <p className="text-sm text-sdm-muted mt-1">
            Select species to run in batch. Cleaned data is required first.
          </p>
        </div>

        {species.length === 0 && (
          <div className="rounded-lg border border-sdm-warning/30 bg-sdm-warning/5 p-4 text-sm text-sdm-warning flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>No species detected. Clean occurrence data with multiple species first.</span>
          </div>
        )}

        {species.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={selectAll} className="text-xs text-sdm-accent hover:underline">Select all</button>
              <span className="text-sdm-muted">/</span>
              <button onClick={deselectAll} className="text-xs text-sdm-accent hover:underline">Clear</button>
              <span className="text-xs text-sdm-muted ml-auto">{selectedCount} of {species.length} selected</span>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto rounded-lg border border-sdm-border bg-sdm-surface p-2">
              {species.map((s) => (
                <label key={s.name} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sdm-bg cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={s.selected}
                    onChange={() => toggleSpecies(s.name)}
                    className="h-4 w-4 rounded border-sdm-border text-sdm-accent"
                  />
                  {s.name}
                </label>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleRun}
                disabled={selectedCount === 0 || runLoading}
                className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50"
              >
                {runLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {runLoading ? "Starting..." : `Run ${selectedCount} species`}
              </button>
              {runError && (
                <span className="text-sm text-sdm-danger">{runError}</span>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  if (view === "progress") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Batch Progress</h2>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
          {targetsProgress ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Loader2 className="h-5 w-5 animate-spin text-sdm-accent" />
                <span className="text-sm text-sdm-muted">Pipeline running...</span>
              </div>
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-md border border-sdm-border p-3 text-center">
                  <p className="text-2xl font-bold text-sdm-heading">{targetsProgress.total}</p>
                  <p className="text-xs text-sdm-muted">Total targets</p>
                </div>
                <div className="rounded-md border border-sdm-border p-3 text-center">
                  <p className="text-2xl font-bold text-sdm-accent">{targetsProgress.completed}</p>
                  <p className="text-xs text-sdm-muted">Completed</p>
                </div>
                <div className="rounded-md border border-sdm-border p-3 text-center">
                  <p className="text-2xl font-bold text-sdm-warning">{targetsProgress.running}</p>
                  <p className="text-xs text-sdm-muted">Running</p>
                </div>
                <div className="rounded-md border border-sdm-border p-3 text-center">
                  <p className="text-2xl font-bold text-sdm-danger">{targetsProgress.errored}</p>
                  <p className="text-xs text-sdm-muted">Errored</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-sdm-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Queued...
            </div>
          )}
        </div>
        {runError && (
          <div className="rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">{runError}</div>
        )}
      </div>
    );
  }

  if (view === "results") {
    const entries = results ? Object.entries(results) : [];
    const successCount = entries.filter(([, r]) => r.status === "completed").length;
    const errorCount = entries.filter(([, r]) => r.status === "errored").length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-sdm-heading">Batch Results</h2>
            <p className="text-sm text-sdm-muted mt-1">{successCount} succeeded, {errorCount} failed</p>
          </div>
          <button onClick={() => setView("setup")} className="text-sm text-sdm-accent hover:underline">New batch</button>
        </div>

        {entries.length === 0 && (
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">No results available.</div>
        )}

        {entries.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-sdm-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sdm-border bg-sdm-surface">
                  <th className="px-4 py-2 text-left font-medium text-sdm-muted">Species</th>
                  <th className="px-4 py-2 text-left font-medium text-sdm-muted">Status</th>
                  <th className="px-4 py-2 text-right font-medium text-sdm-muted">AUC</th>
                  <th className="px-4 py-2 text-right font-medium text-sdm-muted">TSS</th>
                  <th className="px-4 py-2 text-right font-medium text-sdm-muted">CBI</th>
                  <th className="px-4 py-2 text-right font-medium text-sdm-muted">Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sdm-border">
                {entries.map(([name, r]) => {
                  const m = r.metrics as Record<string, unknown> | null;
                  return (
                    <tr key={name} className="bg-sdm-bg hover:bg-sdm-surface/80">
                      <td className="px-4 py-2 text-sdm-heading">{name}</td>
                      <td className="px-4 py-2">
                        {r.status === "completed" ? (
                          <span className="inline-flex items-center gap-1 text-sdm-accent">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sdm-danger" title={r.error as string || ""}>
                            <AlertTriangle className="h-3.5 w-3.5" /> Error
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{m ? Number(m.auc_mean).toFixed(3) : "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{m ? Number(m.tss_mean).toFixed(3) : "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{m ? Number(m.cbi).toFixed(3) : "—"}</td>
                      <td className="px-4 py-2 text-right">{m ? Number(m.presence_records).toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push("/model")}
            className="inline-flex items-center gap-2 rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-sm text-sdm-text hover:bg-sdm-bg"
          >
            <BarChart3 className="h-4 w-4" /> View in Model
          </button>
          <button
            onClick={() => router.push("/ecology")}
            className="inline-flex items-center gap-2 rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-sm text-sdm-text hover:bg-sdm-bg"
          >
            <Layers className="h-4 w-4" /> Ecology
          </button>
        </div>
      </div>
    );
  }

  return null;
}
