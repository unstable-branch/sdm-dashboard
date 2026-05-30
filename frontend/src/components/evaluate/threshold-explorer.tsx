"use client";

interface ThresholdExplorerProps {
  aucMean?: number | null;
  tssMean?: number | null;
  sensitivity?: number | null;
  specificity?: number | null;
}

export function ThresholdExplorer({ aucMean, tssMean, sensitivity, specificity }: ThresholdExplorerProps) {
  const realSensitivity = sensitivity ?? null;
  const realSpecificity = specificity ?? null;
  const realTss = tssMean ?? null;
  const hasData = realSensitivity !== null && realSpecificity !== null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Sensitivity</p>
          <p className="mt-1 text-xl font-bold text-sdm-accent">
            {hasData ? realSensitivity!.toFixed(3) : "—"}
          </p>
          <p className="text-xs text-sdm-muted mt-0.5">True positive rate (at model threshold)</p>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Specificity</p>
          <p className="mt-1 text-xl font-bold text-sdm-accent">
            {hasData ? realSpecificity!.toFixed(3) : "—"}
          </p>
          <p className="text-xs text-sdm-muted mt-0.5">True negative rate (at model threshold)</p>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">TSS</p>
          <p className={`mt-1 text-xl font-bold ${realTss !== null ? (realTss >= 0.5 ? "text-green-500" : realTss >= 0 ? "text-sdm-accent" : "text-sdm-danger") : ""}`}>
            {realTss !== null ? realTss.toFixed(3) : "—"}
          </p>
          <p className="text-xs text-sdm-muted mt-0.5">Sensitivity + Specificity - 1</p>
        </div>
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Threshold Metrics</h4>
        <p className="text-xs text-sdm-muted mb-3">
          These metrics are computed at the model&apos;s selected threshold ({">"}0.5) during cross-validation.
        </p>
        {hasData && (
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="flex items-center justify-between p-2 rounded bg-sdm-surface-soft">
              <span className="text-sdm-muted">Sensitivity</span>
              <span className="text-sdm-text font-mono font-semibold">{realSensitivity!.toFixed(3)}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-sdm-surface-soft">
              <span className="text-sdm-muted">Specificity</span>
              <span className="text-sdm-text font-mono font-semibold">{realSpecificity!.toFixed(3)}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-sdm-surface-soft">
              <span className="text-sdm-muted">True Skill Statistic</span>
              <span className="text-sdm-text font-mono font-semibold">{realTss !== null ? realTss.toFixed(3) : "—"}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-sdm-surface-soft">
              <span className="text-sdm-muted">AUC</span>
              <span className="text-sdm-text font-mono font-semibold">{aucMean != null ? aucMean.toFixed(3) : "—"}</span>
            </div>
          </div>
        )}
        {!hasData && (
          <p className="text-xs text-sdm-muted italic">No evaluation metrics available for this run.</p>
        )}
      </div>

      {aucMean != null && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">Model discrimination</h4>
          <p className="text-sm text-sdm-text">
            AUC = {aucMean.toFixed(3)} &mdash;{" "}
            {aucMean >= 0.9 ? "Excellent" : aucMean >= 0.8 ? "Good" : aucMean >= 0.7 ? "Acceptable" : "Poor"}
          </p>
          <p className="text-xs text-sdm-muted mt-1">
            Area Under the ROC Curve (AUC) measures the model&apos;s ability to discriminate presence from absence across all possible thresholds.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">About thresholds</h4>
        <p className="text-xs text-sdm-muted leading-relaxed">
          The model selects a suitability threshold to convert continuous suitability scores into binary
          presence/absence predictions. Metrics shown above are evaluated at this threshold using
          cross-validated test folds. A per-threshold sweep visualization requires a backend endpoint.
        </p>
      </div>
    </div>
  );
}
