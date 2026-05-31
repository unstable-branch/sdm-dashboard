"use client";

import { CheckCircle2, XCircle } from "lucide-react";

interface DetectedColumnsProps {
  columns: Record<string, string | null>;
}

const FIELD_LABELS: Record<string, string> = {
  longitude: "Longitude",
  latitude: "Latitude",
  source: "Source / Institution",
  species: "Species name",
  country: "Country",
  occurrenceStatus: "Occurrence status",
};

export function DetectedColumns({ columns }: DetectedColumnsProps) {
  const entries = Object.entries(columns);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-3">
      <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">
        Detected columns
      </h4>
      <div className="space-y-1">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-center justify-between text-xs">
            <span className="text-sdm-muted">{FIELD_LABELS[key] || key}</span>
            <span className="flex items-center gap-1.5">
              {val ? (
                <>
                  <code className="text-sdm-text font-mono">{val}</code>
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                </>
              ) : (
                <>
                  <span className="text-sdm-muted italic">not found</span>
                  <XCircle className="h-3 w-3 text-sdm-muted shrink-0" />
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
