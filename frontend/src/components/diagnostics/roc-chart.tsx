"use client";

import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, ComposedChart } from "recharts";
import type { RocData } from "@/services/types";

interface RocChartProps {
  data: RocData | null;
  loading: boolean;
}

export function RocChart({ data, loading }: RocChartProps) {
  if (loading) return <div className="text-sm text-sdm-muted">Loading ROC data...</div>;
  if (!data) return <div className="text-sm text-sdm-muted italic">No ROC data available</div>;
  if (data.error) return <div className="text-sm text-red-400">{data.error}</div>;
  if (!data.available) return <div className="text-sm text-sdm-muted italic">{data.message || "ROC not available"}</div>;

  const points = data.fpr?.map((fpr, i) => ({
    fpr: Number.isFinite(fpr) ? fpr : 0,
    tpr: Number.isFinite(data.tpr?.[i]) ? data.tpr![i] : 0,
  })) || [];

  if (points.length === 0) return <div className="text-sm text-sdm-muted italic">No ROC points to display</div>;

  const auc: number | undefined = data.auc;
  const aucLabel = auc != null && Number.isFinite(auc) ? `AUC = ${auc.toFixed(3)}` : "";

  return (
    <div className="space-y-3">
      <div className="text-xs text-sdm-muted">
        Receiver Operating Characteristic curve. {aucLabel && <span className="text-sdm-text font-semibold">{aucLabel}</span>}
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={points} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="fpr"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "False Positive Rate", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "True Positive Rate", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px", fontSize: "12px" }}
            formatter={(value: number) => [Number.isFinite(value) ? value.toFixed(3) : "—", ""]}
          />
          <defs>
            <linearGradient id="rocAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2C7FB8" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#2C7FB8" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="tpr" fill="url(#rocAreaFill)" stroke="none" />
          <Line type="monotone" dataKey="tpr" stroke="#2C7FB8" strokeWidth={2} dot={false} name="ROC" />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#6b7280" strokeDasharray="4 4" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
