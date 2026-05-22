"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface CurvePoint {
  value: number;
  suitability: number;
}

interface CurveData {
  covariate: string;
  points: CurvePoint[];
}

interface ResponseCurvesData {
  available: boolean;
  message?: string;
  n_curves?: number;
  curves?: CurveData[];
  error?: string;
}

interface ResponseCurvesChartProps {
  data: ResponseCurvesData | null;
  loading: boolean;
}

const COLORS = [
  "#2C7FB8", "#E34B35", "#F6B26B", "#6A3D99", "#33A02C",
  "#FB9A99", "#1F78B4", "#A6CEE3", "#B2DF8A", "#CAB2D6",
  "#FDBF6F", "#E69F00", "#56B4E9", "#009E73", "#D55E00",
];

export function ResponseCurvesChart({ data, loading }: ResponseCurvesChartProps) {
  const curves = data?.curves || [];
  const [activeCurves, setActiveCurves] = useState<Set<string>>(
    () => new Set(curves.map((c) => c.covariate))
  );

  useEffect(() => {
    if (curves.length > 0 && activeCurves.size === 0) {
      setActiveCurves(new Set(curves.map((c) => c.covariate)));
    }
  }, [data, curves, activeCurves.size]);

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

  const allValues = new Set<number>();
  curves.forEach((c) => c.points.forEach((p) => allValues.add(p.value)));
  const sortedValues = Array.from(allValues).sort((a, b) => a - b);

  const combinedData = sortedValues.map((val) => {
    const entry: Record<string, number> = { value: val };
    curves.forEach((c) => {
      if (activeCurves.has(c.covariate)) {
        const point = c.points.find((p) => Math.abs(p.value - val) < 0.001);
        entry[c.covariate] = point?.suitability ?? NaN;
      }
    });
    return entry;
  });

  const toggleCurve = (covariate: string) => {
    const next = new Set(activeCurves);
    if (next.has(covariate)) {
      if (next.size > 1) next.delete(covariate);
    } else {
      next.add(covariate);
    }
    setActiveCurves(next);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-sdm-muted">
        Suitability response when varying one covariate while holding others at their mean.
        Click legend items to toggle curves.
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {curves.map((c) => {
          const idx = curves.indexOf(c);
          const isActive = activeCurves.has(c.covariate);
          return (
            <button
              key={c.covariate}
              onClick={() => toggleCurve(c.covariate)}
              className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                isActive ? "text-sdm-text border border-sdm-border bg-sdm-surface" : "text-sdm-muted border border-transparent opacity-50"
              }`}
              style={{ borderLeftColor: isActive ? COLORS[idx % COLORS.length] : "transparent", borderLeftWidth: "3px" }}
            >
              {c.covariate}
            </button>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={combinedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="value"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Covariate value", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 11 }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Suitability", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          {curves.map((c, idx) =>
            activeCurves.has(c.covariate) ? (
              <Line
                key={c.covariate}
                type="monotone"
                dataKey={c.covariate}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={2}
                dot={false}
                name={c.covariate}
              />
            ) : null
          )}
          <Legend />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
