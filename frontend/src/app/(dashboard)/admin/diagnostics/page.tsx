"use client";

import { useState, useEffect, useCallback } from "react";
import React from "react";
import { apiGet, apiPost } from "@/services/api";
import { Loader2, AlertCircle, CheckCircle2, Clock, XCircle, Play, RefreshCw } from "lucide-react";

interface RunRecord {
  id: string;
  speciesName: string | null;
  modelId: string | null;
  status: string;
  jobId: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface RunDetail {
  id: string;
  config: any;
  metrics: any;
  error: string | null;
}

export default function AdminDiagnosticsPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const limit = 25;

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter) params.set("status", statusFilter);
      const data = await apiGet<{ runs: RunRecord[]; total: number }>(`/api/v1/admin/diagnostics/runs?${params}`);
      setRuns(data.runs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  async function expandRun(id: string) {
    if (expandedRun === id) { setExpandedRun(null); setRunDetail(null); return; }
    setExpandedRun(id);
    setDetailLoading(true);
    try {
      const detail = await apiGet<RunDetail>(`/api/v1/admin/diagnostics/runs/${id}`);
      setRunDetail(detail);
    } catch {
      setRunDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function cleanupJobs() {
    try {
      const res = await apiPost<{ message: string }>("/api/v1/admin/system/jobs/cleanup");
      alert(res.message);
      fetchRuns();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  const statusIcon = (s: string) => {
    switch (s) {
      case "completed": return <CheckCircle2 className="h-4 w-4 text-sdm-success" />;
      case "failed": return <XCircle className="h-4 w-4 text-red-400" />;
      case "running": return <Play className="h-4 w-4 text-sdm-accent animate-pulse" />;
      case "queued": return <Clock className="h-4 w-4 text-sdm-warning" />;
      default: return <AlertCircle className="h-4 w-4 text-sdm-muted" />;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-sdm-heading">Diagnostic Logs</h1>
        <div className="flex gap-2">
          <button onClick={() => setStatusFilter("")} className={`rounded px-3 py-1 text-xs ${!statusFilter ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text"}`}>All</button>
          {["completed", "failed", "running", "queued", "cancelled"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded px-3 py-1 text-xs capitalize ${statusFilter === s ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text hover:bg-sdm-surface-soft"}`}>{s}</button>
          ))}
          <button onClick={cleanupJobs}
            className="rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft">
            <RefreshCw className="h-3.5 w-3.5 inline mr-1" /> Cleanup
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-sdm-border bg-sdm-surface-soft">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Species</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Model</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Job ID</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <React.Fragment key={r.id}>
                <tr onClick={() => expandRun(r.id)}
                  className="border-b border-sdm-border hover:bg-sdm-surface-soft cursor-pointer">
                  <td className="px-4 py-2"><div className="flex items-center gap-1">{statusIcon(r.status)}<span className="text-xs capitalize">{r.status}</span></div></td>
                  <td className="px-4 py-2 text-xs text-sdm-text">{r.speciesName || "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted font-mono">{r.modelId || "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted font-mono">{r.jobId || "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
                {expandedRun === r.id && (
                  <tr className="border-b border-sdm-border bg-sdm-surface-soft">
                    <td colSpan={5} className="px-4 py-3">
                      {detailLoading ? <Loader2 className="h-4 w-4 animate-spin text-sdm-accent" /> : runDetail ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <h4 className="text-xs font-medium text-sdm-muted mb-1">Config</h4>
                              <pre className="text-xs text-sdm-text bg-sdm-surface rounded p-2 max-h-40 overflow-auto">{JSON.stringify(runDetail.config, null, 2)}</pre>
                            </div>
                            <div>
                              <h4 className="text-xs font-medium text-sdm-muted mb-1">Metrics</h4>
                              <pre className="text-xs text-sdm-text bg-sdm-surface rounded p-2 max-h-40 overflow-auto">{JSON.stringify(runDetail.metrics, null, 2)}</pre>
                            </div>
                          </div>
                          {runDetail.error && (
                            <div>
                              <h4 className="text-xs font-medium text-red-400 mb-1">Error</h4>
                              <pre className="text-xs text-red-400 bg-red-500/5 rounded p-2 max-h-32 overflow-auto">{runDetail.error}</pre>
                            </div>
                          )}
                          {r.error && runDetail.error !== r.error && (
                            <div>
                              <h4 className="text-xs font-medium text-red-400 mb-1">Run Error (DB)</h4>
                              <pre className="text-xs text-red-400 bg-red-500/5 rounded p-2">{r.error}</pre>
                            </div>
                          )}
                        </div>
                      ) : <span className="text-xs text-sdm-muted">No diagnostics available</span>}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-sdm-muted">
        <span>{total} runs</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Previous</button>
          <button onClick={() => setPage(page + 1)} disabled={page * limit >= total}
            className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Next</button>
        </div>
      </div>
    </div>
  );
}