"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { CalibrationData } from "@/services/types";

interface CalibrationChartProps {
  data: CalibrationData | null;
  loading: boolean;
}

export function CalibrationChart({ data, loading }: CalibrationChartProps) {
  if (loading) return <div className="text-sm text-sdm-muted">Loading calibration data...</div>;
  if (!data) return <div className="text-sm text-sdm-muted italic">No calibration data available</div>;
  if (data.error) return <div className="text-sm text-red-400">{data.error}</div>;
  if (!data.available) return <div className="text-sm text-sdm-muted italic">{data.message || "Calibration not available"}</div>;

  const bins = data.bins || [];
  if (bins.length === 0) return <div className="text-sm text-sdm-muted italic">No calibration bins to display</div>;

  const chartData = bins.map((b) => ({
    predicted: Number.isFinite(b.bin_mid) ? b.bin_mid : 0,
    observed: Number.isFinite(b.observed_freq) ? b.observed_freq : 0,
    count: b.count,
  }));

  return (
    <div className="space-y-3">
      <div className="text-xs text-sdm-muted">
        Calibration curve: predicted probability vs observed frequency. Points close to the diagonal indicate well-calibrated predictions.
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="predicted"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Predicted Probability", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Observed Frequency", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px", fontSize: "12px" }}
            formatter={(value: number, name: string) => {
              const safe = Number.isFinite(value) ? value.toFixed(3) : "—";
              return [safe, name === "observed" ? "Observed" : "Predicted"];
            }}
          />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#6b7280" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="observed" stroke="#2C7FB8" strokeWidth={2} dot={{ r: 4 }} name="observed" />
          <Line type="monotone" dataKey="predicted" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 4" dot={false} name="predicted" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
