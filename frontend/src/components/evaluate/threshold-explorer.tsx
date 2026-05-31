"use client";

import { useState } from "react";

interface ThresholdExplorerProps {
  aucMean?: number | null;
  tssMean?: number | null;
  sensitivity?: number | null;
  specificity?: number | null;
}

export function ThresholdExplorer({ aucMean, sensitivity, specificity }: ThresholdExplorerProps) {
  const [threshold, setThreshold] = useState(0.5);

  const simulatedSensitivity = sensitivity != null
    ? Math.max(0, Math.min(1, sensitivity + (0.5 - threshold) * 0.8))
    : 1 - threshold * 0.9;

  const simulatedSpecificity = specificity != null
    ? Math.max(0, Math.min(1, specificity - (0.5 - threshold) * 0.6))
    : 0.3 + threshold * 0.6;

  const simulatedTss = simulatedSensitivity + simulatedSpecificity - 1;

  const optimalThreshold = (() => {
    let bestTss = -1;
    let bestT = 0.5;
    for (let t = 0.05; t <= 0.95; t += 0.05) {
      const sens = 1 - t * 0.9;
      const spec = 0.3 + t * 0.6;
      const tss = sens + spec - 1;
      if (tss > bestTss) {
        bestTss = tss;
        bestT = t;
      }
    }
    return bestT;
  })();

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-sdm-text mb-2">
          Suitability threshold: <span className="text-sdm-accent font-mono">{threshold.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-sdm-muted mt-1">
          <span>0.05 (lenient)</span>
          <span>0.95 (strict)</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Sensitivity</p>
          <p className="mt-1 text-xl font-bold text-sdm-accent">{simulatedSensitivity.toFixed(3)}</p>
          <p className="text-xs text-sdm-muted mt-0.5">True positive rate</p>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Specificity</p>
          <p className="mt-1 text-xl font-bold text-sdm-accent">{simulatedSpecificity.toFixed(3)}</p>
          <p className="text-xs text-sdm-muted mt-0.5">True negative rate</p>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">TSS</p>
          <p className={`mt-1 text-xl font-bold ${simulatedTss >= 0.5 ? "text-green-500" : simulatedTss >= 0 ? "text-sdm-accent" : "text-sdm-danger"}`}>
            {simulatedTss.toFixed(3)}
          </p>
          <p className="text-xs text-sdm-muted mt-0.5">Sens + Spec - 1</p>
        </div>
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">Threshold guidance</h4>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-sdm-muted">Optimal threshold (max TSS)</p>
            <p className="text-sdm-heading font-mono font-semibold">{optimalThreshold.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sdm-muted">Current threshold</p>
            <p className="text-sdm-heading font-mono font-semibold">{threshold.toFixed(2)}</p>
          </div>
        </div>
        {aucMean != null && (
          <div className="mt-3 pt-3 border-t border-sdm-border">
            <p className="text-sdm-muted">Model AUC</p>
            <p className="text-sdm-heading font-mono font-semibold">{aucMean.toFixed(3)}</p>
            <p className="text-sdm-muted mt-1">
              {aucMean >= 0.9 ? "Excellent discrimination" : aucMean >= 0.8 ? "Good discrimination" : aucMean >= 0.7 ? "Acceptable" : "Poor discrimination"}
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">Sensitivity vs Specificity</h4>
        <div className="relative h-32">
          <svg viewBox="0 0 100 50" className="w-full h-full">
            <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" className="text-sdm-border" strokeWidth="0.5" />
            <line x1="0" y1="0" x2="0" y2="50" stroke="currentColor" className="text-sdm-border" strokeWidth="0.5" />
            <polyline
              points={Array.from({ length: 19 }, (_, i) => {
                const t = 0.05 + i * 0.05;
                const s = 1 - t * 0.9;
                return `${t * 100},${(1 - s) * 50}`;
              }).join(" ")}
              fill="none"
              className="text-blue-500"
              stroke="currentColor"
              strokeWidth="1"
            />
            <polyline
              points={Array.from({ length: 19 }, (_, i) => {
                const t = 0.05 + i * 0.05;
                const sp = 0.3 + t * 0.6;
                return `${t * 100},${(1 - sp) * 50}`;
              }).join(" ")}
              fill="none"
              className="text-green-500"
              stroke="currentColor"
              strokeWidth="1"
            />
            <circle cx={threshold * 100} cy={(1 - simulatedSensitivity) * 50} r="2" className="fill-blue-500" />
            <circle cx={threshold * 100} cy={(1 - simulatedSpecificity) * 50} r="2" className="fill-green-500" />
          </svg>
          <div className="flex justify-between text-xs text-sdm-muted mt-1">
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-blue-500 inline-block" /> Sensitivity</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-green-500 inline-block" /> Specificity</span>
          </div>
        </div>
      </div>
    </div>
  );
}
export { ThresholdExplorer as default }
