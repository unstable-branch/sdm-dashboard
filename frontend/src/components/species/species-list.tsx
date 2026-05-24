"use client";

import { SearchInput } from "@/components/ui/search-input";

interface SpeciesSummary {
  id: string;
  name: string;
  occurrence_count: number | null;
  created_at: string;
}

interface SpeciesListProps {
  species: SpeciesSummary[];
  onSelect: (id: string, name: string) => void;
}

export function SpeciesList({ species, onSelect }: SpeciesListProps) {
  return (
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
                <button
                  onClick={() => onSelect(sp.id, sp.name)}
                  className="text-xs text-sdm-accent hover:underline"
                >
                  View details →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
