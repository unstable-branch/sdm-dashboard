"use client";

import { cn } from "@/lib/utils";
import { CloudOff, Cloud } from "lucide-react";
import { BIOVAR_CHOICES } from "@sdm/shared";

interface ClimatePanelProps {
  biovars: number[];
  climateCheckLoading: boolean;
  missingBiovars: number[];
  onToggleBiovar: (id: number) => void;
}

export function ClimatePanel({ biovars, climateCheckLoading, missingBiovars, onToggleBiovar }: ClimatePanelProps) {
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
      <h2 className="text-lg font-semibold text-sdm-heading">Climate & BIO variables</h2>
      <p className="text-sm text-sdm-muted">Select at least 2 climate variables</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {BIOVAR_CHOICES.map((bio) => (
          <label
            key={bio.id}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
              biovars.includes(bio.id)
                ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                : "border-sdm-border bg-sdm-surface-soft text-sdm-text hover:border-sdm-accent/50"
            )}
          >
            <input type="checkbox" checked={biovars.includes(bio.id)} onChange={() => onToggleBiovar(bio.id)} className="sr-only" />
            <span className="font-medium">{bio.label}</span>
          </label>
        ))}
      </div>
      {biovars.length < 2 && <p className="text-xs text-sdm-danger">Select at least 2 BIO variables</p>}

      {climateCheckLoading ? (
        <div className="flex items-center gap-2 text-xs text-sdm-muted">
          <span className="animate-pulse">Checking climate data availability...</span>
        </div>
      ) : missingBiovars.length > 0 && biovars.length >= 2 ? (
        <div className="rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3 flex items-start gap-3">
          <CloudOff className="h-4 w-4 text-sdm-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-sdm-text">Climate data not available locally</p>
            <p className="text-xs text-sdm-muted mt-0.5">Missing: BIO{missingBiovars.join(", BIO")}</p>
            <p className="text-xs text-sdm-muted mt-0.5">Download from Data → Climate tab, or enable auto-download.</p>
          </div>
        </div>
      ) : biovars.length >= 2 ? (
        <div className="flex items-center gap-2 text-xs text-sdm-success">
          <Cloud className="h-3.5 w-3.5" />
          <span>All selected BIO variables available locally</span>
        </div>
      ) : null}
    </div>
  );
}
