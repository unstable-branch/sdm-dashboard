"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { DensityData } from "@/services/types";

interface DensityChartProps {
  data: DensityData | null;
  loading: boolean;
}

export function DensityChart({ data, loading }: DensityChartProps) {
  if (loading) return <div className="text-sm text-sdm-muted">Loading density data...</div>;
  if (!data) return <div className="text-sm text-sdm-muted italic">No density data available</div>;
  if (data.error) return <div className="text-sm text-red-400">{data.error}</div>;
  if (!data.available) return <div className="text-sm text-sdm-muted italic">{data.message || "Density not available"}</div>;

  const pres = data.presence;
  const bg = data.background;
  if (!pres || !bg || pres.x.length === 0 || bg.x.length === 0) {
    return <div className="text-sm text-sdm-muted italic">No density data to display</div>;
  }

  // Merge into a common x-axis grid for area chart overlay
  const allX = Array.from(new Set([...pres.x, ...bg.x])).sort((a, b) => a - b);
  const chartData = allX.map((x) => {
    const presIdx = pres.x.indexOf(x);
    const bgIdx = bg.x.indexOf(x);
    return {
      suitability: x,
      presence: presIdx >= 0 ? pres.y[presIdx] : 0,
      background: bgIdx >= 0 ? bg.y[bgIdx] : 0,
    };
  });

  return (
    <div className="space-y-3">
      <div className="text-xs text-sdm-muted">
        Suitability density for presence and background points. Overlap indicates model uncertainty in discrimination.
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="suitability"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Suitability", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Density", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px", fontSize: "12px" }}
            formatter={(value: number) => [Number.isFinite(value) ? value.toFixed(3) : "—", ""]}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="presence"
            fill="#2C7FB8"
            stroke="#2C7FB8"
            fillOpacity={0.4}
            strokeWidth={2}
            name="Presence"
          />
          <Area
            type="monotone"
            dataKey="background"
            fill="#E34B35"
            stroke="#E34B35"
            fillOpacity={0.3}
            strokeWidth={2}
            name="Background"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
