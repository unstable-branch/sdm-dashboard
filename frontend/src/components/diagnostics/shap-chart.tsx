"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ShapEntry {
  variable: string;
  value: number;
  shap_value: number;
}

interface ShapData {
  available: boolean;
  prediction?: number;
  shap?: ShapEntry[];
  message?: string;
}

interface ShapChartProps {
  data: ShapData | null;
  loading: boolean;
}

export function formatShapChartData(shap: ShapEntry[]) {
  return [...shap]
    .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
    .slice(0, 15)
    .map((d) => ({
      variable: d.variable,
      shap: d.shap_value,
      absShap: Math.abs(d.shap_value),
    }));
}

export function ShapChart({ data, loading }: ShapChartProps) {
  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sdm-muted">Loading SHAP values...</div>;
  }

  if (!data || !data.available || !data.shap || data.shap.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sdm-muted">
        {data?.message || "Click a cell on the suitability map to explain its prediction"}
      </div>
    );
  }

  const chartData = formatShapChartData(data.shap);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm text-sdm-muted">
        <span>Predicted suitability: <strong className="text-sdm-text">{data.prediction?.toFixed(3)}</strong></span>
      </div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 20, top: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis dataKey="variable" type="category" tick={{ fontSize: 12 }} width={90} />
            <Tooltip
              formatter={(val: number) => Number.isFinite(val) ? val.toFixed(4) : "—"}
              labelFormatter={() => ""}
            />
            <Bar dataKey="shap" fill="var(--sdm-accent, #3b82f6)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-sdm-muted">
        SHAP values show how each covariate contributes to pushing the prediction away from the
        mean suitability across the study area. Positive values increase suitability; negative values decrease it.
      </p>
    </div>
  );
}
