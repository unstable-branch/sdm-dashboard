"use client";

import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { ThresholdData } from "@/services/types";

interface ThresholdChartProps {
  data: ThresholdData | null;
  loading: boolean;
}

export function ThresholdChart({ data, loading }: ThresholdChartProps) {
  const [activeMetric, setActiveMetric] = useState("tss");

  if (loading) return <div className="text-sm text-sdm-muted">Loading threshold data...</div>;
  if (!data) return <div className="text-sm text-sdm-muted italic">No threshold data available</div>;
  if (data.error) return <div className="text-sm text-red-400">{data.error}</div>;
  if (!data.available) return <div className="text-sm text-sdm-muted italic">{data.message || "Threshold not available"}</div>;

  const thresholds = data.thresholds || [];
  if (thresholds.length === 0) return <div className="text-sm text-sdm-muted italic">No threshold data to display</div>;

  const chartData = thresholds.map((t) => ({
    threshold: Number.isFinite(t.threshold) ? t.threshold : 0,
    sensitivity: Number.isFinite(t.sensitivity) ? t.sensitivity : 0,
    specificity: Number.isFinite(t.specificity) ? t.specificity : 0,
    tss: Number.isFinite(t.tss) ? t.tss : 0,
  }));

  // Find optimal threshold (max TSS)
  const optimal = useMemo(() => {
    let best = chartData[0];
    for (const d of chartData) {
      if (d.tss > best.tss) best = d;
    }
    return best;
  }, [chartData]);

  const metricColors: Record<string, string> = { sensitivity: "#2C7FB8", specificity: "#F6B26B", tss: "#E34B35" };
  const metricLabels: Record<string, string> = { sensitivity: "Sensitivity", specificity: "Specificity", tss: "TSS" };

  return (
    <div className="space-y-3">
      <div className="text-xs text-sdm-muted">
        Performance metrics across all thresholds. Optimal threshold (max TSS) is marked with a dashed vertical line.
      </div>
      <div className="flex flex-wrap gap-2">
        {["sensitivity", "specificity", "tss"].map((m) => (
          <button
            key={m}
            onClick={() => setActiveMetric(m)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeMetric === m ? "bg-sdm-accent text-white" : "bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
            }`}
          >
            {metricLabels[m]}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="threshold"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Threshold", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Score", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px", fontSize: "12px" }}
            formatter={(value: number) => [Number.isFinite(value) ? value.toFixed(3) : "—", ""]}
          />
          {["sensitivity", "specificity", "tss"].map((m) =>
            m === activeMetric ? (
              <Line key={m} type="monotone" dataKey={m} stroke={metricColors[m]} strokeWidth={2} dot={false} name={metricLabels[m]} />
            ) : (
              <Line key={m} type="monotone" dataKey={m} stroke={metricColors[m]} strokeWidth={1} dot={false} opacity={0.3} name={metricLabels[m]} />
            )
          )}
          <ReferenceLine x={optimal.threshold} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
      <div className="text-xs text-sdm-muted bg-sdm-surface-soft border border-sdm-border rounded p-2">
        Optimal threshold: <span className="text-sdm-text font-semibold">{optimal.threshold.toFixed(3)}</span>
        &nbsp;(TSS = <span className="text-sdm-text font-semibold">{optimal.tss.toFixed(3)}</span>,
        sensitivity = <span className="text-sdm-text font-semibold">{optimal.sensitivity.toFixed(3)}</span>,
        specificity = <span className="text-sdm-text font-semibold">{optimal.specificity.toFixed(3)}</span>)
      </div>
    </div>
  );
}
