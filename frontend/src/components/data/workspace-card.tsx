"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, BadgeCheck, CircleAlert, Eye, Minus, RotateCcw, ArrowRight } from "lucide-react";
import type { WorkspaceFile } from "@/app/(dashboard)/data/types";

interface WorkspaceCardProps {
  item: WorkspaceFile;
  index: number;
  onUpdate: (id: string, updates: Partial<WorkspaceFile>) => void;
  onRemove: (id: string) => void;
  onClean: (id: string) => void;
  onReviewRecords: (id: string) => void;
  onOpenInModel: (id: string) => void;
  disabled?: boolean;
}

export function WorkspaceCard({
  item, index, onUpdate, onRemove, onClean, onReviewRecords, onOpenInModel, disabled,
}: WorkspaceCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "workspace", item },
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCleaned = !!item.cleanedFileId;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      data-dragging={isDragging || undefined}
      className="rounded-lg border border-sdm-border bg-sdm-surface transition-shadow
        data-[dragging]:opacity-50 data-[dragging]:shadow-lg"
    >
      <div className="flex items-start gap-3 p-4">
        <button
          {...listeners}
          className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-sdm-muted hover:text-sdm-text"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-sdm-heading">{item.fileName}</span>
            <span className="text-xs text-sdm-muted shrink-0">{item.fileRows.toLocaleString()} records</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-sdm-muted">Species:</label>
              <input
                type="text"
                value={item.selectedSpecies[0] || ""}
                onChange={(e) => onUpdate(item.id, { selectedSpecies: [e.target.value] })}
                placeholder="Enter species"
                disabled={disabled}
                className="w-44 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text
                  placeholder:text-sdm-muted focus:outline-none focus:ring-1 focus:ring-sdm-accent/50
                  disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {item.cleanLoading ? (
                <span className="flex items-center gap-1 text-xs text-sdm-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> Cleaning...
                </span>
              ) : isCleaned ? (
                <span className="flex items-center gap-1 text-xs text-sdm-success">
                  <BadgeCheck className="h-3 w-3" /> Cleaned — {item.cleanValidRecords?.toLocaleString()} valid records
                </span>
              ) : item.cleanError ? (
                <span className="flex items-center gap-1 text-xs text-sdm-danger">
                  <CircleAlert className="h-3 w-3" /> {item.cleanError}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-sdm-muted">
                  <CircleAlert className="h-3 w-3" /> Not cleaned
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {!item.cleanLoading && !isCleaned && !item.cleanError && (
                <button
                  onClick={() => onClean(item.id)}
                  disabled={disabled}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-sdm-accent hover:bg-sdm-accent/10 disabled:opacity-50"
                >
                  Clean
                </button>
              )}
              {isCleaned && (
                <button
                  onClick={() => onOpenInModel(item.id)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-sdm-accent hover:bg-sdm-accent/10"
                >
                  Send to model <ArrowRight className="h-3 w-3" />
                </button>
              )}
              {isCleaned && (
                <button
                  onClick={() => onReviewRecords(item.id)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft"
                >
                  <Eye className="h-3 w-3" /> View records
                </button>
              )}
              {isCleaned && (
                <button
                  onClick={() => onClean(item.id)}
                  disabled={disabled}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-sdm-muted hover:bg-sdm-surface-soft disabled:opacity-50"
                  title="Re-clean"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
              {item.cleanError && (
                <button
                  onClick={() => onClean(item.id)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-sdm-danger hover:bg-sdm-danger/10"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => onRemove(item.id)}
                disabled={disabled || item.cleanLoading}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-sdm-muted hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                <Minus className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
