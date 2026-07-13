"use client";

import { useState } from "react";
import { Search, Download, ChevronDown, AlertCircle, Loader2 } from "lucide-react";
import { GbifMark } from "@/components/data/source-icons";

interface GbifSearchProps {
  onSearch: (taxon: string, country: string, maxRecords: number, useAuth: boolean) => void;
  loading?: boolean;
  error?: string | null;
  result?: Record<string, unknown> | null;
  hasSavedCredentials?: boolean;
}

export function GbifSearch({ onSearch, loading, error, result, hasSavedCredentials }: GbifSearchProps) {
  const [taxon, setTaxon] = useState("");
  const [country, setCountry] = useState("");
  const [maxRecords, setMaxRecords] = useState(1000);
  const [useAuth, setUseAuth] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxon.trim()) return;
    onSearch(taxon.trim(), country.trim(), maxRecords, useAuth);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-lg border border-sdm-border bg-sdm-surface p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <GbifMark className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">Search GBIF</h3>
            <p className="text-xs text-sdm-muted">Download species occurrence records from the Global Biodiversity Information Facility</p>
          </div>
        </div>

        <div>
          <label htmlFor="gbif-taxon" className="block text-sm font-medium text-sdm-text mb-1">Species name</label>
          <input id="gbif-taxon" type="text" value={taxon}
            onChange={(e) => setTaxon(e.target.value)}
            placeholder="e.g., Acacia mearnsii"
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent" required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="gbif-country" className="block text-sm font-medium text-sdm-text mb-1">Country (optional)</label>
            <input id="gbif-country" type="text" value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              placeholder="e.g., AU" maxLength={2}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent uppercase" />
          </div>
          <div>
            <label htmlFor="gbif-max" className="block text-sm font-medium text-sdm-text mb-1">Max records</label>
            <input id="gbif-max" type="number" value={maxRecords}
              onChange={(e) => setMaxRecords(Math.min(100000, Math.max(10, parseInt(e.target.value) || 10)))}
              min={10} max={100000} step={10}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent" />
            <p className="text-xs text-sdm-muted mt-1">Max 10,000 for public API; unlimited with authenticated download</p>
          </div>
        </div>

        {/* Authenticated download toggle */}
        <label className="flex items-center gap-2 text-sm text-sdm-text cursor-pointer pt-1">
          <input type="checkbox" checked={useAuth} onChange={(e) => setUseAuth(e.target.checked)}
            className="rounded border-sdm-border bg-sdm-surface-soft" />
          <div>
            <span className="font-medium">Authenticated download using saved credentials or API key</span>
            {!hasSavedCredentials && useAuth && (
              <p className="text-xs text-sdm-warning mt-0.5">
                No saved credentials found. Set up your GBIF username and password in{" "}
                <a href="/settings" className="text-sdm-accent hover:underline">Settings</a>.
              </p>
            )}
          </div>
        </label>

        <button type="submit" disabled={loading || !taxon.trim()}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
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
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
          <div className="flex items-center gap-2 mb-3">
            <GbifMark className="h-4 w-4" />
            <span className="font-medium text-sdm-heading">GBIF Results</span>
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
            {(() => {
              const doi = result.doi;
              const doiStr = typeof doi === "string" && doi !== "null" && doi !== "NA" && doi.length > 0 ? doi : null;
              return doiStr ? (
                <div>
                  <span className="text-sdm-muted">DOI:</span>
                  <span className="ml-1.5 font-mono text-xs text-sdm-accent-blue">{doiStr.substring(0, 30)}…</span>
                </div>
              ) : null;
            })()}
          </div>
          {result.total_available != null && Number(result.total_available) > Number(result.n_records) && (
            <p className="mt-3 text-xs text-sdm-warning">
              Only {Number(result.n_records ?? 0).toLocaleString()} records fetched. Increase "Max records" or use authenticated download for the full dataset.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
