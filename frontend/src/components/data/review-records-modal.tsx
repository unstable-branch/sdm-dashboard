"use client";

import { useState, useCallback, useMemo, useEffect, useRef, useReducer } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CleaningTable } from "@/components/data/cleaning-table";
import { SourceCounts } from "@/components/data/source-counts";
import { X, Download, RotateCcw, Filter, AlertTriangle } from "lucide-react";
import type { OccurrencePoint } from "@/app/(dashboard)/data/types";

type SourceFilter = "all" | "upload" | "gbif" | "gbif_download" | "ala";

interface PreviewSelection {
  flags: ReadonlySet<number>;
  history: ReadonlySet<number>[];
}

type SelectionAction = { type: "toggle"; index: number } | { type: "clear" } | { type: "undo" } | { type: "reset" };

function selectionReducer(state: PreviewSelection, action: SelectionAction): PreviewSelection {
  if (action.type === "reset") return { flags: new Set(), history: [] };
  if (action.type === "undo") {
    const [previous, ...history] = state.history;
    return previous ? { flags: previous, history } : state;
  }
  if (action.type === "clear" && state.flags.size === 0) return state;
  const flags = new Set(state.flags);
  if (action.type === "clear") flags.clear();
  else if (flags.has(action.index)) flags.delete(action.index);
  else flags.add(action.index);
  return { flags, history: [state.flags, ...state.history].slice(0, 10) };
}

interface ReviewRecordsModalProps {
  open: boolean;
  onClose: () => void;
  records: OccurrencePoint[];
  sourceCounts: Record<string, number>;
  ccLog: string[];
  validRecords: number | null;
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
      return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  const [{ flags: flaggedSet, history: undoStack }, dispatchSelection] = useReducer(selectionReducer, { flags: new Set<number>(), history: [] });
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const toggleFlag = (index: number) => dispatchSelection({ type: "toggle", index });
  const clearFlags = () => dispatchSelection({ type: "clear" });

  const undo = () => dispatchSelection({ type: "undo" });

  const exportFlagged = useCallback(() => {
    const indices = Array.from(flaggedSet);
    csvExport(records, indices, "flagged_records.csv");
  }, [flaggedSet, records]);

  const visibleIndices = useMemo(() => {
    return records.flatMap((record, index) => {
      if (sourceFilter !== "all" && record.source !== sourceFilter) return [];
      if (showOnlyFlagged && !flaggedSet.has(index)) return [];
      return [index];
    });
  }, [records, sourceFilter, showOnlyFlagged, flaggedSet]);
  const filteredRecords = useMemo(() => visibleIndices.map((index) => records[index]), [records, visibleIndices]);
  const visibleFlags = useMemo(() => new Set(visibleIndices.flatMap((index, position) => flaggedSet.has(index) ? [position] : [])), [visibleIndices, flaggedSet]);

  const sourceFilterOptions = useMemo(() => {
    const sources = new Set(records.map((r) => r.source).filter(Boolean));
    return Array.from(sources) as string[];
  }, [records]);

  useEffect(() => {
    if (open) {
      dispatchSelection({ type: "reset" });
      setSourceFilter("all");
      setShowOnlyFlagged(false);
    }
  }, [open, records]);

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <Dialog.Content
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          closeRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current?.focus();
        }}
        className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 rounded-lg border border-sdm-border bg-sdm-bg shadow-xl max-h-[calc(100dvh-2rem)] flex flex-col sm:top-8 sm:max-h-[calc(100dvh-4rem)]"
      >
        <div className="flex items-center justify-between border-b border-sdm-border px-6 py-4">
          <Dialog.Title className="text-lg font-semibold text-sdm-heading">
            Review Records
          </Dialog.Title>
          <Dialog.Close asChild>
          <button ref={closeRef} type="button" aria-label="Close record review" className="rounded p-2 text-sdm-muted hover:text-sdm-text focus-visible:outline-2 focus-visible:outline-sdm-accent">
            <X className="h-5 w-5" />
          </button>
          </Dialog.Close>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Original</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{originalRows.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Valid</p>
              <p className="mt-1 text-xl font-bold text-sdm-accent">{validRecords == null ? "Unavailable" : validRecords.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Manual flags</p>
              <p className="mt-1 text-xl font-bold text-sdm-warning">{flaggedSet.size}</p>
            </div>
            <div className="rounded-md border border-sdm-border bg-sdm-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Undo</p>
              <p className="mt-1 text-xl font-bold text-sdm-heading">{undoStack.length}</p>
            </div>
          </div>

          <Dialog.Description className="text-sm text-sdm-muted">
            Loaded {records.length.toLocaleString()} preview rows; {validRecords == null ? "the cleaned record count is unavailable" : `the cleaned dataset contains ${validRecords.toLocaleString()} valid records`}.
            {" "}Manual flags apply to this preview only and are not saved to the dataset. CoordinateCleaner findings are recorded separately in the cleaning log.
          </Dialog.Description>

          {validRecords != null && <SourceCounts counts={sourceCounts} total={validRecords} />}

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
                aria-label="Filter preview by source"
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
              <span>{records.length === 0 ? "No detailed record data available. Summary counts shown above." : "No records match the current filter."}</span>
            </div>
          ) : (
            <CleaningTable data={filteredRecords} flaggedRows={visibleFlags} onFlagToggle={(position) => toggleFlag(visibleIndices[position])} title={`Preview rows (${filteredRecords.length.toLocaleString()} shown / ${records.length.toLocaleString()} loaded)`} />
          )}
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
