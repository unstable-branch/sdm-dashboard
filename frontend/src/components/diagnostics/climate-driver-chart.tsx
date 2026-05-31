"use client";

interface ClimateDriverData {
  available: boolean;
  has_future_projection?: boolean;
  summary?: {
    mean_delta: number;
    sd_delta: number;
    min_delta: number;
    max_delta: number;
    pct_loss: number;
    pct_gain: number;
    pct_stable: number;
    n_cells: number;
  };
  message?: string;
  note?: string;
}

interface ClimateDriverChartProps {
  data: ClimateDriverData | null;
  loading: boolean;
}

export function ClimateDriverChart({ data, loading }: ClimateDriverChartProps) {
  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sdm-muted">Loading climate driver analysis...</div>;
  }

  if (!data || !data.available) {
    return (
      <div className="flex items-center justify-center h-48 text-sdm-muted">
        {data?.message || "Climate driver analysis requires a future projection"}
      </div>
    );
  }

  const s = data.summary;
  if (!s) {
    return <div className="flex items-center justify-center h-48 text-sdm-muted">No summary data available</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-4 text-center">
          <div className={`text-2xl font-bold ${s.mean_delta > 0 ? 'text-green-500' : 'text-red-500'}`}>
            {s.mean_delta > 0 ? '+' : ''}{s.mean_delta.toFixed(3)}
          </div>
          <div className="text-xs text-sdm-muted mt-1">Mean change</div>
        </div>
        <div className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-4 text-center">
          <div className="text-2xl font-bold text-red-500">{s.pct_loss.toFixed(1)}%</div>
          <div className="text-xs text-sdm-muted mt-1">Cells losing suitability</div>
        </div>
        <div className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-4 text-center">
          <div className="text-2xl font-bold text-green-500">{s.pct_gain.toFixed(1)}%</div>
          <div className="text-xs text-sdm-muted mt-1">Cells gaining suitability</div>
        </div>
        <div className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-4 text-center">
          <div className="text-2xl font-bold text-sdm-text">{s.pct_stable.toFixed(1)}%</div>
          <div className="text-xs text-sdm-muted mt-1">Cells stable</div>
        </div>
      </div>

      <div className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-2">Suitability change distribution</h4>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <div className="text-sdm-muted">Minimum</div>
          <div className="text-sdm-text font-mono">{s.min_delta.toFixed(4)}</div>
          <div className="text-sdm-muted">Maximum</div>
          <div className="text-sdm-text font-mono">{s.max_delta.toFixed(4)}</div>
          <div className="text-sdm-muted">Standard deviation</div>
          <div className="text-sdm-text font-mono">{s.sd_delta.toFixed(4)}</div>
          <div className="text-sdm-muted">Cells analysed</div>
          <div className="text-sdm-text font-mono">{s.n_cells.toLocaleString()}</div>
        </div>
      </div>

      {data.note && (
        <p className="text-xs text-sdm-muted italic">{data.note}</p>
      )}
    </div>
  );
}
