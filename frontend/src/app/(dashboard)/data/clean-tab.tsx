"use client";

import { JobProgress } from "@/components/jobs/job-progress";
import { SourceCounts } from "@/components/data/source-counts";
import { CleaningTable } from "@/components/data/cleaning-table";
import { CheckCircle2, Loader2, AlertTriangle, Wand2 } from "lucide-react";
import type { OccurrencePoint } from "./types";

interface CleanTabProps {
  uploadResult: Record<string, unknown> | null;
  cleanResult: Record<string, unknown> | null;
  cleanLoading: boolean;
  cleanError: string | null;
  cleanJobId: string | null;
  useAsync: boolean;
  useCc: boolean;
  maxCoordUncertainty: string;

  onSetUseAsync: (v: boolean) => void;
  onSetUseCc: (v: boolean) => void;
  onSetMaxCoordUncertainty: (v: string) => void;
  onClean: () => void;
  onCleanComplete: (result: Record<string, unknown>) => void;
  onFlagToggle: (idx: number, flagged: boolean) => void;
  onRunModel: () => void;
}

export function CleanTab({
  uploadResult, cleanResult, cleanLoading, cleanError, cleanJobId,
  useAsync, useCc, maxCoordUncertainty,
  onSetUseAsync, onSetUseCc, onSetMaxCoordUncertainty, onClean, onCleanComplete, onFlagToggle, onRunModel,
}: CleanTabProps) {
  const cleanPreview = cleanResult?.cleaned_records as OccurrencePoint[] | undefined;
  const sourceCounts = cleanResult?.source_counts as Record<string, number> | undefined;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h2 className="text-lg font-semibold text-sdm-heading mb-4">Clean occurrence data</h2>
        <p className="text-sm text-sdm-muted mb-4">
          Remove duplicates, filter invalid coordinates, and optionally run CoordinateCleaner tests.
        </p>

        <div className="flex items-center gap-4 mb-4">
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useAsync} onChange={(e) => onSetUseAsync(e.target.checked)}
              className="rounded border-sdm-border bg-sdm-surface-soft" />
            Run in background (for large datasets)
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useCc} onChange={(e) => onSetUseCc(e.target.checked)}
              className="rounded border-sdm-border bg-sdm-surface-soft" />
            CoordinateCleaner
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <span>Max coord uncertainty (m):</span>
            <input type="number" min={0} step={100} placeholder="No filter" value={maxCoordUncertainty}
              onChange={(e) => onSetMaxCoordUncertainty(e.target.value)}
              className="w-28 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text" />
          </label>
        </div>

        <button onClick={onClean}
          disabled={cleanLoading || !uploadResult?.file_id || !!cleanJobId}
          className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
          {cleanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {cleanLoading ? "Cleaning..." : cleanJobId ? "Running..." : "Run cleaning"}
        </button>

        {cleanError && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
            <span>{cleanError}</span>
          </div>
        )}
        {cleanJobId && (
          <div className="mt-4">
            <JobProgress jobId={cleanJobId} onComplete={onCleanComplete} />
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 mt-2">
              <div className="flex items-center gap-2 text-sm text-sdm-muted">
                <Loader2 className="h-4 w-4 animate-spin text-sdm-accent" />
                Cleaning in background...
              </div>
            </div>
          </div>
        )}
      </div>

      {cleanResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Original</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{String(cleanResult.original_rows)}</p>
            </div>
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Valid</p>
              <p className="mt-1 text-xl font-bold text-sdm-accent">{(Number(cleanResult.valid_records) || 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Bad coords</p>
              <p className="mt-1 text-xl font-bold text-sdm-danger">{String(cleanResult.removed_bad_coordinates)}</p>
            </div>
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Duplicates</p>
              <p className="mt-1 text-xl font-bold text-sdm-warning">{String(cleanResult.removed_duplicates)}</p>
            </div>
          </div>

          {sourceCounts && <SourceCounts counts={sourceCounts} total={Number(cleanResult.valid_records) || 0} />}

          {cleanPreview && cleanPreview.length > 0 && (
            <CleaningTable data={cleanPreview} title="Cleaned records" onFlagToggle={onFlagToggle} />
          )}

          {(Number(cleanResult.valid_records) || 0) > 0 ? (
            <div className="flex items-center justify-between rounded-md border border-indigo-500/30 bg-indigo-500/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-indigo-500">
                <CheckCircle2 className="h-4 w-4" />
                <span>Cleaned: {(Number(cleanResult.valid_records) || 0).toLocaleString()} valid records ready</span>
              </div>
              <button onClick={onRunModel} className="text-sm font-medium text-sdm-accent hover:underline">
                Run SDM with cleaned data →
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border border-sdm-danger/30 bg-sdm-danger/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-sdm-danger">
                <AlertTriangle className="h-4 w-4" />
                <span>Cleaning produced 0 valid records — check your data</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
