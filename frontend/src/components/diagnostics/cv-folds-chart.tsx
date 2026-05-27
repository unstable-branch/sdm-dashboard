"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { CvFoldsData } from "@/services/types";

interface CvFoldsChartProps {
  data: CvFoldsData | null;
  loading: boolean;
}

export function CvFoldsChart({ data, loading }: CvFoldsChartProps) {
  if (loading) return <div className="text-sm text-sdm-muted">Loading CV folds data...</div>;
  if (!data) return <div className="text-sm text-sdm-muted italic">No CV folds data available</div>;
  if (data.error) return <div className="text-sm text-red-400">{data.error}</div>;
  if (!data.available) return <div className="text-sm text-sdm-muted italic">{data.message || "CV folds not available"}</div>;

  const folds = data.folds || [];
  if (folds.length === 0) return <div className="text-sm text-sdm-muted italic">No fold data to display</div>;

  const chartData = folds.map((f) => ({
    fold: `Fold ${f.fold}`,
    AUC: Number.isFinite(f.auc) ? f.auc : 0,
    TSS: Number.isFinite(f.tss) ? f.tss : 0,
  }));

  const aucMean = Number.isFinite(data.auc_mean) ? data.auc_mean! : 0;
  const tssMean = Number.isFinite(data.tss_mean) ? data.tss_mean! : 0;

  return (
    <div className="space-y-3">
      <div className="text-xs text-sdm-muted">
        Per-fold cross-validation performance. Dashed lines show the mean across folds.
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="fold" tick={{ fontSize: 11, fill: "#9ca3af" }} />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            label={{ value: "Score", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 11 }}
            domain={[0, 1]}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px", fontSize: "12px" }}
            formatter={(value: number) => [Number.isFinite(value) ? value.toFixed(3) : "—", ""]}
          />
          <Legend />
          <Bar dataKey="AUC" fill="#2C7FB8" radius={[2, 2, 0, 0]} />
          <Bar dataKey="TSS" fill="#F6B26B" radius={[2, 2, 0, 0]} />
          <ReferenceLine y={aucMean} stroke="#2C7FB8" strokeDasharray="4 4" strokeWidth={1.5} />
          <ReferenceLine y={tssMean} stroke="#F6B26B" strokeDasharray="4 4" strokeWidth={1.5} />
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-4 gap-4 text-sm">
        <div><span className="text-xs text-sdm-muted">AUC Mean</span><p className="font-semibold text-sdm-text">{aucMean.toFixed(3)}</p></div>
        <div><span className="text-xs text-sdm-muted">AUC SD</span><p className="font-semibold text-sdm-text">{Number.isFinite(data.auc_sd) ? data.auc_sd!.toFixed(3) : "—"}</p></div>
        <div><span className="text-xs text-sdm-muted">TSS Mean</span><p className="font-semibold text-sdm-text">{tssMean.toFixed(3)}</p></div>
        <div><span className="text-xs text-sdm-muted">TSS SD</span><p className="font-semibold text-sdm-text">{Number.isFinite(data.tss_sd) ? data.tss_sd!.toFixed(3) : "—"}</p></div>
      </div>
    </div>
  );
}
