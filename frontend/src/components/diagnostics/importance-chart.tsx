"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar } from "recharts";

interface ImportanceEntry {
  variable: string;
  importance: number;
  sd: number;
  baseline: number;
}

interface ImportanceData {
  available: boolean;
  message?: string;
  n_variables?: number;
  importance?: ImportanceEntry[];
  error?: string;
}

interface ImportanceChartProps {
  data: ImportanceData | null;
  loading: boolean;
}

export function ImportanceChart({ data, loading }: ImportanceChartProps) {
  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading importance data...</div>;
  }

  if (!data) {
    return <div className="text-sm text-sdm-muted italic">No importance data available</div>;
  }

  if (data.error) {
    return <div className="text-sm text-red-400">{data.error}</div>;
  }

  if (!data.available) {
    return <div className="text-sm text-sdm-muted italic">{data.message || "Variable importance not available"}</div>;
  }

  const items = (data.importance || []).slice(0, 15);
  if (items.length === 0) {
    return <div className="text-sm text-sdm-muted italic">No importance data to display</div>;
  }

  const chartData = items.map((item) => ({
    name: item.variable,
    importance: Math.max(0, item.importance),
    sd: item.sd,
  }));

  return (
    <div className="space-y-3">
      <div className="text-xs text-sdm-muted">
        Permutation importance (AUC drop when variable is shuffled). Higher = more influential.
        Error bars show ±1 SD across permutations.
      </div>
      <ResponsiveContainer width="100%" height={Math.max(200, items.length * 28)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "#e5e7eb", fontFamily: "monospace" }}
            width={95}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => [value.toFixed(4), name === "importance" ? "Importance" : "SD"]}
          />
          <Bar dataKey="importance" fill="#2C7FB8" radius={[0, 4, 4, 0]}>
            <ErrorBar dataKey="sd" stroke="#F6B26B" strokeWidth={1.5} width={6} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
