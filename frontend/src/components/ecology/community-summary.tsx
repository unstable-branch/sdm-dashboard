"use client";

import { Leaf, Users } from "lucide-react";
import { fmtFixed } from "@/lib/utils";
import type { RunSummary } from "@/services/types";

interface CommunitySummaryProps {
  run: RunSummary;
}

export function CommunitySummary({ run }: CommunitySummaryProps) {
  const metrics = run.metrics ?? {};
  const speciesAuc = (metrics.species_auc as Record<string, number | null> | undefined) ?? null;
  const speciesCounts = (metrics.species_presence_counts as Record<string, number | null> | undefined) ?? null;
  const nSpecies = speciesAuc ? Object.keys(speciesAuc).length : 0;
  const of = run.output_files ?? {};

  const speciesTifs: Array<{ name: string; tif: string }> = [];
  const count = parseInt(of["multi_species_tif_count"] as string || "0", 10);
  if (!isNaN(count) && count > 0) {
    for (let i = 1; i <= count; i++) {
      const tif = of[`multi_species_tif_${i}`] as string | undefined;
      if (tif) {
        const name = tif.split("/").pop()?.replace(/\.tif$/i, "").replace(/^.*?_/, "") || `Species ${i}`;
        speciesTifs.push({ name, tif });
      }
    }
  }

  if (nSpecies === 0 && speciesTifs.length === 0) return null;

  const speciesList = speciesTifs.length > 0 ? speciesTifs : (
    speciesAuc ? Object.keys(speciesAuc).map((name) => ({ name, tif: "" })) : []
  );

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-sdm-accent" />
        <h3 className="text-sm font-semibold text-sdm-heading">Community composition</h3>
      </div>

      <p className="text-xs text-sdm-muted">
        {nSpecies > 0 ? `${nSpecies} species detected` : `${speciesTifs.length} species in output`}
        {run.species ? ` from ${run.species}` : ""}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-sdm-border">
              <th className="text-left py-2 pr-4 font-medium text-sdm-muted">Species</th>
              {speciesAuc && <th className="text-right py-2 pr-4 font-medium text-sdm-muted">AUC</th>}
              {speciesCounts && <th className="text-right py-2 pr-4 font-medium text-sdm-muted">Records</th>}
              {speciesTifs.length > 0 && <th className="text-right py-2 font-medium text-sdm-muted">Download</th>}
            </tr>
          </thead>
          <tbody>
            {speciesList.map((sp, i) => (
              <tr key={i} className="border-b border-sdm-border/50">
                <td className="py-2 pr-4 text-sdm-text">
                  <span className="inline-flex items-center gap-1.5">
                    <Leaf className="h-3 w-3 text-sdm-accent shrink-0" />
                    {sp.name}
                  </span>
                </td>
                {speciesAuc && (
                  <td className="py-2 pr-4 text-right text-sdm-text font-mono">
                    {fmtFixed(speciesAuc[sp.name] ?? null, 3)}
                  </td>
                )}
                {speciesCounts && (
                  <td className="py-2 pr-4 text-right text-sdm-text font-mono">
                    {speciesCounts[sp.name] != null ? Number(speciesCounts[sp.name]).toLocaleString() : "—"}
                  </td>
                )}
                {speciesTifs.length > 0 && (
                  <td className="py-2 text-right">
                    {sp.tif ? (
                      <a
                        href={`/api/v1/results/file/download?path=${encodeURIComponent(sp.tif)}`}
                        className="text-sdm-accent hover:underline"
                      >
                        TIF
                      </a>
                    ) : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {of["multi_species_richness_tif"] && (
        <div className="text-xs text-sdm-muted pt-2 border-t border-sdm-border">
          <a
            href={`/api/v1/results/file/download?path=${encodeURIComponent(of["multi_species_richness_tif"] as string)}`}
            className="text-sdm-accent hover:underline"
          >
            Download species richness raster →
          </a>
        </div>
      )}
    </div>
  );
}
