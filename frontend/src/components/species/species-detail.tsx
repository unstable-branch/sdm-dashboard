"use client";

import { useState, useEffect } from "react";
import { Loader2, MapPin, Calendar, FileText, ArrowLeft } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";

interface OccurrenceRecord {
  id: string;
  longitude: number;
  latitude: number;
  source?: string;
  date?: string;
  [key: string]: unknown;
}

interface RunSummary {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  metrics: Record<string, unknown> | null;
}

interface SpeciesDetailProps {
  speciesId: string;
  speciesName: string;
  onBack: () => void;
}

export function SpeciesDetail({ speciesId, speciesName, onBack }: SpeciesDetailProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceRecord[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [occSearch, setOccSearch] = useState("");
  const [occPage, setOccPage] = useState(1);
  const [occTotal, setOccTotal] = useState(0);
  const occLimit = 20;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/v1/data/species/${speciesId}/occurrences?page=${occPage}&limit=${occLimit}`).then((r) => r.json()),
      fetch("/api/v1/sdm/runs").then((r) => r.json()),
    ]).then(([occData, runsData]) => {
      setOccurrences(occData.occurrences || []);
      setOccTotal(occData.pagination?.total || 0);
      const speciesRuns = (runsData.runs || []).filter(
        (r: RunSummary) => r.species === speciesName && r.status === "completed"
      );
      setRuns(speciesRuns);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [speciesId, speciesName, occPage]);

  const filteredOccurrences = occurrences.filter((o) => {
    if (!occSearch) return true;
    const q = occSearch.toLowerCase();
    return (
      o.source?.toLowerCase().includes(q) ||
      String(o.longitude).includes(q) ||
      String(o.latitude).includes(q)
    );
  });

  const totalPages = Math.ceil(occTotal / occLimit);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sdm-muted hover:text-sdm-text">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-sdm-heading">{speciesName}</h2>
          <p className="text-sm text-sdm-muted">{occTotal.toLocaleString()} occurrence records</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h3 className="text-sm font-semibold text-sdm-heading mb-3">Runs</h3>
          {runs.length === 0 ? (
            <p className="text-xs text-sdm-muted italic">No completed runs for this species</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <a
                  key={run.id}
                  href={`/results/${run.id}`}
                  className="block rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-2 hover:border-sdm-accent/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-sdm-text">{run.model_id}</span>
                    <span className="text-xs text-sdm-muted">
                      {(run.metrics?.auc_mean as number)?.toFixed(3) ?? "—"} AUC
                    </span>
                  </div>
                  <p className="text-xs text-sdm-muted mt-1">
                    {new Date(run.started_at).toLocaleDateString()}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h3 className="text-sm font-semibold text-sdm-heading mb-3">Quick stats</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-sdm-muted">Total records</span>
              <span className="text-sdm-text font-mono">{occTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sdm-muted">Unique sources</span>
              <span className="text-sdm-text font-mono">
                {new Set(occurrences.map((o) => o.source).filter(Boolean)).size || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sdm-muted">Completed runs</span>
              <span className="text-sdm-text font-mono">{runs.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-sdm-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-sdm-heading">Occurrence records</h3>
          <SearchInput
            value={occSearch}
            onChange={setOccSearch}
            placeholder="Filter records..."
            className="w-48"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sdm-border text-sdm-muted">
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">Longitude</th>
                <th className="text-left px-4 py-2 font-medium">Latitude</th>
                <th className="text-left px-4 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {filteredOccurrences.map((occ, i) => (
                <tr key={occ.id || i} className="border-b border-sdm-border/50 hover:bg-sdm-surface-soft/50">
                  <td className="px-4 py-2 text-sdm-muted">{(occPage - 1) * occLimit + i + 1}</td>
                  <td className="px-4 py-2 font-mono text-xs text-sdm-text">{occ.longitude.toFixed(4)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-sdm-text">{occ.latitude.toFixed(4)}</td>
                  <td className="px-4 py-2 text-sdm-muted text-xs">{occ.source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-sdm-border flex items-center justify-between text-sm">
            <span className="text-sdm-muted">
              Page {occPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOccPage((p) => Math.max(1, p - 1))}
                disabled={occPage === 1}
                className="px-3 py-1 rounded text-xs border border-sdm-border disabled:opacity-40 hover:bg-sdm-surface-soft"
              >
                Previous
              </button>
              <button
                onClick={() => setOccPage((p) => Math.min(totalPages, p + 1))}
                disabled={occPage === totalPages}
                className="px-3 py-1 rounded text-xs border border-sdm-border disabled:opacity-40 hover:bg-sdm-surface-soft"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
