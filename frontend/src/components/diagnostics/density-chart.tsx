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
  // Use a Map keyed by rounded values to avoid floating-point indexOf mismatches
  const toKey = (v: number) => Math.round(v * 1e6).toString();
  const presMap = new Map<string, number>();
  pres.x.forEach((x, i) => { if (Number.isFinite(x) && Number.isFinite(pres.y[i])) presMap.set(toKey(x), pres.y[i]); });
  const bgMap = new Map<string, number>();
  bg.x.forEach((x, i) => { if (Number.isFinite(x) && Number.isFinite(bg.y[i])) bgMap.set(toKey(x), bg.y[i]); });
  const allKeys = Array.from(new Set([...presMap.keys(), ...bgMap.keys()])).sort((a, b) => parseFloat(a) - parseFloat(b));
  const chartData = allKeys.map((k) => ({
    suitability: parseFloat(k),
    presence: presMap.get(k) ?? 0,
    background: bgMap.get(k) ?? 0,
  }));

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
