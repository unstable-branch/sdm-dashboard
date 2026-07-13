"use client";

import { useState } from "react";
import { Search, AlertCircle, Loader2 } from "lucide-react";
import { AlaMark } from "@/components/data/source-icons";

interface AlaSearchProps {
  onSearch: (taxon: string, country: string, maxRecords: number, apiKey: string) => void;
  loading?: boolean;
  error?: string | null;
  result?: Record<string, unknown> | null;
  hasApiKey?: boolean;
}

export function AlaSearch({ onSearch, loading, error, result, hasApiKey }: AlaSearchProps) {
  const [taxon, setTaxon] = useState("");
  const [country, setCountry] = useState("");
  const [maxRecords, setMaxRecords] = useState(1000);
  const [apiKey, setApiKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxon.trim()) return;
    onSearch(taxon.trim(), country.trim(), maxRecords, apiKey.trim());
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-lg border border-sdm-border bg-sdm-surface p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <AlaMark className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">Search ALA</h3>
            <p className="text-xs text-sdm-muted">Download species occurrence records from the <a href="https://docs.ala.org.au" target="_blank" rel="noopener noreferrer" className="text-sdm-accent hover:underline">Atlas of Living Australia</a></p>
          </div>
        </div>

        <div>
          <label htmlFor="ala-taxon" className="block text-sm font-medium text-sdm-text mb-1">Species name</label>
          <input id="ala-taxon" type="text" value={taxon}
            onChange={(e) => setTaxon(e.target.value)}
            placeholder="e.g., Acacia mearnsii"
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent" required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ala-country" className="block text-sm font-medium text-sdm-text mb-1">Country (optional)</label>
            <input id="ala-country" type="text" value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g., Australia"
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent" />
          </div>
          <div>
            <label htmlFor="ala-max" className="block text-sm font-medium text-sdm-text mb-1">Max records</label>
            <input id="ala-max" type="number" value={maxRecords}
              onChange={(e) => setMaxRecords(Math.min(100000, Math.max(10, parseInt(e.target.value) || 10)))}
              min={10} max={100000} step={10}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent" />
            <p className="text-xs text-sdm-muted mt-1">Max 10,000 for public API; higher with ALA API key</p>
          </div>
        </div>

        {/* ALA API key field */}
        <div>
          <label htmlFor="ala-api-key" className="block text-sm font-medium text-sdm-text mb-1">ALA API Key (optional)</label>
          <input id="ala-api-key" type="password" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasApiKey ? "Saved key — override or leave blank" : "Optional — leave blank for basic access"}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 pr-8 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent" />
          {hasApiKey && !apiKey && (
            <p className="text-xs text-sdm-success mt-0.5">Using saved API key from Settings</p>
          )}
          <p className="text-xs text-sdm-muted mt-1">Not needed for basic access. <a href="https://support.ala.org.au/support/solutions/articles/6000261502-how-to-access-ala-apis" target="_blank" rel="noopener noreferrer" className="text-sdm-accent hover:underline">Learn more</a></p>
        </div>

        <button type="submit" disabled={loading || !taxon.trim()}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Searching..." : "Search ALA"}
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlaMark className="h-4 w-4" />
            <span className="font-medium text-sdm-heading">ALA Results</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-sdm-muted">Records:</span>
              <span className="ml-1.5 font-medium text-sdm-text">
                {Number(result.n_records ?? 0).toLocaleString()}
                {result.total_available != null && Number(result.total_available) > Number(result.n_records ?? 0) && (
                  <span className="text-sdm-muted"> / {Number(result.total_available).toLocaleString()} available</span>
                )}
              </span>
            </div>
            <div>
              <span className="text-sdm-muted">Taxon:</span>
              <span className="ml-1.5 font-medium text-sdm-text">{String(result.taxon ?? "—")}</span>
            </div>
          </div>
          {result.total_available != null && Number(result.total_available) > Number(result.n_records ?? 0) && (
            <p className="mt-3 text-xs text-sdm-warning">
              Only {Number(result.n_records ?? 0).toLocaleString()} records fetched. Increase "Max records" or use an ALA API key for more.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
