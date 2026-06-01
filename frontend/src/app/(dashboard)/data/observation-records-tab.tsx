"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { CleaningTable } from "@/components/data/cleaning-table";
import { SourceCounts } from "@/components/data/source-counts";
import { OccurrenceMap } from "@/components/data/occurrence-map";
import type { OccurrencePoint } from "./types";
import { Download, Trash2, RotateCcw, Flag, Filter } from "lucide-react";

type SourceFilter = "all" | "upload" | "gbif" | "gbif_download";

interface UndoEntry {
  action: "flag" | "unflag" | "bulk_remove";
  indices: number[];
}

interface ObservationRecordsTabProps {
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

export function ObservationRecordsTab({
  records,
  sourceCounts,
  ccLog,
  validRecords,
  originalRows,
}: ObservationRecordsTabProps) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [flaggedSet, setFlaggedSet] = useState<Set<number>>(new Set());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

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
    if (sourceFilter === "all") return records;
    return records.filter((r) => r.source === sourceFilter);
  }, [records, sourceFilter]);

  const sourceFilterOptions = useMemo(() => {
    const sources = new Set(records.map((r) => r.source).filter(Boolean));
    return Array.from(sources) as string[];
  }, [records]);

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        Clean occurrence data first to see observation records.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-2.5 py-1.5">
          <Filter className="h-3.5 w-3.5 text-sdm-muted" />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="bg-transparent text-xs font-medium text-sdm-text outline-none"
          >
            <option value="all">All sources</option>
            {sourceFilterOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-sdm-border bg-sdm-surface-soft px-2.5 py-1.5">
          <Flag className="h-3.5 w-3.5 text-sdm-danger" />
          <span className="text-xs font-medium text-sdm-danger">
            {flaggedSet.size} flagged
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={removeFlagged}
            disabled={flaggedSet.size === 0}
            className="inline-flex items-center gap-1 rounded-md border border-sdm-border px-2.5 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-danger/10 hover:border-sdm-danger/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Remove flagged
          </button>
          <button
            onClick={clearFlags}
            disabled={flaggedSet.size === 0}
            className="inline-flex items-center gap-1 rounded-md border border-sdm-border px-2.5 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Clear flags
          </button>
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-sdm-border px-2.5 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Undo
          </button>
          <button
            onClick={exportFlagged}
            disabled={flaggedSet.size === 0}
            className="inline-flex items-center gap-1 rounded-md border border-sdm-border px-2.5 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="h-3 w-3" />
            Export flagged (CSV)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <OccurrenceMap
            points={filteredRecords}
            flaggedIndices={flaggedSet}
            onPointClick={(idx) => toggleFlag(idx)}
          />
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sdm-muted mb-2">Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-sdm-muted">Original</p>
                <p className="text-lg font-bold text-sdm-heading">{originalRows.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-sdm-muted">Valid</p>
                <p className="text-lg font-bold text-sdm-accent">{validRecords.toLocaleString()}</p>
              </div>
            </div>
          </div>
          {sourceCounts && Object.keys(sourceCounts).length > 0 && (
            <SourceCounts counts={sourceCounts} total={validRecords} />
          )}
          {ccLog.length > 0 && (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-sdm-muted mb-2">
                Cleaning Log
              </h3>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {ccLog.map((line, i) => (
                  <p key={i} className="text-xs font-mono text-sdm-muted leading-tight">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <CleaningTable data={filteredRecords} onFlagToggle={toggleFlag} title="Observation Records" />
    </div>
  );
}
