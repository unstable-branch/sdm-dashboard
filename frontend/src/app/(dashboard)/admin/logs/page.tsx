"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/services/api";
import { Loader2, ChevronDown, ChevronRight, Download, Calendar, X } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";

interface LogEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [since, setSince] = useState("");
  const [before, setBefore] = useState("");
  const [exporting, setExporting] = useState(false);

  const limit = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (action) params.set("action", action);
      if (since) params.set("since", new Date(since).toISOString());
      if (before) params.set("before", new Date(before).toISOString());
      const data = await apiGet<{ logs: LogEntry[]; total: number }>(`/api/v1/admin/logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [page, action, since, before]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const commonActions = ["user_login", "user_register", "user_profile_update", "user_password_change", "settings_update", "admin_user_create", "admin_user_update", "system_cache_clear", "occurrence_upload", "model_run"];

  async function exportLogs() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: "1", limit: String(Math.min(total, 10000)) });
      if (action) params.set("action", action);
      if (since) params.set("since", new Date(since).toISOString());
      if (before) params.set("before", new Date(before).toISOString());
      const data = await apiGet<{ logs: LogEntry[] }>(`/api/v1/admin/logs?${params}`);
      const blob = new Blob([JSON.stringify(data.logs, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sdm-logs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent
    } finally {
      setExporting(false);
    }
  }

  function clearDateFilters() {
    setSince("");
    setBefore("");
  }

  const hasDateFilter = since || before;

  if (loading && logs.length === 0) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-sdm-heading">Usage Logs</h1>
        <button onClick={exportLogs} disabled={exporting || total === 0}
          className="rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft disabled:opacity-50">
          <Download className="h-3.5 w-3.5 inline mr-1" />
          {exporting ? "Exporting..." : "Export JSON"}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <button onClick={() => setAction("")} className={`rounded px-3 py-1 text-xs ${!action ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text"}`}>All</button>
        {commonActions.map((a) => (
          <button key={a} onClick={() => setAction(a)}
            className={`rounded px-3 py-1 text-xs ${action === a ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text hover:bg-sdm-surface-soft"}`}>
            {a.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Calendar className="h-4 w-4 text-sdm-muted" />
        <input type="datetime-local" value={since} onChange={(e) => { setSince(e.target.value); setPage(1); }}
          className="rounded-md border border-sdm-border bg-sdm-surface px-2 py-1 text-xs text-sdm-text" />
        <span className="text-xs text-sdm-muted">to</span>
        <input type="datetime-local" value={before} onChange={(e) => { setBefore(e.target.value); setPage(1); }}
          className="rounded-md border border-sdm-border bg-sdm-surface px-2 py-1 text-xs text-sdm-text" />
        {hasDateFilter && (
          <button onClick={clearDateFilters} className="text-xs text-sdm-muted hover:text-sdm-text">
            <X className="h-3.5 w-3.5 inline mr-0.5" /> Clear
          </button>
        )}
      </div>

      {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-sdm-border bg-sdm-surface-soft">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted w-8"></th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Time</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Entity</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">IP</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-sdm-muted w-16">Copy</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tbody key={l.id}>
                <tr className="border-b border-sdm-border hover:bg-sdm-surface-soft cursor-pointer"
                  onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                  <td className="px-4 py-2">
                    {expandedId === l.id
                      ? <ChevronDown className="h-3.5 w-3.5 text-sdm-muted" />
                      : <ChevronRight className="h-3.5 w-3.5 text-sdm-muted" />}
                  </td>
                  <td className="px-4 py-2 text-xs text-sdm-muted whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2"><span className="text-xs font-medium text-sdm-text uppercase">{l.action}</span></td>
                  <td className="px-4 py-2 text-xs text-sdm-muted">{l.entity || "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted font-mono">{l.ipAddress || "-"}</td>
                  <td className="px-4 py-2 text-right">
                    <CopyButton value={l} onClick={(e) => e.stopPropagation()} />
                  </td>
                </tr>
                {expandedId === l.id && (
                  <tr className="border-b border-sdm-border bg-sdm-surface-soft">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="space-y-2 text-xs">
                        {l.userId && <div><span className="text-sdm-muted">User:</span> <span className="text-sdm-text">{l.userId}</span></div>}
                        {l.entityId && <div><span className="text-sdm-muted">Entity ID:</span> <span className="text-sdm-text">{l.entityId}</span></div>}
                        {l.details && (
                          <div>
                            <span className="text-sdm-muted">Details:</span>
                            <pre className="mt-1 p-2 rounded bg-sdm-surface border border-sdm-border overflow-x-auto max-h-48 text-sdm-text">{JSON.stringify(l.details, null, 2)}</pre>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <CopyButton value={l.details || {}} label="Copy details" />
                          <CopyButton value={l} label="Copy full entry" />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-sdm-muted">
        <span>{total} entries</span>
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
