"use client";

import { RefreshCw } from "lucide-react";

interface ClimateScenario {
  id: string;
  type: "future" | "current";
  gcm?: string;
  ssp?: string;
  period?: string;
  source?: "worldclim" | "chelsa";
  file_count: number;
  size_bytes: number;
  is_averaged?: boolean;
}

interface ScenarioListProps {
  scenarios: ClimateScenario[];
  onRefresh: () => void;
  loading?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ScenarioList({ scenarios, onRefresh, loading }: ScenarioListProps) {
  if (scenarios.length === 0 && !loading) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center">
        <p className="text-sm text-sdm-muted">No climate data downloaded yet.</p>
        <p className="text-xs text-sdm-muted mt-1">Use the download forms above to get WorldClim, CHELSA, or CMIP6 data.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-sdm-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-sdm-heading">Downloaded scenarios</h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-sdm-muted hover:text-sdm-text flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-sdm-border text-sdm-muted">
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">GCM</th>
              <th className="text-left px-4 py-2 font-medium">SSP</th>
              <th className="text-left px-4 py-2 font-medium">Period</th>
              <th className="text-right px-4 py-2 font-medium">Files</th>
              <th className="text-right px-4 py-2 font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id} className="border-b border-sdm-border/50 hover:bg-sdm-surface-soft/50">
                <td className="px-4 py-2">
                  {s.type === "future" ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.is_averaged ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"}`}>
                      {s.is_averaged ? "Averaged" : "Future"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400">
                      {s.source === "chelsa" ? "CHELSA" : "WorldClim"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-sdm-text font-mono">{s.gcm || "—"}</td>
                <td className="px-4 py-2 text-sdm-text">{s.ssp || "—"}</td>
                <td className="px-4 py-2 text-sdm-text">{s.period || "—"}</td>
                <td className="px-4 py-2 text-right text-sdm-muted">{s.file_count}</td>
                <td className="px-4 py-2 text-right text-sdm-muted">{formatSize(s.size_bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
