"use client";

import { memo } from "react";
import { BIOVAR_CHOICES } from "@sdm/shared";
import { cn } from "@/lib/utils";

interface ClimateBiovarGridProps {
  selected: number[];
  missing: number[];
  loading: boolean;
  onToggle: (id: number) => void;
}

export const ClimateBiovarGrid = memo(function ClimateBiovarGrid({ selected, missing, loading, onToggle }: ClimateBiovarGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {BIOVAR_CHOICES.map((bio) => {
        const isSelected = selected.includes(bio.id);
        const isMissing = missing.includes(bio.id);
        return (
          <button
            key={bio.id}
            type="button"
            onClick={() => onToggle(bio.id)}
            disabled={loading}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
              isSelected
                ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                : "border-sdm-border bg-sdm-surface text-sdm-muted hover:border-sdm-accent/50",
              isMissing && "border-sdm-danger/50 bg-sdm-danger/5 text-sdm-danger",
              loading && "opacity-50 cursor-not-allowed"
            )}
            title={bio.description}
          >
            <span className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
              isSelected ? "bg-sdm-accent text-white" : "bg-sdm-surface-soft text-sdm-muted"
            )}>
              {bio.id}
            </span>
            <span className="truncate">{bio.label}</span>
            {isMissing && <span className="ml-auto text-[10px] text-sdm-danger shrink-0">Missing</span>}
          </button>
        );
      })}
    </div>
  );
});
