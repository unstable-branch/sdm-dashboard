"use client";

interface ModelSettingsProps {
  backgroundN: number;
  nCores: number;
  cvFolds: number;
  cvStrategy: string;
  paReplicates: number;
  aggregationFactor: number;
  includeQuadratic: boolean;
  onSetBackgroundN: (v: number) => void;
  onSetNCores: (v: number) => void;
  onSetCvFolds: (v: number) => void;
  onSetCvStrategy: (v: string) => void;
  onSetPaReplicates: (v: number) => void;
  onSetAggregationFactor: (v: number) => void;
  onSetIncludeQuadratic: (v: boolean) => void;
}

export function ModelSettings({
  backgroundN, nCores, cvFolds, cvStrategy, paReplicates, aggregationFactor, includeQuadratic,
  onSetBackgroundN, onSetNCores, onSetCvFolds, onSetCvStrategy, onSetPaReplicates, onSetAggregationFactor, onSetIncludeQuadratic,
}: ModelSettingsProps) {
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
      <h2 className="text-lg font-semibold text-sdm-heading">Model settings</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Background points</label>
          <input type="number" value={backgroundN} onChange={(e) => onSetBackgroundN(Number(e.target.value))} min={500} max={100000} step={500} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
        </div>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">CPU cores</label>
          <input type="number" value={nCores} onChange={(e) => onSetNCores(Number(e.target.value))} min={1} max={64} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
        </div>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Cross-validation folds</label>
          <select value={cvFolds} onChange={(e) => onSetCvFolds(Number(e.target.value))} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
            <option value={0}>Off</option>
            <option value={3}>3-fold</option>
            <option value={5}>5-fold</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">CV strategy</label>
          <select value={cvStrategy} onChange={(e) => onSetCvStrategy(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
            <option value="random">Random</option>
            <option value="spatial_blocks">Spatial blocks</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">PA replicates</label>
          <input type="number" value={paReplicates} onChange={(e) => onSetPaReplicates(Number(e.target.value))} min={1} max={10} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
        </div>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Raster aggregation</label>
          <input type="number" value={aggregationFactor} onChange={(e) => onSetAggregationFactor(Number(e.target.value))} min={1} max={8} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-sdm-text">
        <input type="checkbox" checked={includeQuadratic} onChange={(e) => onSetIncludeQuadratic(e.target.checked)} />
        Include quadratic climate responses
      </label>
    </div>
  );
}
