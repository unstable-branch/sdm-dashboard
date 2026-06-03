"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface AleCurvePoint {
  value: number;
  ale: number;
}

interface AleCurve {
  covariate: string;
  points: AleCurvePoint[];
}

interface AleData {
  available: boolean;
  n_curves?: number;
  curves?: AleCurve[];
  message?: string;
}

interface AleChartProps {
  data: AleData | null;
  loading: boolean;
}

export function AleChart({ data, loading }: AleChartProps) {
  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sdm-muted">Loading ALE curves...</div>;
  }

  if (!data || !data.available || !data.curves || data.curves.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sdm-muted">
        {data?.message || "ALE data not available for this run"}
      </div>
    );
  }

  const sanitizedCurves = data.curves.map((curve) => ({
    ...curve,
    points: curve.points.filter((p) => Number.isFinite(p.value) && Number.isFinite(p.ale)),
  })).filter((c) => c.points.length > 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-sdm-muted">
        Accumulated Local Effects — unbiased feature effects that handle correlated covariates correctly.
        Unlike PDPs, ALE averages only over the local distribution of other variables.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sanitizedCurves.map((curve) => (
          <div key={curve.covariate} className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <h4 className="text-xs font-semibold text-sdm-heading mb-2 truncate">{curve.covariate}</h4>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curve.points} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="value" tick={{ fontSize: 10 }} type="number" domain={["auto", "auto"]} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(val: number) => Number.isFinite(val) ? val.toFixed(4) : "—"}
                    labelFormatter={(v: number) => Number.isFinite(v) ? v.toFixed(2) : "—"}
                  />
                  <Line type="monotone" dataKey="ale" stroke="var(--sdm-accent, #3b82f6)" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-sdm-muted">
        ALE values are centered around zero. Positive values mean the covariate increases suitability
        relative to the average prediction; negative values decrease it.
      </p>
    </div>
  );
}
