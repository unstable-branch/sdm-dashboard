"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { CleaningTable } from "@/components/data/cleaning-table";
import { SourceCounts } from "@/components/data/source-counts";
import { X, Download, RotateCcw, Filter, AlertTriangle } from "lucide-react";
import type { OccurrencePoint } from "@/app/(dashboard)/data/types";

type SourceFilter = "all" | "upload" | "gbif" | "gbif_download";

interface UndoEntry {
  action: "flag" | "unflag" | "bulk_remove";
  indices: number[];
}

interface ReviewRecordsModalProps {
  open: boolean;
  onClose: () => void;
  records: OccurrencePoint[];
  sourceCounts: Record<string, number>;
  ccLog: string[];
  validRecords: number;
  originalRows: number;
}

function csvExport(records: OccurrencePoint[], indices: number[], filename: string) {
  if (indices.length === 0) return;
  const selected = indices.map((i) => records[i]);
  const keys = Array.from(new Set(selected.flatMap(Object.keys)));
  const header = keys.join(",");
  const rows = selected.map((r) =>
    keys.map((k) => {
      const v = r[k];
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReviewRecordsModal({
  open, onClose, records, sourceCounts, ccLog, validRecords, originalRows,
}: ReviewRecordsModalProps) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [flaggedSet, setFlaggedSet] = useState<Set<number>>(new Set());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false);

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => [entry, ...prev].slice(0, 10));
  }, []);

  const toggleFlag = useCallback(
    (idx: number) => {
      setFlaggedSet((prev) => {
        const next = new Set(prev);
        const wasFlagged = next.has(idx);
        if (wasFlagged) next.delete(idx);
        else next.add(idx);
        pushUndo({ action: wasFlagged ? "unflag" : "flag", indices: [idx] });
        return next;
      });
    },
    [pushUndo]
  );

  const removeFlagged = useCallback(() => {
    const indices = Array.from(flaggedSet);
    if (indices.length === 0) return;
    pushUndo({ action: "bulk_remove", indices });
    setFlaggedSet(new Set());
  }, [flaggedSet, pushUndo]);

  const clearFlags = useCallback(() => {
    const indices = Array.from(flaggedSet);
    if (indices.length === 0) return;
    pushUndo({ action: "bulk_remove", indices });
    setFlaggedSet(new Set());
  }, [flaggedSet, pushUndo]);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const [last, ...rest] = prev;
      setFlaggedSet((current) => {
        const next = new Set(current);
        if (last.action === "flag" || last.action === "bulk_remove") {
          last.indices.forEach((i) => next.delete(i));
        } else if (last.action === "unflag") {
          last.indices.forEach((i) => next.add(i));
        }
        return next;
      });
      return rest;
    });
  }, []);

  const exportFlagged = useCallback(() => {
    const indices = Array.from(flaggedSet);
    csvExport(records, indices, "flagged_records.csv");
  }, [flaggedSet, records]);

  const filteredRecords = useMemo(() => {
    let result = records;
    if (sourceFilter !== "all") {
      result = result.filter((r) => r.source === sourceFilter);
    }
    if (showOnlyFlagged && flaggedSet.size > 0) {
      result = result.filter((_, i) => flaggedSet.has(i));
    }
    return result;
  }, [records, sourceFilter, showOnlyFlagged, flaggedSet]);

  const sourceFilterOptions = useMemo(() => {
    const sources = new Set(records.map((r) => r.source).filter(Boolean));
    return Array.from(sources) as string[];
  }, [records]);

  useEffect(() => {
    if (open) {
      setFlaggedSet(new Set());
      setUndoStack([]);
      setSourceFilter("all");
      setShowOnlyFlagged(false);
    }
  }, [open]);

  if (!open || records.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-5xl rounded-lg border border-sdm-border bg-sdm-bg shadow-xl max-h-[calc(100vh-4rem)] flex flex-col">
        <div className="flex items-center justify-between border-b border-sdm-border px-6 py-4">
          <h2 className="text-lg font-semibold text-sdm-heading">
            Review Records
          </h2>
          <button onClick={onClose} className="rounded p-1 text-sdm-muted hover:text-sdm-text">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Original</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{originalRows.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Valid</p>
              <p className="mt-1 text-xl font-bold text-sdm-accent">{validRecords.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Flagged</p>
              <p className="mt-1 text-xl font-bold text-sdm-warning">{flaggedSet.size}</p>
            </div>
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Undo</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{undoStack.length}</p>
            </div>
          </div>

          <SourceCounts counts={sourceCounts} total={validRecords} />

          {ccLog.length > 0 && (
            <details className="rounded-lg border border-sdm-border bg-sdm-surface">
              <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-sdm-heading">
                CoordinateCleaner log ({ccLog.length} entries)
              </summary>
              <div className="max-h-32 overflow-y-auto px-4 pb-3 space-y-0.5">
                {ccLog.map((entry, i) => (
                  <p key={i} className="text-xs text-sdm-muted font-mono">{entry}</p>
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-sdm-muted" />
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
                className="rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text"
              >
                <option value="all">All sources</option>
                {sourceFilterOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-sdm-text cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyFlagged}
                onChange={(e) => setShowOnlyFlagged(e.target.checked)}
                className="rounded border-sdm-border bg-sdm-surface-soft"
              />
              Flagged only
            </label>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <button onClick={removeFlagged} disabled={flaggedSet.size === 0}
                className="flex items-center gap-1 rounded border border-sdm-danger/30 bg-sdm-danger/5 px-2.5 py-1 text-xs font-medium text-sdm-danger hover:bg-sdm-danger/10 disabled:opacity-50">
                Remove flagged
              </button>
              <button onClick={clearFlags} disabled={flaggedSet.size === 0}
                className="flex items-center gap-1 rounded border border-sdm-border px-2.5 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-50">
                Clear flags
              </button>
              <button onClick={undo} disabled={undoStack.length === 0}
                className="flex items-center gap-1 rounded border border-sdm-border px-2.5 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-50">
                <RotateCcw className="h-3 w-3" /> Undo
              </button>
              <button onClick={exportFlagged} disabled={flaggedSet.size === 0}
                className="flex items-center gap-1 rounded border border-sdm-border px-2.5 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-50">
                <Download className="h-3 w-3" /> Export CSV
              </button>
            </div>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3 text-sm text-sdm-warning">
              <AlertTriangle className="h-4 w-4" />
              <span>No records match the current filter.</span>
            </div>
          ) : (
            <CleaningTable data={filteredRecords} onFlagToggle={toggleFlag} title={`Records (${filteredRecords.length} of ${records.length})`} />
          )}
        </div>
      </div>
    </div>
  );
}
