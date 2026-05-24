"use client";

import { useState } from "react";
import { Globe, Search, AlertCircle } from "lucide-react";

interface GbifSearchProps {
  onSearch: (taxon: string, country: string, maxRecords: number) => void;
  loading?: boolean;
  error?: string | null;
  result?: Record<string, unknown> | null;
}

export function GbifSearch({ onSearch, loading, error, result }: GbifSearchProps) {
  const [taxon, setTaxon] = useState("");
  const [country, setCountry] = useState("");
  const [maxRecords, setMaxRecords] = useState(1000);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxon.trim()) return;
    onSearch(taxon.trim(), country.trim(), maxRecords);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="gbif-taxon" className="block text-sm font-medium text-sdm-text mb-1">
            Species name
          </label>
          <input
            id="gbif-taxon"
            type="text"
            value={taxon}
            onChange={(e) => setTaxon(e.target.value)}
            placeholder="e.g., Acacia mearnsii"
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="gbif-country" className="block text-sm font-medium text-sdm-text mb-1">
              Country (optional)
            </label>
            <input
              id="gbif-country"
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g., AU"
              maxLength={2}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent uppercase"
            />
          </div>
          <div>
            <label htmlFor="gbif-max" className="block text-sm font-medium text-sdm-text mb-1">
              Max records
            </label>
            <input
              id="gbif-max"
              type="number"
              value={maxRecords}
              onChange={(e) => setMaxRecords(Math.min(10000, Math.max(10, parseInt(e.target.value) || 10)))}
              min={10}
              max={10000}
              step={100}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !taxon.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Search className="h-4 w-4" />
          {loading ? "Searching..." : "Search GBIF"}
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-4 w-4 text-sdm-accent" />
            <span className="font-medium text-sdm-heading">GBIF Results</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-sdm-muted">Records found:</span>{" "}
              <span className="font-medium text-sdm-text">{String(result.n_records)}</span>
            </div>
            <div>
              <span className="text-sdm-muted">Taxon:</span>{" "}
              <span className="font-medium text-sdm-text">{String(result.taxon)}</span>
            </div>
            {result.doi != null && String(result.doi) !== "null" ? (
              <div className="col-span-2">
                <span className="text-sdm-muted">DOI:</span>{" "}
                <span className="font-mono text-xs text-sdm-accent-blue">{String(result.doi)}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
