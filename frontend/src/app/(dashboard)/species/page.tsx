"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, Users, ArrowRight } from "lucide-react";
import { SpeciesList } from "@/components/species/species-list";
import { SpeciesDetail } from "@/components/species/species-detail";
import { SearchInput } from "@/components/ui/search-input";

interface SpeciesSummary {
  id: string;
  name: string;
  occurrence_count: number | null;
  created_at: string;
}

export default function SpeciesPage() {
  const [species, setSpecies] = useState<SpeciesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSpecies, setSelectedSpecies] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/data/species?page=${page}&limit=${limit}`)
      .then((res) => res.json())
      .then((data) => {
        setSpecies(data.species || []);
        setTotalPages(data.pagination?.totalPages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page]);

  const filteredSpecies = species.filter((sp) => {
    if (!search) return true;
    return sp.name.toLowerCase().includes(search.toLowerCase());
  });

  const handleSelect = (id: string, name: string) => {
    setSelectedSpecies({ id, name });
  };

  if (loading && !selectedSpecies) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Species</h1>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      </div>
    );
  }

  if (selectedSpecies) {
    return (
      <SpeciesDetail
        speciesId={selectedSpecies.id}
        speciesName={selectedSpecies.name}
        onBack={() => setSelectedSpecies(null)}
      />
    );
  }

  if (species.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Species</h1>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center">
          <Users className="h-10 w-10 text-sdm-muted mx-auto mb-3" />
          <p className="text-sm text-sdm-heading font-medium">No species registered</p>
          <p className="text-xs text-sdm-muted mt-1">Upload occurrence data to create species entries.</p>
          <Link href="/data" className="inline-flex items-center gap-2 mt-4 text-sm font-medium text-sdm-accent hover:underline">
            Go to Data tab <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sdm-heading">Species</h1>
          <p className="text-sdm-muted mt-1">
            Manage species entries and view their occurrence records.
          </p>
        </div>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter species..."
          className="w-56"
        />
      </div>

      <SpeciesList species={filteredSpecies} onSelect={handleSelect} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-sdm-muted">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded text-xs border border-sdm-border disabled:opacity-40 hover:bg-sdm-surface-soft"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded text-xs border border-sdm-border disabled:opacity-40 hover:bg-sdm-surface-soft"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
