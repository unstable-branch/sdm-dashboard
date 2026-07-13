"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/services/api";
import { Loader2, ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { RunDetail } from "@/services/types";

interface ComparisonData {
  species: string;
  same_species: boolean;
  models: {
    model1: { id: string; label: string; method: string };
    model2: { id: string; label: string; method: string };
  };
  metrics: {
    auc: { model1: number; model2: number; diff: number };
    tss: { model1: number; model2: number; diff: number };
    cv_strategy: { model1: string; model2: string };
    cv_k: { model1: number; model2: number };
  };
  data: {
    n_presences: { model1: number; model2: number };
    n_background: { model1: number; model2: number };
  } | null;
  importance: Array<Record<string, unknown>> | null;
  summary: {
    better_auc: string;
    better_tss: string;
    n_shared_vars: number;
  };
  report_text: string;
}

interface RunComparisonReportProps {
  run1: RunDetail;
  run2: RunDetail;
}

function fmt(v: number | undefined | null, d: number): string {
  return v != null && Number.isFinite(v) ? v.toFixed(d) : "—";
}

function DiffIndicator({ diff }: { diff: number; better: string }) {
  if (!isFinite(diff) || diff === 0) return <Minus className="h-4 w-4 text-sdm-muted" />;
  if (diff > 0) return <ArrowUp className="h-4 w-4 text-green-500" />;
  return <ArrowDown className="h-4 w-4 text-red-500" />;
}

export function RunComparisonReport({ run1, run2 }: RunComparisonReportProps) {
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchComparison = async () => {
      try {
        const result = await apiGet<ComparisonData>(`/api/v1/sdm/compare/${run1.id}/${run2.id}`);
        setData(result);
      } catch (err: any) {
        setError(err?.message || "Comparison failed");
      } finally {
        setLoading(false);
      }
    };
    fetchComparison();
  }, [run1.id, run2.id]);

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sdm-muted"><Loader2 className="h-5 w-5 animate-spin mr-2" />Comparing runs...</div>;
  }

  if (error) {
    return <div className="rounded-md border border-red-300/30 bg-red-500/5 p-4 text-sm text-red-500">{error}</div>;
  }

  if (!data) return null;

  const m1 = data.models.model1;
  const m2 = data.models.model2;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h2 className="text-sm font-semibold text-sdm-heading mb-1">Model comparison</h2>
        <p className="text-xs text-sdm-muted mb-4">{data.species}</p>

        <div className="grid grid-cols-3 gap-4 text-center mb-4">
          <div className="rounded-md bg-sdm-surface-soft p-3">
            <div className="text-xs text-sdm-muted mb-1">{m1.label}</div>
            <div className="text-lg font-bold text-sdm-text">{fmt(data.metrics.auc.model1, 3)}</div>
            <div className="text-[10px] text-sdm-muted">AUC</div>
          </div>
          <div className="rounded-md bg-sdm-accent/5 border border-sdm-accent/20 p-3">
            <DiffIndicator diff={data.metrics.auc.diff} better={data.summary.better_auc} />
            <div className={`text-lg font-bold ${data.metrics.auc.diff > 0 ? 'text-green-500' : data.metrics.auc.diff < 0 ? 'text-red-500' : 'text-sdm-text'}`}>
              {data.metrics.auc.diff > 0 ? '+' : ''}{fmt(data.metrics.auc.diff, 3)}
            </div>
            <div className="text-[10px] text-sdm-muted">AUC difference</div>
          </div>
          <div className="rounded-md bg-sdm-surface-soft p-3">
            <div className="text-xs text-sdm-muted mb-1">{m2.label}</div>
            <div className="text-lg font-bold text-sdm-text">{fmt(data.metrics.auc.model2, 3)}</div>
            <div className="text-[10px] text-sdm-muted">AUC</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <h3 className="text-xs font-semibold text-sdm-heading mb-2">Metrics</h3>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-sdm-muted">TSS</span><span className="text-sdm-text">{fmt(data.metrics.tss.model1, 3)} vs {fmt(data.metrics.tss.model2, 3)}</span></div>
              <div className="flex justify-between"><span className="text-sdm-muted">CV strategy</span><span className="text-sdm-text">{data.metrics.cv_strategy.model1} vs {data.metrics.cv_strategy.model2}</span></div>
              <div className="flex justify-between"><span className="text-sdm-muted">CV folds</span><span className="text-sdm-text">{data.metrics.cv_k.model1} vs {data.metrics.cv_k.model2}</span></div>
            </div>
            <p className="text-xs text-sdm-muted mt-2">
              Better AUC: <strong className={data.metrics.auc.diff > 0 ? 'text-green-500' : 'text-red-500'}>{data.summary.better_auc}</strong>
            </p>
          </div>

          {data.data && (
            <div>
              <h3 className="text-xs font-semibold text-sdm-heading mb-2">Data</h3>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-sdm-muted">Presences</span><span className="text-sdm-text">{data.data.n_presences.model1} vs {data.data.n_presences.model2}</span></div>
                <div className="flex justify-between"><span className="text-sdm-muted">Background</span><span className="text-sdm-text">{data.data.n_background.model1} vs {data.data.n_background.model2}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {data.importance && data.importance.length > 0 && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h3 className="text-xs font-semibold text-sdm-heading mb-3">Variable importance divergence</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-sdm-border/50">
                  <th className="text-left py-1 pr-4 text-sdm-muted">Variable</th>
                  <th className="text-right py-1 pr-4 text-sdm-muted">{m1.id}</th>
                  <th className="text-right py-1 pr-4 text-sdm-muted">{m2.id}</th>
                  <th className="text-right py-1 text-sdm-muted">Diff</th>
                </tr>
              </thead>
              <tbody>
                {data.importance.slice(0, 10).map((row: any, i) => (
                  <tr key={i} className="border-b border-sdm-border/30">
                    <td className="py-1 pr-4 text-sdm-text">{row.variable}</td>
                    <td className="py-1 pr-4 text-right text-sdm-text">{fmt(row.importance_model1, 3)}</td>
                    <td className="py-1 pr-4 text-right text-sdm-text">{fmt(row.importance_model2, 3)}</td>
                    <td className={`py-1 text-right ${row.diff > 0 ? 'text-green-500' : row.diff < 0 ? 'text-red-500' : 'text-sdm-muted'}`}>
                      {row.diff > 0 ? '+' : ''}{fmt(row.diff, 3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <details className="rounded-lg border border-sdm-border bg-sdm-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-sdm-heading">Text report</summary>
        <pre className="px-4 pb-4 text-xs text-sdm-muted font-mono whitespace-pre-wrap">{data.report_text}</pre>
      </details>
    </div>
  );
}
