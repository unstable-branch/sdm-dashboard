"use client";

import { useState } from "react";
import { RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import { apiPost } from "@/services/api";

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
  onDelete: (id: string) => void;
  loading?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ScenarioList({ scenarios, onRefresh, onDelete, loading }: ScenarioListProps) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await apiPost<{ ok: boolean }>(`/api/v1/climate/delete/${id}`);
      onDelete(id);
    } catch {
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

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
              <th className="text-right px-4 py-2 font-medium">Actions</th>
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
                <td className="px-4 py-2 text-right">
                  {confirmDelete === s.id ? (
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-sdm-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Delete?
                      </span>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deleting === s.id}
                        className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs disabled:opacity-50"
                      >
                        {deleting === s.id ? "..." : "Yes"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-0.5 rounded bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text text-xs"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(s.id)}
                      className="text-sdm-muted hover:text-red-400 transition-colors"
                      title="Delete scenario"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
