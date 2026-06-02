"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { ResponseCurvesData } from "@/services/types";

interface ResponseCurvesChartProps {
  data: ResponseCurvesData | null;
  loading: boolean;
}

const PALETTE = [
  "#2C7FB8", "#E34B35", "#F6B26B", "#6A3D99", "#33A02C",
  "#FB9A99", "#1F78B4", "#A6CEE3", "#B2DF8A", "#CAB2D6",
  "#FDBF6F", "#E69F00", "#56B4E9", "#009E73", "#D55E00",
];

function CurveChart({ curve, color }: { curve: NonNullable<ResponseCurvesData["curves"]>[number]; color: string }) {
  const data = curve.points
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.suitability))
    .map((p) => ({ x: p.value, suitability: p.suitability }));
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
      <p className="text-xs font-medium text-sdm-text mb-1 font-mono">{curve.covariate}</p>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="x" tick={{ fontSize: 10, fill: "#9ca3af" }} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "#9ca3af" }} width={30} />
          <Tooltip
            formatter={(value: number) => [Number.isFinite(value) ? value.toFixed(4) : "N/A", "Suitability"]}
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px", fontSize: "11px" }}
          />
          <Line type="monotone" dataKey="suitability" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ResponseCurvesChart({ data, loading }: ResponseCurvesChartProps) {
  const curves = data?.curves || [];

  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading response curves...</div>;
  }

  if (!data) {
    return <div className="text-sm text-sdm-muted italic">No response curve data available</div>;
  }

  if (data.error) {
    return <div className="text-sm text-red-400">{data.error}</div>;
  }

  if (!data.available) {
    return <div className="text-sm text-sdm-muted italic">{data.message || "Response curves not available"}</div>;
  }

  if (curves.length === 0) {
    return <div className="text-sm text-sdm-muted italic">No curves to display</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-sdm-muted">
        Marginal response curves: suitability when varying one covariate while holding others at their mean.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {curves.map((c, idx) => (
          <CurveChart key={c.covariate} curve={c} color={PALETTE[idx % PALETTE.length]} />
        ))}
      </div>
    </div>
  );
}
export { ResponseCurvesChart as default }
