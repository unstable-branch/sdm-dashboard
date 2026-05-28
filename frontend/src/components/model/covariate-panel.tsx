"use client";

import { cn } from "@/lib/utils";
import { SOIL_VARS, SOIL_DEPTHS, UV_VARS } from "@sdm/shared";

interface CovariatePanelProps {
  useElevation: boolean;
  useSoil: boolean;
  soilVars: string[];
  soilDepths: string[];
  useUv: boolean;
  uvVars: string[];
  useVegetation: boolean;
  useLulc: boolean;
  useHfp: boolean;
  useBioclimSeason: boolean;
  useDrought: boolean;
  onSetUseElevation: (v: boolean) => void;
  onSetUseSoil: (v: boolean) => void;
  onToggleSoilVar: (v: string) => void;
  onToggleSoilDepth: (v: string) => void;
  onSetUseUv: (v: boolean) => void;
  onToggleUvVar: (v: string) => void;
  onSetUseVegetation: (v: boolean) => void;
  onSetUseLulc: (v: boolean) => void;
  onSetUseHfp: (v: boolean) => void;
  onSetUseBioclimSeason: (v: boolean) => void;
  onSetUseDrought: (v: boolean) => void;
}

export function CovariatePanel({
  useElevation, useSoil, soilVars, soilDepths, useUv, uvVars,
  useVegetation, useLulc, useHfp, useBioclimSeason, useDrought,
  onSetUseElevation, onSetUseSoil, onToggleSoilVar, onToggleSoilDepth,
  onSetUseUv, onToggleUvVar, onSetUseVegetation, onSetUseLulc, onSetUseHfp,
  onSetUseBioclimSeason, onSetUseDrought,
}: CovariatePanelProps) {
  return (
    <details className="rounded-lg border border-sdm-border bg-sdm-surface">
      <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-sdm-heading">Optional covariates</summary>
      <div className="px-6 pb-6 space-y-4">
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useElevation} onChange={(e) => onSetUseElevation(e.target.checked)} />
          Add elevation (OpenTopography)
        </label>

        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useSoil} onChange={(e) => onSetUseSoil(e.target.checked)} />
          Add SoilGrids covariates
        </label>
        {useSoil && (
          <div className="space-y-2 ml-6">
            <div className="flex flex-wrap gap-2">
              {SOIL_VARS.map((v: { id: string; label: string }) => (
                <label key={v.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", soilVars.includes(v.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                  <input type="checkbox" checked={soilVars.includes(v.id)} onChange={() => onToggleSoilVar(v.id)} className="sr-only" />
                  {v.label}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {SOIL_DEPTHS.map((d: string) => (
                <label key={d} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", soilDepths.includes(d) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                  <input type="checkbox" checked={soilDepths.includes(d)} onChange={() => onToggleSoilDepth(d)} className="sr-only" />
                  {d}
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useUv} onChange={(e) => onSetUseUv(e.target.checked)} />
          Add UV-B covariates (glUV)
        </label>
        {useUv && (
          <div className="flex flex-wrap gap-2 ml-6">
            {UV_VARS.map((v: { id: string; label: string }) => (
              <label key={v.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", uvVars.includes(v.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                <input type="checkbox" checked={uvVars.includes(v.id)} onChange={() => onToggleUvVar(v.id)} className="sr-only" />
                {v.label}
              </label>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useVegetation} onChange={(e) => onSetUseVegetation(e.target.checked)} />
          Add vegetation productivity
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useLulc} onChange={(e) => onSetUseLulc(e.target.checked)} />
          Add LULC (MODIS)
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useHfp} onChange={(e) => onSetUseHfp(e.target.checked)} />
          Add Human Footprint
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useBioclimSeason} onChange={(e) => onSetUseBioclimSeason(e.target.checked)} />
          Add bioclimatic seasonality
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={useDrought} onChange={(e) => onSetUseDrought(e.target.checked)} />
          Add drought index (scPDSI)
        </label>
      </div>
    </details>
  );
}
