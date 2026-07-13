"use client";

import { CHELSA_EXTRA_CHOICES } from "@sdm/shared";
import { cn } from "@/lib/utils";
import { CloudOff, Cloud } from "lucide-react";
import { ClimateBiovarGrid } from "./climate-biovar-grid";

interface ModelConfigBiovarsProps {
  climateSource: "worldclim" | "chelsa";
  onClimateSourceChange: (source: "worldclim" | "chelsa") => void;
  climateRes: number;
  onClimateResChange: (res: number) => void;
  biovars: number[];
  missingBiovars: number[];
  climateCheckLoading: boolean;
  toggleBiovar: (id: number) => void;
  aggregationFactor: number;
  chelsaExtras: string[];
  onChelsaExtrasChange: (extras: string[]) => void;
}

export function ModelConfigBiovars({
  climateSource,
  onClimateSourceChange,
  climateRes,
  onClimateResChange,
  biovars,
  missingBiovars,
  climateCheckLoading,
  toggleBiovar,
  aggregationFactor,
  chelsaExtras,
  onChelsaExtrasChange,
}: ModelConfigBiovarsProps) {
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
      <h2 className="text-lg font-semibold text-sdm-heading">Climate & BIO variables</h2>
      <p className="text-sm text-sdm-muted">Select at least 2 climate variables.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Climate source</label>
          <select
            value={climateSource}
            onChange={(e) => onClimateSourceChange(e.target.value as "worldclim" | "chelsa")}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
          >
            <option value="worldclim">WorldClim v2.1</option>
            <option value="chelsa">CHELSA v2.1</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Resolution</label>
          <select
            value={climateRes}
            onChange={(e) => onClimateResChange(Number(e.target.value))}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
          >
            {climateSource === "chelsa" ? (
              <>
                <option value={0.5}>30 arc-seconds (~1 km) — native</option>
                <option value={2.5}>2.5 arc-minutes (~5 km) — auto-agg 5x</option>
                <option value={5}>5 arc-minutes (~10 km) — auto-agg 10x</option>
                <option value={10}>10 arc-minutes (~20 km) — auto-agg 20x</option>
              </>
            ) : (
              <>
                <option value={10}>10 arc-minutes (~20 km)</option>
                <option value={5}>5 arc-minutes (~10 km)</option>
                <option value={2.5}>2.5 arc-minutes (~5 km)</option>
              </>
            )}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <ClimateBiovarGrid selected={biovars} missing={missingBiovars} loading={climateCheckLoading} onToggle={toggleBiovar} />
      </div>
      {biovars.length < 2 && (
        <p className="text-xs text-sdm-danger">Select at least 2 BIO variables</p>
      )}

      {climateCheckLoading ? (
        <div className="flex items-center gap-2 text-xs text-sdm-muted">
          <span className="animate-pulse">Checking climate data availability...</span>
        </div>
      ) : missingBiovars.length > 0 && biovars.length >= 2 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
          <CloudOff className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-sdm-text">Climate data not available locally</p>
            <p className="text-xs text-sdm-muted mt-0.5">
              {missingBiovars.length} BIO {missingBiovars.length === 1 ? "variable is" : "variables are"} missing: BIO
              {missingBiovars.join(", BIO")}
            </p>
            <p className="text-xs text-sdm-muted mt-0.5">
              Download missing layers from the Data → Climate tab, or enable auto-download.
            </p>
          </div>
        </div>
      ) : biovars.length >= 2 ? (
        <div className="flex items-center gap-2 text-xs text-green-500">
          <Cloud className="h-3.5 w-3.5" />
          <span>All selected BIO variables available locally</span>
        </div>
      ) : null}

      <div className="text-xs text-sdm-muted border-t border-sdm-border pt-3 mt-2">
        {climateSource === "chelsa"
          ? (() => {
              const nativeArcmin = 0.5;
              const targetAgg = Math.max(1, Math.ceil(climateRes / nativeArcmin));
              const effectiveAgg = Math.max(aggregationFactor, targetAgg);
              const effArcmin = nativeArcmin * effectiveAgg;
              const effKm = (effArcmin * 1.852).toFixed(1);
              if (targetAgg > aggregationFactor) {
                return `CHELSA native 30 arc-sec x auto-aggregation ${effectiveAgg}x (target: worldclimRes=${climateRes} arc-min) -> ~${effArcmin.toFixed(1)} arc-min (~${effKm} km)`;
              } else if (aggregationFactor > 1) {
                return `CHELSA native 30 arc-sec x user aggregation ${aggregationFactor}x -> ~${effArcmin.toFixed(1)} arc-min (~${effKm} km)`;
              }
              return `CHELSA native 30 arc-sec (~1 km) - no aggregation`;
            })()
          : (() => {
              const effArcmin = climateRes * aggregationFactor;
              const effKm = (effArcmin * 1.852).toFixed(1);
              if (aggregationFactor > 1) {
                return `WorldClim ${climateRes} arc-min x ${aggregationFactor}x aggregation -> ~${effArcmin} arc-min (~${effKm} km)`;
              }
              return `WorldClim ${climateRes} arc-min (~${effKm} km)`;
            })()}
      </div>

      {climateSource === "chelsa" && (
        <div className="border-t border-sdm-border pt-4 mt-2">
          <h3 className="text-sm font-semibold text-sdm-heading mb-2">CHELSA extra variables</h3>
          <p className="text-xs text-sdm-muted mb-2">Additional bioclimatic variables available with CHELSA v2.1.</p>
          <div className="flex flex-wrap gap-2">
            {CHELSA_EXTRA_CHOICES.map((v: { id: string; label: string; description: string }) => (
              <label
                key={v.id}
                title={v.description}
                className={cn(
                  "px-2 py-1 rounded text-xs cursor-pointer border",
                  chelsaExtras.includes(v.id)
                    ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                    : "border-sdm-border text-sdm-muted"
                )}
              >
                <input type="checkbox" className="sr-only" checked={chelsaExtras.includes(v.id)} onChange={() => onChelsaExtrasChange(chelsaExtras.includes(v.id) ? chelsaExtras.filter((x) => x !== v.id) : [...chelsaExtras, v.id])} />
                {v.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
