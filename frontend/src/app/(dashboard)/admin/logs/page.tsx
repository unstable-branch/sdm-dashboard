"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/services/api";
import { Loader2 } from "lucide-react";

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

  const limit = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (action) params.set("action", action);
      const data = await apiGet<{ logs: LogEntry[]; total: number }>(`/api/v1/admin/logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [page, action]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const commonActions = ["user_login", "user_register", "user_profile_update", "user_password_change", "settings_update", "admin_user_create", "admin_user_update", "system_cache_clear"];

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold text-sdm-heading">Usage Logs</h1>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setAction("")} className={`rounded px-3 py-1 text-xs ${!action ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text"}`}>All</button>
        {commonActions.map((a) => (
          <button key={a} onClick={() => setAction(a)}
            className={`rounded px-3 py-1 text-xs ${action === a ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text hover:bg-sdm-surface-soft"}`}>
            {a.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-sdm-border bg-sdm-surface-soft">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Time</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Entity</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-sdm-border hover:bg-sdm-surface-soft">
                <td className="px-4 py-2 text-xs text-sdm-muted whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2"><span className="text-xs font-medium text-sdm-text uppercase">{l.action}</span></td>
                <td className="px-4 py-2 text-xs text-sdm-muted">{l.entity || "-"}</td>
                <td className="px-4 py-2 text-xs text-sdm-muted font-mono">{l.ipAddress || "-"}</td>
              </tr>
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