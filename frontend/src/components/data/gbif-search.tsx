"use client";

import { useState } from "react";
import { Globe, Search, Download, ChevronDown, Key, Mail, User, AlertCircle, Loader2 } from "lucide-react";

interface GbifSearchProps {
  onSearch: (taxon: string, country: string, maxRecords: number, useAuth: boolean, username?: string, password?: string, email?: string) => void;
  loading?: boolean;
  error?: string | null;
  result?: Record<string, unknown> | null;
}

export function GbifSearch({ onSearch, loading, error, result }: GbifSearchProps) {
  const [taxon, setTaxon] = useState("");
  const [country, setCountry] = useState("");
  const [maxRecords, setMaxRecords] = useState(1000);
  const [useAuth, setUseAuth] = useState(false);
  const [gbifUser, setGbifUser] = useState("");
  const [gbifPass, setGbifPass] = useState("");
  const [gbifEmail, setGbifEmail] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxon.trim()) return;
    onSearch(taxon.trim(), country.trim(), maxRecords, useAuth, gbifUser || undefined, gbifPass || undefined, gbifEmail || undefined);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-lg border border-sdm-border bg-sdm-surface p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Globe className="h-5 w-5" />
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
              min={10} max={100000} step={100}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-2 focus:ring-sdm-accent/50 focus:border-sdm-accent" />
            <p className="text-xs text-sdm-muted mt-1">Max 10,000 for public API; unlimited with authenticated download</p>
          </div>
        </div>

        {/* Authenticated download toggle */}
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-sdm-muted hover:text-sdm-text transition-colors [&::-webkit-details-marker]:hidden">
            <Download className="h-4 w-4" />
            Use authenticated download (unlimited records)
            <ChevronDown className="h-3.5 w-3.5 ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 p-3 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft space-y-3">
            <p className="text-xs text-sdm-muted">
              Requires a GBIF account. Set up your credentials in the{" "}
              <a href="/admin/keys" className="text-sdm-accent hover:underline">API Keys</a>{" "}
              admin page or enter them below.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-sdm-muted mb-1">
                  <User className="h-3 w-3" /> Username
                </label>
                <input type="text" value={gbifUser} onChange={(e) => setGbifUser(e.target.value)}
                  placeholder="GBIF username"
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted" />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-sdm-muted mb-1">
                  <Key className="h-3 w-3" /> Password
                </label>
                <input type="password" value={gbifPass} onChange={(e) => setGbifPass(e.target.value)}
                  placeholder="GBIF password"
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted" />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-sdm-muted mb-1">
                  <Mail className="h-3 w-3" /> Email
                </label>
                <input type="email" value={gbifEmail} onChange={(e) => setGbifEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted" />
              </div>
            </div>
          </div>
        </details>

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
            <Globe className="h-4 w-4 text-sdm-accent" />
            <span className="font-medium text-sdm-heading">GBIF Results</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-sdm-muted">Records:</span>
              <span className="ml-1.5 font-medium text-sdm-text">{String(result.n_records)}</span>
            </div>
            <div>
              <span className="text-sdm-muted">Taxon:</span>
              <span className="ml-1.5 font-medium text-sdm-text">{String(result.taxon)}</span>
            </div>
            {result.doi != null && String(result.doi) !== "null" ? (
              <div>
                <span className="text-sdm-muted">DOI:</span>
                <span className="ml-1.5 font-mono text-xs text-sdm-accent-blue">{String(result.doi).substring(0, 30)}…</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default GbifSearch;
