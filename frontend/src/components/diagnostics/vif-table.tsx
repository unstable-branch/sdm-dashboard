"use client";

import type { VifData } from "@/services/types";

interface VifTableProps {
  data: VifData | null;
  loading: boolean;
}

export function VifTable({ data, loading }: VifTableProps) {
  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading VIF data...</div>;
  }

  if (!data) {
    return <div className="text-sm text-sdm-muted italic">No VIF data available</div>;
  }

  if (data.error) {
    return <div className="text-sm text-red-400">{data.error}</div>;
  }

  if (!data.available) {
    return <div className="text-sm text-sdm-muted italic">{data.message || "VIF data not available"}</div>;
  }

  const selected = data.selected || [];
  const dropped = data.dropped || [];
  const history = data.vif_history || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">Variables retained</div>
          <div className="text-lg font-semibold text-green-400">{selected.length}</div>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">Variables dropped</div>
          <div className="text-lg font-semibold text-red-400">{dropped.length}</div>
        </div>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
          <div className="text-xs text-sdm-muted mb-1">Final max VIF</div>
          <div className="text-lg font-semibold text-sdm-text">
            {data.vif_final != null && Number.isFinite(data.vif_final) ? data.vif_final.toFixed(2) : "—"}
          </div>
        </div>
      </div>

      {dropped.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">Dropped variables</h4>
          <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sdm-border bg-sdm-surface-soft">
                  <th className="text-left px-3 py-2 text-xs text-sdm-muted font-medium">Variable</th>
                  <th className="text-left px-3 py-2 text-xs text-sdm-muted font-medium">Iteration</th>
                  <th className="text-left px-3 py-2 text-xs text-sdm-muted font-medium">Max VIF at removal</th>
                </tr>
              </thead>
              <tbody>
                {dropped.map((v) => {
                  const hist = history.find((h) => h.variable_removed === v);
                  return (
                    <tr key={v} className="border-b border-sdm-border/50 last:border-0">
                      <td className="px-3 py-2 text-sdm-text font-mono text-xs">{v}</td>
                      <td className="px-3 py-2 text-sdm-muted">{hist?.iteration ?? "—"}</td>
                      <td className="px-3 py-2 text-red-400">{hist?.max_vif != null && Number.isFinite(hist.max_vif) ? hist.max_vif.toFixed(2) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">Retained variables</h4>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sdm-border bg-sdm-surface-soft">
                <th className="text-left px-3 py-2 text-xs text-sdm-muted font-medium">Variable</th>
                <th className="text-left px-3 py-2 text-xs text-sdm-muted font-medium">Mean</th>
                <th className="text-left px-3 py-2 text-xs text-sdm-muted font-medium">SD</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((v) => (
                <tr key={v} className="border-b border-sdm-border/50 last:border-0">
                  <td className="px-3 py-2 text-sdm-text font-mono text-xs">{v}</td>
                  <td className="px-3 py-2 text-sdm-muted">
                    {Number.isFinite(data.var_means?.[v]) ? data.var_means![v].toFixed(3) : "—"}
                  </td>
                  <td className="px-3 py-2 text-sdm-muted">
                    {Number.isFinite(data.var_sds?.[v]) ? data.var_sds![v].toFixed(3) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
