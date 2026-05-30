"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { apiGet } from "@/services/api";
import { Loader2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { SpeciesSummary } from "@/services/types";

export default function SpeciesPage() {
  const [species, setSpecies] = useState<SpeciesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiGet<{ species: SpeciesSummary[] }>("/api/v1/data/species?limit=500")
      .then((data) => {
        setSpecies(data.species);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const filtered = search
    ? species.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : species;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Species</h1>
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-4 text-sm text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Species</h1>
        <p className="text-sm text-sdm-muted mt-1">{species.length} species recorded in the database.</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sdm-muted" />
        <input
          type="text"
          placeholder="Search species..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-sdm-border bg-sdm-surface-soft pl-10 pr-4 py-2 text-sm text-sdm-text placeholder:text-sdm-muted focus:outline-none focus:ring-2 focus:ring-sdm-accent/50"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted text-sm">
          {search ? "No species match your search." : "No species found. Upload occurrence data to create species records."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/results?species=${encodeURIComponent(s.name)}`}
              className="rounded-lg border border-sdm-border bg-sdm-surface p-4 hover:border-sdm-accent/50 transition-colors"
            >
              <h3 className="text-sm font-semibold text-sdm-heading">{s.name}</h3>
              <p className="text-xs text-sdm-muted mt-1">
                {s.occurrence_count ?? 0} occurrences
              </p>
              <p className="text-xs text-sdm-muted">
                Created {new Date(s.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
