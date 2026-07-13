"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost } from "@/services/api";
import { Loader2, Layers, Beaker, AlertTriangle } from "lucide-react";
import type { UploadFile } from "@/services/types";

interface ExampleInfo {
  name: string;
  fileName: string;
  species: number;
  totalRecords: number;
  cleanRecords: number;
  dirtyRecords: number;
  description: string;
  isMultiSpecies: boolean;
  hasCoordinateCleanerTests: boolean;
}

interface SyntheticExamplesPanelProps {
  onAddToWorkspace: (file: UploadFile, species?: string) => void;
  reloadTrigger?: number;
}

export function SyntheticExamplesPanel({ onAddToWorkspace, reloadTrigger }: SyntheticExamplesPanelProps) {
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ examples: ExampleInfo[] }>("/api/v1/data/examples/details")
      .then((data) => {
        if (data?.examples) {
          setExamples(data.examples.filter((e) => e.totalRecords > 0));
        }
      })
      .catch(() => setError("Failed to load synthetic test data"))
      .finally(() => setLoading(false));
  }, [reloadTrigger]);

  const loadExample = useCallback(async (name: string) => {
    setLoadingName(name);
    setError(null);
    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/examples/load", { name });
      const fileId = (result.file_id as string) || (result.file_path as string) || "";
      const nRows = typeof result.n_rows === "number" ? result.n_rows : 0;
      const speciesDetected = (result.species_detected as string) || null;
      const speciesNames = (result.species_names as string[]) || [];
      const speciesOverride = speciesNames.length > 0
        ? speciesNames.join(", ")
        : speciesDetected || undefined;

      const file: UploadFile = {
        file_id: fileId,
        file_name: `${name}.csv`,
        file_size: 0,
        n_rows: nRows,
        cleaned: false,
        modified_at: new Date().toISOString(),
        species: speciesOverride || undefined,
        format: "csv",
      };
      onAddToWorkspace(file, speciesOverride || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load example");
    } finally {
      setLoadingName(null);
    }
  }, [onAddToWorkspace]);

  const handleDragStart = useCallback((e: React.DragEvent, name: string) => {
    e.dataTransfer.setData("application/x-sdm-example", name);
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed border-sdm-border/60 bg-sdm-surface-soft/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-sdm-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading synthetic test data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-sdm-danger/40 bg-sdm-danger/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-sdm-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (examples.length === 0) return null;

  return (
    <div className="space-y-2">
      {examples.map((ex) => (
        <div
          key={ex.name}
          draggable
          onDragStart={(e) => handleDragStart(e, ex.name)}
          className="flex items-center gap-3 rounded-lg border border-dashed border-sdm-border/60 bg-sdm-surface-soft/30 px-4 py-3 transition-colors hover:border-sdm-accent/40 hover:bg-sdm-surface-soft/50 cursor-grab active:cursor-grabbing"
        >
          <Layers className="h-4 w-4 shrink-0 text-sdm-muted" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sdm-heading">
              {ex.fileName}
              {ex.isMultiSpecies && (
                <span className="ml-1.5 inline-flex items-center rounded bg-purple-500/10 px-1.5 py-0.5 text-xs font-medium text-purple-500">
                  multi-species
                </span>
              )}
              {ex.hasCoordinateCleanerTests && (
                <span className="ml-1.5 inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-500">
                  CC tests
                </span>
              )}
            </p>
            <p className="text-xs text-sdm-muted mt-0.5">{ex.description}</p>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-sdm-muted">
              <span>{ex.species} species</span>
              <span>{ex.totalRecords.toLocaleString()} records</span>
              <span className="text-sdm-success">{ex.cleanRecords.toLocaleString()} clean</span>
              <span className="text-sdm-warning">{ex.dirtyRecords} dirty</span>
            </div>
          </div>
          <button
            onClick={() => loadExample(ex.name)}
            disabled={loadingName === ex.name}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-sdm-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 transition-colors"
          >
            {loadingName === ex.name ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading...
              </>
            ) : (
              "Load into workspace"
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
