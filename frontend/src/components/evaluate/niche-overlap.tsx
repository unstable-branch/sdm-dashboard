"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, Legend } from "recharts";
import { Loader2, GitCompare } from "lucide-react";
import { apiPost } from "@/services/api";

interface RunOption {
  id: string;
  species: string;
  model_id: string;
}

interface NicheOverlapResult {
  run_id_1: string;
  run_id_2: string;
  species_1: string;
  species_2: string;
  D: number;
  I: number;
  stability: number;
  unfilling: number;
  expansion: number;
  centroid_distance: number;
  n_native: number;
  n_introduced: number;
}

interface NicheOverlapProps {
  runs: RunOption[];
}

export function NicheOverlap({ runs }: NicheOverlapProps) {
  const [run1, setRun1] = useState("");
  const [run2, setRun2] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NicheOverlapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCompute = async () => {
    if (!run1 || !run2 || run1 === run2) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiPost("/api/v1/ecology/niche-overlap", { run_id_1: run1, run_id_2: run2 }) as NicheOverlapResult;
      setResult(data as unknown as NicheOverlapResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const canCompute = run1 && run2 && run1 !== run2;

  if (runs.length < 2) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        <GitCompare className="h-10 w-10 mx-auto mb-3 text-sdm-muted/50" />
        <p className="text-sm font-medium text-sdm-heading">Need at least 2 runs</p>
        <p className="text-xs mt-1">Run models for at least 2 species to compute niche overlap.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h3 className="text-sm font-semibold text-sdm-heading mb-3">Select two runs to compare</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-sdm-muted mb-1">Run 1 (native)</label>
            <select
              value={run1}
              onChange={(e) => setRun1(e.target.value)}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
            >
              <option value="">Select a run...</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{r.species} ({r.model_id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-sdm-muted mb-1">Run 2 (introduced)</label>
            <select
              value={run2}
              onChange={(e) => setRun2(e.target.value)}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
            >
              <option value="">Select a run...</option>
              {runs.filter((r) => r.id !== run1).map((r) => (
                <option key={r.id} value={r.id}>{r.species} ({r.model_id})</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleCompute}
          disabled={!canCompute || loading}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
          {loading ? "Computing..." : "Compute niche overlap"}
        </button>

        {error && (
          <div className="mt-3 rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
              <div className="text-xs text-sdm-muted mb-1">Schoener's D</div>
              <div className="text-lg font-semibold text-sdm-text">{result.D.toFixed(3)}</div>
              <div className="text-xs text-sdm-muted">0 = no overlap, 1 = identical</div>
            </div>
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
              <div className="text-xs text-sdm-muted mb-1">Hellinger's I</div>
              <div className="text-lg font-semibold text-sdm-text">{result.I.toFixed(3)}</div>
              <div className="text-xs text-sdm-muted">0 = no overlap, 1 = identical</div>
            </div>
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
              <div className="text-xs text-sdm-muted mb-1">Stability</div>
              <div className="text-lg font-semibold text-green-400">{result.stability.toFixed(3)}</div>
              <div className="text-xs text-sdm-muted">Shared niche space</div>
            </div>
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
              <div className="text-xs text-sdm-muted mb-1">Unfilling</div>
              <div className="text-lg font-semibold text-red-400">{result.unfilling.toFixed(3)}</div>
              <div className="text-xs text-sdm-muted">Lost niche space</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Overlap metrics</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    { metric: "Schoener's D", value: result.D },
                    { metric: "Hellinger's I", value: result.I },
                    { metric: "Stability", value: result.stability },
                    { metric: "Unfilling", value: result.unfilling },
                    { metric: "Expansion", value: result.expansion },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="metric" tick={{ fontSize: 10, fill: "#9ca3af" }} interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px", fontSize: "12px" }}
                    formatter={(value: number) => [value.toFixed(3), "Value"]}
                  />
                  <Bar dataKey="value" fill="#2C7FB8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Niche dynamics</h4>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={[
                  { metric: "Stability", value: result.stability },
                  { metric: "Unfilling", value: result.unfilling },
                  { metric: "Expansion", value: result.expansion },
                ]}>
                  <PolarGrid stroke="rgba(255,255,255,0.1)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                  <Radar name="Value" dataKey="value" stroke="#E34B35" fill="#E34B35" fillOpacity={0.3} />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
            <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Summary</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-sdm-muted">Native occurrences</span>
                <span className="text-sdm-text font-mono">{result.n_native.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sdm-muted">Introduced occurrences</span>
                <span className="text-sdm-text font-mono">{result.n_introduced.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sdm-muted">Centroid distance</span>
                <span className="text-sdm-text font-mono">{result.centroid_distance.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sdm-muted">Species</span>
                <span className="text-sdm-text font-mono text-xs">{result.species_1} vs {result.species_2}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
