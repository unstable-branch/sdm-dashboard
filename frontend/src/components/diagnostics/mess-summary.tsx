"use client";

interface MessData {
  available: boolean;
  message?: string;
  mess_tif?: string;
  mod_tif?: string;
  pct_extrapolation?: number | null;
  has_future_projection?: boolean;
  error?: string;
}

interface MessSummaryProps {
  data: MessData | null;
  loading: boolean;
}

export function MessSummary({ data, loading }: MessSummaryProps) {
  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading MESS data...</div>;
  }

  if (!data) {
    return <div className="text-sm text-sdm-muted italic">No MESS data available</div>;
  }

  if (data.error) {
    return <div className="text-sm text-red-400">{data.error}</div>;
  }

  if (!data.available) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-sdm-muted italic">{data.message || "MESS not available"}</div>
        {data.has_future_projection && (
          <div className="text-xs text-sdm-muted">
            Future projection exists but MESS raster was not generated.
            Re-run with future projection enabled to compute MESS.
          </div>
        )}
      </div>
    );
  }

  const pct = data.pct_extrapolation;
  const pctColor = pct != null
    ? pct < 10 ? "text-green-400"
    : pct < 30 ? "text-yellow-400"
    : "text-red-400"
    : "text-sdm-muted";

  const pctLabel = pct != null
    ? pct < 10 ? "Low extrapolation"
    : pct < 30 ? "Moderate extrapolation"
    : "High extrapolation — interpret with caution"
    : "";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">% Extrapolation area</div>
          <div className={`text-lg font-semibold ${pctColor}`}>
            {pct != null ? `${pct.toFixed(1)}%` : "—"}
          </div>
          {pctLabel && <div className="text-xs text-sdm-muted">{pctLabel}</div>}
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">Status</div>
          <div className="text-lg font-semibold text-green-400">Available</div>
          <div className="text-xs text-sdm-muted">MESS + MOD rasters computed</div>
        </div>
      </div>

      <div className="text-xs text-sdm-muted bg-sdm-surface-soft border border-sdm-border rounded p-3">
        <strong className="text-sdm-text">MESS (Multivariate Environmental Similarity Surface)</strong>
        <br />
        Identifies cells where projected conditions are outside the training environmental space.
        Negative values = extrapolation. The MOD raster identifies which variable is most dissimilar.
        <br /><br />
        {data.mess_tif && (
          <span>
            MESS raster: <code className="text-sdm-accent">{data.mess_tif}</code>
          </span>
        )}
      </div>
    </div>
  );
}
