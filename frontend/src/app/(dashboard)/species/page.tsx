"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, Users, ArrowRight } from "lucide-react";

interface SpeciesSummary {
  id: string;
  name: string;
  occurrence_count: number | null;
  created_at: string;
}

export default function SpeciesPage() {
  const [species, setSpecies] = useState<SpeciesSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/data/species")
      .then((res) => res.json())
      .then((data) => {
        setSpecies(data.species || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Species</h1>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      </div>
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
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Species</h1>
        <p className="text-sdm-muted mt-1">
          Manage species entries and view their occurrence records.
        </p>
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sdm-border text-sdm-muted">
              <th className="text-left px-4 py-3 font-medium">Species</th>
              <th className="text-right px-4 py-3 font-medium">Occurrences</th>
              <th className="text-right px-4 py-3 font-medium">Created</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {species.map((sp) => (
              <tr key={sp.id} className="border-b border-sdm-border/50 hover:bg-sdm-surface-soft/50">
                <td className="px-4 py-3 font-medium text-sdm-text">{sp.name}</td>
                <td className="px-4 py-3 text-right text-sdm-muted">
                  {sp.occurrence_count != null ? sp.occurrence_count.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3 text-right text-sdm-muted">
                  {new Date(sp.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href="/data" className="text-xs text-sdm-accent hover:underline">
                    View data →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
