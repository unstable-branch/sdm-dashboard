"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { UploadFile } from "@/services/types";

interface WorkspaceSourceCardProps {
  file: UploadFile;
  disabled?: boolean;
  onAddToWorkspace?: () => void;
  onDelete?: (fileId: string) => void;
}

const FORMAT_COLORS: Record<string, string> = {
  dwca: "bg-blue-500/10 text-blue-400",
  csv: "bg-green-500/10 text-green-400",
  tsv: "bg-amber-500/10 text-amber-400",
};

export function WorkspaceSourceCard({ file, disabled, onAddToWorkspace, onDelete }: WorkspaceSourceCardProps) {
  const sizeStr = file.file_size > 1024 * 1024
    ? `${(file.file_size / 1024 / 1024).toFixed(1)} MB`
    : `${(file.file_size / 1024).toFixed(0)} KB`;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-sdm-file", JSON.stringify({
          file_id: file.file_id,
          file_name: file.file_name,
          n_rows: file.n_rows,
          in_workspace: !!disabled,
        }));
        e.dataTransfer.effectAllowed = disabled ? "move" : "copy";
      }}
      className="flex items-center gap-2 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm transition-colors touch-none
        hover:border-sdm-accent/50 data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed cursor-grab active:cursor-grabbing"
      data-disabled={disabled || undefined}
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
      {disabled && (
        <span className="shrink-0 text-xs text-sdm-accent">In workspace</span>
      )}
      {onDelete && !disabled && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(file.file_id); }}
          className="flex shrink-0 items-center gap-1 rounded p-1 text-sdm-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Delete from history"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}