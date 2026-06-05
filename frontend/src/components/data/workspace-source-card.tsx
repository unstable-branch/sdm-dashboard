"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Plus } from "lucide-react";
import type { UploadFile } from "@/services/types";

interface WorkspaceSourceCardProps {
  file: UploadFile;
  disabled?: boolean;
  onAddToWorkspace?: () => void;
}

const FORMAT_COLORS: Record<string, string> = {
  dwca: "bg-blue-500/10 text-blue-400",
  csv: "bg-green-500/10 text-green-400",
  tsv: "bg-amber-500/10 text-amber-400",
};

export function WorkspaceSourceCard({ file, disabled, onAddToWorkspace }: WorkspaceSourceCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: file.file_id,
    data: { type: "source", file },
    disabled: disabled || !file.file_id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const sizeStr = file.file_size > 1024 * 1024
    ? `${(file.file_size / 1024 / 1024).toFixed(1)} MB`
    : `${(file.file_size / 1024).toFixed(0)} KB`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-dragging={isDragging || undefined}
      data-disabled={disabled || undefined}
      className="flex items-center gap-2 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm transition-colors
        hover:border-sdm-accent/50 data-[dragging]:opacity-50 data-[dragging]:shadow-lg
        data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4 shrink-0 text-sdm-muted" />
      <div className="min-w-0 flex-1">
        <span className="truncate font-medium text-sdm-text">{file.file_name}</span>
        {file.format && (
          <span className={`ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-xs font-medium ${FORMAT_COLORS[file.format] || "bg-gray-500/10 text-gray-400"}`}>
            {file.format.toUpperCase()}
          </span>
        )}
        {file.species && <span className="ml-1.5 text-xs text-sdm-muted">— {file.species}</span>}
        <p className="text-xs text-sdm-muted">
          {sizeStr}{file.n_rows > 0 && ` · ${file.n_rows.toLocaleString()} rows`}
          {file.cleaned || file.cleaned_file_id
            ? ` · ✅ Cleaned`
            : ` · ◌ Uncleaned`}
        </p>
      </div>
      {onAddToWorkspace && !disabled && (
        <button
          onClick={(e) => { e.stopPropagation(); onAddToWorkspace(); }}
          className="flex shrink-0 items-center gap-1 rounded border border-sdm-border bg-sdm-surface px-2 py-1 text-xs font-medium text-sdm-accent hover:bg-sdm-accent/10"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      )}
      {disabled && !onAddToWorkspace && (
        <span className="shrink-0 text-xs text-sdm-accent">In workspace</span>
      )}
    </div>
  );
}
