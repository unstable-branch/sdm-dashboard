"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { CbiData } from "@/services/types";

interface CbiChartProps {
  data: CbiData | null;
  loading: boolean;
}

export function CbiChart({ data, loading }: CbiChartProps) {
  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading CBI data...</div>;
  }

  if (!data) {
    return <div className="text-sm text-sdm-muted italic">No CBI data available</div>;
  }

  if (data.error) {
    return <div className="text-sm text-red-400">{data.error}</div>;
  }

  if (!data.available) {
    return <div className="text-sm text-sdm-muted italic">{data.message || "CBI not available"}</div>;
  }

  const bins = data.bins || [];
  if (bins.length === 0) {
    return <div className="text-sm text-sdm-muted italic">No bin data to display</div>;
  }

  const cbiValue: number | undefined = data.cbi;
  const cbiFinite = cbiValue != null && Number.isFinite(cbiValue);
  const cbiVal = cbiFinite ? cbiValue! : 0;
  const cbiColor = cbiFinite
    ? cbiVal >= 0.7 ? "text-green-400"
    : cbiVal >= 0.4 ? "text-yellow-400"
    : "text-red-400"
    : "text-sdm-muted";

  const cbiLabel = cbiFinite
    ? cbiVal >= 0.7 ? "Good fit"
    : cbiVal >= 0.4 ? "Moderate fit"
    : "Poor fit"
    : "—";

  const peValue: number | undefined = data.pe_ratio;
  const peFinite = peValue != null && Number.isFinite(peValue);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">CBI (Spearman ρ)</div>
          <div className={`text-lg font-semibold ${cbiColor}`}>
            {cbiFinite ? cbiValue!.toFixed(3) : "—"}
          </div>
          <div className="text-xs text-sdm-muted">{cbiLabel}</div>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">P/E Ratio (mean)</div>
          <div className="text-lg font-semibold text-sdm-text">
            {peFinite ? peValue!.toFixed(3) : "—"}
          </div>
          <div className="text-xs text-sdm-muted">&gt;1 = model better than random</div>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">Bins</div>
          <div className="text-lg font-semibold text-sdm-text">{data.n_bins ?? "—"}</div>
        </div>
      </div>

      {data.note && (
        <div className="text-xs text-yellow-400 bg-yellow-500/5 border border-yellow-500/20 rounded p-2">
          Note: {data.note}
        </div>
      )}

      <div className="text-xs text-sdm-muted">
        P/E ratio: observed presences / expected background per suitability bin.
        Smoothed curve (moving average) used for CBI calculation.
        Dashed line at 1.0 = random expectation.
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={bins} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="bin_mid"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Suitability", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 11 }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "P/E Ratio", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => [Number.isFinite(value) ? value.toFixed(3) : "—", name === "smoothed" ? "Smoothed P/E" : "Raw P/E"]}
          />
          <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="ratio"
            stroke="#94a3b8"
            strokeWidth={1}
            dot={false}
            name="Raw P/E"
            opacity={0.5}
          />
          <Line
            type="monotone"
            dataKey="smoothed"
            stroke="#E34B35"
            strokeWidth={2}
            dot={false}
            name="Smoothed P/E"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
export { CbiChart as default }
