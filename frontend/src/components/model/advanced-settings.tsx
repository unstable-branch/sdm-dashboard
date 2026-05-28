"use client";

interface AdvancedSettingsProps {
  vifReduction: boolean;
  climateMatching: boolean;
  thinByCell: boolean;
  mergeSmallSources: boolean;
  biasMethod: string;
  thickeningDistanceKm: number;
  minSourceRecords: number;
  onSetVifReduction: (v: boolean) => void;
  onSetClimateMatching: (v: boolean) => void;
  onSetThinByCell: (v: boolean) => void;
  onSetMergeSmallSources: (v: boolean) => void;
  onSetBiasMethod: (v: string) => void;
  onSetThickeningDistanceKm: (v: number) => void;
  onSetMinSourceRecords: (v: number) => void;
}

export function AdvancedSettings({
  vifReduction, climateMatching, thinByCell, mergeSmallSources,
  biasMethod, thickeningDistanceKm, minSourceRecords,
  onSetVifReduction, onSetClimateMatching, onSetThinByCell, onSetMergeSmallSources,
  onSetBiasMethod, onSetThickeningDistanceKm, onSetMinSourceRecords,
}: AdvancedSettingsProps) {
  return (
    <details className="rounded-lg border border-sdm-border bg-sdm-surface">
      <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-sdm-heading">Advanced settings</summary>
      <div className="px-6 pb-6 space-y-4">
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={vifReduction} onChange={(e) => onSetVifReduction(e.target.checked)} />
          Drop collinear covariates (VIF reduction)
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={climateMatching} onChange={(e) => onSetClimateMatching(e.target.checked)} />
          Compute climate matching
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={thinByCell} onChange={(e) => onSetThinByCell(e.target.checked)} />
          Thin duplicate records in same climate cell
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={mergeSmallSources} onChange={(e) => onSetMergeSmallSources(e.target.checked)} />
          Merge small occurrence sources
        </label>

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Background sampling bias correction</label>
          <select value={biasMethod} onChange={(e) => onSetBiasMethod(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
            <option value="uniform">Uniform random</option>
            <option value="target_group">Target-group</option>
            <option value="thickened">Thickened</option>
          </select>
        </div>

        {biasMethod === "thickened" && (
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Kernel distance (km)</label>
            <input type="number" value={thickeningDistanceKm} onChange={(e) => onSetThickeningDistanceKm(Number(e.target.value))} min={1} max={100} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Merge sources with fewer than</label>
          <input type="number" value={minSourceRecords} onChange={(e) => onSetMinSourceRecords(Number(e.target.value))} min={1} max={100} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
        </div>
      </div>
    </details>
  );
}
